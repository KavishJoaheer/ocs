const express = require("express");
const { db } = require("../db");
const { publishPatientDataChange } = require("../lib/inventoryRealtime");
const { getDoctorCaseloadFilterSql } = require("../lib/patientAccess");
const { notifyStaffAppointmentMutation } = require("../lib/appointmentNotifications");

const router = express.Router();
const validStatuses = new Set(["scheduled", "completed", "cancelled"]);

const APPOINTMENT_DETAIL = `
  SELECT
    a.*,
    p.full_name AS patient_name,
    d.full_name AS doctor_name,
    d.specialization,
    c.id AS consultation_id
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN doctors d ON d.id = a.doctor_id
  LEFT JOIN consultations c ON c.appointment_id = a.id
  WHERE a.id = ?
`;

function getAppointmentDetail(id) {
  return db.prepare(APPOINTMENT_DETAIL).get(id) || null;
}

function validateAppointmentPayload(body) {
  const patientId = Number(body.patient_id);
  const doctorId = Number(body.doctor_id);
  const appointmentDate = String(body.appointment_date ?? "").trim();
  const appointmentTime = String(body.appointment_time ?? "").trim();
  const status = String(body.status ?? "scheduled").trim();

  if (!Number.isInteger(patientId) || patientId <= 0) return "Patient selection is required.";
  if (!Number.isInteger(doctorId) || doctorId <= 0) return "Doctor selection is required.";
  if (!appointmentDate) return "Appointment date is required.";
  if (!appointmentTime) return "Appointment time is required.";
  if (!validStatuses.has(status)) return "Appointment status is invalid.";

  return null;
}

router.get("/", (req, res) => {
  const doctorId = String(req.query.doctorId ?? "").trim();
  const caseloadDoctorId =
    req.auth?.role === "doctor" ? Number(req.auth.doctor_id || 0) : null;
  if (req.auth?.role === "doctor" && !caseloadDoctorId) {
    return res.json([]);
  }
  const status = String(req.query.status ?? "").trim();
  const dateFrom = String(req.query.dateFrom ?? "").trim();
  const dateTo = String(req.query.dateTo ?? "").trim();

  const appointments = db
    .prepare(`
      SELECT
        a.*,
        p.full_name AS patient_name,
        d.full_name AS doctor_name,
        d.specialization,
        c.id AS consultation_id
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN doctors d ON d.id = a.doctor_id
      LEFT JOIN consultations c ON c.appointment_id = a.id
      WHERE p.deleted_at IS NULL
        AND (@doctorId = '' OR CAST(a.doctor_id AS TEXT) = @doctorId)
        AND (@status = '' OR a.status = @status)
        AND (@dateFrom = '' OR a.appointment_date >= @dateFrom)
        AND (@dateTo = '' OR a.appointment_date <= @dateTo)
        ${caseloadDoctorId ? getDoctorCaseloadFilterSql("p") : ""}
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
    `)
    .all({
      doctorId,
      status,
      dateFrom,
      dateTo,
      ...(caseloadDoctorId ? { caseloadDoctorId } : {}),
    });

  res.json(appointments);
});

router.post("/", (req, res) => {
  const validationError = validateAppointmentPayload(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const patient = db
    .prepare("SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL")
    .get(Number(req.body.patient_id));
  const doctor = db
    .prepare("SELECT id FROM doctors WHERE id = ? AND is_active = 1")
    .get(Number(req.body.doctor_id));

  if (!patient || !doctor) {
    return res.status(400).json({ error: "Patient or doctor record does not exist." });
  }

  const result = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      Number(req.body.patient_id),
      Number(req.body.doctor_id),
      String(req.body.appointment_date).trim(),
      String(req.body.appointment_time).trim(),
      String(req.body.status ?? "scheduled").trim(),
    );

  const appointment = getAppointmentDetail(result.lastInsertRowid);

  publishPatientDataChange(appointment.patient_id, { reason: "appointment" });
  notifyStaffAppointmentMutation(null, appointment);

  res.status(201).json(appointment);
});

router.put("/:id", (req, res) => {
  const appointmentId = Number(req.params.id);
  const before = getAppointmentDetail(appointmentId);

  if (!before) return res.status(404).json({ error: "Appointment not found." });

  const validationError = validateAppointmentPayload(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const patient = db
    .prepare("SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL")
    .get(Number(req.body.patient_id));
  const doctor = db
    .prepare("SELECT id FROM doctors WHERE id = ? AND is_active = 1")
    .get(Number(req.body.doctor_id));

  if (!patient || !doctor) {
    return res.status(400).json({ error: "Patient or doctor record does not exist." });
  }

  db.prepare(`
    UPDATE appointments
    SET patient_id = ?, doctor_id = ?, appointment_date = ?, appointment_time = ?, status = ?
    WHERE id = ?
  `).run(
    Number(req.body.patient_id),
    Number(req.body.doctor_id),
    String(req.body.appointment_date).trim(),
    String(req.body.appointment_time).trim(),
    String(req.body.status ?? "scheduled").trim(),
    appointmentId,
  );

  const appointment = getAppointmentDetail(appointmentId);

  publishPatientDataChange(appointment.patient_id, { reason: "appointment" });
  notifyStaffAppointmentMutation(before, appointment);

  res.json(appointment);
});

router.patch("/:id/status", (req, res) => {
  const appointmentId = Number(req.params.id);
  const status = String(req.body.status ?? "").trim();

  if (!validStatuses.has(status)) {
    return res.status(400).json({ error: "Appointment status is invalid." });
  }

  const existing = getAppointmentDetail(appointmentId);
  if (!existing) return res.status(404).json({ error: "Appointment not found." });

  if (
    req.auth?.role === "doctor" &&
    req.auth.doctor_id &&
    Number(existing.doctor_id) !== Number(req.auth.doctor_id)
  ) {
    return res.status(403).json({ error: "You can only update your own appointments." });
  }

  db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(status, appointmentId);
  const updated = getAppointmentDetail(appointmentId);
  publishPatientDataChange(updated.patient_id, { reason: "appointment" });
  notifyStaffAppointmentMutation(existing, updated);
  res.json(updated);
});

router.delete("/:id", (req, res) => {
  const appointmentId = Number(req.params.id);
  const existing = getAppointmentDetail(appointmentId);

  if (!existing) return res.status(404).json({ error: "Appointment not found." });

  const consultation = db
    .prepare("SELECT id FROM consultations WHERE appointment_id = ?")
    .get(appointmentId);

  if (consultation) {
    return res.status(400).json({
      error: "This appointment already has a consultation record and cannot be deleted.",
    });
  }

  db.prepare("DELETE FROM appointments WHERE id = ?").run(appointmentId);
  publishPatientDataChange(existing.patient_id, { reason: "appointment" });
  if (String(existing.status || "") === "scheduled") {
    notifyStaffAppointmentMutation(existing, { ...existing, status: "cancelled" });
  }
  res.status(204).send();
});

module.exports = router;
