const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const { db, labReportAttachmentsDir } = require("../db");
const { publishPatientDataChange, publishLinkhamPatientsChange } = require("../lib/inventoryRealtime");
const {
  getVapidPublicKey,
  isPushConfigured,
  savePatientPushSubscription,
  clearPatientPushSubscription,
  sendPushToRole,
} = require("../lib/push");
const { notifyStaffNewVisitRequest, notifyStaffVisitCancelled } = require("../lib/visitRequestNotifications");
const {
  PATIENT_CANCELLABLE_STATUSES,
  getActiveVisitRequestForPatient,
  getActiveVisitRequestsForDependents,
  getVisitRequestById,
} = require("../lib/visitRequests");
const {
  buildHealthRecordsPayload,
  resolveConsultationDiagnosis,
} = require("../lib/healthRecords");
const { parseBillingRow, serializePatientBillingRows, offsetLocalDate } = require("../lib/utils");
const {
  isVerifiedPatientPortalAccount,
  requireConfirmedChartAccess,
} = require("../lib/patientAuth");
const { isLinkhamInsuranceProvider } = require("../lib/insuranceProvider");
const { mintStreamToken } = require("../lib/streamTokens");
const {
  getPendingChangeForAppointment,
} = require("../lib/appointmentChangeRequests");

const router = express.Router();

