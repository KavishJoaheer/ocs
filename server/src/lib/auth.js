const { db } = require("../db");
const { hashSessionToken } = require("./security");

function cleanupExpiredSessions() {
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
}

function serializeUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    doctor_id: row.doctor_id ? Number(row.doctor_id) : null,
    doctor_name: row.doctor_name || null,
    operation_status: row.operation_status || "active",
    operation_status_updated_at: row.operation_status_updated_at || null,
  };
}

function getSessionUserByToken(token) {
  cleanupExpiredSessions();

  const tokenHash = hashSessionToken(token);

  return db
    .prepare(`
      SELECT
        s.id AS session_id,
        u.id,
        u.username,
        u.full_name,
        u.role,
        u.doctor_id,
        u.operation_status,
        u.operation_status_updated_at,
        d.full_name AS doctor_name
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN doctors d ON d.id = u.doctor_id
      WHERE s.token_hash = ?
        AND s.expires_at > CURRENT_TIMESTAMP
        AND u.is_active = 1
        AND u.deleted_at IS NULL
    `)
    .get(tokenHash);
}

function extractBearerToken(headerValue) {
  const header = String(headerValue || "");

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

function requireAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    return res.status(401).json({ error: "Authentication is required." });
  }

  const session = getSessionUserByToken(token);

  if (!session) {
    return res.status(401).json({ error: "Your session is invalid or has expired." });
  }

  req.auth = serializeUser(session);
  req.authSessionId = Number(session.session_id);
  req.authToken = token;
  return next();
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: "Authentication is required." });
    }

    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "You do not have permission to access this area." });
    }

    return next();
  };
}

function authorizeByMethod(methodRoleMap) {
  return (req, res, next) => {
    const allowedRoles = methodRoleMap[req.method] || methodRoleMap.default;

    if (!allowedRoles) {
      return next();
    }

    return authorizeRoles(...allowedRoles)(req, res, next);
  };
}

module.exports = {
  authorizeByMethod,
  authorizeRoles,
  cleanupExpiredSessions,
  extractBearerToken,
  requireAuth,
  serializeUser,
};
