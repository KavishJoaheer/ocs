const express = require("express");
const { db } = require("../db");

const router = express.Router();

function normalizeLabReportPayload(body) {
  const consultationRaw = String(body.consultation_id ?? "").trim();

  return {
    patient_id: Number(body.patient_id),
    consultation_id: consultationRaw ? Number(consultationRaw) : null,
    report_title: String(body.report_title ?? "").trim(),
    report_date: String(body.report_date ?? "").trim(),
    report_details: String(body.report_details ?? "").trim(),
  };
}

function validateLabReportPayload(payload) {
  if (!Number.isInteger(payload.patient_id) || payload.patient_id <= 0) {
    return "Patient selection is required.";
  }

  if (
    payload.consultation_id !== null &&
    (!Number.isInteger(payload.consultation_id) || payload.consultation_id <= 0)
  ) {
    return "Linked consultation must be valid.";
  }

  if (!payload.report_title) return "Report title is required.";
  if (!payload.report_date) return "Report date is required.";
  if (!payload.report_details) return "Report details are required.";

  return null;
}

function getPatientById(patientId) {
  return db
    .prepare(`
      SELECT id, full_name, assigned_doctor_id
      FROM patients
      WHERE id = ?
        AND deleted_at IS NULL
    `)
    .get(patientId);
}

function getLabReportById(reportId) {
  return db
    .prepare(`
      SELECT
        lr.*,
        c.consultation_date,
        d.full_name AS consultation_doctor_name,
        d.specialization AS consultation_doctor_specialization,
        u.full_name AS created_by_name,
        u.role AS created_by_role
      FROM lab_reports lr
      LEFT JOIN consultations c ON c.id = lr.consultation_id
      LEFT JOIN doctors d ON d.id = c.doctor_id
      LEFT JOIN users u ON u.id = lr.created_by_user_id
      WHERE lr.id = ?
    `)
    .get(reportId);
}

function getLabReportsByPatientId(patientId) {
  return db
    .prepare(`
      SELECT
        lr.*,
        c.consultation_date,
        d.full_name AS consultation_doctor_name,
        d.specialization AS consultation_doctor_specialization,
        u.full_name AS created_by_name,
        u.role AS created_by_role
      FROM lab_reports lr
      LEFT JOIN consultations c ON c.id = lr.consultation_id
      LEFT JOIN doctors d ON d.id = c.doctor_id
      LEFT JOIN users u ON u.id = lr.created_by_user_id
      WHERE lr.patient_id = ?
      ORDER BY lr.report_date DESC, lr.created_at DESC
    `)
    .all(patientId);
}

function ensureConsultationMatchesPatient(patientId, consultationId) {
  if (!consultationId) {
    return { consultation: null };
  }

  const consultation = db
    .prepare(`
      SELECT id, patient_id
      FROM consultations
      WHERE id = ?
    `)
    .get(consultationId);

  if (!consultation) {
    return { error: "Linked consultation was not found." };
  }

  if (Number(consultation.patient_id) !== Number(patientId)) {
    return { error: "The selected consultation does not belong to this patient." };
  }

  return { consultation };
}

function ensureDoctorPatientAccess(patient, auth) {
  if (auth.role !== "doctor") {
    return true;
  }

  return (
    auth.doctor_id &&
    Number(patient.assigned_doctor_id) === Number(auth.doctor_id)
  );
}

router.get("/", (req, res) => {
  const patientId = Number(req.query.patientId);

  if (!Number.isInteger(patientId) || patientId <= 0) {
    return res.status(400).json({ error: "Patient id is required." });
  }

  const patient = getPatientById(patientId);

  if (!patient) {
    return res.status(404).json({ error: "Patient not found." });
  }

  if (!ensureDoctorPatientAccess(patient, req.auth)) {
    return res.status(403).json({
      error: "You can only access lab reports for patients assigned to your doctor profile.",
    });
  }

  res.json(getLabReportsByPatientId(patientId));
});

router.post("/", (req, res) => {
  const payload = normalizeLabReportPayload(req.body);
  const validationError = validateLabReportPayload(payload);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const patient = getPatientById(payload.patient_id);

  if (!patient) {
    return res.status(404).json({ error: "Patient not found." });
  }

  if (!ensureDoctorPatientAccess(patient, req.auth)) {
    return res.status(403).json({
      error: "You can only add lab reports for patients assigned to your doctor profile.",
    });
  }

  const consultationMatch = ensureConsultationMatchesPatient(
    payload.patient_id,
    payload.consultation_id,
  );

  if (consultationMatch.error) {
    return res.status(400).json({ error: consultationMatch.error });
  }

  const result = db
    .prepare(`
      INSERT INTO lab_reports (
        patient_id,
        consultation_id,
        report_title,
        report_date,
        report_details,
        created_by_user_id
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      payload.patient_id,
      payload.consultation_id,
      payload.report_title,
      payload.report_date,
      payload.report_details,
      req.auth.id,
    );

  res.status(201).json(getLabReportById(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const reportId = Number(req.params.id);
  const existing = db
    .prepare(`
      SELECT id, patient_id
      FROM lab_reports
      WHERE id = ?
    `)
    .get(reportId);

  if (!existing) {
    return res.status(404).json({ error: "Lab report not found." });
  }

  const payload = normalizeLabReportPayload({
    ...req.body,
    patient_id: existing.patient_id,
  });
  const validationError = validateLabReportPayload(payload);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const patient = getPatientById(existing.patient_id);

  if (!patient) {
    return res.status(404).json({ error: "Patient not found." });
  }

  if (!ensureDoctorPatientAccess(patient, req.auth)) {
    return res.status(403).json({
      error: "You can only edit lab reports for patients assigned to your doctor profile.",
    });
  }

  const consultationMatch = ensureConsultationMatchesPatient(
    existing.patient_id,
    payload.consultation_id,
  );

  if (consultationMatch.error) {
    return res.status(400).json({ error: consultationMatch.error });
  }

  db.prepare(`
    UPDATE lab_reports
    SET
      consultation_id = ?,
      report_title = ?,
      report_date = ?,
      report_details = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    payload.consultation_id,
    payload.report_title,
    payload.report_date,
    payload.report_details,
    reportId,
  );

  res.json(getLabReportById(reportId));
});

module.exports = router;
