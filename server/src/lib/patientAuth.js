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
    link_status: row.link_status != null ? String(row.link_status) : null,
    phone: row.phone || "",
    date_of_birth: row.date_of_birth || "",
    gender: row.gender || "M",
  };
}

function enrichPatientUserRow(row) {
  if (!row) {
    return null;
  }

  if (row.link_status != null || !row.patient_id) {
    return serializePatientUser(row);
  }

  const patient = db
    .prepare("SELECT link_status FROM patients WHERE id = ? AND deleted_at IS NULL")
    .get(row.patient_id);

  return serializePatientUser({
    ...row,
    link_status: patient?.link_status ?? null,
  });
}

function isVerifiedPatientPortalAccount(auth) {
  return Boolean(auth?.patient_id) && (auth?.link_status === "verified" || auth?.link_status === "staff_created");
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
        u.gender,
        p.link_status
      FROM patient_auth_sessions s
      JOIN patient_users u ON u.id = s.patient_user_id
      LEFT JOIN patients p ON p.id = u.patient_id AND p.deleted_at IS NULL
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

  req.patientAuth = enrichPatientUserRow(session);
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
  enrichPatientUserRow,
  getPatientSessionUserByToken,
  isVerifiedPatientPortalAccount,
  requirePatientAuth,
  requirePatientAuthFlexible,
  serializePatientUser,
};
