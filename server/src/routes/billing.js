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
const BILLING_ALLOWED_ROLES = new Set(["admin", "doctor", "accountant"]);

router.use((req, res, next) => {
  if (!BILLING_ALLOWED_ROLES.has(String(req.auth?.role || "").trim().toLowerCase())) {
    return res.status(403).json({ error: "You do not have permission to access billing." });
  }
  return next();
});

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
        c.appointment_id,
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

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

function calculateAppointmentLossRevenue(items) {
  const normalized = normalizeBillingItems(items);
  const totals = normalized.reduce(
    (acc, item) => {
      const amount = roundCurrency(item.amount);
      if (item.type === "Wastage") {
        acc.loss_rs += amount;
      } else if (item.type === "Adjustment") {
        acc.adjustment_rs += amount;
      } else if (item.type === "Sale") {
        acc.revenue_rs += amount;
      }
      return acc;
    },
    { revenue_rs: 0, loss_rs: 0, adjustment_rs: 0 },
  );

  return {
    revenue_rs: roundCurrency(totals.revenue_rs),
    loss_rs: roundCurrency(totals.loss_rs),
    adjustment_rs: roundCurrency(totals.adjustment_rs),
  };
}

function consumeDoctorBatches(itemId, quantity) {
  const rows = db
    .prepare(`
      SELECT id, quantity_remaining, expiry_date
      FROM inventory_batches
      WHERE item_id = ?
        AND quantity_remaining > 0
      ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, id ASC
    `)
    .all(itemId);

  let remaining = quantity;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(row.quantity_remaining || 0));
    if (!take) continue;
    db.prepare("UPDATE inventory_batches SET quantity_remaining = ? WHERE id = ?").run(
      Number(row.quantity_remaining || 0) - take,
      row.id,
    );
    remaining -= take;
  }
  return { consumed: quantity - remaining, remaining };
}

function insertInventoryMovement({
  itemId,
  quantity,
  previousQuantity,
  nextQuantity,
  actionType,
  note,
  userId,
  appointmentId,
  consultationId,
  meta = {},
}) {
  db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
      recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
    )
    VALUES (?, 'out', ?, ?, ?, NULL, ?, ?, ?, 'appointment', ?, ?)
  `).run(
    itemId,
    quantity,
    previousQuantity,
    nextQuantity,
    userId || null,
    note,
    actionType,
    appointmentId || null,
    JSON.stringify({
      consultation_id: consultationId,
      appointment_id: appointmentId,
      transaction_type: actionType === "wastage" ? "Wastage" : "Sale",
      ...meta,
    }),
  );
}

function applyInventoryTransactions({
  consultation,
  items,
  userId,
}) {
  const normalized = normalizeBillingItems(items);
  const inventoryLines = normalized.filter((item) => item.inventory_item_id && Number(item.quantity) > 0);
  const processed = [];

  for (const line of inventoryLines) {
    const stockItem = db
      .prepare(`
        SELECT *
        FROM inventory
        WHERE id = ?
          AND stock_scope = 'doctor'
          AND owner_doctor_id = ?
      `)
      .get(Number(line.inventory_item_id), Number(consultation.doctor_id));

    if (!stockItem) {
      throw new Error(`Inventory item not found for doctor: ${line.description || "line item"}.`);
    }

    const qty = Number(line.quantity || 0);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error("Inventory quantity must be a positive whole number.");
    }

    const available = Number(stockItem.quantity || 0);
    if (available < qty && !line.emergency_override) {
      throw new Error(`Insufficient stock for ${stockItem.item_name}. Enable emergency override if clinically required.`);
    }

    const toConsume = Math.min(Math.max(available, 0), qty);
    if (toConsume > 0) {
      consumeDoctorBatches(stockItem.id, toConsume);
    }

    const previousQuantity = available;
    const nextQuantity = previousQuantity - qty;
    db.prepare("UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      nextQuantity,
      stockItem.id,
    );

    const actionType =
      line.type === "Wastage"
        ? "wastage"
        : line.type === "Adjustment"
          ? "adjustment"
          : "sell";
    insertInventoryMovement({
      itemId: stockItem.id,
      quantity: qty,
      previousQuantity,
      nextQuantity,
      actionType,
      note:
        actionType === "wastage"
          ? "Marked as clinical wastage from billing."
          : actionType === "adjustment"
            ? "Inventory adjustment recorded from billing."
          : "Billed to patient.",
      userId,
      appointmentId: consultation.appointment_id,
      consultationId: consultation.id,
      meta: {
        emergency_override: Boolean(line.emergency_override),
      },
    });

    processed.push({
      ...line,
      description: line.description || stockItem.item_name,
      amount:
        line.type === "Wastage" || line.type === "Adjustment"
          ? roundCurrency(Number(stockItem.cost_price || 0) * qty)
          : roundCurrency(Number(stockItem.selling_price || 0) * qty),
      inventory_item_id: Number(stockItem.id),
    });
  }

  const passthrough = normalized.filter((item) => !(item.inventory_item_id && Number(item.quantity) > 0));
  return [...passthrough, ...processed];
}

function getJoinedBillById(billId) {
  const bill = db
    .prepare(`
      SELECT
        b.*,
        p.full_name AS patient_name,
        c.consultation_date,
        c.appointment_id,
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

  if (!bill) return null;
  const parsed = parseBillingRow(bill);
  return {
    ...parsed,
    appointment_financials: calculateAppointmentLossRevenue(parsed.items),
  };
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

router.get("/inventory-options/by-consultation/:consultationId", (req, res) => {
  const consultationId = Number(req.params.consultationId || 0);
  const consultation = getConsultationContext(consultationId);
  if (!consultation) {
    return res.status(404).json({ error: "Consultation not found." });
  }
  if (
    req.auth?.role === "doctor" &&
    req.auth.doctor_id &&
    Number(consultation.doctor_id) !== Number(req.auth.doctor_id)
  ) {
    return res.status(403).json({
      error: "You can only access inventory linked to your own consultations.",
    });
  }

  const rows = db
    .prepare(`
      SELECT
        i.id,
        i.item_name,
        i.quantity,
        i.minimum_quantity,
        i.selling_price,
        i.cost_price,
        COALESCE(f.name, '') AS folder_name
      FROM inventory i
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
      ORDER BY i.item_name ASC
    `)
    .all(Number(consultation.doctor_id))
    .map((row) => ({
      ...row,
      quantity: Number(row.quantity || 0),
      minimum_quantity: Number(row.minimum_quantity || 0),
      selling_price: roundCurrency(row.selling_price),
      cost_price: roundCurrency(row.cost_price),
    }));

  res.json(rows);
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

  let createdId = null;
  try {
    db.transaction(() => {
      const computedItems = applyInventoryTransactions({
        consultation,
        items,
        userId: req.auth?.id || null,
      });

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
        JSON.stringify(computedItems),
        calculateBillingTotal(computedItems),
        status,
        paymentMethod,
        paymentDate,
      );
      createdId = Number(result.lastInsertRowid);
    })();
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Failed to create billing entry." });
  }

  res.status(201).json(getJoinedBillById(createdId));
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
  if (items.some((item) => item.inventory_item_id && Number(item.quantity) > 0)) {
    return res.status(400).json({
      error:
        "Editing inventory-linked lines is locked after sync. Create a new adjustment/wastage line in a new bill entry.",
    });
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
