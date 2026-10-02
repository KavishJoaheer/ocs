const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { db, manualInvoiceAttachmentsDir } = require("../db");
const { publishPatientDataChange } = require("../lib/inventoryRealtime");

const router = express.Router();
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]);

function safeFileName(value) {
  return String(value || "invoice-photo")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      fs.mkdirSync(manualInvoiceAttachmentsDir, { recursive: true });
      callback(null, manualInvoiceAttachmentsDir);
    },
    filename(_req, file, callback) {
      const extension = path.extname(file.originalname || "").toLowerCase();
      const baseName = safeFileName(path.basename(file.originalname || "invoice-photo", extension));
      callback(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${baseName}${extension}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const missingType = !file.mimetype || file.mimetype === "application/octet-stream";
    if (ALLOWED_TYPES.has(file.mimetype) || (missingType && ALLOWED_EXTENSIONS.has(extension))) {
      callback(null, true);
      return;
    }
    callback(new Error("Only invoice photos (JPG, PNG, WEBP, GIF, HEIC or HEIF) are allowed."));
  },
});

function loadConsultation(consultationId) {
  return db.prepare(`
    SELECT c.id, c.patient_id, c.doctor_id, c.voided_at
    FROM consultations c
    JOIN patients p ON p.id = c.patient_id
    WHERE c.id = ? AND p.deleted_at IS NULL
  `).get(consultationId);
}

function mayView(auth, consultation) {
  if (!auth || !consultation) return false;
  if (["admin", "operator"].includes(auth.role)) return true;
  if (auth.role === "doctor") {
    return Number(auth.doctor_id || 0) === Number(consultation.doctor_id);
  }
  return false;
}

router.post("/", (req, res, next) => {
  upload.single("invoice_photo")(req, res, (error) => {
    if (error) {
      return res.status(400).json({ error: error.message || "The invoice photo could not be uploaded." });
    }
    next();
  });
}, (req, res) => {
  const consultationId = Number(req.body.consultation_id);
  const billingId = Number(req.body.billing_id);

  const fail = (status, message) => {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    return res.status(status).json({ error: message });
  };

  if (!req.file) return fail(400, "Choose a photo of the manual invoice.");
  if (!Number.isInteger(consultationId) || consultationId <= 0) {
    return fail(400, "A valid consultation is required.");
  }
  if (!Number.isInteger(billingId) || billingId <= 0) {
    return fail(400, "Select the bill that matches this invoice.");
  }

  const consultation = loadConsultation(consultationId);
  if (!consultation || consultation.voided_at) {
    return fail(404, "Consultation not found.");
  }

  const bill = db.prepare(`
    SELECT id, patient_id, consultation_id, voided_at
    FROM billing
    WHERE id = ?
  `).get(billingId);
  if (
    !bill ||
    bill.voided_at ||
    Number(bill.consultation_id) !== consultationId ||
    Number(bill.patient_id) !== Number(consultation.patient_id)
  ) {
    return fail(400, "The selected bill does not belong to this consultation.");
  }

  const result = db.prepare(`
    INSERT INTO manual_invoice_attachments (
      consultation_id, billing_id, patient_id, original_name, stored_name,
      mime_type, file_size, uploaded_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    consultationId,
    billingId,
    consultation.patient_id,
    String(req.file.originalname || "invoice-photo"),
    req.file.filename,
    String(req.file.mimetype || "application/octet-stream"),
    Number(req.file.size || 0),
    req.auth?.id || null,
  );

  publishPatientDataChange(consultation.patient_id, {
    reason: "manual_invoice_attachment",
  });

  const attachment = db.prepare(`
    SELECT attachment.id, attachment.consultation_id, attachment.billing_id,
      attachment.original_name, attachment.mime_type, attachment.file_size,
      attachment.created_at, uploader.full_name AS uploaded_by_name,
      uploader.role AS uploaded_by_role, billing.invoice_number,
      billing.source_reference, billing.status AS billing_status
    FROM manual_invoice_attachments attachment
    LEFT JOIN users uploader ON uploader.id = attachment.uploaded_by_user_id
    JOIN billing ON billing.id = attachment.billing_id
    WHERE attachment.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({
    ...attachment,
    download_url: `/manual-invoice-attachments/${attachment.id}/download`,
  });
});

router.get("/:id/download", (req, res) => {
  const attachment = db.prepare(`
    SELECT attachment.*, c.doctor_id, c.voided_at AS consultation_voided_at
    FROM manual_invoice_attachments attachment
    JOIN consultations c ON c.id = attachment.consultation_id
    WHERE attachment.id = ?
  `).get(Number(req.params.id));

  if (!attachment) return res.status(404).json({ error: "Manual invoice photo not found." });
  if (!mayView(req.auth, attachment)) {
    return res.status(403).json({ error: "You do not have access to this invoice photo." });
  }

  const filePath = path.resolve(manualInvoiceAttachmentsDir, attachment.stored_name);
  if (!filePath.startsWith(`${path.resolve(manualInvoiceAttachmentsDir)}${path.sep}`)) {
    return res.status(400).json({ error: "Invalid invoice photo path." });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "The stored invoice photo is missing." });
  }

  res.setHeader("Content-Type", attachment.mime_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`);
  res.setHeader("X-File-Name", encodeURIComponent(attachment.original_name));
  res.sendFile(filePath);
});

module.exports = router;
