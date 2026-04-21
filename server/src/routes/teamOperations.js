const express = require("express");
const { db } = require("../db");
const { hashPassword } = require("../lib/security");

const router = express.Router();

const SUPPORTED_ROLES = new Set(["doctor", "operator", "accountant"]);
const RECENTLY_DELETED_WINDOW_SQL = "-30 days";

function normalizePayload(body, role) {
  return {
    full_name: String(body.full_name ?? "").trim(),
    username: String(body.username ?? "").trim().toLowerCase(),
    specialization: String(body.specialization ?? "").trim(),
    password: String(body.password ?? ""),
    role,
  };
}

function validatePayload(payload, { requirePassword = false } = {}) {
  if (!payload.full_name) return "Full name is required.";
  if (!payload.username) return "Username is required.";

  if (payload.role === "doctor" && !payload.specialization) {
    return "Specialization is required.";
  }

  if (payload.password && payload.password.length < 8) {
    return "Passwords must be at least 8 characters long.";
  }

  if (requirePassword && !payload.password) {
    return "Password is required.";
  }

  return null;
}

function ensureUniqueUsername(username, excludeUserId = null) {
  const existing = db
    .prepare(
      `
      SELECT id
      FROM users
      WHERE lower(username) = lower(?)
        AND (? IS NULL OR id != ?)
      LIMIT 1
    `,
    )
    .get(username, excludeUserId, excludeUserId);

  return !existing;
}

function getDoctorMemberRow(doctorId, { includeDeleted = false } = {}) {
  return db
    .prepare(
      `
      SELECT
        'doctor' AS role,
        d.id,
        d.full_name,
        d.specialization,
        d.is_active,
        d.deleted_at,
        u.id AS user_id,
        u.username,
        u.is_active AS login_active,
        u.deleted_at AS user_deleted_at,
        COUNT(DISTINCT p.id) AS assigned_patient_count,
        COUNT(DISTINCT a.id) AS appointment_count,
        COUNT(DISTINCT c.id) AS consultation_count
      FROM doctors d
      LEFT JOIN users u ON u.id = (
        SELECT id
        FROM users
        WHERE doctor_id = d.id
          AND role = 'doctor'
        ORDER BY id ASC
        LIMIT 1
      )
      LEFT JOIN patients p ON p.assigned_doctor_id = d.id
      LEFT JOIN appointments a ON a.doctor_id = d.id
      LEFT JOIN consultations c ON c.doctor_id = d.id
      WHERE d.id = ?
        AND (? = 1 OR d.deleted_at IS NULL)
      GROUP BY d.id, u.id
    `,
    )
    .get(doctorId, includeDeleted ? 1 : 0);
}

function getSupportMemberRow(memberId, role, { includeDeleted = false } = {}) {
  return db
    .prepare(
      `
      SELECT
        id,
        username,
        full_name,
        role,
        is_active,
        deleted_at,
        created_at
      FROM users
      WHERE id = ?
        AND role = ?
        AND (? = 1 OR deleted_at IS NULL)
    `,
    )
    .get(memberId, role, includeDeleted ? 1 : 0);
}

function listMembers(role) {
  if (role === "doctor") {
    return db
      .prepare(
        `
        SELECT
          'doctor' AS role,
          d.id,
          d.full_name,
          d.specialization,
          d.is_active,
          d.deleted_at,
          u.id AS user_id,
          u.username,
          u.is_active AS login_active,
          u.deleted_at AS user_deleted_at,
          COUNT(DISTINCT p.id) AS assigned_patient_count,
          COUNT(DISTINCT a.id) AS appointment_count,
          COUNT(DISTINCT c.id) AS consultation_count
        FROM doctors d
        LEFT JOIN users u ON u.id = (
          SELECT id
          FROM users
          WHERE doctor_id = d.id
            AND role = 'doctor'
          ORDER BY id ASC
          LIMIT 1
        )
        LEFT JOIN patients p ON p.assigned_doctor_id = d.id
        LEFT JOIN appointments a ON a.doctor_id = d.id
        LEFT JOIN consultations c ON c.doctor_id = d.id
        WHERE d.deleted_at IS NULL
        GROUP BY d.id, u.id
        ORDER BY d.is_active DESC, d.full_name ASC
      `,
      )
      .all();
  }

  return db
    .prepare(
      `
      SELECT
        id,
        username,
        full_name,
        role,
        is_active,
        deleted_at,
        created_at
      FROM users
      WHERE role = ?
        AND deleted_at IS NULL
      ORDER BY is_active DESC, full_name ASC
    `,
    )
    .all(role);
}

