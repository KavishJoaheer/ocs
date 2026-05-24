const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const { db } = require("../db");

let pushConfigured = false;
let cachedVapidKeys = null;

function resolveDataDir() {
  const explicitDbPath = process.env.DB_PATH;
  const volumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const isVercelRuntime = Boolean(process.env.VERCEL);
  const dbPath =
    explicitDbPath ||
    path.join(
      volumeMountPath || (isVercelRuntime ? path.join("/tmp") : path.join(__dirname, "..", "data")),
      "clinic.db",
    );

  return path.dirname(dbPath);
}

function getVapidStorePath() {
  return path.join(resolveDataDir(), "vapid.json");
}

function loadVapidKeys() {
  if (cachedVapidKeys) {
    return cachedVapidKeys;
  }

  const envPublic = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const envPrivate = String(process.env.VAPID_PRIVATE_KEY || "").trim();

  if (envPublic && envPrivate) {
    cachedVapidKeys = { publicKey: envPublic, privateKey: envPrivate };
    return cachedVapidKeys;
  }

  const vapidPath = getVapidStorePath();

  try {
    if (fs.existsSync(vapidPath)) {
      const stored = JSON.parse(fs.readFileSync(vapidPath, "utf8"));
      if (stored?.publicKey && stored?.privateKey) {
        cachedVapidKeys = {
          publicKey: String(stored.publicKey),
          privateKey: String(stored.privateKey),
        };
        return cachedVapidKeys;
      }
    }
  } catch (error) {
    console.warn("[push] Could not read stored VAPID keys:", error?.message || error);
  }

  if (process.env.VERCEL) {
    return null;
  }

  try {
    const generated = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(vapidPath), { recursive: true });
    fs.writeFileSync(vapidPath, JSON.stringify(generated, null, 2), "utf8");
    cachedVapidKeys = generated;
    console.log(`[push] Generated VAPID keys at ${vapidPath}`);
    return cachedVapidKeys;
  } catch (error) {
    console.warn("[push] Could not persist generated VAPID keys:", error?.message || error);
    return null;
  }
}

function configureWebPush() {
  const keys = loadVapidKeys();

  if (!keys?.publicKey || !keys?.privateKey) {
    pushConfigured = false;
    return false;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@ocsmedecins.com",
    keys.publicKey,
    keys.privateKey,
  );
  pushConfigured = true;
  return true;
}

function isPushConfigured() {
  if (!pushConfigured) {
    return configureWebPush();
  }

  return pushConfigured;
}

function getVapidPublicKey() {
  return loadVapidKeys()?.publicKey || "";
}

function parseSubscription(raw) {
  if (!raw) {
    return null;
  }

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed?.endpoint) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function getPushDeliveryOptions(payload = {}) {
  const options = {
    TTL: 0,
    urgency: "high",
  };

  const topic = String(payload?.tag || "").trim();
  if (topic) {
    options.topic = topic.slice(0, 32);
  }

  return options;
}

async function sendNotification(subscriptionRaw, payload) {
  if (!isPushConfigured()) {
    return { ok: false, skipped: true, reason: "push_not_configured" };
  }

  const subscription = parseSubscription(subscriptionRaw);
  if (!subscription) {
    return { ok: false, skipped: true, reason: "invalid_subscription" };
  }

  const body =
    typeof payload === "string" ? payload : JSON.stringify(payload ?? {});

  let deliveryPayload = payload;
  if (typeof payload === "string") {
    try {
      deliveryPayload = JSON.parse(payload);
    } catch {
      deliveryPayload = {};
    }
  }

  try {
    await webpush.sendNotification(subscription, body, getPushDeliveryOptions(deliveryPayload));
    return { ok: true };
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410 || statusCode === 401 || statusCode === 403) {
      try {
        clearPushSubscriptionByEndpoint(subscription.endpoint);
      } catch (clearError) {
        console.warn("[push] could not clear stale subscription:", clearError?.message || clearError);
      }
    }

    console.warn("[push] delivery failed:", error?.message || error);
    return { ok: false, error: error?.message || "delivery_failed" };
  }
}

function clearPushSubscriptionByEndpoint(endpoint) {
  if (!endpoint) {
    return;
  }

  db.prepare(`
    UPDATE users
    SET push_subscription_token = NULL
    WHERE push_subscription_token LIKE ?
  `).run(`%${endpoint}%`);
}

function saveUserPushSubscription(userId, subscription) {
  const serialized = JSON.stringify(subscription);
  db.prepare(`
    UPDATE users
    SET push_subscription_token = ?
    WHERE id = ?
  `).run(serialized, userId);
}

function clearUserPushSubscription(userId) {
  db.prepare(`
    UPDATE users
    SET push_subscription_token = NULL
    WHERE id = ?
  `).run(userId);
}

