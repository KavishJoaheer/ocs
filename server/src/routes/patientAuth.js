const express = require("express");
const { db } = require("../db");
const {
  cleanupExpiredPatientSessions,
  enrichPatientUserRow,
  requirePatientAuth,
  serializePatientUser,
} = require("../lib/patientAuth");
const { publishPatientDataChange } = require("../lib/inventoryRealtime");
const { calculateAgeFromIsoDate, parseMauritianID } = require("../lib/nicParser");
const {
  generateSessionToken,
  getSessionExpiryTimestamp,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} = require("../lib/security");
const { getPatientPortalOrigin, sendPatientPasswordResetEmail } = require("../lib/mailer");

const router = express.Router();

function generatePatientIdentifier() {
  const latestIdentifier = db
    .prepare(
      `
        SELECT patient_identifier
        FROM patients
        WHERE patient_identifier GLOB 'OCS-[0-9]*'
        ORDER BY CAST(substr(patient_identifier, 5) AS INTEGER) DESC
        LIMIT 1
      `,
    )
    .get()?.patient_identifier;

  const latestNumber = latestIdentifier
    ? Number.parseInt(String(latestIdentifier).replace(/^OCS-/, ""), 10)
    : Number.NaN;
  const nextNumber = Number.isFinite(latestNumber) ? latestNumber + 1 : 150;

  return `OCS-${nextNumber}`;
}

router.post("/register", (req, res) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const password = String(req.body.password ?? "");
  const fullName = String(req.body.full_name ?? "").trim();
  const phone = String(req.body.phone ?? "").trim();
  const genderRaw = String(req.body.gender ?? "").trim().toUpperCase();
  const gender = ["M", "F"].includes(genderRaw) ? genderRaw : "M";
  // National ID is the strong identifier we use to link a self-signup to an
  // existing staff-managed patient record and prevent duplicate charts.
  const nationalId = String(req.body.national_id ?? req.body.patient_id_number ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s/g, "");

  if (!email || !password || !fullName || !phone || !nationalId) {
    return res
      .status(400)
      .json({ error: "Email, password, full_name, phone, and national_id are required." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const parsedNic = parseMauritianID(nationalId);
  if (nationalId.length === 14 && !parsedNic) {
    return res.status(400).json({
      error: "Enter a valid 14-character Mauritian National ID.",
    });
  }

  let dateOfBirth = String(req.body.date_of_birth ?? "").trim();
  if (parsedNic) {
    dateOfBirth = parsedNic.isoDob;
  }
  const age = parsedNic?.age ?? calculateAgeFromIsoDate(dateOfBirth) ?? 0;

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
    const existingPatient = db
      .prepare(
        `
          SELECT id, date_of_birth, gender
          FROM patients
          WHERE patient_id_number = ? AND deleted_at IS NULL
        `,
      )
      .get(nationalId);

    let userDateOfBirth = dateOfBirth;
    let userGender = gender;

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

      const staffDob = String(existingPatient.date_of_birth || "").trim();
      const staffGender = ["M", "F"].includes(existingPatient.gender)
        ? existingPatient.gender
        : gender;

      // Keep staff-entered identity authoritative. Only fill an empty DOB from a
      // parsed Mauritian NIC, backfill an empty phone, and flag the link for staff.
      if (!staffDob && parsedNic) {
        db.prepare(`
          UPDATE patients
          SET date_of_birth = ?, age = ?
          WHERE id = ?
        `).run(parsedNic.isoDob, parsedNic.age, patientId);
      }

      db.prepare(`
        UPDATE patients
        SET patient_contact_number = CASE
              WHEN patient_contact_number IS NULL OR patient_contact_number = ''
              THEN ? ELSE patient_contact_number END,
            link_status = 'pending_review'
        WHERE id = ?
      `).run(phone, patientId);

      userDateOfBirth = staffDob || parsedNic?.isoDob || dateOfBirth;
      userGender = staffGender;
    } else {
      const patientIdentifier = generatePatientIdentifier();

      const patientResult = db
        .prepare(`
          INSERT INTO patients (
            full_name, first_name, last_name, patient_identifier, patient_id_number,
            age, date_of_birth, gender, patient_contact_number,
            contact_number, address, assigned_doctor_id, link_status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', NULL, 'self_registered')
        `)
        .run(
          fullName,
          firstName,
          lastName,
          patientIdentifier,
          nationalId,
          age,
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
      .run(email, passwordHash, patientId, fullName, phone, userDateOfBirth, userGender);

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
      if (error.message.includes("patient_identifier")) {
        return res.status(409).json({
          error: "Could not assign a unique care number. Please try again.",
        });
      }

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

router.post("/change-password", requirePatientAuth, (req, res) => {
  const currentPassword = String(req.body.current_password ?? "");
  const newPassword = String(req.body.new_password ?? "");

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current password and new password are required." });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const user = db
    .prepare("SELECT id, password_hash FROM patient_users WHERE id = ? AND is_active = 1")
    .get(req.patientAuth.id);

  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  db.transaction(() => {
    db.prepare("UPDATE patient_users SET password_hash = ? WHERE id = ?").run(
      hashPassword(newPassword),
      user.id,
    );
    if (req.patientAuthSessionId) {
      db.prepare("DELETE FROM patient_auth_sessions WHERE patient_user_id = ? AND id != ?").run(
        user.id,
        req.patientAuthSessionId,
      );
    } else {
      db.prepare("DELETE FROM patient_auth_sessions WHERE patient_user_id = ?").run(user.id);
    }
  })();

  return res.json({ ok: true });
});

router.post("/forgot-password", async (req, res) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const generic = { ok: true };

  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  const user = db
    .prepare("SELECT id, email FROM patient_users WHERE lower(email) = ? AND is_active = 1")
    .get(email);

  if (!user) {
    return res.json(generic);
  }

  db.prepare(
    `
      DELETE FROM patient_password_reset_tokens
      WHERE patient_user_id = ? OR expires_at <= CURRENT_TIMESTAMP
    `,
  ).run(user.id);

  const token = generateSessionToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000);
  db.prepare(
    `
      INSERT INTO patient_password_reset_tokens (patient_user_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `,
  ).run(user.id, hashSessionToken(token), expires.toISOString().replace("T", " ").slice(0, 19));

  const resetUrl = `${getPatientPortalOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await sendPatientPasswordResetEmail({ to: user.email, resetUrl });
  } catch (error) {
    console.warn("[mailer] password reset email failed:", error?.message || error);
  }

  if (process.env.NODE_ENV === "test") {
    return res.json({ ok: true, reset_token: token });
  }

  return res.json(generic);
});

router.post("/reset-password", (req, res) => {
  const token = String(req.body.token ?? "").trim();
  const newPassword = String(req.body.new_password ?? "");

  if (!token || !newPassword) {
    return res.status(400).json({ error: "Reset token and new password are required." });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const row = db
    .prepare(
      `
        SELECT id, patient_user_id
        FROM patient_password_reset_tokens
        WHERE token_hash = ?
          AND used_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
      `,
    )
    .get(hashSessionToken(token));

  if (!row) {
    return res.status(400).json({ error: "This reset link is invalid or has expired." });
  }

  db.transaction(() => {
    db.prepare("UPDATE patient_users SET password_hash = ? WHERE id = ?").run(
      hashPassword(newPassword),
      row.patient_user_id,
    );
    db.prepare("UPDATE patient_password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      row.id,
    );
    db.prepare("DELETE FROM patient_auth_sessions WHERE patient_user_id = ?").run(row.patient_user_id);
  })();

  return res.json({ ok: true });
});

module.exports = router;
