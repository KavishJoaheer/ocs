const express = require("express");
const { db, ensureBillingForConsultation } = require("../db");
const { parseBillingRow, toNumber } = require("../lib/utils");

const router = express.Router();

function validateConsultationPayload(body, options = {}) {
  const requireAppointment = options.requireAppointment ?? true;
  const appointmentId = Number(body.appointment_id);
  const consultationDate = String(body.consultation_date ?? "").trim();
  const doctorNotes = String(body.doctor_notes ?? "").trim();

  if (requireAppointment && (!Number.isInteger(appointmentId) || appointmentId <= 0)) {
    return "Appointment selection is required.";
  }

  if (!consultationDate) return "Consultation date is required.";
  if (!doctorNotes) return "Doctor notes are required.";

  return null;
}

function getDoctorRecord(doctorId) {
  return db
    .prepare(`
      SELECT id, full_name, specialization
      FROM doctors
      WHERE id = ?
        AND deleted_at IS NULL
    `)
    .get(doctorId);
}

function getConsultationById(consultationId) {
  const consultation = db
    .prepare(`
      SELECT
        c.*,
        p.full_name AS patient_name,
        p.patient_identifier,
        p.patient_id_number,
        d.full_name AS doctor_name,
        d.specialization,
        a.appointment_date,
        a.appointment_time,
        a.status AS appointment_status,
        (
          SELECT COUNT(*)
          FROM billing b
          WHERE b.consultation_id = c.id
        ) AS bill_count,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM billing b
            WHERE b.consultation_id = c.id
              AND b.status = 'unpaid'
          ) THEN 'unpaid'
          WHEN EXISTS (
            SELECT 1
            FROM billing b
            WHERE b.consultation_id = c.id
          ) THEN 'paid'
          ELSE NULL
        END AS bill_status,
        (
          SELECT COALESCE(SUM(b.total_amount), 0)
          FROM billing b
          WHERE b.consultation_id = c.id
        ) AS bill_total_amount
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      JOIN appointments a ON a.id = c.appointment_id
      WHERE c.id = ?
        AND p.deleted_at IS NULL
    `)
    .get(consultationId);

  if (!consultation) {
    return null;
  }

  const bills = db
    .prepare(`
      SELECT
        b.*,
        p.full_name AS patient_name,
        c.consultation_date,
        d.full_name AS doctor_name
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE b.consultation_id = ?
        AND p.deleted_at IS NULL
      ORDER BY b.created_at DESC, b.id DESC
    `)
    .all(consultationId)
    .map(parseBillingRow);

  return {
    ...consultation,
    bill_count: Number(consultation.bill_count || 0),
    bill_total_amount: toNumber(consultation.bill_total_amount, 0),
    bills,
  };
}

router.get("/available-appointments", (_req, res) => {
  const appointments = db
    .prepare(`
      SELECT
        a.id,
        a.appointment_date,
        a.appointment_time,
        a.status,
        p.full_name AS patient_name,
        d.full_name AS doctor_name,
        d.specialization
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN doctors d ON d.id = a.doctor_id
      LEFT JOIN consultations c ON c.appointment_id = a.id
      WHERE c.id IS NULL
        AND a.status != 'cancelled'
        AND p.deleted_at IS NULL
        AND (@doctorId = '' OR CAST(a.doctor_id AS TEXT) = @doctorId)
      ORDER BY a.appointment_date DESC, a.appointment_time DESC
    `)
    .all({
      doctorId:
        _req.auth?.role === "doctor" && _req.auth.doctor_id ? String(_req.auth.doctor_id) : "",
    });

  res.json(appointments);
});

router.get("/", (req, res) => {
  const consultations = db
    .prepare(`
      SELECT
        c.*,
        p.full_name AS patient_name,
        d.full_name AS doctor_name,
        d.specialization,
        a.appointment_date,
        a.appointment_time,
        (
          SELECT COUNT(*)
          FROM billing b
          WHERE b.consultation_id = c.id
        ) AS bill_count,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM billing b
            WHERE b.consultation_id = c.id
              AND b.status = 'unpaid'
          ) THEN 'unpaid'
          WHEN EXISTS (
            SELECT 1
            FROM billing b
            WHERE b.consultation_id = c.id
          ) THEN 'paid'
          ELSE NULL
        END AS bill_status
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      JOIN appointments a ON a.id = c.appointment_id
      WHERE p.deleted_at IS NULL
        AND (@doctorId = '' OR CAST(c.doctor_id AS TEXT) = @doctorId)
      ORDER BY c.consultation_date DESC, c.created_at DESC
    `)
    .all({
      doctorId:
        req.auth?.role === "doctor" && req.auth.doctor_id ? String(req.auth.doctor_id) : "",
    })
    .map((consultation) => ({
      ...consultation,
      bill_count: Number(consultation.bill_count || 0),
    }));

  res.json(consultations);
});