function listRecentlyDeletedMembers() {
  const deletedDoctors = db
    .prepare(
      `
      SELECT
        'doctor' AS role,
        d.id,
        d.full_name,
        d.specialization,
        u.username,
        d.deleted_at,
        d.is_active,
        COUNT(DISTINCT p.id) AS assigned_patient_count,
        COUNT(DISTINCT a.id) AS appointment_count,
        COUNT(DISTINCT c.id) AS consultation_count
      FROM doctors d
      LEFT JOIN users u ON u.id = (
        SELECT id
        FROM users
        WHERE doctor_id = d.id
          AND role = 'doctor'
        ORDER BY id ASC
        LIMIT 1
      )
      LEFT JOIN patients p ON p.assigned_doctor_id = d.id
      LEFT JOIN appointments a ON a.doctor_id = d.id
      LEFT JOIN consultations c ON c.doctor_id = d.id
      WHERE d.deleted_at IS NOT NULL
        AND d.deleted_at >= datetime('now', ?)
      GROUP BY d.id, u.id
    `,
    )
    .all(RECENTLY_DELETED_WINDOW_SQL);

  const deletedSupport = db
    .prepare(
      `
      SELECT
        role,
        id,
        full_name,
        username,
        NULL AS specialization,
        deleted_at,
        is_active,
        0 AS assigned_patient_count,
        0 AS appointment_count,
        0 AS consultation_count
      FROM users
      WHERE role IN ('operator', 'accountant')
        AND deleted_at IS NOT NULL
        AND deleted_at >= datetime('now', ?)
    `,
    )
    .all(RECENTLY_DELETED_WINDOW_SQL);

  return [...deletedDoctors, ...deletedSupport].sort((left, right) => {
    const leftDate = new Date(left.deleted_at || 0).getTime();
    const rightDate = new Date(right.deleted_at || 0).getTime();
    return rightDate - leftDate || String(left.full_name).localeCompare(String(right.full_name));
  });
}

function createMember(payload) {
  if (payload.role === "doctor") {
    const doctorId = db
      .prepare(
        `
        INSERT INTO doctors (full_name, specialization, is_active)
        VALUES (?, ?, 1)
      `,
      )
      .run(payload.full_name, payload.specialization).lastInsertRowid;

    db.prepare(
      `
      INSERT INTO users (username, full_name, role, password_hash, doctor_id, is_active)
      VALUES (?, ?, 'doctor', ?, ?, 1)
    `,
    ).run(
      payload.username,
      payload.full_name,
      hashPassword(payload.password),
      doctorId,
    );

    return Number(doctorId);
  }

  return db
    .prepare(
      `
      INSERT INTO users (username, full_name, role, password_hash, is_active)
      VALUES (?, ?, ?, ?, 1)
    `,
    )
    .run(
      payload.username,
      payload.full_name,
      payload.role,
      hashPassword(payload.password),
    ).lastInsertRowid;
}

