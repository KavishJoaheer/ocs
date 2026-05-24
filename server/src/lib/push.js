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
  // Keep urgency high so the OS surfaces alerts immediately, but give push
  // services a 24h retention window so devices that are temporarily offline
  // still receive low-stock/critical notifications when they reconnect.
  const options = {
    TTL: 86400,
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
    return { ok: true, endpoint: subscription.endpoint };
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
    return { ok: false, error: error?.message || "delivery_failed", endpoint: subscription.endpoint };
  }
}

function clearPushSubscriptionByEndpoint(endpoint) {
  if (!endpoint) {
    return;
  }

  db.prepare("DELETE FROM user_push_subscriptions WHERE endpoint = ?").run(endpoint);
}

function saveUserPushSubscription(userId, subscription, userAgent = null) {
  const endpoint = subscription?.endpoint && String(subscription.endpoint).trim();
  if (!endpoint) {
    return { ok: false, reason: "missing_endpoint" };
  }

  const serialized = JSON.stringify(subscription);

  // Upsert on the endpoint: if the same browser re-subscribes (e.g. after
  // pushsubscriptionchange) we replace the JSON without inserting a duplicate
  // row; if a different user re-binds the same endpoint we reassign it.
  db.prepare(`
    INSERT INTO user_push_subscriptions
      (user_id, endpoint, subscription_json, user_agent, last_seen_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      subscription_json = excluded.subscription_json,
      user_agent = COALESCE(excluded.user_agent, user_push_subscriptions.user_agent),
      updated_at = CURRENT_TIMESTAMP,
      last_seen_at = CURRENT_TIMESTAMP
  `).run(userId, endpoint, serialized, userAgent ? String(userAgent).slice(0, 255) : null);

  return { ok: true, endpoint };
}

function clearUserPushSubscription(userId, { endpoint = null } = {}) {
  if (endpoint) {
    db.prepare(
      "DELETE FROM user_push_subscriptions WHERE user_id = ? AND endpoint = ?",
    ).run(userId, endpoint);
    return;
  }

  db.prepare("DELETE FROM user_push_subscriptions WHERE user_id = ?").run(userId);
}

const LOW_STOCK_DOCTOR_NOTIFICATION_KEY = "low_stock";
const LOW_STOCK_DOCTOR_OPERATOR_NOTIFICATION_KEY = "low_stock_doctor_ops";
const LOW_STOCK_OCS_NOTIFICATION_KEY = "low_stock_ocs";
const LOW_STOCK_REMINDER_MS = 6 * 60 * 60 * 1000;
const OCS_LOW_STOCK_ROLES = ["admin", "operator"];
const DOCTOR_BAG_OPERATOR_ROLES = ["operator"];
const MASTER_WAREHOUSE_ROLES = ["admin", "operator"];

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

function getUserPushSubscriptions(userId) {
  return db
    .prepare(`
      SELECT s.subscription_json
      FROM user_push_subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ?
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `)
    .all(userId)
    .map((row) => row.subscription_json)
    .filter(Boolean);
}

function getUserPushSubscription(userId) {
  // Legacy single-subscription helper kept for callers that only care about
  // "does this user have any active device?". Returns the most recently
  // updated subscription JSON when there are several.
  const row = db
    .prepare(`
      SELECT s.subscription_json
      FROM user_push_subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ?
        AND u.is_active = 1
        AND u.deleted_at IS NULL
      ORDER BY datetime(s.updated_at) DESC
      LIMIT 1
    `)
    .get(userId);

  return row?.subscription_json || null;
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
  return getSubscriberUserIdsByRoles(OCS_LOW_STOCK_ROLES);
}

function getSubscriberUserIdsByRole(role) {
  return db
    .prepare(`
      SELECT DISTINCT u.id
      FROM users u
      INNER JOIN user_push_subscriptions s ON s.user_id = u.id
      WHERE u.role = ?
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `)
    .all(role)
    .map((row) => Number(row.id));
}

function getSubscriberUserIdsByRoles(roles = []) {
  const normalizedRoles = [...new Set(roles.map((role) => String(role || "").trim()).filter(Boolean))];
  if (!normalizedRoles.length) {
    return [];
  }

  const placeholders = normalizedRoles.map(() => "?").join(", ");

  return db
    .prepare(`
      SELECT DISTINCT u.id
      FROM users u
      INNER JOIN user_push_subscriptions s ON s.user_id = u.id
      WHERE u.role IN (${placeholders})
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `)
    .all(...normalizedRoles)
    .map((row) => Number(row.id));
}