const LOW_STOCK_DOCTOR_NOTIFICATION_KEY = "low_stock";
const LOW_STOCK_OCS_NOTIFICATION_KEY = "low_stock_ocs";
const LOW_STOCK_REMINDER_MS = 6 * 60 * 60 * 1000;
const OCS_LOW_STOCK_ROLES = ["admin", "operator"];

function ensurePushNotificationStateTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_notification_state (
      user_id INTEGER NOT NULL,
      notification_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL DEFAULT '',
      last_sent_at TEXT NOT NULL,
      PRIMARY KEY (user_id, notification_key)
    )
  `);
}

function getUserPushSubscription(userId) {
  const row = db
    .prepare(`
      SELECT push_subscription_token
      FROM users
      WHERE id = ?
        AND is_active = 1
        AND deleted_at IS NULL
        AND push_subscription_token IS NOT NULL
        AND TRIM(push_subscription_token) != ''
    `)
    .get(userId);

  return row?.push_subscription_token || null;
}

function getDoctorUserId(doctorId) {
  const row = db
    .prepare(`
      SELECT id
      FROM users
      WHERE doctor_id = ?
        AND role = 'doctor'
        AND is_active = 1
        AND deleted_at IS NULL
      LIMIT 1
    `)
    .get(doctorId);

  return row?.id ? Number(row.id) : null;
}

function getDoctorPushSubscription(doctorId) {
  const userId = getDoctorUserId(doctorId);
  if (!userId) {
    return null;
  }

  return getUserPushSubscription(userId);
}

function resolveDoctorPushSubscription({ doctorId, userId = null }) {
  if (userId) {
    const directSubscription = getUserPushSubscription(userId);
    if (directSubscription) {
      return directSubscription;
    }
  }

  return getDoctorPushSubscription(doctorId);
}

function getDoctorLowStockItemIds(doctorId) {
  const rows = db
    .prepare(`
      SELECT
        i.id AS my_item_id,
        i.quantity AS my_quantity,
        i.minimum_quantity AS par_level
      FROM inventory i
      WHERE i.stock_scope = 'doctor'
        AND i.owner_doctor_id = ?
        AND i.minimum_quantity > 0
    `)
    .all(doctorId);

  return rows
    .map((row) => {
      const parLevel = Number(row.par_level || 0);
      const quantity = Number(row.my_quantity || 0);
      const ratio = parLevel > 0 ? quantity / parLevel : 1;
      const requiredQuantity = Math.max(parLevel - quantity, 0);

      return {
        itemId: Number(row.my_item_id),
        parLevel,
        quantity,
        ratio,
        requiredQuantity,
      };
    })
    .filter((row) => row.parLevel > 0 && row.ratio < 0.5 && row.requiredQuantity > 0)
    .map((row) => row.itemId);
}

function getOcsLowStockItemIds() {
  const rows = db
    .prepare(`
      SELECT id, quantity, minimum_quantity
      FROM inventory
      WHERE stock_scope = 'ocs'
        AND minimum_quantity > 0
    `)
    .all();

  return rows
    .filter((row) => {
      const parLevel = Number(row.minimum_quantity || 0);
      const quantity = Number(row.quantity || 0);
      return parLevel > 0 && quantity <= parLevel;
    })
    .map((row) => Number(row.id));
}

function getAdminOperatorSubscriberUserIds() {
  const placeholders = OCS_LOW_STOCK_ROLES.map(() => "?").join(", ");

  return db
    .prepare(`
      SELECT id
      FROM users
      WHERE role IN (${placeholders})
        AND is_active = 1
        AND deleted_at IS NULL
        AND push_subscription_token IS NOT NULL
        AND TRIM(push_subscription_token) != ''
    `)
    .all(...OCS_LOW_STOCK_ROLES)
    .map((row) => Number(row.id));
}

function shouldSendLowStockReminder(userId, payloadHash, notificationKey) {
  ensurePushNotificationStateTable();

  const existing = db
    .prepare(`
      SELECT payload_hash, last_sent_at
      FROM push_notification_state
      WHERE user_id = ?
        AND notification_key = ?
    `)
    .get(userId, notificationKey);

  if (!existing) {
    return true;
  }

  if (String(existing.payload_hash || "") !== payloadHash) {
    return true;
  }

  const lastSentMs = new Date(existing.last_sent_at).getTime();
  if (Number.isNaN(lastSentMs)) {
    return true;
  }

  return Date.now() - lastSentMs >= LOW_STOCK_REMINDER_MS;
}

function recordLowStockNotification(userId, payloadHash, notificationKey) {
  ensurePushNotificationStateTable();

  db.prepare(`
    INSERT INTO push_notification_state (user_id, notification_key, payload_hash, last_sent_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, notification_key) DO UPDATE SET
      payload_hash = excluded.payload_hash,
      last_sent_at = CURRENT_TIMESTAMP
  `).run(userId, notificationKey, payloadHash);
}

async function notifyDoctorLowStockSummary({ doctorId, userId = null }) {
  const normalizedDoctorId = Number(doctorId || 0);
  if (!normalizedDoctorId) {
    return { ok: false, skipped: true, reason: "missing_doctor_id" };
  }

  const lowStockItemIds = getDoctorLowStockItemIds(normalizedDoctorId);
  if (!lowStockItemIds.length) {
    return { ok: false, skipped: true, reason: "no_low_stock_items" };
  }

  const resolvedUserId = Number(userId || 0) || getDoctorUserId(normalizedDoctorId);
  if (!resolvedUserId) {
    return { ok: false, skipped: true, reason: "missing_doctor_user" };
  }

  const payloadHash = lowStockItemIds.sort((left, right) => left - right).join(",");
  if (!shouldSendLowStockReminder(resolvedUserId, payloadHash, LOW_STOCK_DOCTOR_NOTIFICATION_KEY)) {
    return { ok: false, skipped: true, reason: "cooldown_active" };
  }

  const subscription = resolveDoctorPushSubscription({
    doctorId: normalizedDoctorId,
    userId: resolvedUserId,
  });
  if (!subscription) {
    return { ok: false, skipped: true, reason: "no_subscription" };
  }

  const count = lowStockItemIds.length;
  const payload = {
    title: "⚠️ Low Stock Alert",
    body:
      count === 1
        ? "1 kit item is below 50% par level. Tap to restock now."
        : `${count} kit items are below 50% par level. Tap to restock now.`,
    url: "/inventory?context=my&restock=alert",
    icon: "/icon-192.png",
    tag: "doctor-low-stock",
  };

  const result = await sendNotification(subscription, payload);
  if (result.ok) {
    recordLowStockNotification(resolvedUserId, payloadHash, LOW_STOCK_DOCTOR_NOTIFICATION_KEY);
  }

  return result;
}

async function notifyOcsLowStockSubscribers({ userIds = null } = {}) {
  const lowStockItemIds = getOcsLowStockItemIds();
  if (!lowStockItemIds.length) {
    return { ok: false, skipped: true, reason: "no_low_stock_items" };
  }

  const targetUserIds = Array.isArray(userIds) && userIds.length
    ? [...new Set(userIds.map((value) => Number(value)).filter(Boolean))]
    : getAdminOperatorSubscriberUserIds();

  if (!targetUserIds.length) {
    return { ok: false, skipped: true, reason: "no_subscribers" };
  }

  const payloadHash = lowStockItemIds.sort((left, right) => left - right).join(",");
  const count = lowStockItemIds.length;
  const payload = {
    title: "⚠️ Low Stock Alert",
    body:
      count === 1
        ? "1 OCS stock item is at or below par level. Tap to review inventory."
        : `${count} OCS stock items are at or below par level. Tap to review inventory.`,
    url: "/inventory",
    icon: "/icon-192.png",
    tag: "ocs-low-stock",
  };

  const results = await Promise.allSettled(
    targetUserIds.map(async (targetUserId) => {
      if (!shouldSendLowStockReminder(targetUserId, payloadHash, LOW_STOCK_OCS_NOTIFICATION_KEY)) {
        return { ok: false, skipped: true, reason: "cooldown_active", userId: targetUserId };
      }

      const subscription = getUserPushSubscription(targetUserId);
      if (!subscription) {
        return { ok: false, skipped: true, reason: "no_subscription", userId: targetUserId };
      }

      const result = await sendNotification(subscription, payload);
      if (result.ok) {
        recordLowStockNotification(targetUserId, payloadHash, LOW_STOCK_OCS_NOTIFICATION_KEY);
      }

      return { ...result, userId: targetUserId };
    }),
  );

  const delivered = results.filter(
    (entry) => entry.status === "fulfilled" && entry.value?.ok,
  ).length;

  return {
    ok: delivered > 0,
    delivered,
    attempted: targetUserIds.length,
  };
}

function getDoctorPushSubscriptions() {
  return getTeamPushSubscriptions({ roles: ["doctor"] });
}

const PUSH_SUBSCRIBER_ROLES = ["admin", "doctor", "operator", "lab_tech", "accountant"];

function listPushSubscriptionStatus() {
  const placeholders = PUSH_SUBSCRIBER_ROLES.map(() => "?").join(", ");
  const rows = db
    .prepare(`
      SELECT
        u.id,
        u.full_name,
        u.username,
        u.role,
        d.full_name AS doctor_profile_name,
        CASE
          WHEN u.push_subscription_token IS NOT NULL AND TRIM(u.push_subscription_token) != ''
          THEN 1
          ELSE 0
        END AS push_enabled
      FROM users u
      LEFT JOIN doctors d ON d.id = u.doctor_id
      WHERE u.is_active = 1
        AND u.deleted_at IS NULL
        AND u.role IN (${placeholders})
      ORDER BY
        CASE u.role
          WHEN 'doctor' THEN 1
          WHEN 'operator' THEN 2
          WHEN 'accountant' THEN 3
          WHEN 'lab_tech' THEN 4
          WHEN 'admin' THEN 5
          ELSE 6
        END,
        u.full_name COLLATE NOCASE
    `)
    .all(...PUSH_SUBSCRIBER_ROLES);

  const subscribers = rows.map((row) => ({
    user_id: Number(row.id),
    full_name: row.full_name,
    username: row.username,
    role: row.role,
    doctor_profile_name: row.doctor_profile_name || null,
    push_enabled: Boolean(row.push_enabled),
  }));

  const summary = {
    total: subscribers.length,
    enabled: subscribers.filter((entry) => entry.push_enabled).length,
    by_role: {},
  };

  for (const entry of subscribers) {
    if (!summary.by_role[entry.role]) {
      summary.by_role[entry.role] = { total: 0, enabled: 0 };
    }

    summary.by_role[entry.role].total += 1;
    if (entry.push_enabled) {
      summary.by_role[entry.role].enabled += 1;
    }
  }

  return {
    configured: isPushConfigured(),
    summary,
    subscribers,
  };
}

function getTeamPushSubscriptions({ roles = null, excludeRoles = [] } = {}) {
  const rows = db
    .prepare(`
      SELECT push_subscription_token, role
      FROM users
      WHERE is_active = 1
        AND deleted_at IS NULL
        AND push_subscription_token IS NOT NULL
        AND TRIM(push_subscription_token) != ''
    `)
    .all();

  return rows
    .filter((row) => {
      if (excludeRoles.includes(row.role)) {
        return false;
      }

      if (roles && !roles.includes(row.role)) {
        return false;
      }

      return true;
    })
    .map((row) => row.push_subscription_token)
    .filter(Boolean);
}

async function maybeNotifyLowStock(itemId, actingUserId = null) {
  const item = db
    .prepare(`
      SELECT
        quantity AS current_quantity,
        minimum_quantity AS par_level,
        owner_doctor_id,
        stock_scope
      FROM inventory
      WHERE id = ?
    `)
    .get(itemId);

  if (!item) {
    return { ok: false, skipped: true, reason: "item_not_found" };
  }

  const parLevel = Number(item.par_level || 0);
  const currentQuantity = Number(item.current_quantity || 0);

  if (item.stock_scope === "doctor" && item.owner_doctor_id) {
    if (parLevel <= 0 || currentQuantity > parLevel * 0.5) {
      return { ok: false, skipped: true, reason: "not_low_stock" };
    }

    return notifyDoctorLowStockSummary({
      doctorId: Number(item.owner_doctor_id),
      userId: actingUserId ? Number(actingUserId) : null,
    });
  }

  if (item.stock_scope === "ocs") {
    if (parLevel <= 0 || currentQuantity > parLevel) {
      return { ok: false, skipped: true, reason: "not_low_stock" };
    }

    return notifyOcsLowStockSubscribers();
  }

  return { ok: false, skipped: true, reason: "unsupported_scope" };
}

async function maybeNotifyDoctorLowStock(itemId, actingUserId = null) {
  return maybeNotifyLowStock(itemId, actingUserId);
}

async function broadcastHcmNewsToDoctors(newsArticle) {
  const subscriptions = getTeamPushSubscriptions({ excludeRoles: ["admin"] });
  if (!subscriptions.length) {
    return;
  }

  const title = String(newsArticle?.title || "HCM update").trim();
  const payload = {
    title: "📢 New HCM Update",
    body: `${title} - Tap to read full notice.`,
    url: "/hcm-news",
    icon: "/icon-192.png",
    tag: "hcm-news",
  };

  await Promise.allSettled(
    subscriptions.map((subscription) => sendNotification(subscription, payload)),
  );
}

configureWebPush();

module.exports = {
  broadcastHcmNewsToDoctors,
  clearUserPushSubscription,
  getVapidPublicKey,
  isPushConfigured,
  listPushSubscriptionStatus,
  maybeNotifyDoctorLowStock,
  maybeNotifyLowStock,
  notifyDoctorLowStockSummary,
  notifyOcsLowStockSubscribers,
  saveUserPushSubscription,
  sendNotification,
};
