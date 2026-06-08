const fs = require("fs");
const path = require("path");
const express = require("express");
const { db, labReportAttachmentsDir } = require("../db");
const { publishPatientDataChange } = require("../lib/inventoryRealtime");

const router = express.Router();

/** Split a free-text clinical field into list items for the records UI. */
function splitClinicalField(text) {
  return String(text || "")
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ id: index + 1, name: line }));
}

function fileTypeFromMime(mime) {
  const value = String(mime || "").toLowerCase();
  if (value === "application/pdf") return "PDF";
  if (value.startsWith("image/")) return "Image";
  return "Document";
}

const DIAGNOSIS_PREFIX_REGEX = /^(imp(ression)?\s*:|dx\s*-\s*|dx\s*:|diagnosis\s*:)/i;

function extractDiagnosisFromNotes(notes) {
  const rawText = String(notes || "").trim();
  if (!rawText) {
    return "General Assessment";
  }

  for (const line of rawText.split("\n")) {
    const cleanLine = String(line || "").trim();
    if (!cleanLine || !DIAGNOSIS_PREFIX_REGEX.test(cleanLine)) {
      continue;
    }

    let diagnosis = cleanLine
      .replace(/^imp(ression)?\s*:/i, "")
      .replace(/^dx\s*-\s*/i, "")
      .replace(/^dx\s*:/i, "")
      .replace(/^diagnosis\s*:/i, "")
      .trim()
      .replace(/\bday\s*\d+\b.*$/i, "")
      .trim();

    if (diagnosis.length > 140) {
      diagnosis = `${diagnosis.slice(0, 140).trim()}…`;
    }

    return diagnosis || "General Assessment";
  }

  const fallback = rawText.length > 80 ? `${rawText.slice(0, 80).trim()}…` : rawText;
  return fallback || "General Assessment";
}

router.get("/dashboard", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({
      patient: null,
      upcoming_appointments_count: 0,
      pending_bills_count: 0,
      next_appointment: null,
    });
  }

  const patient = db
    .prepare(`
      SELECT p.*, d.full_name AS assigned_doctor_name
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      WHERE p.id = ? AND p.deleted_at IS NULL
    `)
    .get(patientId);

  const upcomingCount = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM appointments
      WHERE patient_id = ?
        AND appointment_date >= date('now')
        AND status = 'scheduled'
    `)
    .get(patientId);

  const pendingBills = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM billing
      WHERE patient_id = ? AND status = 'unpaid'
    `)
    .get(patientId);

  const nextAppointment = db
    .prepare(`
      SELECT
        a.*,
        d.full_name AS doctor_name
      FROM appointments a
      JOIN doctors d ON d.id = a.doctor_id
      WHERE a.patient_id = ?
        AND a.appointment_date >= date('now')
        AND a.status = 'scheduled'
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT 1
    `)
    .get(patientId);

  const lastConsultationRow = db
    .prepare(`
      SELECT
        c.id,
        c.consultation_date,
        c.doctor_notes,
        d.full_name AS doctor_name
      FROM consultations c
      JOIN doctors d ON d.id = c.doctor_id
      WHERE c.patient_id = ?
      ORDER BY c.consultation_date DESC, c.id DESC
      LIMIT 1
    `)
    .get(patientId);

  const lastConsultation = lastConsultationRow
    ? {
        id: lastConsultationRow.id,
        doctor_name: lastConsultationRow.doctor_name,
        date: lastConsultationRow.consultation_date,
        diagnosis: extractDiagnosisFromNotes(lastConsultationRow.doctor_notes),
      }
    : null;

  return res.json({
    patient: patient || null,
    upcoming_appointments_count: upcomingCount?.count || 0,
    pending_bills_count: pendingBills?.count || 0,
    next_appointment: nextAppointment || null,
    last_consultation: lastConsultation,
  });
});

