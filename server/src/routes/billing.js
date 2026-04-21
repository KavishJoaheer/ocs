const express = require("express");
const { db } = require("../db");
const {
  calculateBillingTotal,
  getTodayLocal,
  normalizeBillingItems,
  parseBillingRow,
} = require("../lib/utils");

const router = express.Router();
const PAYMENT_METHODS = new Set(["cash", "juice", "card", "ib"]);

function normalizePaymentMethod(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function buildDoctorAccessClause(auth) {
  if (auth?.role === "doctor" && auth.doctor_id) {
    return {
      clause: "AND c.doctor_id = @doctorId",
      params: { doctorId: Number(auth.doctor_id) },
    };
  }

  return {
    clause: "",
    params: { doctorId: null },
  };
}

function getConsultationContext(consultationId) {
  return db
    .prepare(`
      SELECT
        c.id,
        c.patient_id,
        c.doctor_id,
        c.consultation_date,
        p.full_name AS patient_name,
        d.full_name AS doctor_name
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE c.id = ?
        AND p.deleted_at IS NULL
    `)
    .get(consultationId);
}

function getJoinedBillById(billId) {
  const bill = db
    .prepare(`
      SELECT
        b.*,
        p.full_name AS patient_name,
        c.consultation_date,
        c.doctor_id,
        d.full_name AS doctor_name
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE b.id = ?
        AND p.deleted_at IS NULL
    `)
    .get(billId);

  return bill ? parseBillingRow(bill) : null;
}

function ensureBillAccess(req, bill) {
  if (!bill) {
    return { status: 404, error: "Bill not found." };
  }

  if (
    req.auth?.role === "doctor" &&
    req.auth.doctor_id &&
    Number(bill.doctor_id) !== Number(req.auth.doctor_id)
  ) {
    return { status: 403, error: "You can only manage billing linked to your own consultations." };
  }

  return null;
}

router.get("/patient-summary", (req, res) => {
  const doctorAccess = buildDoctorAccessClause(req.auth);

  const summary = db
    .prepare(`
      SELECT
        p.id AS patient_id,
        p.full_name AS patient_name,
        COUNT(b.id) AS bill_count,
        COALESCE(SUM(b.total_amount), 0) AS total_billed,
        COALESCE(SUM(CASE WHEN b.status = 'paid' THEN b.total_amount ELSE 0 END), 0) AS paid_amount,
        COALESCE(SUM(CASE WHEN b.status = 'unpaid' THEN b.total_amount ELSE 0 END), 0) AS unpaid_amount
      FROM patients p
      LEFT JOIN billing b ON b.patient_id = p.id
      LEFT JOIN consultations c ON c.id = b.consultation_id
      WHERE p.deleted_at IS NULL
        ${doctorAccess.clause}
      GROUP BY p.id
      HAVING bill_count > 0
      ORDER BY unpaid_amount DESC, total_billed DESC, patient_name ASC
    `)
    .all(doctorAccess.params);

  res.json(summary);
});

router.get("/", (req, res) => {
  const status = String(req.query.status ?? "").trim();
  const patientId = String(req.query.patientId ?? "").trim();
  const doctorAccess = buildDoctorAccessClause(req.auth);

  const bills = db
    .prepare(`
      SELECT
        b.*,
        p.full_name AS patient_name,
        c.consultation_date,
        c.doctor_id,
        d.full_name AS doctor_name
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE p.deleted_at IS NULL
        AND (@status = '' OR b.status = @status)
        AND (@patientId = '' OR CAST(b.patient_id AS TEXT) = @patientId)
        ${doctorAccess.clause}
      ORDER BY c.consultation_date DESC, b.created_at DESC
    `)
    .all({
      status,
      patientId,
      ...doctorAccess.params,
    })
    .map(parseBillingRow);

  res.json(bills);
});

router.get("/:id", (req, res) => {
  const billId = Number(req.params.id);
  const bill = getJoinedBillById(billId);
  const accessError = ensureBillAccess(req, bill);

  if (accessError) {
    return res.status(accessError.status).json({ error: accessError.error });
  }

  res.json(bill);
});

router.post("/", (req, res) => {
  const consultationId = Number(req.body.consultation_id);
  const patientId = Number(req.body.patient_id);
  const consultation = getConsultationContext(consultationId);

  if (!Number.isInteger(consultationId) || consultationId <= 0 || !consultation) {
    return res.status(400).json({ error: "Select a valid consultation." });
  }

  if (!Number.isInteger(patientId) || patientId <= 0) {
    return res.status(400).json({ error: "Select a valid patient." });
  }

  if (Number(consultation.patient_id) !== patientId) {
    return res.status(400).json({
      error: "The selected consultation does not belong to the selected patient.",
    });
  }

  if (
    req.auth?.role === "doctor" &&
    req.auth.doctor_id &&
    Number(consultation.doctor_id) !== Number(req.auth.doctor_id)
  ) {
    return res.status(403).json({
      error: "You can only create billing linked to your own consultations.",
    });
  }

  const items = normalizeBillingItems(req.body.items);
  if (!items.length) {
    return res.status(400).json({ error: "At least one billing line item is required." });
  }

  const status = String(req.body.status ?? "unpaid")
    .trim()
    .toLowerCase();
  if (!["paid", "unpaid"].includes(status)) {
    return res.status(400).json({ error: "Billing status is invalid." });
  }

  const paymentMethod =
    status === "paid" ? normalizePaymentMethod(req.body.payment_method) : null;

  if (status === "paid" && !PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({
      error: "Select a valid payment method: cash, juice, card, or IB.",
    });
  }

  const paymentDate =
    status === "paid"
      ? String(req.body.payment_date ?? getTodayLocal()).trim() || getTodayLocal()
      : null;

  const result = db.prepare(`
    INSERT INTO billing (
      consultation_id,
      patient_id,
      items,
      total_amount,
      status,
      payment_method,
      payment_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    consultationId,
    patientId,
    JSON.stringify(items),
    calculateBillingTotal(items),
    status,
    paymentMethod,
    paymentDate,
  );

  res.status(201).json(getJoinedBillById(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const billId = Number(req.params.id);
  const existing = getJoinedBillById(billId);
  const accessError = ensureBillAccess(req, existing);

  if (accessError) {
    return res.status(accessError.status).json({ error: accessError.error });
  }

  const items = normalizeBillingItems(req.body.items);
  if (!items.length) {
    return res.status(400).json({ error: "At least one billing line item is required." });
  }

  const status = String(req.body.status ?? existing.status).trim().toLowerCase();
  if (!["paid", "unpaid"].includes(status)) {
    return res.status(400).json({ error: "Billing status is invalid." });
  }

  const paymentMethod =
    status === "paid"
      ? normalizePaymentMethod(req.body.payment_method ?? existing.payment_method)
      : null;

  if (status === "paid" && !PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({
      error: "Select a valid payment method: cash, juice, card, or IB.",
    });
  }

  const paymentDate =
    status === "paid"
      ? String(req.body.payment_date ?? existing.payment_date ?? getTodayLocal()).trim()
      : null;

  db.prepare(`
    UPDATE billing
    SET
      items = ?,
      total_amount = ?,
      status = ?,
      payment_method = ?,
      payment_date = ?
    WHERE id = ?
  `).run(
    JSON.stringify(items),
    calculateBillingTotal(items),
    status,
    paymentMethod,
    paymentDate || null,
    billId,
  );

  res.json(getJoinedBillById(billId));
});

router.patch("/:id/pay", (req, res) => {
  const billId = Number(req.params.id);
  const existing = getJoinedBillById(billId);
  const accessError = ensureBillAccess(req, existing);

  if (accessError) {
    return res.status(accessError.status).json({ error: accessError.error });
  }

  const paymentMethod =
    normalizePaymentMethod(req.body.payment_method ?? existing.payment_method ?? "cash");

  if (!PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({
      error: "Select a valid payment method: cash, juice, card, or IB.",
    });
  }

  const paymentDate = String(req.body.payment_date ?? getTodayLocal()).trim();

  db.prepare(`
    UPDATE billing
    SET status = 'paid',
        payment_method = ?,
        payment_date = ?
    WHERE id = ?
  `).run(paymentMethod, paymentDate, billId);

  res.json(getJoinedBillById(billId));
});

module.exports = router;
