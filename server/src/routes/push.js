const express = require("express");
const { authorizeRoles, requireAuth } = require("../lib/auth");
const {
  clearUserPushSubscription,
  getVapidPublicKey,
  isPushConfigured,
  listPushSubscriptionStatus,
  saveUserPushSubscription,
  getUserPushSubscriptions,
  sendNotification,
} = require("../lib/push");

const router = express.Router();
const PUSH_SUBSCRIBER_ROLES = ["admin", "doctor", "operator", "lab_tech", "accountant"];
const testAttempts = new Map();

router.post('/test-device', requireAuth, authorizeRoles(...PUSH_SUBSCRIBER_ROLES), async (req, res) => {
  if (!isPushConfigured()) return res.status(503).json({error:'Web push is not configured on this server.'});
  const endpoint = String(req.body?.endpoint || '');
  const owned = getUserPushSubscriptions(req.auth.id).find(raw => {
    try { return JSON.parse(raw).endpoint === endpoint; } catch { return false; }
  });
  if (!owned) return res.status(404).json({error:'This device is not registered to your account. Turn alerts off and on again on this device.'});
  const now = Date.now();
  for (const [id, at] of testAttempts) if (now - at >= 60000) testAttempts.delete(id);
  if (testAttempts.has(req.auth.id)) return res.status(429).json({error:'Wait one minute before testing again.'});
  testAttempts.set(req.auth.id, now);
  const result = await sendNotification(owned, {title:'OCS device alert test', body:'If you see this alert, notifications reached this device.', url:'/', tag:'ocs-device-test', icon:'/icon-192.png'});
  if (!result.ok) return res.status(502).json({error:'The push service did not accept the test. Re-enable alerts on this device and try again.'});
  return res.json({accepted:true, message:'Test accepted by the push service. Confirm that the alert appeared on this device; acceptance alone does not prove delivery.'});
});

router.get("/vapid-public-key", (_req, res) => {
  const configured = isPushConfigured();
  const publicKey = configured ? getVapidPublicKey() : null;

  res.json({
    configured,
    publicKey,
  });
});

router.get("/subscriber-status", requireAuth, authorizeRoles("admin"), (_req, res) => {
  res.json(listPushSubscriptionStatus());
});

router.post("/subscribe", requireAuth, authorizeRoles(...PUSH_SUBSCRIBER_ROLES), (req, res) => {
  const subscription = req.body?.subscription;

  if (!subscription?.endpoint) {
    return res.status(400).json({ error: "A valid push subscription payload is required." });
  }

  if (!isPushConfigured()) {
    return res.status(503).json({ error: "Web push is not configured on this server." });
  }

  const userAgent = req.headers["user-agent"] || null;
  const result = saveUserPushSubscription(req.auth.id, subscription, userAgent);
  res.json({ ok: result?.ok !== false, endpoint: result?.endpoint || subscription.endpoint });
});

router.delete("/subscribe", requireAuth, authorizeRoles(...PUSH_SUBSCRIBER_ROLES), (req, res) => {
  // Allow callers to scope the unsubscribe to a specific browser endpoint
  // (the device the user is currently on) so disabling alerts on the phone
  // doesn't kill alerts on the desktop. Falls back to clearing every device.
  const endpoint = req.body?.endpoint || req.query?.endpoint || null;
  clearUserPushSubscription(req.auth.id, endpoint ? { endpoint: String(endpoint) } : {});
  res.json({ ok: true });
});

module.exports = router;