function updateMember(memberId, payload) {
  if (payload.role === "doctor") {
    const existing = getDoctorMemberRow(memberId);

    if (!existing) {
      return null;
    }

    db.prepare(
      `
      UPDATE doctors
      SET full_name = ?, specialization = ?, is_active = 1, deleted_at = NULL
      WHERE id = ?
    `,
    ).run(payload.full_name, payload.specialization, memberId);

    if (existing.user_id) {
      if (payload.password) {
        db.prepare(
          `
          UPDATE users
          SET username = ?, full_name = ?, password_hash = ?, is_active = 1, deleted_at = NULL
          WHERE id = ?
        `,
        ).run(
          payload.username,
          payload.full_name,
          hashPassword(payload.password),
          existing.user_id,
        );
      } else {
        db.prepare(
          `
          UPDATE users
          SET username = ?, full_name = ?, is_active = 1, deleted_at = NULL
          WHERE id = ?
        `,
        ).run(payload.username, payload.full_name, existing.user_id);
      }
    } else {
      if (!payload.password) {
        throw new Error("Password is required when restoring a doctor login.");
      }

      db.prepare(
        `
        INSERT INTO users (username, full_name, role, password_hash, doctor_id, is_active)
        VALUES (?, ?, 'doctor', ?, ?, 1)
      `,
      ).run(
        payload.username,
        payload.full_name,
        hashPassword(payload.password),
        memberId,
      );
    }

    return getDoctorMemberRow(memberId);
  }

  const existing = db
    .prepare(
      `
      SELECT id, username, full_name, role, is_active, created_at
      FROM users
      WHERE id = ? AND role = ?
    `,
    )
    .get(memberId, payload.role);

  if (!existing) {
    return null;
  }

  if (payload.password) {
    db.prepare(
      `
      UPDATE users
      SET username = ?, full_name = ?, password_hash = ?, is_active = 1, deleted_at = NULL
      WHERE id = ?
    `,
    ).run(payload.username, payload.full_name, hashPassword(payload.password), memberId);
  } else {
    db.prepare(
      `
      UPDATE users
      SET username = ?, full_name = ?, is_active = 1, deleted_at = NULL
      WHERE id = ?
    `,
    ).run(payload.username, payload.full_name, memberId);
  }

  return db
    .prepare(
      `
      SELECT id, username, full_name, role, is_active, created_at
      FROM users
      WHERE id = ?
    `,
    )
    .get(memberId);
}

router.get("/:role", (req, res) => {
  const role = String(req.params.role || "").toLowerCase();

  if (!SUPPORTED_ROLES.has(role)) {
    return res.status(400).json({ error: "Unsupported team role." });
  }

  res.json(listMembers(role));
});

router.get("/deleted/recent", (_req, res) => {
  res.json(listRecentlyDeletedMembers());
});

router.post("/:role", (req, res) => {
  const role = String(req.params.role || "").toLowerCase();

  if (!SUPPORTED_ROLES.has(role)) {
    return res.status(400).json({ error: "Unsupported team role." });
  }

  const payload = normalizePayload(req.body, role);
  const validationError = validatePayload(payload, { requirePassword: true });

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  if (!ensureUniqueUsername(payload.username)) {
    return res.status(409).json({ error: "That username is already in use." });
  }

  const memberId = db.transaction(() => createMember(payload))();
  const member = role === "doctor" ? getDoctorMemberRow(memberId) : updateMember(memberId, payload);

  res.status(201).json(member);
});

router.put("/:role/:id", (req, res) => {
  const role = String(req.params.role || "").toLowerCase();

  if (!SUPPORTED_ROLES.has(role)) {
    return res.status(400).json({ error: "Unsupported team role." });
  }

  const memberId = Number(req.params.id);
  const payload = normalizePayload(req.body, role);
  const validationError = validatePayload(payload);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const existing =
    role === "doctor" ? getDoctorMemberRow(memberId) : getSupportMemberRow(memberId, role);

  if (!existing) {
    return res.status(404).json({ error: `${role} account not found.` });
  }

  if (role === "doctor" && !existing.user_id && !payload.password) {
    return res.status(400).json({ error: "Password is required when restoring a doctor login." });
  }

  if (!ensureUniqueUsername(payload.username, role === "doctor" ? existing.user_id : existing.id)) {
    return res.status(409).json({ error: "That username is already in use." });
  }

  const updated = db.transaction(() => updateMember(memberId, payload))();

  if (!updated) {
    return res.status(404).json({ error: `${role} account not found.` });
  }

  res.json(updated);
});