const PATIENT_REPORT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function sanitizeReportFileName(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

const patientReportUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      fs.mkdirSync(labReportAttachmentsDir, { recursive: true });
      callback(null, labReportAttachmentsDir);
    },
    filename(_req, file, callback) {
      const extension = path.extname(file.originalname || "").toLowerCase();
      const safeBaseName = sanitizeReportFileName(
        path.basename(file.originalname || "report", extension),
      );
      const uniquePrefix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
      callback(null, `${uniquePrefix}-${safeBaseName || "report"}${extension}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    if (!PATIENT_REPORT_TYPES.has(file.mimetype)) {
      callback(new Error("Only PDF and image files are allowed."));
      return;
    }
    callback(null, true);
  },
});

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
    insurance_provider: patient.insurance_provider || "",
    insurance_policy_number: patient.insurance_policy_number || "",
    is_under_review: patient.is_under_review === 1 || patient.is_under_review === true,
    review_reason_note: String(patient.review_reason_note || "").trim() || null,
    review_due_date: String(patient.review_due_date || "").trim() || null,
  };
}

function buildLongTermReviewAppointment(patient, patientId) {
  if (!patient) {
    return null;
  }

  const reviewDueDate = String(patient.review_due_date || "").trim();
  const isUnderReview = patient.is_under_review === 1 || patient.is_under_review === true;

  if (!isUnderReview || !reviewDueDate) {
    return null;
  }

  const doctorName =
    patient.review_doctor_name || patient.doctor_name || patient.assigned_doctor_name || null;
  const reviewTime = String(patient.review_appointment_time || "").trim();

  return {
    id: `review-${patientId}`,
    patient_id: patientId,
    appointment_date: reviewDueDate,
    appointment_time: reviewTime,
    date: reviewDueDate,
    time: reviewTime,
    status: "scheduled",
    doctor_name: doctorName,
    kind: "review",
    reason: String(patient.review_reason_note || "").trim() || null,
  };
}

function serializeDashboardNextAppointment(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    date: row.date || row.appointment_date,
    time: row.time ?? row.appointment_time ?? "",
    doctor_name: row.doctor_name || null,
    status: row.status || "scheduled",
    kind: row.kind || null,
    reason: row.reason || null,
  };
}

function pickEarliestNextAppointment(dbNext, reviewNext) {
  if (!dbNext) {
    return reviewNext;
  }

  if (!reviewNext) {
    return dbNext;
  }

  const dbDate = String(dbNext.date || "");
  const reviewDate = String(reviewNext.date || "");

  if (reviewDate < dbDate) {
    return reviewNext;
  }

  if (reviewDate > dbDate) {
    return dbNext;
  }

  // Same day — prefer the staff-scheduled appointment slot when one exists.
  return dbNext;
}

// Everything below reads or writes a patient chart, so the confirmation gate is
// applied to the whole router and only these paths opt out. A route added later
// is therefore protected by default rather than by remembering to guard it.
const CHART_ACCESS_EXEMPT_PATHS = new Set([
  "/stream-token",
  "/push/vapid-public-key",
  "/push/subscribe",
]);

router.use((req, res, next) => {
  if (CHART_ACCESS_EXEMPT_PATHS.has(req.path)) {
    return next();
  }

  return requireConfirmedChartAccess(req, res, next);
});

router.get("/dashboard", (req, res) => {
  const patientId = req.portalPatientId;

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
      SELECT
        p.*,
        d.full_name AS assigned_doctor_name,
        rd.full_name AS review_doctor_name
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      LEFT JOIN doctors rd ON rd.id = COALESCE(p.review_assigned_doctor_id, p.assigned_doctor_id)
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

  const nextAppointmentRow = db
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

  const dbNextAppointment = serializeDashboardNextAppointment(nextAppointmentRow);
  const reviewAppointment = buildLongTermReviewAppointment(patient, patientId);
  const nextAppointment = pickEarliestNextAppointment(
    dbNextAppointment,
    serializeDashboardNextAppointment(reviewAppointment),
  );

  const lastConsultationRow = db
    .prepare(`
      SELECT
        c.id,
        c.consultation_date,
        c.doctor_notes,
        c.patient_diagnosis,
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
        diagnosis: resolveConsultationDiagnosis(lastConsultationRow),
      }
    : null;

  const totalVisits = db
    .prepare("SELECT COUNT(*) AS count FROM consultations WHERE patient_id = ?")
    .get(patientId);

  const recentConsultationRows = db
    .prepare(`
      SELECT
        c.consultation_date,
        c.doctor_notes,
        c.patient_diagnosis,
        d.full_name AS doctor_name
      FROM consultations c
      JOIN doctors d ON d.id = c.doctor_id
      WHERE c.patient_id = ?
      ORDER BY c.consultation_date DESC, c.id DESC
      LIMIT 5
    `)
    .all(patientId);

  const recent_activity = recentConsultationRows.map((row) => {
    const diagnosis = resolveConsultationDiagnosis(row);
    const doctorName = String(row.doctor_name || "Your doctor").trim();
    return {
      date: row.consultation_date,
      description: `${diagnosis} — ${doctorName}`,
    };
  });

  let upcomingAppointments = upcomingCount?.count || 0;
  if (reviewAppointment) {
    upcomingAppointments += 1;
  }
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
  const patientId = req.portalPatientId;

  if (!patientId) {
    return res.json({ appointments: [] });
  }

  const appointments = db
    .prepare(`
      SELECT
        a.*,
        d.full_name AS doctor_name,
        c.id AS consultation_id
      FROM appointments a
      JOIN doctors d ON d.id = a.doctor_id
      LEFT JOIN consultations c ON c.appointment_id = a.id
      WHERE a.patient_id = ?
      ORDER BY a.appointment_date DESC, a.appointment_time DESC
    `)
    .all(patientId);

  // Surface a staff-scheduled long-term review as an upcoming item so the
  // patient sees the follow-up their care team booked.
  const patient = db
    .prepare(`
      SELECT
        p.is_under_review,
        p.review_due_date,
        p.review_appointment_time,
        p.review_reason_note,
        p.assigned_doctor_id,
        p.review_assigned_doctor_id,
        d.full_name AS assigned_doctor_name,
        rd.full_name AS review_doctor_name,
        rd.full_name AS doctor_name
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      LEFT JOIN doctors rd ON rd.id = COALESCE(p.review_assigned_doctor_id, p.assigned_doctor_id)
      WHERE p.id = ? AND p.deleted_at IS NULL
    `)
    .get(patientId);

  const reviewAppointment = buildLongTermReviewAppointment(patient, patientId);
  const hasMatchingSlot = appointments.some((row) => {
    const sameDay = String(row.appointment_date || "").slice(0, 10) === String(patient?.review_due_date || "").trim();
    const reviewDoctorId = Number(
      patient?.review_assigned_doctor_id || patient?.assigned_doctor_id || 0,
    );
    const sameDoctor = !reviewDoctorId || Number(row.doctor_id) === reviewDoctorId;
    return sameDay && sameDoctor && String(row.status || "") === "scheduled";
  });
  if (reviewAppointment && !hasMatchingSlot) {
    appointments.unshift(reviewAppointment);
  }

  const withChanges = appointments.map((row) => {
    if (!row?.id || String(row.id).startsWith("review-")) {
      return { ...row, pending_change: null };
    }
    return {
      ...row,
      pending_change: getPendingChangeForAppointment(row.id, patientId),
    };
  });

  return res.json({ appointments: withChanges });
});