router.get("/appointments", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({ appointments: [] });
  }

  const appointments = db
    .prepare(`
      SELECT
        a.*,
        d.full_name AS doctor_name
      FROM appointments a
      JOIN doctors d ON d.id = a.doctor_id
      WHERE a.patient_id = ?
      ORDER BY a.appointment_date DESC, a.appointment_time DESC
    `)
    .all(patientId);

  return res.json({ appointments });
});

router.get("/billing", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({ billing: [] });
  }

  const billing = db
    .prepare(`
      SELECT
        b.*,
        c.consultation_date,
        c.doctor_notes,
        d.full_name AS doctor_name
      FROM billing b
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE b.patient_id = ?
      ORDER BY b.created_at DESC
    `)
    .all(patientId);

  return res.json({ billing });
});

router.get("/profile", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({ patient: null });
  }

  const patient = db
    .prepare(`
      SELECT p.*, d.full_name AS assigned_doctor_name
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      WHERE p.id = ? AND p.deleted_at IS NULL
    `)
    .get(patientId);

  return res.json({ patient: patient || null });
});

router.get("/health-records", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({ consultations: [], reports: [], clinical: {} });
  }

  const patient = db
    .prepare("SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL")
    .get(patientId);

  if (!patient) {
    return res.json({ consultations: [], reports: [], clinical: {} });
  }

  const consultationRows = db
    .prepare(`
      SELECT c.id, c.consultation_date, c.doctor_notes, d.full_name AS doctor_name
      FROM consultations c
      JOIN doctors d ON d.id = c.doctor_id
      WHERE c.patient_id = ?
      ORDER BY c.consultation_date DESC, c.id DESC
    `)
    .all(patientId);

  // All of this patient's report attachments, joined to their parent report and
  // the staff member who created it.
  const attachmentRows = db
    .prepare(`
      SELECT
        a.id,
        a.consultation_id,
        a.original_name,
        a.mime_type,
        a.created_at,
        lr.report_title,
        lr.report_date,
        u.full_name AS created_by_name
      FROM lab_report_attachments a
      JOIN lab_reports lr ON lr.id = a.report_id
      LEFT JOIN users u ON u.id = lr.created_by_user_id
      WHERE a.patient_id = ?
      ORDER BY a.created_at DESC, a.id DESC
    `)
    .all(patientId);

  const attachmentsByConsultation = new Map();
  for (const row of attachmentRows) {
    if (!row.consultation_id) continue;
    const list = attachmentsByConsultation.get(row.consultation_id) || [];
    list.push({ id: row.id, name: row.original_name || row.report_title || "Report" });
    attachmentsByConsultation.set(row.consultation_id, list);
  }

  const consultations = consultationRows.map((row) => ({
    id: row.id,
    date: row.consultation_date,
    doctor_name: row.doctor_name,
    diagnosis: extractDiagnosisFromNotes(row.doctor_notes),
    reports: attachmentsByConsultation.get(row.id) || [],
  }));

  const reports = attachmentRows.map((row) => ({
    id: row.id,
    name: row.original_name || row.report_title || "Report",
    report_date: row.report_date || row.created_at,
    uploaded_at: row.created_at,
    file_type: fileTypeFromMime(row.mime_type),
    requested_by: row.created_by_name || "",
    requested_by_source: row.created_by_name ? "OCS Doctor" : "",
  }));

  const clinical = {
    medical_history: splitClinicalField(patient.past_medical_history),
    surgical_history: splitClinicalField(patient.past_surgical_history),
    allergy_history: splitClinicalField(patient.drug_allergy_history),
    drug_history: splitClinicalField(patient.drug_history),
  };

  return res.json({ consultations, reports, clinical });
});

