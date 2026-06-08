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

function extractPatientToken(req, { allowQuery = false } = {}) {
  const header = String(req.headers.authorization || "");

  if (header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token) {
      return token;
    }
  }

  // EventSource (SSE) cannot send custom headers, so the patient realtime
  // stream passes the bearer token as a query parameter instead.
  if (allowQuery && req.query && req.query.access_token) {
    return String(req.query.access_token).trim();
  }

  return "";
}

function authenticatePatient(req, res, next, { allowQuery = false } = {}) {
  const token = extractPatientToken(req, { allowQuery });

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

function requirePatientAuth(req, res, next) {
  return authenticatePatient(req, res, next, { allowQuery: false });
}

// Same as requirePatientAuth but also accepts the token via ?access_token=,
// used by the patient realtime (SSE) stream.
function requirePatientAuthFlexible(req, res, next) {
  return authenticatePatient(req, res, next, { allowQuery: true });
}

module.exports = {
  cleanupExpiredPatientSessions,
  getPatientSessionUserByToken,
  requirePatientAuth,
  requirePatientAuthFlexible,
  serializePatientUser,
};
