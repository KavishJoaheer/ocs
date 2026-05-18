const express = require("express");
const { authorizeRoles, requireAuth } = require("../lib/auth");
const {
  clearUserPushSubscription,
  getVapidPublicKey,
  isPushConfigured,
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

router.post("/subscribe", requireAuth, authorizeRoles(...PUSH_SUBSCRIBER_ROLES), (req, res) => {
  const subscription = req.body?.subscription;

  if (!subscription?.endpoint) {
    return res.status(400).json({ error: "A valid push subscription payload is required." });
  }

  if (!isPushConfigured()) {
    return res.status(503).json({ error: "Web push is not configured on this server." });
  }

  saveUserPushSubscription(req.auth.id, subscription);
  res.json({ ok: true });
});

router.delete("/subscribe", requireAuth, authorizeRoles(...PUSH_SUBSCRIBER_ROLES), (req, res) => {
  clearUserPushSubscription(req.auth.id);
  res.json({ ok: true });
});

module.exports = router;