router.put("/profile", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.status(404).json({ error: "Patient record not found." });
  }

  const patient = db
    .prepare("SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL")
    .get(patientId);

  if (!patient) {
    return res.status(404).json({ error: "Patient record not found." });
  }

  const phone = req.body.phone !== undefined ? String(req.body.phone).trim() : undefined;
  const address = req.body.address !== undefined ? String(req.body.address).trim() : undefined;
  const location = req.body.location !== undefined ? String(req.body.location).trim() : undefined;
  const nextOfKinName =
    req.body.next_of_kin_name !== undefined ? String(req.body.next_of_kin_name).trim() : undefined;
  const nextOfKinRelationship =
    req.body.next_of_kin_relationship !== undefined
      ? String(req.body.next_of_kin_relationship).trim()
      : undefined;
  const nextOfKinContactNumber =
    req.body.next_of_kin_contact_number !== undefined
      ? String(req.body.next_of_kin_contact_number).trim()
      : undefined;
  const nextOfKinEmail =
    req.body.next_of_kin_email !== undefined ? String(req.body.next_of_kin_email).trim() : undefined;
  const nextOfKinAddress =
    req.body.next_of_kin_address !== undefined
      ? String(req.body.next_of_kin_address).trim()
      : undefined;

  const updates = [];
  const params = [];

  if (phone !== undefined) {
    updates.push("patient_contact_number = ?");
    params.push(phone);
  }

  if (address !== undefined) {
    updates.push("address = ?");
    params.push(address);
  }

  if (location !== undefined) {
    updates.push("location = ?");
    params.push(location);
  }

  if (nextOfKinName !== undefined) {
    updates.push("next_of_kin_name = ?");
    params.push(nextOfKinName);
  }

  if (nextOfKinRelationship !== undefined) {
    updates.push("next_of_kin_relationship = ?");
    params.push(nextOfKinRelationship);
  }

  if (nextOfKinContactNumber !== undefined) {
    updates.push("next_of_kin_contact_number = ?");
    params.push(nextOfKinContactNumber);
  }

  if (nextOfKinEmail !== undefined) {
    updates.push("next_of_kin_email = ?");
    params.push(nextOfKinEmail);
  }

  if (nextOfKinAddress !== undefined) {
    updates.push("next_of_kin_address = ?");
    params.push(nextOfKinAddress);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid fields provided for update." });
  }

  params.push(patientId);

  db.prepare(`UPDATE patients SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  if (phone !== undefined) {
    db.prepare("UPDATE patient_users SET phone = ? WHERE patient_id = ?").run(phone, patientId);
  }

  const updated = db
    .prepare(`
      SELECT p.*, d.full_name AS assigned_doctor_name
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      WHERE p.id = ?
    `)
    .get(patientId);

  publishPatientDataChange(patientId, { reason: "profile" });

  return res.json({ patient: updated });
});

// Serve a report attachment to the patient who owns it. Mounted in app.js with
// requirePatientAuthFlexible so the browser can open it directly (token in the
// query string, since <a>/window.open cannot send an Authorization header).
function handleReportAttachmentDownload(req, res) {
  const patientId = req.patientAuth?.patient_id;
  const attachmentId = Number(req.params.attachmentId);

  if (!patientId || !Number.isInteger(attachmentId) || attachmentId <= 0) {
    return res.status(404).json({ error: "Attachment not found." });
  }

  const attachment = db
    .prepare(
      "SELECT id, patient_id, original_name, mime_type, relative_path FROM lab_report_attachments WHERE id = ?",
    )
    .get(attachmentId);

  // Ownership check: a patient may only open their own attachments.
  if (!attachment || Number(attachment.patient_id) !== Number(patientId)) {
    return res.status(404).json({ error: "Attachment not found." });
  }

  const filePath = path.join(labReportAttachmentsDir, attachment.relative_path);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Stored file was not found." });
  }

  res.setHeader("Content-Type", attachment.mime_type || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(attachment.original_name || "report")}"`,
  );
  return res.sendFile(filePath);
}

router.handleReportAttachmentDownload = handleReportAttachmentDownload;

module.exports = router;
