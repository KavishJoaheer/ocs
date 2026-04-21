const express = require("express");
const { db } = require("../db");
const { hashPassword } = require("../lib/security");

const router = express.Router();

function normalizeDoctorPayload(body) {
  return {
    full_name: String(body.full_name ?? "").trim(),
    specialization: String(body.specialization ?? "").trim(),
    username: String(body.username ?? "").trim().toLowerCase(),
    password: String(body.password ?? ""),
  };
}

function validateDoctorPayload(payload, { requirePassword = false } = {}) {
  if (!payload.full_name) return "Full name is required.";
  if (!payload.specialization) return "Specialization is required.";
  if (!payload.username) return "Username is required.";

  if (payload.password && payload.password.length < 8) {
    return "Passwords must be at least 8 characters long.";
  }

  if (requirePassword && !payload.password) {
    return "Password is required.";
  }

  return null;
}

function getDoctorRow(doctorId) {
  return db
    .prepare(`
      SELECT
        d.id,
        d.full_name,
        d.specialization,
        d.is_active,
        u.id AS user_id,
        u.username,
        u.is_active AS login_active,
        COUNT(DISTINCT p.id) AS assigned_patient_count,
        COUNT(DISTINCT a.id) AS appointment_count,
        COUNT(DISTINCT c.id) AS consultation_count
      FROM doctors d
      LEFT JOIN users u ON u.id = (
        SELECT id
        FROM users
        WHERE doctor_id = d.id
          AND role = 'doctor'
          AND deleted_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      LEFT JOIN patients p ON p.assigned_doctor_id = d.id
      LEFT JOIN appointments a ON a.doctor_id = d.id
      LEFT JOIN consultations c ON c.doctor_id = d.id
      WHERE d.id = ?
        AND d.deleted_at IS NULL
      GROUP BY d.id, u.id
    `)
    .get(doctorId);
}

function ensureUniqueDoctorName(fullName, excludeDoctorId = null) {
  const existing = db
    .prepare(`
      SELECT id
      FROM doctors
      WHERE lower(full_name) = lower(?)
        AND is_active = 1
        AND deleted_at IS NULL
        AND (? IS NULL OR id != ?)
      LIMIT 1
    `)
    .get(fullName, excludeDoctorId, excludeDoctorId);

  return !existing;
}

function ensureUniqueUsername(username, excludeUserId = null) {
  const existing = db
    .prepare(`
      SELECT id
      FROM users
      WHERE lower(username) = lower(?)
        AND (? IS NULL OR id != ?)
      LIMIT 1
    `)
    .get(username, excludeUserId, excludeUserId);

  return !existing;
}

router.get("/", (req, res) => {
  const includeInactive = req.query.includeInactive === "1" ? 1 : 0;
  const doctors = db
    .prepare(`
      SELECT
        d.id,
        d.full_name,
        d.specialization,
        d.is_active,
        u.id AS user_id,
        u.username,
        u.is_active AS login_active,
        COUNT(DISTINCT p.id) AS assigned_patient_count,
        COUNT(DISTINCT a.id) AS appointment_count,
        COUNT(DISTINCT c.id) AS consultation_count
      FROM doctors d
      LEFT JOIN users u ON u.id = (
        SELECT id
        FROM users
        WHERE doctor_id = d.id
          AND role = 'doctor'
          AND deleted_at IS NULL
        ORDER BY id ASC
        LIMIT 1
      )
      LEFT JOIN patients p ON p.assigned_doctor_id = d.id
      LEFT JOIN appointments a ON a.doctor_id = d.id
      LEFT JOIN consultations c ON c.doctor_id = d.id
      WHERE d.deleted_at IS NULL
        AND (@includeInactive = 1 OR d.is_active = 1)
      GROUP BY d.id, u.id
      ORDER BY d.is_active DESC, d.full_name ASC
    `)
    .all({ includeInactive });

  res.json(doctors);
});

router.post("/", (req, res) => {
  const payload = normalizeDoctorPayload(req.body);
  const validationError = validateDoctorPayload(payload, { requirePassword: true });

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  if (!ensureUniqueDoctorName(payload.full_name)) {
    return res.status(409).json({ error: "An active doctor with this name already exists." });
  }

  if (!ensureUniqueUsername(payload.username)) {
    return res.status(409).json({ error: "That username is already in use." });
  }

  const createDoctor = db.transaction(() => {
    const doctorId = db
      .prepare(`
        INSERT INTO doctors (full_name, specialization, is_active)
        VALUES (?, ?, 1)
      `)
      .run(payload.full_name, payload.specialization).lastInsertRowid;

    db.prepare(`
      INSERT INTO users (username, full_name, role, password_hash, doctor_id, is_active)
      VALUES (?, ?, 'doctor', ?, ?, 1)
    `).run(
      payload.username,
      payload.full_name,
      hashPassword(payload.password),
      doctorId,
    );

    return Number(doctorId);
  });

  const doctorId = createDoctor();
  res.status(201).json(getDoctorRow(doctorId));
});

router.put("/:id", (req, res) => {
  const doctorId = Number(req.params.id);
  const existing = getDoctorRow(doctorId);

  if (!existing || !existing.is_active) {
    return res.status(404).json({ error: "Doctor not found." });
  }

  const payload = normalizeDoctorPayload(req.body);
  const validationError = validateDoctorPayload(payload);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  if (!ensureUniqueDoctorName(payload.full_name, doctorId)) {
    return res.status(409).json({ error: "An active doctor with this name already exists." });
  }

  if (!ensureUniqueUsername(payload.username, existing.user_id || null)) {
    return res.status(409).json({ error: "That username is already in use." });
  }

  if (!existing.user_id && !payload.password) {
    return res.status(400).json({ error: "Password is required when restoring a doctor login." });
  }

  const updateDoctor = db.transaction(() => {
    db.prepare(`
      UPDATE doctors
      SET full_name = ?, specialization = ?, deleted_at = NULL
      WHERE id = ?
    `).run(payload.full_name, payload.specialization, doctorId);

    if (existing.user_id) {
      if (payload.password) {
        db.prepare(`
          UPDATE users
          SET username = ?, full_name = ?, password_hash = ?, is_active = 1, deleted_at = NULL
          WHERE id = ?
        `).run(
          payload.username,
          payload.full_name,
          hashPassword(payload.password),
          existing.user_id,
        );
      } else {
        db.prepare(`
          UPDATE users
          SET username = ?, full_name = ?, is_active = 1, deleted_at = NULL
          WHERE id = ?
        `).run(payload.username, payload.full_name, existing.user_id);
      }
    } else {
      db.prepare(`
        INSERT INTO users (username, full_name, role, password_hash, doctor_id, is_active)
        VALUES (?, ?, 'doctor', ?, ?, 1)
      `).run(
        payload.username,
        payload.full_name,
        hashPassword(payload.password),
        doctorId,
      );
    }
  });

  updateDoctor();
  res.json(getDoctorRow(doctorId));
});

router.delete("/:id", (req, res) => {
  const doctorId = Number(req.params.id);
  const existing = getDoctorRow(doctorId);

  if (!existing || !existing.is_active) {
    return res.status(404).json({ error: "Doctor not found." });
  }

  const removeDoctorAccess = db.transaction(() => {
    db.prepare("UPDATE doctors SET is_active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      doctorId,
    );

    if (existing.user_id) {
      db.prepare("UPDATE users SET is_active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(
        existing.user_id,
      );
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(existing.user_id);
    }
  });

  removeDoctorAccess();
  res.status(204).send();
});

module.exports = router;
