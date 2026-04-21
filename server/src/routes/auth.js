const express = require("express");
const { db } = require("../db");
const {
  cleanupExpiredSessions,
  requireAuth,
  serializeUser,
} = require("../lib/auth");
const {
  generateSessionToken,
  getSessionExpiryTimestamp,
  hashSessionToken,
  verifyPassword,
} = require("../lib/security");

const router = express.Router();

router.post("/login", (req, res) => {
  const username = String(req.body.username ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  cleanupExpiredSessions();

  const user = db
    .prepare(`
      SELECT
        u.*,
        d.full_name AS doctor_name
      FROM users u
      LEFT JOIN doctors d ON d.id = u.doctor_id
      WHERE lower(u.username) = ?
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `)
    .get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = getSessionExpiryTimestamp();

  db.prepare(`
    INSERT INTO auth_sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).run(user.id, tokenHash, expiresAt);

  return res.json({
    token,
    user: serializeUser(user),
  });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.auth });
});

router.post("/logout", requireAuth, (req, res) => {
  db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(req.authSessionId);
  res.status(204).send();
});

module.exports = router;
