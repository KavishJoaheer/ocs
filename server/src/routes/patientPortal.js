const fs = require("fs");
const path = require("path");
const express = require("express");
const { db, labReportAttachmentsDir } = require("../db");
const { publishPatientDataChange } = require("../lib/inventoryRealtime");
const {
  getVapidPublicKey,
  isPushConfigured,
  savePatientPushSubscription,
  clearPatientPushSubscription,
} = require("../lib/push");
const { notifyStaffNewVisitRequest } = require("../lib/visitRequestNotifications");
const {
  PATIENT_CANCELLABLE_STATUSES,
  getActiveVisitRequestForPatient,
  getVisitRequestById,
} = require("../lib/visitRequests");
const {
  buildHealthRecordsPayload,
  extractDiagnosisFromNotes,
} = require("../lib/healthRecords");
const { serializePatientBillingRows } = require("../lib/patientBilling");

const router = express.Router();

// Normalize a raw patients row (DB column names) into the shape the patient
// portal UI consumes (phone, ocs_care_number, next_of_kin_phone, review, ...).
function serializePatientProfile(patient) {
  if (!patient) {
    return null;
  }

  return {
    id: patient.id,
    full_name: patient.full_name,
    first_name: patient.first_name,
    last_name: patient.last_name,
    ocs_care_number: patient.patient_identifier || null,
    patient_id_number: patient.patient_id_number || null,
    date_of_birth: patient.date_of_birth || null,
    gender: patient.gender || null,
    age: patient.age ?? null,
    phone: patient.patient_contact_number || patient.contact_number || "",
    address: patient.address || "",
    location: patient.location || "",
    assigned_doctor_name: patient.assigned_doctor_name || null,
    next_of_kin_name: patient.next_of_kin_name || "",
    next_of_kin_relationship: patient.next_of_kin_relationship || "",
    next_of_kin_phone: patient.next_of_kin_contact_number || "",
    next_of_kin_email: patient.next_of_kin_email || "",
    next_of_kin_address: patient.next_of_kin_address || "",
    is_under_review: patient.is_under_review === 1 || patient.is_under_review === true,
    review_reason_note: String(patient.review_reason_note || "").trim() || null,
    review_due_date: String(patient.review_due_date || "").trim() || null,
  };
}