router.get("/:id", (req, res) => {
  const consultationId = Number(req.params.id);
  const consultation = getConsultationById(consultationId);

  if (!consultation) {
    return res.status(404).json({ error: "Consultation not found." });
  }

  if (
    req.auth?.role === "doctor" &&
    req.auth.doctor_id &&
    Number(consultation.doctor_id) !== Number(req.auth.doctor_id)
  ) {
    return res.status(403).json({ error: "You can only view your own consultations." });
  }

  res.json(consultation);
});

router.post("/", (req, res) => {
  const validationError = validateConsultationPayload(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const appointmentId = Number(req.body.appointment_id);
  const appointment = db.prepare("SELECT * FROM appointments WHERE id = ?").get(appointmentId);

  if (!appointment) {
    return res.status(400).json({ error: "Selected appointment does not exist." });
  }

  if (
    req.auth?.role === "doctor" &&
    req.auth.doctor_id &&
    Number(appointment.doctor_id) !== Number(req.auth.doctor_id)
  ) {
    return res.status(403).json({ error: "You can only create consultations for your own appointments." });
  }

  const existingConsultation = db
    .prepare("SELECT id FROM consultations WHERE appointment_id = ?")
    .get(appointmentId);

  if (existingConsultation) {
    return res.status(409).json({
      error: "A consultation already exists for this appointment. Please edit the existing note.",
    });
  }

  const createConsultation = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        appointmentId,
        appointment.patient_id,
        appointment.doctor_id,
        String(req.body.consultation_date).trim(),
        String(req.body.doctor_notes).trim(),
      );

    db.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?").run(appointmentId);
    ensureBillingForConsultation(result.lastInsertRowid, appointment.patient_id);

    return result.lastInsertRowid;
  });

  const consultationId = createConsultation();
  const consultation = getConsultationById(consultationId);

  res.status(201).json(consultation);
});

router.put("/:id", (req, res) => {
  const consultationId = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM consultations WHERE id = ?").get(consultationId);

  if (!existing) return res.status(404).json({ error: "Consultation not found." });

  if (
    req.auth?.role === "doctor" &&
    req.auth.doctor_id &&
    Number(existing.doctor_id) !== Number(req.auth.doctor_id)
  ) {
    return res.status(403).json({ error: "You can only edit your own consultations." });
  }

  const validationError = validateConsultationPayload({
    ...req.body,
    appointment_id: existing.appointment_id,
  }, {
    requireAppointment: false,
  });
  if (validationError) return res.status(400).json({ error: validationError });

  const nextDoctorId =
    req.auth?.role === "doctor"
      ? Number(existing.doctor_id)
      : Number.isInteger(Number(req.body.doctor_id)) && Number(req.body.doctor_id) > 0
        ? Number(req.body.doctor_id)
        : Number(existing.doctor_id);

  const doctor = getDoctorRecord(nextDoctorId);

  if (!doctor) {
    return res.status(400).json({ error: "Selected doctor was not found." });
  }

  const nextConsultationDate = String(req.body.consultation_date).trim();
  const nextDoctorNotes = String(req.body.doctor_notes).trim();

  db.transaction(() => {
    db.prepare(`
      UPDATE consultations
      SET
        doctor_id = ?,
        consultation_date = ?,
        doctor_notes = ?
      WHERE id = ?
    `).run(nextDoctorId, nextConsultationDate, nextDoctorNotes, consultationId);

    db.prepare(`
      UPDATE appointments
      SET
        doctor_id = ?,
        appointment_date = ?,
        status = 'completed'
      WHERE id = ?
    `).run(nextDoctorId, nextConsultationDate, existing.appointment_id);
  })();

  const consultation = getConsultationById(consultationId);

  res.json(consultation);
});

router.delete("/:id", (req, res) => {
  const consultationId = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM consultations WHERE id = ?").get(consultationId);

  if (!existing) {
    return res.status(404).json({ error: "Consultation not found." });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM billing WHERE consultation_id = ?").run(consultationId);
    db.prepare("DELETE FROM consultations WHERE id = ?").run(consultationId);
  })();

  res.status(204).send();
});

module.exports = router;