router.get("/billing", (req, res) => {
  const patientId = req.portalPatientId;

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

router.get("/billing/:id", (req, res) => {
  const patientId = req.portalPatientId;
  const billId = Number(req.params.id);

  if (!patientId) {
    return res.status(404).json({ error: "Bill not found." });
  }

  if (!Number.isInteger(billId) || billId <= 0) {
    return res.status(400).json({ error: "Bill id is required." });
  }

  const row = db
    .prepare(
      `
        SELECT
          b.*,
          p.full_name AS patient_name,
          c.consultation_date,
          d.full_name AS doctor_name
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        JOIN consultations c ON c.id = b.consultation_id
        JOIN doctors d ON d.id = c.doctor_id
        WHERE b.id = ?
          AND b.patient_id = ?
          AND p.deleted_at IS NULL
      `,
    )
    .get(billId, patientId);

  if (!row) {
    return res.status(404).json({ error: "Bill not found." });
  }

  const bill = parseBillingRow(row);
  return res.json({
    bill: {
      id: bill.id,
      patient_name: bill.patient_name,
      consultation_date: bill.consultation_date,
      total_amount: bill.total_amount,
      status: bill.status,
      items: bill.items,
      doctor_name: bill.doctor_name || null,
      linkham_claim_status: bill.linkham_claim_status || null,
    },
  });
});

router.get("/profile", (req, res) => {
  const patientId = req.portalPatientId;

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

router.post("/reports", (req, res, next) => {
  patientReportUpload.single("file")(req, res, (error) => {
    if (error) {
      return res.status(400).json({ error: error.message || "Upload failed." });
    }
    return next();
  });
}, (req, res) => {
  // File the report against the profile the patient is acting as, so a report
  // uploaded while a dependent is selected lands on the dependent's chart.
  const patientId = req.portalPatientId;

  if (!patientId) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(409).json({
      error:
        "Your portal account isn't linked to a clinic patient record yet. Please contact the clinic with your National ID.",
      code: "account_not_linked",
    });
  }

  if (!req.file) {
    return res.status(400).json({ error: "A report file is required." });
  }

  const reportTitle = String(req.body.name || req.body.report_title || req.file.originalname || "").trim();
  const reportDate = String(req.body.report_date || "").trim();
  const requestedBySource = String(req.body.requested_by_source || "OCS Doctor").trim();
  const requestedBy = String(req.body.requested_by || "").trim();

  if (!reportTitle) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Report name is required." });
  }

  if (!reportDate) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "Report date is required." });
  }

  const reportDetails = JSON.stringify({
    patient_uploaded: true,
    requested_by_source: requestedBySource,
    requested_by: requestedBy,
  });

  try {
    const reportId = db.transaction(() => {
      const reportResult = db
        .prepare(`
          INSERT INTO lab_reports (
            patient_id,
            consultation_id,
            report_title,
            report_date,
            report_details,
            created_by_user_id
          )
          VALUES (?, NULL, ?, ?, ?, NULL)
        `)
        .run(patientId, reportTitle, reportDate, reportDetails);

      const createdReportId = reportResult.lastInsertRowid;

      db.prepare(`
        INSERT INTO lab_report_attachments (
          report_id,
          patient_id,
          consultation_id,
          original_name,
          stored_name,
          mime_type,
          file_size,
          relative_path,
          uploaded_by_user_id
        )
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL)
      `).run(
        createdReportId,
        patientId,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        req.file.filename,
      );

      return createdReportId;
    })();

    publishPatientDataChange(patientId, { reason: "lab_report" });

    const patientName =
      db.prepare("SELECT full_name FROM patients WHERE id = ?").get(patientId)?.full_name ||
      "A patient";
    void sendPushToRole("lab_tech", {
      title: "New patient lab upload",
      body: `${patientName} uploaded a report for review.`,
      url: "/lab",
      icon: "/icon-192.png",
      tag: `patient-lab-upload-${reportId}`,
    }).catch((error) => {
      console.warn("[push] patient lab upload notification failed:", error?.message || error);
    });

    const attachment = db
      .prepare(
        "SELECT id, created_at FROM lab_report_attachments WHERE report_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(reportId);

    return res.status(201).json({
      report: {
        id: attachment?.id,
        name: reportTitle,
        report_date: reportDate,
        uploaded_at: attachment?.created_at || new Date().toISOString(),
        requested_by_source: requestedBySource,
        requested_by: requestedBy,
      },
    });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    throw error;
  }
});