router.get("/dashboard", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({
      patient: null,
      stats: { upcoming_appointments: 0, pending_bills: 0, total_visits: 0 },
      recent_activity: [],
      upcoming_appointments_count: 0,
      pending_bills_count: 0,
      next_appointment: null,
      last_consultation: null,
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

  const totalVisits = db
    .prepare("SELECT COUNT(*) AS count FROM consultations WHERE patient_id = ?")
    .get(patientId);

  const recentConsultationRows = db
    .prepare(`
      SELECT c.consultation_date, c.doctor_notes, d.full_name AS doctor_name
      FROM consultations c
      JOIN doctors d ON d.id = c.doctor_id
      WHERE c.patient_id = ?
      ORDER BY c.consultation_date DESC, c.id DESC
      LIMIT 5
    `)
    .all(patientId);

  const recent_activity = recentConsultationRows.map((row) => {
    const diagnosis = extractDiagnosisFromNotes(row.doctor_notes);
    const doctorName = String(row.doctor_name || "Your doctor").trim();
    return {
      date: row.consultation_date,
      description: `${diagnosis} — ${doctorName}`,
    };
  });

  const upcomingAppointments = upcomingCount?.count || 0;
  const pendingBillsCount = pendingBills?.count || 0;

  return res.json({
    patient: patient || null,
    stats: {
      upcoming_appointments: upcomingAppointments,
      pending_bills: pendingBillsCount,
      total_visits: totalVisits?.count || 0,
    },
    recent_activity,
    upcoming_appointments_count: upcomingAppointments,
    pending_bills_count: pendingBillsCount,
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

  // Surface a staff-scheduled long-term review as an upcoming item so the
  // patient sees the follow-up their care team booked.
  const patient = db
    .prepare(`
      SELECT p.is_under_review, p.review_due_date, p.review_reason_note, d.full_name AS doctor_name
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      WHERE p.id = ? AND p.deleted_at IS NULL
    `)
    .get(patientId);

  const reviewDueDate = String(patient?.review_due_date || "").trim();

  if (patient && (patient.is_under_review === 1 || patient.is_under_review === true) && reviewDueDate) {
    appointments.unshift({
      id: `review-${patientId}`,
      patient_id: patientId,
      appointment_date: reviewDueDate,
      appointment_time: "",
      status: "scheduled",
      doctor_name: patient.doctor_name || null,
      kind: "review",
      reason: String(patient.review_reason_note || "").trim() || null,
    });
  }

  return res.json({ appointments });
});

router.get("/billing", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({
      bills: [],
      summary: { total_billed: 0, total_paid: 0, outstanding: 0 },
      billing: [],
    });
  }

  const rows = db
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

  return res.json(serializePatientBillingRows(rows));
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

  // Return both the normalized profile (what the UI reads) and the raw row for
  // any older callers.
  return res.json({ profile: serializePatientProfile(patient), patient: patient || null });
});

router.get("/health-records", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({
      consultations: [],
      reports: [],
      clinical: {},
      summary: null,
      timeline: [],
      vitals_trends: { blood_pressure: [], glucose: [], hba1c: [] },
    });
  }

  const patient = db
    .prepare("SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL")
    .get(patientId);

  if (!patient) {
    return res.json({
      consultations: [],
      reports: [],
      clinical: {},
      summary: null,
      timeline: [],
      vitals_trends: { blood_pressure: [], glucose: [], hba1c: [] },
    });
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

  const labReportRows = db
    .prepare(`
      SELECT id, report_date, report_details
      FROM lab_reports
      WHERE patient_id = ?
      ORDER BY report_date DESC, id DESC
    `)
    .all(patientId);

  const attachmentRows = db
    .prepare(`
      SELECT
        a.id,
        a.report_id,
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

  return res.json(
    buildHealthRecordsPayload({
      patient,
      consultationRows,
      attachmentRows,
      labReportRows,
    }),
  );
});

function applyProfileUpdate(req, res) {
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

  const readField = (...keys) => {
    for (const key of keys) {
      if (req.body[key] !== undefined) {
        return String(req.body[key]).trim();
      }
    }
    return undefined;
  };

  const phone = readField("phone", "patient_contact_number");
  const address = readField("address");
  const location = readField("location");
  const nextOfKinName = readField("next_of_kin_name");
  const nextOfKinRelationship = readField("next_of_kin_relationship");
  // The UI sends next_of_kin_phone; accept the canonical DB name too.
  const nextOfKinContactNumber = readField("next_of_kin_phone", "next_of_kin_contact_number");
  const nextOfKinEmail = readField("next_of_kin_email");
  const nextOfKinAddress = readField("next_of_kin_address");

  const updates = [];
  const params = [];

  const pushUpdate = (column, value) => {
    if (value !== undefined) {
      updates.push(`${column} = ?`);
      params.push(value);
    }
  };

  pushUpdate("patient_contact_number", phone);
  pushUpdate("address", address);
  pushUpdate("location", location);
  pushUpdate("next_of_kin_name", nextOfKinName);
  pushUpdate("next_of_kin_relationship", nextOfKinRelationship);
  pushUpdate("next_of_kin_contact_number", nextOfKinContactNumber);
  pushUpdate("next_of_kin_email", nextOfKinEmail);
  pushUpdate("next_of_kin_address", nextOfKinAddress);

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

  const user = db.prepare("SELECT * FROM patient_users WHERE patient_id = ?").get(patientId);

  publishPatientDataChange(patientId, { reason: "profile" });

  return res.json({
    profile: serializePatientProfile(updated),
    patient: updated,
    user: user
      ? {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          phone: user.phone,
          date_of_birth: user.date_of_birth,
          gender: user.gender,
        }
      : undefined,
  });
}

router.put("/profile", applyProfileUpdate);
router.patch("/profile", applyProfileUpdate);

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

router.get("/visit-requests/active", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({ visit_request: null });
  }

  return res.json({ visit_request: getActiveVisitRequestForPatient(patientId) });
});

router.post("/visit-requests", (req, res) => {
  const patientId = req.patientAuth.patient_id;
  const patientUserId = req.patientAuth.id;

  if (!patientId) {
    return res.status(404).json({ error: "Patient record not found." });
  }

  const existingActive = getActiveVisitRequestForPatient(patientId);
  if (existingActive) {
    return res.status(409).json({
      error: "You already have an active visit request in progress.",
      visit_request: existingActive,
    });
  }

  const visitFor = String(req.body.visit_for ?? "myself").trim() || "myself";
  const address = String(req.body.address ?? "").trim();
  const reason = String(req.body.reason ?? "").trim();
  const urgencyRaw = String(req.body.urgency ?? "routine").trim().toLowerCase();
  const urgency = ["routine", "urgent", "emergency"].includes(urgencyRaw) ? urgencyRaw : "routine";

  if (!address) {
    return res.status(400).json({ error: "A visiting address is required." });
  }

  if (!reason) {
    return res.status(400).json({ error: "A reason for the visit is required." });
  }

  const result = db
    .prepare(`
      INSERT INTO visit_requests (patient_id, patient_user_id, visit_for, address, reason, urgency, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `)
    .run(patientId, patientUserId || null, visitFor, address, reason, urgency);

  publishPatientDataChange(patientId, { reason: "visit_request" });

  const visitRequest = getVisitRequestById(result.lastInsertRowid);
  void notifyStaffNewVisitRequest(visitRequest).catch((error) => {
    console.warn("[push] new visit request notification failed:", error?.message || error);
  });

  return res.status(201).json({ visit_request: visitRequest });
});

router.patch("/visit-requests/:id/cancel", (req, res) => {
  const patientId = req.patientAuth.patient_id;
  const requestId = Number(req.params.id);

  if (!patientId || !Number.isInteger(requestId)) {
    return res.status(404).json({ error: "Visit request not found." });
  }

  const existing = db.prepare("SELECT * FROM visit_requests WHERE id = ?").get(requestId);

  if (!existing || Number(existing.patient_id) !== Number(patientId)) {
    return res.status(404).json({ error: "Visit request not found." });
  }

  if (!PATIENT_CANCELLABLE_STATUSES.includes(existing.status)) {
    return res.status(400).json({ error: "This visit request can no longer be cancelled." });
  }

  db.prepare(`
    UPDATE visit_requests
    SET status = 'cancelled', cancelled_by = 'patient', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(requestId);

  publishPatientDataChange(patientId, { reason: "visit_request" });

  return res.json({ visit_request: getVisitRequestById(requestId) });
});

router.handleReportAttachmentDownload = handleReportAttachmentDownload;

router.get("/push/vapid-public-key", (_req, res) => {
  const configured = isPushConfigured();
  res.json({
    configured,
    publicKey: configured ? getVapidPublicKey() : null,
  });
});

router.post("/push/subscribe", (req, res) => {
  const subscription = req.body?.subscription;

  if (!subscription?.endpoint) {
    return res.status(400).json({ error: "A valid push subscription payload is required." });
  }

  if (!isPushConfigured()) {
    return res.status(503).json({ error: "Web push is not configured on this server." });
  }

  const userAgent = req.headers["user-agent"] || null;
  const result = savePatientPushSubscription(req.patientAuth.id, subscription, userAgent);
  res.json({ ok: result?.ok !== false, endpoint: result?.endpoint || subscription.endpoint });
});

router.delete("/push/subscribe", (req, res) => {
  const endpoint = req.body?.endpoint || req.query?.endpoint || null;
  clearPatientPushSubscription(
    req.patientAuth.id,
    endpoint ? { endpoint: String(endpoint) } : {},
  );
  res.json({ ok: true });
});

module.exports = router;
