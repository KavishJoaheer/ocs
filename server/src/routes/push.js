const express = require("express");
const { authorizeRoles, requireAuth } = require("../lib/auth");
const {
  clearUserPushSubscription,
  getVapidPublicKey,
  isPushConfigured,
  listPushSubscriptionStatus,
  saveUserPushSubscription,
} = require("../lib/push");

const router = express.Router();
const PUSH_SUBSCRIBER_ROLES = ["admin", "doctor", "operator", "lab_tech", "accountant"];

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