function getLowStockItemContext(itemId) {
  return db
    .prepare(`
      SELECT
        i.id,
        i.item_name,
        i.quantity,
        i.minimum_quantity,
        i.stock_scope,
        i.owner_doctor_id,
        d.full_name AS doctor_name
      FROM inventory i
      LEFT JOIN doctors d ON d.id = i.owner_doctor_id
      WHERE i.id = ?
    `)
    .get(itemId);
}

function resolveLowStockAlertDestinations(alert = {}) {
  const source = String(alert?.source || "").trim();

  if (source === "doctor_bag") {
    const destinations = [];
    const doctorUserId = Number(alert?.doctorUserId || 0);

    if (doctorUserId) {
      destinations.push({ type: "user", userId: doctorUserId, audience: "doctor" });
    }

    for (const role of DOCTOR_BAG_OPERATOR_ROLES) {
      destinations.push({ type: "role", role, audience: "operator" });
    }

    return destinations;
  }

  if (source === "master_warehouse") {
    return MASTER_WAREHOUSE_ROLES.map((role) => ({
      type: "role",
      role,
      audience: role,
    }));
  }

  return [];
}

function validateLowStockAlertDestinations(alert = {}, destinations = []) {
  const source = String(alert?.source || "").trim();

  if (!destinations.length) {
    return { ok: false, reason: "no_destinations" };
  }

  if (source === "doctor_bag") {
    const hasDoctorRoleBroadcast = destinations.some(
      (destination) => destination.type === "role" && destination.role === "doctor",
    );
    if (hasDoctorRoleBroadcast) {
      return { ok: false, reason: "doctor_bag_must_not_broadcast_to_doctor_role" };
    }

    const hasDoctorUserTarget = destinations.some(
      (destination) => destination.type === "user" && destination.audience === "doctor",
    );
    if (!hasDoctorUserTarget && Number(alert?.doctorUserId || 0)) {
      return { ok: false, reason: "doctor_bag_missing_active_doctor_target" };
    }

    return { ok: true };
  }

  if (source === "master_warehouse") {
    const includesDoctorAudience = destinations.some(
      (destination) =>
        destination.role === "doctor" ||
        destination.audience === "doctor" ||
        destination.type === "user",
    );
    if (includesDoctorAudience) {
      return { ok: false, reason: "master_warehouse_must_not_target_doctors" };
    }

    const allowedRoles = new Set(MASTER_WAREHOUSE_ROLES);
    const invalidRole = destinations.find(
      (destination) => destination.type === "role" && !allowedRoles.has(destination.role),
    );
    if (invalidRole) {
      return { ok: false, reason: "master_warehouse_invalid_role" };
    }

    return { ok: true };
  }

  return { ok: false, reason: "unsupported_alert_source" };
}

async function sendPushToUser(userId, payload, { notificationKey = null, payloadHash = null } = {}) {
  const normalizedUserId = Number(userId || 0);
  if (!normalizedUserId) {
    return { ok: false, skipped: true, reason: "missing_user_id", userId: normalizedUserId };
  }

  if (notificationKey && payloadHash && !shouldSendLowStockReminder(normalizedUserId, payloadHash, notificationKey)) {
    return { ok: false, skipped: true, reason: "cooldown_active", userId: normalizedUserId };
  }

  // Fan out to every active device the user has registered. A delivery
  // counts as successful if at least one endpoint accepts the push.
  const subscriptions = getUserPushSubscriptions(normalizedUserId);
  if (!subscriptions.length) {
    return { ok: false, skipped: true, reason: "no_subscription", userId: normalizedUserId };
  }

  const results = await Promise.allSettled(
    subscriptions.map((subscription) => sendNotification(subscription, payload)),
  );

  const delivered = results.some(
    (entry) => entry.status === "fulfilled" && entry.value?.ok,
  );

  if (delivered && notificationKey && payloadHash) {
    recordLowStockNotification(normalizedUserId, payloadHash, notificationKey);
  }

  return {
    ok: delivered,
    userId: normalizedUserId,
    endpoints: subscriptions.length,
  };
}

async function sendPushToRole(role, payload, options = {}) {
  const userIds = getSubscriberUserIdsByRole(role);
  const results = await Promise.all(
    userIds.map((userId) => sendPushToUser(userId, payload, options)),
  );

  return results;
}

