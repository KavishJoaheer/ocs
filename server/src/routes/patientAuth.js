const express = require("express");
const { db } = require("../db");
const {
  cleanupExpiredPatientSessions,
  requirePatientAuth,
  serializePatientUser,
} = require("../lib/patientAuth");
const {
  generateSessionToken,
  getSessionExpiryTimestamp,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} = require("../lib/security");

const router = express.Router();

function generatePatientIdentifier() {
  const row = db
    .prepare(
      "SELECT patient_identifier FROM patients WHERE patient_identifier LIKE 'OCS-%' ORDER BY id DESC LIMIT 1",
    )
    .get();

  let nextNumber = 1;

  if (row && row.patient_identifier) {
    const match = row.patient_identifier.match(/^OCS-(\d+)$/);

    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  return `OCS-${nextNumber}`;
}

router.post("/register", (req, res) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");
  const fullName = String(req.body.full_name ?? "").trim();
  const phone = String(req.body.phone ?? "").trim();
  const dateOfBirth = String(req.body.date_of_birth ?? "").trim();
  const gender = String(req.body.gender ?? "").trim().toUpperCase();

  if (!email || !password || !fullName || !phone || !dateOfBirth || !gender) {
    return res
      .status(400)
      .json({ error: "Email, password, full_name, phone, date_of_birth, and gender are required." });
  }

  if (!["M", "F"].includes(gender)) {
    return res.status(400).json({ error: "Gender must be 'M' or 'F'." });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const existing = db.prepare("SELECT id FROM patient_users WHERE lower(email) = ?").get(email);

  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = hashPassword(password);

  const nameParts = fullName.split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  const register = db.transaction(() => {
    const patientIdentifier = generatePatientIdentifier();

    const patientResult = db
      .prepare(`
        INSERT INTO patients (
          full_name, first_name, last_name, patient_identifier,
          age, date_of_birth, gender, patient_contact_number,
          contact_number, address, assigned_doctor_id
        )
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, '', '', NULL)
      `)
      .run(fullName, firstName, lastName, patientIdentifier, dateOfBirth, gender, phone);

    const patientId = patientResult.lastInsertRowid;

    const userResult = db
      .prepare(`
        INSERT INTO patient_users (email, password_hash, patient_id, full_name, phone, date_of_birth, gender)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(email, passwordHash, patientId, fullName, phone, dateOfBirth, gender);

    const patientUserId = userResult.lastInsertRowid;

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = getSessionExpiryTimestamp();

    db.prepare(`
      INSERT INTO patient_auth_sessions (patient_user_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `).run(patientUserId, tokenHash, expiresAt);

    const user = db.prepare("SELECT * FROM patient_users WHERE id = ?").get(patientUserId);

    return { token, user };
  });

  try {
    const { token, user } = register();

    return res.status(201).json({
      token,
      user: serializePatientUser(user),
    });
  } catch (error) {
    if (error.message && error.message.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    throw error;
  }
});

router.post("/login", (req, res) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  cleanupExpiredPatientSessions();

  const user = db
    .prepare(`
      SELECT * FROM patient_users
      WHERE lower(email) = ?
        AND is_active = 1
    `)
    .get(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = getSessionExpiryTimestamp();

  db.prepare(`
    INSERT INTO patient_auth_sessions (patient_user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).run(user.id, tokenHash, expiresAt);

  return res.json({
    token,
    user: serializePatientUser(user),
  });
});

router.get("/me", requirePatientAuth, (req, res) => {
  res.json({ user: req.patientAuth });
});

router.post("/logout", requirePatientAuth, (req, res) => {
  db.prepare("DELETE FROM patient_auth_sessions WHERE id = ?").run(req.patientAuthSessionId);
  res.status(204).send();
});

module.exports = router;
