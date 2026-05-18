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
    process.env.VAPID_SUBJECT || "mailto:support@ocs.local",
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

  try {
    await webpush.sendNotification(subscription, body);
    return { ok: true };
  } catch (error) {
    const statusCode = Number(error?.statusCode || 0);
    if (statusCode === 404 || statusCode === 410) {
      clearPushSubscriptionByEndpoint(subscription.endpoint);
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

function getDoctorPushSubscription(doctorId) {
  const row = db
    .prepare(`
      SELECT push_subscription_token
      FROM users
      WHERE doctor_id = ?
        AND role = 'doctor'
        AND is_active = 1
        AND deleted_at IS NULL
        AND push_subscription_token IS NOT NULL
        AND TRIM(push_subscription_token) != ''
      LIMIT 1
    `)
    .get(doctorId);

  return row?.push_subscription_token || null;
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

async function maybeNotifyDoctorLowStock(itemId) {
  const item = db
    .prepare(`
      SELECT
        item_name,
        quantity AS current_quantity,
        minimum_quantity AS par_level,
        owner_doctor_id,
        stock_scope
      FROM inventory
      WHERE id = ?
    `)
    .get(itemId);

  if (!item || item.stock_scope !== "doctor" || !item.owner_doctor_id) {
    return;
  }

  const parLevel = Number(item.par_level || 0);
  const currentQuantity = Number(item.current_quantity || 0);

  if (parLevel <= 0 || currentQuantity > parLevel * 0.5) {
    return;
  }

  const subscription = getDoctorPushSubscription(Number(item.owner_doctor_id));
  if (!subscription) {
    return;
  }

  const payload = {
    title: "⚠️ Low Stock Alert",
    body: `Your kit item [${item.item_name}] is below 50% par level. Tap to restock now.`,
    url: "/inventory",
    icon: "/assets/icons/alert-icon.svg",
  };

  await sendNotification(subscription, payload);
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
    icon: "/assets/icons/news-icon.svg",
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
  saveUserPushSubscription,
  sendNotification,
};