async function dispatchLowStockAlert(alert = {}) {
  const destinations = resolveLowStockAlertDestinations(alert);
  const validation = validateLowStockAlertDestinations(alert, destinations);

  if (!validation.ok) {
    return { ok: false, skipped: true, reason: validation.reason, destinations: destinations.length };
  }

  const deliveries = [];

  for (const destination of destinations) {
    const audience = destination.audience;
    const payload = alert.payloads?.[audience];
    if (!payload) {
      continue;
    }

    const notificationKey = alert.notificationKeys?.[audience] || LOW_STOCK_OCS_NOTIFICATION_KEY;
    const options = {
      notificationKey,
      payloadHash: String(alert.payloadHash || ""),
    };

    if (destination.type === "user") {
      deliveries.push(await sendPushToUser(destination.userId, payload, options));
      continue;
    }

    if (destination.type === "role") {
      deliveries.push(...(await sendPushToRole(destination.role, payload, options)));
    }
  }

  const delivered = deliveries.filter((entry) => entry.ok).length;

  return {
    ok: delivered > 0,
    delivered,
    attempted: deliveries.length,
    destinations: destinations.length,
    source: alert.source,
  };
}

async function notifyDoctorBagLowStock({ itemId, doctorId, actingUserId = null }) {
  const normalizedItemId = Number(itemId || 0);
  const normalizedDoctorId = Number(doctorId || 0);
  if (!normalizedItemId || !normalizedDoctorId) {
    return { ok: false, skipped: true, reason: "missing_doctor_bag_context" };
  }

  const context = getLowStockItemContext(normalizedItemId);
  if (!context || context.stock_scope !== "doctor" || Number(context.owner_doctor_id) !== normalizedDoctorId) {
    return { ok: false, skipped: true, reason: "invalid_doctor_bag_item" };
  }

  const quantity = Number(context.quantity || 0);
  const itemName = String(context.item_name || "item").trim();
  const doctorName = String(context.doctor_name || "Doctor").trim();
  const doctorUserId = Number(actingUserId || 0) || getDoctorUserId(normalizedDoctorId);

  return dispatchLowStockAlert({
    source: "doctor_bag",
    doctorId: normalizedDoctorId,
    doctorUserId,
    itemId: normalizedItemId,
    payloadHash: `${normalizedDoctorId}:${normalizedItemId}:${quantity}`,
    notificationKeys: {
      doctor: LOW_STOCK_DOCTOR_NOTIFICATION_KEY,
      operator: LOW_STOCK_DOCTOR_OPERATOR_NOTIFICATION_KEY,
    },
    payloads: {
      doctor: {
        title: "⚠️ Low Stock",
        body: `You only have ${quantity} left of ${itemName} in your bag.`,
        url: "/inventory?context=my&restock=alert",
        icon: "/icon-192.png",
        tag: "doctor-low-stock",
      },
      operator: {
        title: "📦 Restock Alert",
        body: `Dr. ${doctorName} is low on ${itemName}. Prepare restock.`,
        url: "/inventory",
        icon: "/icon-192.png",
        tag: "doctor-bag-restock",
      },
    },
  });
}

async function notifyMasterWarehouseLowStock({ itemId }) {
  const normalizedItemId = Number(itemId || 0);
  if (!normalizedItemId) {
    return { ok: false, skipped: true, reason: "missing_item_id" };
  }

  const context = getLowStockItemContext(normalizedItemId);
  if (!context || context.stock_scope !== "ocs") {
    return { ok: false, skipped: true, reason: "invalid_master_warehouse_item" };
  }

  const quantity = Number(context.quantity || 0);
  const parLevel = Number(context.minimum_quantity || 0);
  const itemName = String(context.item_name || "item").trim();
  const warehousePayload = {
    title: "⚠️ Low Stock Alert",
    body: `${itemName} is at or below par level (${quantity}/${parLevel}) in master warehouse.`,
    url: "/inventory",
    icon: "/icon-192.png",
    tag: "ocs-low-stock",
  };

  return dispatchLowStockAlert({
    source: "master_warehouse",
    itemId: normalizedItemId,
    payloadHash: `${normalizedItemId}:${quantity}`,
    notificationKeys: {
      operator: LOW_STOCK_OCS_NOTIFICATION_KEY,
      admin: LOW_STOCK_OCS_NOTIFICATION_KEY,
    },
    payloads: {
      operator: warehousePayload,
      admin: warehousePayload,
    },
  });
}