router.patch("/:role/:id/activation", (req, res) => {
  const role = String(req.params.role || "").toLowerCase();

  if (!SUPPORTED_ROLES.has(role)) {
    return res.status(400).json({ error: "Unsupported team role." });
  }

  const memberId = Number(req.params.id);
  const nextIsActive = Boolean(req.body?.is_active);

  if (role === "doctor") {
    const existing = getDoctorMemberRow(memberId);

    if (!existing) {
      return res.status(404).json({ error: "Doctor not found." });
    }

    db.transaction(() => {
      db.prepare("UPDATE doctors SET is_active = ?, deleted_at = NULL WHERE id = ?").run(
        nextIsActive ? 1 : 0,
        memberId,
      );

      if (existing.user_id) {
        db.prepare("UPDATE users SET is_active = ?, deleted_at = NULL WHERE id = ?").run(
          nextIsActive ? 1 : 0,
          existing.user_id,
        );

        if (!nextIsActive) {
          db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(existing.user_id);
        }
      }
    })();

    return res.json(getDoctorMemberRow(memberId));
  }

  const existing = getSupportMemberRow(memberId, role);

  if (!existing) {
    return res.status(404).json({ error: `${role} account not found.` });
  }

  db.transaction(() => {
    db.prepare("UPDATE users SET is_active = ?, deleted_at = NULL WHERE id = ?").run(
      nextIsActive ? 1 : 0,
      memberId,
    );

    if (!nextIsActive) {
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(memberId);
    }
  })();

  const updated = getSupportMemberRow(memberId, role);

  return res.json(updated);
});

router.post("/:role/:id/restore", (req, res) => {
  const role = String(req.params.role || "").toLowerCase();

  if (!SUPPORTED_ROLES.has(role)) {
    return res.status(400).json({ error: "Unsupported team role." });
  }

  const memberId = Number(req.params.id);

  if (role === "doctor") {
    const existing = getDoctorMemberRow(memberId, { includeDeleted: true });

    if (!existing || !existing.deleted_at) {
      return res.status(404).json({ error: "Deleted doctor not found." });
    }

    db.transaction(() => {
      db.prepare("UPDATE doctors SET deleted_at = NULL, is_active = 1 WHERE id = ?").run(memberId);

      if (existing.user_id) {
        db.prepare("UPDATE users SET deleted_at = NULL, is_active = 1 WHERE id = ?").run(
          existing.user_id,
        );
      }
    })();

    return res.json(getDoctorMemberRow(memberId));
  }

  const existing = getSupportMemberRow(memberId, role, { includeDeleted: true });

  if (!existing || !existing.deleted_at) {
    return res.status(404).json({ error: `Deleted ${role} account not found.` });
  }

  db.prepare("UPDATE users SET deleted_at = NULL, is_active = 1 WHERE id = ?").run(memberId);

  return res.json(getSupportMemberRow(memberId, role));
});

router.delete("/:role/:id", (req, res) => {
  const role = String(req.params.role || "").toLowerCase();

  if (!SUPPORTED_ROLES.has(role)) {
    return res.status(400).json({ error: "Unsupported team role." });
  }

  const memberId = Number(req.params.id);

  if (role === "doctor") {
    const existing = getDoctorMemberRow(memberId);

    if (!existing) {
      return res.status(404).json({ error: "Doctor not found." });
    }

    db.transaction(() => {
      if (existing.user_id) {
        db.prepare("UPDATE users SET is_active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(
          existing.user_id,
        );
        db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(existing.user_id);
      }

      db.prepare("UPDATE doctors SET is_active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(
        memberId,
      );
    })();

    return res.status(204).send();
  }

  const existing = getSupportMemberRow(memberId, role);

  if (!existing) {
    return res.status(404).json({ error: `${role} account not found.` });
  }

  db.transaction(() => {
    db.prepare("UPDATE users SET is_active = 0, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      memberId,
    );
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(memberId);
  })();

  return res.status(204).send();
});

module.exports = router;
