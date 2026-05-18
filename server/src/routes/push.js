const express = require("express");
const { authorizeRoles, requireAuth } = require("../lib/auth");
const {
  clearUserPushSubscription,
  getVapidPublicKey,
  isPushConfigured,
  saveUserPushSubscription,
} = require("../lib/push");

const router = express.Router();

router.get("/vapid-public-key", (_req, res) => {
  const publicKey = getVapidPublicKey();

  if (!publicKey) {
    return res.status(503).json({
      error: "Web push is not configured on this server.",
      configured: false,
    });
  }

  res.json({
    configured: isPushConfigured(),
    publicKey,
  });
});

router.post("/subscribe", requireAuth, authorizeRoles("doctor"), (req, res) => {
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

router.delete("/subscribe", requireAuth, authorizeRoles("doctor"), (req, res) => {
  clearUserPushSubscription(req.auth.id);
  res.json({ ok: true });
});

module.exports = router;