function filterMasterWarehouseRecipientUserIds(userIds = null) {
  if (!Array.isArray(userIds) || !userIds.length) {
    return getAdminOperatorSubscriberUserIds();
  }

  const normalizedUserIds = [...new Set(userIds.map((value) => Number(value)).filter(Boolean))];
  if (!normalizedUserIds.length) {
    return [];
  }

  const placeholders = normalizedUserIds.map(() => "?").join(", ");
  const rolePlaceholders = MASTER_WAREHOUSE_ROLES.map(() => "?").join(", ");

  return db
    .prepare(`
      SELECT DISTINCT u.id
      FROM users u
      INNER JOIN user_push_subscriptions s ON s.user_id = u.id
      WHERE u.id IN (${placeholders})
        AND u.role IN (${rolePlaceholders})
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `)
    .all(...normalizedUserIds, ...MASTER_WAREHOUSE_ROLES)
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

  const result = await sendPushToUser(resolvedUserId, payload);
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

  const targetUserIds = filterMasterWarehouseRecipientUserIds(userIds);

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

      const result = await sendPushToUser(targetUserId, payload);
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
        (
          SELECT COUNT(*)
          FROM user_push_subscriptions s
          WHERE s.user_id = u.id
        ) AS device_count
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
    push_enabled: Number(row.device_count || 0) > 0,
    device_count: Number(row.device_count || 0),
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
      SELECT s.subscription_json, u.role
      FROM user_push_subscriptions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE u.is_active = 1
        AND u.deleted_at IS NULL
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
    .map((row) => row.subscription_json)
    .filter(Boolean);
}

async function maybeNotifyLowStock(itemId, actingUserId = null) {
  const item = getLowStockItemContext(itemId);

  if (!item) {
    return { ok: false, skipped: true, reason: "item_not_found" };
  }

  const parLevel = Number(item.minimum_quantity || 0);
  const currentQuantity = Number(item.quantity || 0);

  if (item.stock_scope === "doctor" && item.owner_doctor_id) {
    if (parLevel <= 0 || currentQuantity > parLevel * 0.5) {
      return { ok: false, skipped: true, reason: "not_low_stock" };
    }

    return notifyDoctorBagLowStock({
      itemId: Number(itemId),
      doctorId: Number(item.owner_doctor_id),
      actingUserId: actingUserId ? Number(actingUserId) : null,
    });
  }

  if (item.stock_scope === "ocs") {
    if (parLevel <= 0 || currentQuantity > parLevel) {
      return { ok: false, skipped: true, reason: "not_low_stock" };
    }

    return notifyMasterWarehouseLowStock({ itemId: Number(itemId) });
  }

  return { ok: false, skipped: true, reason: "unsupported_scope" };
}

async function maybeNotifyDoctorLowStock(itemId, actingUserId = null) {
  return maybeNotifyLowStock(itemId, actingUserId);
}

// Banner copy ("Get HCM news and operational updates on this device") is
// only shown to roles that actually need HCM digests: doctors, lab techs,
// and accountants. Admins and operators see a low-stock-only banner, so
// excluding them here keeps the surface area honest and avoids sending
// unsolicited noise to those devices.
const HCM_BROADCAST_ROLES = ["doctor", "lab_tech", "accountant"];

async function broadcastHcmNewsToDoctors(newsArticle) {
  const subscriptions = getTeamPushSubscriptions({ roles: HCM_BROADCAST_ROLES });
  if (!subscriptions.length) {
    return;
  }

  const rawTitle = String(newsArticle?.title || "HCM update").trim();
  // iOS truncates oversized push payload bodies inconsistently; keep the
  // headline short and let the deep link carry the full read.
  const title = rawTitle.length > 120 ? `${rawTitle.slice(0, 117)}…` : rawTitle;
  const payload = {
    title: "📢 New HCM Update",
    body: `${title} — Tap to read full notice.`,
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
  dispatchLowStockAlert,
  getVapidPublicKey,
  isPushConfigured,
  listPushSubscriptionStatus,
  maybeNotifyDoctorLowStock,
  maybeNotifyLowStock,
  notifyDoctorBagLowStock,
  notifyDoctorLowStockSummary,
  notifyMasterWarehouseLowStock,
  notifyOcsLowStockSubscribers,
  resolveLowStockAlertDestinations,
  saveUserPushSubscription,
  sendNotification,
  sendPushToRole,
  sendPushToUser,
  validateLowStockAlertDestinations,
};
