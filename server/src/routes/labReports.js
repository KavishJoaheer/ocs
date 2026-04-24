const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const { db, labReportAttachmentsDir } = require("../db");

const router = express.Router();

const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_REQUEST = 5;

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      fs.mkdirSync(labReportAttachmentsDir, { recursive: true });
      callback(null, labReportAttachmentsDir);
    },
    filename(_req, file, callback) {
      const extension = path.extname(file.originalname || "").toLowerCase();
      const safeBaseName = sanitizeFileName(path.basename(file.originalname || "attachment", extension));
      const uniquePrefix = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
      callback(null, `${uniquePrefix}-${safeBaseName || "attachment"}${extension}`);
    },
  }),
  limits: {
    fileSize: MAX_ATTACHMENT_SIZE_BYTES,
    files: MAX_ATTACHMENTS_PER_REQUEST,
  },
  fileFilter(_req, file, callback) {
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.mimetype)) {
      callback(new Error("Only PDF and image files are allowed."));
      return;
    }

    callback(null, true);
  },
});

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

function listAttachmentsForReportIds(reportIds) {
  if (!reportIds.length) {
    return [];
  }

  const placeholders = reportIds.map(() => "?").join(", ");

  return db
    .prepare(`
      SELECT
        attachment.*,
        uploader.full_name AS uploaded_by_name,
        uploader.role AS uploaded_by_role
      FROM lab_report_attachments attachment
      LEFT JOIN users uploader ON uploader.id = attachment.uploaded_by_user_id
      WHERE attachment.report_id IN (${placeholders})
      ORDER BY attachment.created_at ASC, attachment.id ASC
    `)
    .all(...reportIds);
}

function attachFilesToReports(reports) {
  if (!reports.length) {
    return reports;
  }

  const attachments = listAttachmentsForReportIds(reports.map((report) => report.id));
  const attachmentsByReportId = new Map();

  attachments.forEach((attachment) => {
    const current = attachmentsByReportId.get(attachment.report_id) || [];
    current.push({
      ...attachment,
      download_url: `/api/lab-reports/attachments/${attachment.id}/download`,
    });
    attachmentsByReportId.set(attachment.report_id, current);
  });

  return reports.map((report) => ({
    ...report,
    attachments: attachmentsByReportId.get(report.id) || [],
  }));
}

function getLabReportById(reportId) {
  const report = db
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

  if (!report) {
    return null;
  }

  return attachFilesToReports([report])[0];
}

function getLabReportsByPatientId(patientId) {
  const reports = db
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

  return attachFilesToReports(reports);
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

  return auth.doctor_id && Number(patient.assigned_doctor_id) === Number(auth.doctor_id);
}

