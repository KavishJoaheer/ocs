const { db } = require("../db");
const { hashSessionToken } = require("./security");

function cleanupExpiredPatientSessions() {
  db.prepare("DELETE FROM patient_auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
}

function serializePatientUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    email: row.email,
    full_name: row.full_name,
    patient_id: row.patient_id ? Number(row.patient_id) : null,
    phone: row.phone || "",
    date_of_birth: row.date_of_birth || "",
    gender: row.gender || "M",
  };
}

function getPatientSessionUserByToken(token) {
  cleanupExpiredPatientSessions();

  const tokenHash = hashSessionToken(token);

  return db
    .prepare(`
      SELECT
        s.id AS session_id,
        u.id,
        u.email,
        u.full_name,
        u.patient_id,
        u.phone,
        u.date_of_birth,
        u.gender
      FROM patient_auth_sessions s
      JOIN patient_users u ON u.id = s.patient_user_id
      WHERE s.token_hash = ?
        AND s.expires_at > CURRENT_TIMESTAMP
        AND u.is_active = 1
    `)
    .get(tokenHash);
}

function requirePatientAuth(req, res, next) {
  const header = String(req.headers.authorization || "");

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication is required." });
  }

  const token = header.slice(7).trim();

  if (!token) {
    return res.status(401).json({ error: "Authentication is required." });
  }

  const session = getPatientSessionUserByToken(token);

  if (!session) {
    return res.status(401).json({ error: "Your session is invalid or has expired." });
  }

  req.patientAuth = serializePatientUser(session);
  req.patientAuthSessionId = Number(session.session_id);
  req.patientAuthToken = token;
  return next();
}

module.exports = {
  cleanupExpiredPatientSessions,
  requirePatientAuth,
  serializePatientUser,
};
