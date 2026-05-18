const webpush = require("web-push");
const { db } = require("../db");

let pushConfigured = false;

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    pushConfigured = false;
    return false;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:support@ocs.local",
    publicKey,
    privateKey,
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
  return process.env.VAPID_PUBLIC_KEY || "";
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
  return db
    .prepare(`
      SELECT push_subscription_token
      FROM users
      WHERE role = 'doctor'
        AND is_active = 1
        AND deleted_at IS NULL
        AND push_subscription_token IS NOT NULL
        AND TRIM(push_subscription_token) != ''
    `)
    .all()
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
  const subscriptions = getDoctorPushSubscriptions();
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
  maybeNotifyDoctorLowStock,
  saveUserPushSubscription,
  sendNotification,
};