function saveAttachments({ reportId, patientId, consultationId, files, uploadedByUserId }) {
  if (!files?.length) {
    return;
  }

  const insertAttachment = db.prepare(`
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  files.forEach((file) => {
    insertAttachment.run(
      reportId,
      patientId,
      consultationId,
      file.originalname,
      file.filename,
      file.mimetype,
      file.size,
      file.filename,
      uploadedByUserId,
    );
  });
}

function cleanupUploadedFiles(files = []) {
  files.forEach((file) => {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });
}

function updateReportAttachmentConsultation(reportId, consultationId) {
  db.prepare(`
    UPDATE lab_report_attachments
    SET consultation_id = ?
    WHERE report_id = ?
  `).run(consultationId, reportId);
}

function getAttachmentById(attachmentId) {
  return db
    .prepare(`
      SELECT
        attachment.*,
        report.patient_id AS report_patient_id
      FROM lab_report_attachments attachment
      JOIN lab_reports report ON report.id = attachment.report_id
      WHERE attachment.id = ?
    `)
    .get(attachmentId);
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
      error: "You can only access Medical & Lab Reports for patients assigned to your doctor profile.",
    });
  }

  res.json(getLabReportsByPatientId(patientId));
});

router.post("/", upload.array("attachments", MAX_ATTACHMENTS_PER_REQUEST), (req, res) => {
  const payload = normalizeLabReportPayload(req.body);
  const validationError = validateLabReportPayload(payload);

  if (validationError) {
    cleanupUploadedFiles(req.files);
    return res.status(400).json({ error: validationError });
  }

  const patient = getPatientById(payload.patient_id);

  if (!patient) {
    cleanupUploadedFiles(req.files);
    return res.status(404).json({ error: "Patient not found." });
  }

  if (!ensureDoctorPatientAccess(patient, req.auth)) {
    cleanupUploadedFiles(req.files);
    return res.status(403).json({
      error: "You can only add Medical & Lab Reports for patients assigned to your doctor profile.",
    });
  }

  const consultationMatch = ensureConsultationMatchesPatient(
    payload.patient_id,
    payload.consultation_id,
  );

  if (consultationMatch.error) {
    cleanupUploadedFiles(req.files);
    return res.status(400).json({ error: consultationMatch.error });
  }

  try {
    const createdReportId = db.transaction(() => {
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

      saveAttachments({
        reportId: result.lastInsertRowid,
        patientId: payload.patient_id,
        consultationId: payload.consultation_id,
        files: req.files,
        uploadedByUserId: req.auth.id,
      });

      return result.lastInsertRowid;
    })();

    res.status(201).json(getLabReportById(createdReportId));
  } catch (error) {
    cleanupUploadedFiles(req.files);
    throw error;
  }
});

router.put("/:id", upload.array("attachments", MAX_ATTACHMENTS_PER_REQUEST), (req, res) => {
  const reportId = Number(req.params.id);
  const existing = db
    .prepare(`
      SELECT id, patient_id
      FROM lab_reports
      WHERE id = ?
    `)
    .get(reportId);

  if (!existing) {
    cleanupUploadedFiles(req.files);
    return res.status(404).json({ error: "Medical & Lab Report not found." });
  }

  const payload = normalizeLabReportPayload({
    ...req.body,
    patient_id: existing.patient_id,
  });
  const validationError = validateLabReportPayload(payload);

  if (validationError) {
    cleanupUploadedFiles(req.files);
    return res.status(400).json({ error: validationError });
  }

  const patient = getPatientById(existing.patient_id);

  if (!patient) {
    cleanupUploadedFiles(req.files);
    return res.status(404).json({ error: "Patient not found." });
  }

  if (!ensureDoctorPatientAccess(patient, req.auth)) {
    cleanupUploadedFiles(req.files);
    return res.status(403).json({
      error: "You can only edit Medical & Lab Reports for patients assigned to your doctor profile.",
    });
  }

  const consultationMatch = ensureConsultationMatchesPatient(
    existing.patient_id,
    payload.consultation_id,
  );

  if (consultationMatch.error) {
    cleanupUploadedFiles(req.files);
    return res.status(400).json({ error: consultationMatch.error });
  }

  try {
    db.transaction(() => {
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

      updateReportAttachmentConsultation(reportId, payload.consultation_id);
      saveAttachments({
        reportId,
        patientId: existing.patient_id,
        consultationId: payload.consultation_id,
        files: req.files,
        uploadedByUserId: req.auth.id,
      });
    })();

    res.json(getLabReportById(reportId));
  } catch (error) {
    cleanupUploadedFiles(req.files);
    throw error;
  }
});

router.get("/attachments/:attachmentId/download", (req, res) => {
  const attachmentId = Number(req.params.attachmentId);
  const attachment = getAttachmentById(attachmentId);

  if (!attachment) {
    return res.status(404).json({ error: "Attachment not found." });
  }

  const patient = getPatientById(attachment.report_patient_id);

  if (!patient) {
    return res.status(404).json({ error: "Patient not found." });
  }

  if (!ensureDoctorPatientAccess(patient, req.auth)) {
    return res.status(403).json({
      error: "You can only access Medical & Lab Report files for patients assigned to your doctor profile.",
    });
  }

  const filePath = path.join(labReportAttachmentsDir, attachment.relative_path);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Stored file was not found." });
  }

  res.setHeader("Content-Type", attachment.mime_type || "application/octet-stream");
  res.setHeader("X-File-Name", encodeURIComponent(attachment.original_name));
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(attachment.original_name)}"`,
  );
  res.sendFile(filePath);
});

router.delete("/attachments/:attachmentId", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can delete uploaded files." });
  }

  const attachmentId = Number(req.params.attachmentId);
  const attachment = getAttachmentById(attachmentId);

  if (!attachment) {
    return res.status(404).json({ error: "Attachment not found." });
  }

  const filePath = path.join(labReportAttachmentsDir, attachment.relative_path);

  db.prepare("DELETE FROM lab_report_attachments WHERE id = ?").run(attachmentId);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  res.status(204).send();
});

module.exports = router;