router.get("/health-records", (req, res) => {
  const patientId = req.portalPatientId;

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
      SELECT
        c.id,
        c.consultation_date,
        c.doctor_notes,
        c.clinical_note,
        c.patient_diagnosis,
        c.patient_prescription,
        d.full_name AS doctor_name
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
  const patientId = req.portalPatientId;

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
  const insuranceProvider = readField("insurance_provider");
  const insurancePolicyNumber = readField("insurance_policy_number");

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
  pushUpdate("insurance_provider", insuranceProvider);
  pushUpdate("insurance_policy_number", insurancePolicyNumber);

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

  if (
    insuranceProvider !== undefined &&
    (isLinkhamInsuranceProvider(insuranceProvider) ||
      isLinkhamInsuranceProvider(patient.insurance_provider))
  ) {
    publishLinkhamPatientsChange({ patientId });
  }

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

// A guardian may open records for their own profile and for any dependent they
// manage. Downloads authenticate with a query token and cannot carry the
// acting-profile header, so resolve access from the family tree instead.
function portalCanAccessPatientRecord(req, patientId) {
  const target = Number(patientId || 0);
  const guardianId = Number(req.patientAuth?.patient_id || 0);
  const acting = Number(req.portalPatientId || 0);

  if (!target) {
    return false;
  }
  if (target === acting || target === guardianId) {
    return true;
  }
  if (!guardianId) {
    return false;
  }

  return Boolean(
    db
      .prepare(
        "SELECT id FROM patients WHERE id = ? AND parent_patient_id = ? AND deleted_at IS NULL",
      )
      .get(target, guardianId),
  );
}

// Serve a report attachment to the patient who owns it. Mounted in app.js with
// requirePatientAuthFlexible so the browser can open it directly (token in the
// query string, since <a>/window.open cannot send an Authorization header).
function handleReportAttachmentDownload(req, res) {
  const guardianId = Number(req.patientAuth?.patient_id || 0);
  const attachmentId = Number(req.params.attachmentId);

  if (!guardianId || !Number.isInteger(attachmentId) || attachmentId <= 0) {
    return res.status(404).json({ error: "Attachment not found." });
  }

  const attachment = db
    .prepare(
      "SELECT id, patient_id, original_name, mime_type, relative_path FROM lab_report_attachments WHERE id = ?",
    )
    .get(attachmentId);

  // Ownership check: own attachments, or those of a dependent they manage.
  if (!attachment || !portalCanAccessPatientRecord(req, attachment.patient_id)) {
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
  const patientId = req.portalPatientId;

  if (!patientId) {
    return res.json({ visit_request: null, family_visit_requests: [] });
  }

  const guardianId = Number(req.patientAuth.patient_id || 0);
  const isGuardianView = Boolean(guardianId) && Number(patientId) === guardianId;

  return res.json({
    visit_request: getActiveVisitRequestForPatient(patientId),
    family_visit_requests: isGuardianView ? getActiveVisitRequestsForDependents(guardianId) : [],
  });
});

router.post("/visit-requests", (req, res) => {
  const patientId = req.portalPatientId;
  const patientUserId = req.patientAuth.id;

  if (!patientId) {
    return res.status(409).json({
      error:
        "Your portal account isn't linked to a clinic patient record yet. Please contact the clinic with your National ID.",
      code: "account_not_linked",
    });
  }

  if (!isVerifiedPatientPortalAccount(req.patientAuth)) {
    return res.status(409).json({
      error:
        "Your clinic record is not verified yet. Please contact the clinic to complete account linking before requesting a visit.",
      code: "account_link_pending",
    });
  }

  const existingActive = getActiveVisitRequestForPatient(patientId);
  if (existingActive) {
    return res.status(409).json({
      error: "You already have an active visit request in progress.",
      visit_request: existingActive,
    });
  }

  const guardianId = Number(req.patientAuth.patient_id || 0);
  const isDependentVisit = Boolean(patientId && guardianId && Number(patientId) !== guardianId);
  const visitFor = isDependentVisit ? "dependent" : "myself";
  const dependentPatientId = isDependentVisit ? Number(patientId) : null;
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
      INSERT INTO visit_requests (
        patient_id, patient_user_id, visit_for, dependent_patient_id, address, reason, urgency, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `)
    .run(
      patientId,
      patientUserId || null,
      visitFor,
      dependentPatientId,
      address,
      reason,
      urgency,
    );

  publishPatientDataChange(patientId, { reason: "visit_request" });
  if (guardianId && Number(patientId) !== guardianId) {
    publishPatientDataChange(guardianId, { reason: "visit_request" });
  }

  const visitRequest = getVisitRequestById(result.lastInsertRowid, { includeStaffNotes: false });
  void notifyStaffNewVisitRequest(visitRequest).catch((error) => {
    console.warn("[push] new visit request notification failed:", error?.message || error);
  });

  return res.status(201).json({ visit_request: visitRequest });
});

router.patch("/visit-requests/:id/cancel", (req, res) => {
  const patientId = req.portalPatientId;
  const requestId = Number(req.params.id);

  if (!patientId || !Number.isInteger(requestId)) {
    return res.status(404).json({ error: "Visit request not found." });
  }

  const existing = db.prepare("SELECT * FROM visit_requests WHERE id = ?").get(requestId);
  const guardianId = Number(req.patientAuth.patient_id || 0);
  const childVisit =
    existing && guardianId
      ? db
          .prepare(
            `
              SELECT id FROM patients
              WHERE id = ? AND parent_patient_id = ? AND deleted_at IS NULL
            `,
          )
          .get(existing.patient_id, guardianId)
      : null;
  const ownsVisit =
    existing &&
    (Number(existing.patient_id) === Number(patientId) ||
      Number(existing.patient_user_id) === Number(req.patientAuth.id) ||
      Number(existing.patient_id) === guardianId ||
      Boolean(childVisit));

  if (!existing || !ownsVisit) {
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

  publishPatientDataChange(existing.patient_id, { reason: "visit_request" });
  if (guardianId && Number(existing.patient_id) !== guardianId) {
    publishPatientDataChange(guardianId, { reason: "visit_request" });
  }

  const visitRequest = getVisitRequestById(requestId, { includeStaffNotes: false });
  void notifyStaffVisitCancelled(visitRequest).catch((error) => {
    console.warn("[push] visit cancellation notification failed:", error?.message || error);
  });

  return res.json({ visit_request: visitRequest });
});

router.handleReportAttachmentDownload = handleReportAttachmentDownload;

router.post("/stream-token", (req, res) => {
  const minted = mintStreamToken({ audience: "patient", userId: req.patientAuth.id });
  return res.json(minted);
});

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

function generateDependentIdentifier() {
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

function ageFromIsoDob(isoDob) {
  const dob = new Date(String(isoDob || ""));
  if (Number.isNaN(dob.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

function serializeDependent(row) {
  return {
    id: Number(row.id),
    full_name: row.full_name,
    date_of_birth: row.date_of_birth || "",
    gender: row.gender || "M",
    relationship: row.family_relationship || row.contact_relationship || "",
    patient_identifier: row.patient_identifier || "",
  };
}

router.get("/dependents", (req, res) => {
  const guardianId = req.patientAuth.patient_id;
  if (!guardianId) {
    return res.json({ dependents: [] });
  }

  const rows = db
    .prepare(
      `
        SELECT id, full_name, date_of_birth, gender, family_relationship, contact_relationship, patient_identifier
        FROM patients
        WHERE parent_patient_id = ?
          AND deleted_at IS NULL
        ORDER BY full_name ASC, id ASC
      `,
    )
    .all(guardianId);

  return res.json({ dependents: rows.map(serializeDependent) });
});

router.post("/dependents", (req, res) => {
  const guardianId = req.patientAuth.patient_id;
  if (!guardianId) {
    return res.status(409).json({ error: "Link your clinic record before adding family members." });
  }

  const fullName = String(req.body.full_name ?? "").trim();
  const relationship = String(req.body.relationship ?? "").trim();
  const dateOfBirth = String(req.body.date_of_birth ?? "").trim();
  const genderRaw = String(req.body.gender ?? "").trim().toUpperCase();
  const gender = ["M", "F"].includes(genderRaw) ? genderRaw : "";

  if (!fullName || !relationship || !dateOfBirth || !gender) {
    return res.status(400).json({ error: "full_name, relationship, date_of_birth, and gender are required." });
  }

  const nameParts = fullName.split(/\s+/);
  const firstName = nameParts[0] || fullName;
  const lastName = nameParts.slice(1).join(" ") || "";
  const guardian = db
    .prepare("SELECT assigned_doctor_id, address, location FROM patients WHERE id = ?")
    .get(guardianId);

  const result = db
    .prepare(
      `
        INSERT INTO patients (
          full_name, first_name, last_name, patient_identifier, patient_id_number,
          age, date_of_birth, gender, parent_patient_id, family_relationship, contact_relationship,
          contact_number, patient_contact_number, address, location, assigned_doctor_id, link_status
        )
        VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, 'staff_created')
      `,
    )
    .run(
      fullName,
      firstName,
      lastName,
      generateDependentIdentifier(),
      ageFromIsoDob(dateOfBirth),
      dateOfBirth,
      gender,
      guardianId,
      relationship,
      relationship,
      guardian?.address || "",
      guardian?.location || "",
      guardian?.assigned_doctor_id || null,
    );

  const created = db
    .prepare(
      `
        SELECT id, full_name, date_of_birth, gender, family_relationship, contact_relationship, patient_identifier
        FROM patients
        WHERE id = ?
      `,
    )
    .get(result.lastInsertRowid);

  publishPatientDataChange(guardianId, { reason: "profile" });
  return res.status(201).json({ dependent: serializeDependent(created) });
});

router.delete("/dependents/:id", (req, res) => {
  const guardianId = req.patientAuth.patient_id;
  const dependentId = Number(req.params.id);
  if (!guardianId || !Number.isInteger(dependentId)) {
    return res.status(404).json({ error: "Family member not found." });
  }

  const row = db
    .prepare(
      `
        SELECT id FROM patients
        WHERE id = ? AND parent_patient_id = ? AND deleted_at IS NULL
      `,
    )
    .get(dependentId, guardianId);

  if (!row) {
    return res.status(404).json({ error: "Family member not found." });
  }

  db.prepare("UPDATE patients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(dependentId);
  publishPatientDataChange(guardianId, { reason: "profile" });
  return res.status(204).send();
});

router.post("/appointment-change-requests", (req, res) => {
  const patientId = req.portalPatientId;
  if (!patientId) {
    return res.status(409).json({ error: "Your clinic record is not linked yet." });
  }

  const appointmentId = Number(req.body.appointment_id);
  const requestType = String(req.body.request_type || "").trim().toLowerCase();
  const patientMessage = String(req.body.patient_message || "").trim();
  const preferredDate = String(req.body.preferred_date || "").trim() || null;
  const preferredTime = String(req.body.preferred_time || "").trim() || null;

  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return res.status(400).json({ error: "appointment_id is required." });
  }
  if (!["cancel", "reschedule"].includes(requestType)) {
    return res.status(400).json({ error: "request_type must be cancel or reschedule." });
  }

  const appointment = db
    .prepare(
      `
        SELECT a.*, p.parent_patient_id
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        WHERE a.id = ?
          AND p.deleted_at IS NULL
      `,
    )
    .get(appointmentId);

  const guardianId = Number(req.patientAuth.patient_id || 0);
  const ownsAppointment =
    appointment &&
    (Number(appointment.patient_id) === Number(patientId) ||
      Number(appointment.patient_id) === guardianId ||
      Number(appointment.parent_patient_id) === guardianId);

  if (!ownsAppointment) {
    return res.status(404).json({ error: "Appointment not found." });
  }

  if (appointment.status !== "scheduled") {
    return res.status(400).json({ error: "Only upcoming appointments can be changed." });
  }

  const pending = getPendingChangeForAppointment(appointmentId, appointment.patient_id);
  if (pending) {
    return res.status(409).json({
      error: "A change request is already waiting for the clinic.",
      request: pending,
    });
  }

  if (requestType === "reschedule") {
    const tomorrow = offsetLocalDate(1);
    if (!preferredDate) {
      return res.status(400).json({ error: "preferred_date is required to reschedule." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || preferredDate < tomorrow) {
      return res.status(400).json({ error: "Please choose a date from tomorrow onwards." });
    }
  }

  const result = db
    .prepare(
      `
        INSERT INTO appointment_change_requests (
          appointment_id, patient_id, patient_user_id, request_type, patient_message,
          preferred_date, preferred_time, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `,
    )
    .run(
      appointmentId,
      appointment.patient_id,
      req.patientAuth.id,
      requestType,
      patientMessage,
      preferredDate,
      preferredTime,
    );

  publishPatientDataChange(appointment.patient_id, { reason: "appointment" });

  void sendPushToRole("operator", {
    title: requestType === "cancel" ? "Appointment cancel request" : "Appointment reschedule request",
    body: "A patient asked to change a scheduled visit.",
    url: "/visit-requests",
    tag: `appointment-change-${result.lastInsertRowid}`,
  }).catch(() => {});
  void sendPushToRole("admin", {
    title: requestType === "cancel" ? "Appointment cancel request" : "Appointment reschedule request",
    body: "A patient asked to change a scheduled visit.",
    url: "/visit-requests",
    tag: `appointment-change-${result.lastInsertRowid}`,
  }).catch(() => {});

  const created = getPendingChangeForAppointment(appointmentId, appointment.patient_id);
  return res.status(201).json({ request: created });
});

module.exports = router;
