const crypto = require("node:crypto");

const USER_ROLES = ["admin", "doctor", "operator", "lab_tech", "accountant"];
const DEFAULT_SEED_PASSWORD = process.env.SEED_USER_PASSWORD || "Welcome@123";
const SESSION_DURATION_DAYS = Number(process.env.SESSION_DURATION_DAYS || 7);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${derivedKey}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedKey] = String(storedHash || "").split(":");

  if (!salt || !expectedKey) {
    return false;
  }

  const derivedKey = crypto.scryptSync(String(password), salt, 64);
  const expectedBuffer = Buffer.from(expectedKey, "hex");

  if (derivedKey.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expectedBuffer);
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function toSqlTimestamp(date) {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function getSessionExpiryTimestamp(days = SESSION_DURATION_DAYS) {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return toSqlTimestamp(expiry);
}

module.exports = {
  DEFAULT_SEED_PASSWORD,
  USER_ROLES,
  generateSessionToken,
  getSessionExpiryTimestamp,
  hashPassword,
  hashSessionToken,
  verifyPassword,
};
