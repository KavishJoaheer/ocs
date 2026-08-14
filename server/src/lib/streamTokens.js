const { db } = require("../db");
const { generateSessionToken, hashSessionToken } = require("./security");

const STREAM_TOKEN_TTL_MS = 15 * 60 * 1000;

function toSqlTimestamp(date) {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function cleanupExpiredStreamTokens() {
  db.prepare("DELETE FROM stream_tokens WHERE expires_at <= CURRENT_TIMESTAMP").run();
}

function mintStreamToken({ audience, userId, ttlMs = STREAM_TOKEN_TTL_MS }) {
  cleanupExpiredStreamTokens();

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = toSqlTimestamp(new Date(Date.now() + ttlMs));

  db.prepare(
    `
    INSERT INTO stream_tokens (token_hash, audience, user_id, expires_at)
    VALUES (?, ?, ?, ?)
  `,
  ).run(tokenHash, audience, Number(userId), expiresAt);

  return {
    token,
    expires_at: expiresAt,
    expires_in: Math.floor(ttlMs / 1000),
  };
}

function getStaffUserByStreamToken(token) {
  cleanupExpiredStreamTokens();
  const tokenHash = hashSessionToken(token);

  return db
    .prepare(
      `
      SELECT
        u.id,
        u.username,
        u.full_name,
        u.role,
        u.doctor_id,
        u.operation_status,
        u.operation_status_updated_at,
        d.full_name AS doctor_name
      FROM stream_tokens t
      JOIN users u ON u.id = t.user_id
      LEFT JOIN doctors d ON d.id = u.doctor_id
      WHERE t.token_hash = ?
        AND t.audience = 'staff'
        AND t.expires_at > CURRENT_TIMESTAMP
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `,
    )
    .get(tokenHash);
}

function getPatientUserByStreamToken(token) {
  cleanupExpiredStreamTokens();
  const tokenHash = hashSessionToken(token);

  return db
    .prepare(
      `
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.patient_id,
        u.phone,
        u.date_of_birth,
        u.gender,
        p.link_status
      FROM stream_tokens t
      JOIN patient_users u ON u.id = t.user_id
      LEFT JOIN patients p ON p.id = u.patient_id AND p.deleted_at IS NULL
      WHERE t.token_hash = ?
        AND t.audience = 'patient'
        AND t.expires_at > CURRENT_TIMESTAMP
        AND u.is_active = 1
    `,
    )
    .get(tokenHash);
}

module.exports = {
  STREAM_TOKEN_TTL_MS,
  getPatientUserByStreamToken,
  getStaffUserByStreamToken,
  mintStreamToken,
};
