const { db } = require("../db");
const { hashSessionToken } = require("./security");
const { getPatientUserByStreamToken } = require("./streamTokens");

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

// Signup claims an existing chart on a national ID alone, so a pending_review
// account may be sitting on someone else's medical history until staff confirm
// the person. A self_registered account created its own chart during signup, so
// there is no third party's history in it, and an account with no chart at all
// falls through to each route's own not-linked message.
function isPortalChartAwaitingConfirmation(auth) {
  if (!auth?.patient_id || isVerifiedPatientPortalAccount(auth)) {
    return false;
  }

  return auth.link_status !== "self_registered";
}

function requireConfirmedChartAccess(req, res, next) {
  if (!isPortalChartAwaitingConfirmation(req.patientAuth)) {
    return next();
  }

  return res.status(409).json({
    error:
      "Your clinic record is still being confirmed by staff, so it cannot be opened yet. Please contact the clinic to finish linking your account.",
    code: "account_link_pending",
  });
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
      return { token, source: "header" };
    }
  }

  // EventSource (SSE) and file downloads cannot send custom headers, so they
  // pass a short-lived stream token as a query parameter instead.
  if (allowQuery && req.query && req.query.access_token) {
    const token = String(req.query.access_token).trim();
    if (token) {
      return { token, source: "query" };
    }
  }

  return { token: "", source: null };
}

function authenticatePatient(req, res, next, { allowQuery = false, allowStreamToken = false } = {}) {
  const { token, source } = extractPatientToken(req, { allowQuery });

  if (!token) {
    return res.status(401).json({ error: "Authentication is required." });
  }

  const session =
    source === "query"
      ? allowStreamToken
        ? getPatientUserByStreamToken(token)
        : null
      : getPatientSessionUserByToken(token);

  if (!session) {
    return res.status(401).json({ error: "Your session is invalid or has expired." });
  }

  req.patientAuth = enrichPatientUserRow(session);
  req.patientAuthSessionId = session.session_id ? Number(session.session_id) : null;
  req.patientAuthToken = token;

  const guardianId = req.patientAuth?.patient_id ? Number(req.patientAuth.patient_id) : null;
  const requested = Number(req.get("x-ocs-patient-id") || 0);
  if (!requested || requested === guardianId) {
    req.portalPatientId = guardianId;
    return next();
  }

  const child = db
    .prepare(
      `
        SELECT id
        FROM patients
        WHERE id = ?
          AND parent_patient_id = ?
          AND deleted_at IS NULL
      `,
    )
    .get(requested, guardianId);

  if (!child) {
    return res.status(403).json({ error: "You cannot access that family profile." });
  }

  req.portalPatientId = Number(child.id);
  return next();
}

function requirePatientAuth(req, res, next) {
  return authenticatePatient(req, res, next, { allowQuery: false, allowStreamToken: false });
}

// SSE and file downloads authenticate via ?access_token= using a stream token.
function requirePatientAuthFlexible(req, res, next) {
  return authenticatePatient(req, res, next, { allowQuery: true, allowStreamToken: true });
}

module.exports = {
  cleanupExpiredPatientSessions,
  enrichPatientUserRow,
  getPatientSessionUserByToken,
  isPortalChartAwaitingConfirmation,
  isVerifiedPatientPortalAccount,
  requireConfirmedChartAccess,
  requirePatientAuth,
  requirePatientAuthFlexible,
  serializePatientUser,
};
