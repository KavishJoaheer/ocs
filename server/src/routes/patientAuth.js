const express = require("express");
const { db } = require("../db");
const {
  cleanupExpiredPatientSessions,
  enrichPatientUserRow,
  requirePatientAuth,
  serializePatientUser,
} = require("../lib/patientAuth");
const { publishPatientDataChange } = require("../lib/inventoryRealtime");
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
  // National ID is the strong identifier we use to link a self-signup to an
  // existing staff-managed patient record (optional, but prevents duplicates).
  const nationalId = String(req.body.national_id ?? req.body.patient_id_number ?? "").trim();

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
    let patientId;

    // Strong-match an existing staff record by national ID so a patient who
    // signs up themselves is linked to their real chart instead of spawning a
    // duplicate.
    const existingPatient = nationalId
      ? db
          .prepare(
            "SELECT id FROM patients WHERE patient_id_number = ? AND deleted_at IS NULL",
          )
          .get(nationalId)
      : null;

    if (existingPatient) {
      const alreadyLinked = db
        .prepare("SELECT id FROM patient_users WHERE patient_id = ?")
        .get(existingPatient.id);

      if (alreadyLinked) {
        const error = new Error("ALREADY_LINKED");
        error.code = "ALREADY_LINKED";
        throw error;
      }

      patientId = existingPatient.id;

      // Keep staff-entered data authoritative; only backfill an empty phone, and
      // flag the link for staff to confirm.
      db.prepare(`
        UPDATE patients
        SET patient_contact_number = CASE
              WHEN patient_contact_number IS NULL OR patient_contact_number = ''
              THEN ? ELSE patient_contact_number END,
            link_status = 'pending_review'
        WHERE id = ?
      `).run(phone, patientId);
    } else {
      const patientIdentifier = generatePatientIdentifier();

      const patientResult = db
        .prepare(`
          INSERT INTO patients (
            full_name, first_name, last_name, patient_identifier, patient_id_number,
            age, date_of_birth, gender, patient_contact_number,
            contact_number, address, assigned_doctor_id, link_status
          )
          VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, '', '', NULL, 'self_registered')
        `)
        .run(
          fullName,
          firstName,
          lastName,
          patientIdentifier,
          nationalId,
          dateOfBirth,
          gender,
          phone,
        );

      patientId = patientResult.lastInsertRowid;
    }

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

    return { token, user, patientId };
  });

  try {
    const { token, user, patientId } = register();

    publishPatientDataChange(patientId, { reason: "patient" });

    return res.status(201).json({
      token,
      user: enrichPatientUserRow(user),
    });
  } catch (error) {
    if (error.code === "ALREADY_LINKED") {
      return res.status(409).json({
        error:
          "A patient account is already linked to this record. Please contact the clinic for help.",
      });
    }

    if (error.message && error.message.includes("patient_id_number")) {
      // Race or stale duplicate on the national ID unique index.
      return res.status(409).json({
        error: "A patient with this national ID already exists. Please contact the clinic.",
      });
    }

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
    user: enrichPatientUserRow(user),
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
