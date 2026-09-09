const express = require("express");
const { db } = require("../db");
const {
  calculateBillingTotal,
  getTodayLocal,
  normalizeBillingItems,
  parseBillingRow,
} = require("../lib/utils");
const { isLinkhamInsuranceProvider } = require("../lib/insuranceProvider");
const {
  publishInventoryChange,
  publishLinkhamClaimsChange,
  publishPatientDataChange,
} = require("../lib/inventoryRealtime");
const {
  findUnbilledSaleCredit,
  markSaleMovementsBilled,
  pendingSales,
  matchesVisit,
} = require("../lib/saleBillingLinkage");
const { doctorCanAccessPatient, doctorPatientAccessError, getDoctorCaseloadFilterSql } = require("../lib/patientAccess");
const { decorateInventoryItems } = require("../lib/inventoryStockState");
const { consumeAvailableFefo } = require("../lib/restockFulfilment");
const { assertInventoryQuantityUpdate, InventoryVersionConflictError } = require("../lib/inventoryQuantity");
const { recordMovementAllocations } = require("../lib/inventoryMovementAllocations");

const { operationFor } = require("../lib/operationReceipts");
const { isConsultationFee, assertSingleVisitFee, assertVisitReadyForPayment } = require("../lib/consultationFees");
const router = express.Router();
function validPaymentDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function billingDateSql(req) {
  return req.query.dateBasis === "payment"
    ? "CASE WHEN b.status = 'paid' THEN COALESCE(NULLIF(b.payment_date, ''), date(b.created_at, '+4 hours')) ELSE date(c.consultation_date) END"
    : "date(c.consultation_date)";
}
function inventorySignature(items) {
  return JSON.stringify(normalizeBillingItems(items).filter(i => i.inventory_item_id).map(i =>
    [i.inventory_item_id, i.quantity, i.type, i.amount, i.description, Boolean(i.emergency_override)]
  ).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
const PAYMENT_METHODS = new Set(["cash", "juice", "card", "ib"]);
const BILLING_READ_ROLES = new Set(["admin", "doctor", "accountant", "operator"]);
const BILLING_WRITE_ROLES = new Set(["admin", "doctor", "accountant", "operator"]);

router.use((req, res, next) => {
  const role = String(req.auth?.role || "").trim().toLowerCase();
  const allowed = req.method === "GET" ? BILLING_READ_ROLES : BILLING_WRITE_ROLES;
  if (!allowed.has(role)) {
    return res.status(403).json({ error: "You do not have permission to access billing." });
  }
  return next();
});

function ensureActivityHistoryTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_activity_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_id INTEGER,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actor_user_id INTEGER,
      actor_name TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL DEFAULT '',
      action_type TEXT NOT NULL DEFAULT '',
      item_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT '',
      source_text TEXT NOT NULL DEFAULT '',
      destination_text TEXT NOT NULL DEFAULT '',
      batch_id TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_activity_timestamp ON inventory_activity_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_inventory_activity_action ON inventory_activity_history(action_type);
  `);
}

function notifyLinkhamBillingIfNeeded(patientId, userId) {
  const pid = Number(patientId || 0);
  if (!pid) {
    return;
  }

  const patient = db.prepare("SELECT insurance_provider FROM patients WHERE id = ?").get(pid);
  if (!isLinkhamInsuranceProvider(patient?.insurance_provider)) {
    return;
  }

  publishLinkhamClaimsChange({
    changedByUserId: userId || null,
  });
}

function normalizePaymentMethod(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function buildDoctorAccessClause(auth) {
  if (auth?.role === "doctor") {
    const caseloadDoctorId = Number(auth.doctor_id || 0);
    if (!caseloadDoctorId) {
      return {
        clause: "AND 1 = 0",
        params: {},
      };
    }

    return {
      clause: getDoctorCaseloadFilterSql("p"),
      params: { caseloadDoctorId },
    };
  }

  return {
    clause: "",
    params: {},
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
        c.voided_at,
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

function validateOperatorIssue(items, status) {
  if (status !== "unpaid") {
    return "Operators can issue unpaid invoices only. Payment must be recorded by an authorised finance or clinical user.";
  }

  const tariffRows = db
    .prepare("SELECT type_name, default_amount FROM consultation_fee_types")
    .all();
  const tariffs = new Map(
    tariffRows.map((row) => [String(row.type_name), roundCurrency(row.default_amount)]),
  );

  for (const item of items) {
    if (isConsultationFee(item)) {
      const expected = tariffs.get(String(item.description || "").trim());
      if (expected === undefined || roundCurrency(item.amount) !== expected || Number(item.quantity) !== 1) {
        return "Operators must use the current Day, Night, or Review consultation tariff without changing its price.";
      }
      continue;
    }

    if (
      !item.inventory_item_id ||
      item.type !== "Sale" ||
      item.emergency_override === true
    ) {
      return "Operators can add available catalogue items only. Manual charges, wastage, adjustments, and emergency stock overrides require an authorised clinician or admin.";
    }
  }

  return null;
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
  return consumeAvailableFefo(itemId, quantity);
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
  ensureActivityHistoryTable();
  const fullMeta = {
    consultation_id: consultationId,
    appointment_id: appointmentId,
    transaction_type:
      actionType === "wastage"
        ? "Wastage"
        : actionType === "adjustment"
          ? "Adjustment"
          : "Sale",
    ...meta,
  };
  const activityActionType = fullMeta.emergency_override ? "override" : actionType;

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
    JSON.stringify(fullMeta),
  );

  const inserted = db.prepare("SELECT last_insert_rowid() AS id").get();
  const movementId = Number(inserted?.id || 0);
  db.prepare(`
    INSERT INTO inventory_activity_history (
      movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type, item_name,
      quantity, direction, source_text, destination_text, batch_id, meta_json
    )
    VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movementId || null,
    userId || null,
    String(fullMeta.performed_by_name || ""),
    String(fullMeta.performed_by_role || ""),
    String(activityActionType || ""),
    String(fullMeta.item_name || ""),
    Number(quantity || 0),
    "out",
    String(fullMeta.source_text || "Doctor Stock"),
    String(fullMeta.destination_text || "Patient Bill"),
    String(fullMeta.batch_id || (fullMeta.allocations || []).map((row) => row.batch_id).join(",") || ""),
    JSON.stringify(fullMeta),
  );
  return movementId;
}

function applyInventoryTransactions({
  consultation,
  items,
  userId,
  actor,
  billingId = null,
}) {
  const normalized = normalizeBillingItems(items);
  const inventoryLines = normalized.filter((item) => item.inventory_item_id && Number(item.quantity) > 0);
  const processed = [];
  const touchedItemIds = new Set();

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
      throw new Error(
        `Inventory item not found for doctor (${line.description || "line item"}). It may have been removed from the medical bag — update or remove this billing line.`,
      );
    }

    const qty = Number(line.quantity || 0);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error("Inventory quantity must be a positive whole number.");
    }

    const isSellLine = line.type !== "Wastage" && line.type !== "Adjustment";
    if (!isSellLine && line.dispensing_movement_ids?.length) throw Object.assign(new Error("A recorded sale must be reconciled as a sale, not a new wastage or adjustment."),{status:409});

    // For Sale-style lines, see if the doctor already deducted this exact
    // patient/item combo from the bag while in the field. If so we credit
    // those movements against the bill instead of deducting again — which
    // is how the bag was getting double-decremented before.
    let linkedSaleMovementIds = [];
    let qtyToDecrement = qty;
    let recordedSaleAmount = 0;
    if (isSellLine && billingId) {
      const { matched, consumedQty, recordedAmount } = findUnbilledSaleCredit({
        itemId: stockItem.id,
        patientId: Number(consultation.patient_id),
        doctorId: Number(consultation.doctor_id),
        maxQty: qty,
        consultationId: consultation.id,
        movementIds: line.dispensing_movement_ids || [],
      });

      recordedSaleAmount = recordedAmount;
      if (matched.length > 0) {
        linkedSaleMovementIds = markSaleMovementsBilled(matched, billingId);
        qtyToDecrement = qty - consumedQty;
      }
    }

    const decorated = decorateInventoryItems([stockItem])[0] || stockItem;
    const atp = Number(decorated.available_to_promise ?? decorated.available_to_use ?? 0);
    if (qtyToDecrement > atp) {
      const error = new Error(
        `Insufficient usable stock for ${stockItem.item_name}. ${atp} unit(s) available to promise; ${qtyToDecrement} requested.`,
      );
      error.status = 409;
      error.extra = {
        code: "INSUFFICIENT_ATP",
        available_to_promise: atp,
        requested: qtyToDecrement,
      };
      throw error;
    }

    const locked = db.prepare("SELECT * FROM inventory WHERE id = ?").get(stockItem.id);
    const previousQuantity = Number(locked?.quantity || 0);
    const expectedVersion = Number(locked?.row_version || 1);
    let allocations = [];
    let nextQuantity = previousQuantity;
    if (qtyToDecrement > 0) {
      const consumed = consumeDoctorBatches(stockItem.id, qtyToDecrement);
      allocations = consumed.allocations || [];
      const allocated = allocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      if (allocated !== qtyToDecrement) {
        const error = new Error(
          `Eligible batches could not cover the billed quantity for ${stockItem.item_name}.`,
        );
        error.status = 409;
        error.extra = { code: "INSUFFICIENT_ELIGIBLE_BATCHES" };
        throw error;
      }
      nextQuantity = previousQuantity - allocated;
      if (nextQuantity < 0) {
        const error = new Error("Inventory quantity cannot become negative.");
        error.status = 409;
        throw error;
      }
      try {
        assertInventoryQuantityUpdate(stockItem.id, nextQuantity, expectedVersion);
      } catch (error) {
        if (error instanceof InventoryVersionConflictError || error.code === "INVENTORY_VERSION_CONFLICT") {
          error.status = 409;
        }
        throw error;
      }
    }

    const actionType =
      line.type === "Wastage"
        ? "wastage"
        : line.type === "Adjustment"
          ? "adjustment"
          : "sell";

    if (qtyToDecrement > 0) {
      const movementId = insertInventoryMovement({
        itemId: stockItem.id,
        quantity: qtyToDecrement,
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
          item_name: stockItem.item_name,
          emergency_override: Boolean(line.emergency_override),
          dispensed_quantity: qtyToDecrement,
          billed_quantity: qty,
          batch_shortfall: 0,
          allocations,
          performed_by_user_id: actor?.id || userId || null,
          performed_by_role: actor?.role || "",
          performed_by_name: actor?.full_name || actor?.username || "",
          source_text: actor?.full_name ? `${actor.full_name} (${actor.role || ""})` : "Doctor Stock",
          destination_text: "Patient Bill",
          billing_id: billingId,
          billing_line_description: line.description || stockItem.item_name,
          linked_sale_movement_ids: linkedSaleMovementIds,
          linked_sale_credit_qty: qty - qtyToDecrement,
        },
      });
      recordMovementAllocations(movementId, allocations);
    }

    touchedItemIds.add(Number(stockItem.id));

    processed.push({
      ...line,
      description: line.description || stockItem.item_name,
      amount:
        line.type === "Wastage" || line.type === "Adjustment"
          ? roundCurrency(Number(stockItem.cost_price || 0) * qty)
          : roundCurrency(recordedSaleAmount + Number(stockItem.selling_price || 0) * qtyToDecrement),
      inventory_item_id: Number(stockItem.id),
      linked_sale_movement_ids: linkedSaleMovementIds,
      dispensing_movement_ids: linkedSaleMovementIds,
    });
  }

  const passthrough = normalized.filter((item) => !(item.inventory_item_id && Number(item.quantity) > 0));
  return { items: [...passthrough, ...processed], touchedItemIds: [...touchedItemIds] };
}

function withPaymentReview(bills) {
  const visits = new Map();
  return bills.map(bill => {
    if (bill.status !== 'unpaid' || bill.voided_at || bill.consultation_voided_at) return bill;
    if (!visits.has(bill.consultation_id)) {
      try { assertVisitReadyForPayment(db, bill.consultation_id); visits.set(bill.consultation_id, null); }
      catch (error) {
        if (error.status !== 409) throw error;
        visits.set(bill.consultation_id, {reason:error.message, ...error.extra});
      }
    }
    return {...bill, payment_block:visits.get(bill.consultation_id)};
  });
}

function getJoinedBillById(billId) {
  const bill = db
    .prepare(`
      SELECT
        b.*,
        p.full_name AS patient_name,
        p.deleted_at AS patient_archived_at,
        c.voided_at AS consultation_voided_at,
        c.consultation_date,
        c.appointment_id,
        c.doctor_id,
        d.full_name AS doctor_name,
        u.full_name AS updated_by_name
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      LEFT JOIN users u ON u.id = b.updated_by_user_id
      WHERE b.id = ?
    `)
    .get(billId);

  if (!bill) return null;
  const parsed = withPaymentReview([parseBillingRow(bill)])[0];
  return {
    ...parsed,
    history: db.prepare(`SELECT e.*, COALESCE(NULLIF(e.actor_name, ''), u.full_name) AS actor_name FROM billing_events e
      LEFT JOIN users u ON u.id=e.actor_id WHERE e.bill_id=? ORDER BY e.id DESC`).all(billId),
    appointment_financials: calculateAppointmentLossRevenue(parsed.items),
  };
}

function ensureBillAccess(req, bill, { write = false } = {}) {
  if (!bill) {
    return { status: 404, error: "Bill not found." };
  }

  if (write && (bill.voided_at || bill.consultation_voided_at)) {
    return { status: 409, error: "This bill is voided and cannot be changed or paid." };
  }
  if (req.auth?.role !== "doctor") {
    return null;
  }

  if (write) {
    if (!req.auth.doctor_id || Number(bill.doctor_id) !== Number(req.auth.doctor_id)) {
      return { status: 403, error: "You can only manage billing linked to your own consultations." };
    }
    return null;
  }

  const patient = db
    .prepare("SELECT * FROM patients WHERE id = ?")
    .get(bill.patient_id);
  if (!doctorCanAccessPatient(patient, req.auth)) {
    return { status: 403, error: doctorPatientAccessError(req.auth) };
  }

  return null;
}

router.get("/patient-summary", (req, res) => {
  const doctorAccess = buildDoctorAccessClause(req.auth);
  const dateFrom = String(req.query.dateFrom ?? "").trim();
  const dateTo = String(req.query.dateTo ?? "").trim();

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
      JOIN billing b ON b.patient_id = p.id
      JOIN consultations c ON c.id = b.consultation_id
      WHERE b.voided_at IS NULL AND c.voided_at IS NULL
        AND (@dateFrom = '' OR ${billingDateSql(req)} >= date(@dateFrom))
        AND (@dateTo = '' OR ${billingDateSql(req)} <= date(@dateTo))
        AND (@reportDoctorId IS NULL OR c.doctor_id = @reportDoctorId)
        ${doctorAccess.clause}
      GROUP BY p.id
      ORDER BY unpaid_amount DESC, total_billed DESC, patient_name ASC
    `)
    .all({
      dateFrom,
      dateTo,
      reportDoctorId: req.query.doctorId ? Number(req.query.doctorId) : null,
      ...doctorAccess.params,
    });

  res.json(summary);
});

router.get("/", (req, res) => {
  const status = String(req.query.status ?? "").trim();
  const patientId = String(req.query.patientId ?? "").trim();
  const dateFrom = String(req.query.dateFrom ?? "").trim();
  const dateTo = String(req.query.dateTo ?? "").trim();
  const doctorAccess = buildDoctorAccessClause(req.auth);

  const bills = db
    .prepare(`
      SELECT
        b.*,
        p.full_name AS patient_name,
        p.deleted_at AS patient_archived_at,
        c.voided_at AS consultation_voided_at,
        c.consultation_date,
        c.doctor_id,
        d.full_name AS doctor_name,
        u.full_name AS updated_by_name
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      LEFT JOIN users u ON u.id = b.updated_by_user_id
      WHERE ((@status = 'voided' AND (b.voided_at IS NOT NULL OR c.voided_at IS NOT NULL))
        OR (@status != 'voided' AND b.voided_at IS NULL AND c.voided_at IS NULL AND (@status = '' OR b.status = @status)))
        AND (@patientId = '' OR CAST(b.patient_id AS TEXT) = @patientId)
        AND (@dateFrom = '' OR ${billingDateSql(req)} >= date(@dateFrom))
        AND (@dateTo = '' OR ${billingDateSql(req)} <= date(@dateTo))
        AND (@reportDoctorId IS NULL OR c.doctor_id = @reportDoctorId)
        ${doctorAccess.clause}
      ORDER BY c.consultation_date DESC, b.created_at DESC
    `)
    .all({
      status,
      patientId,
      dateFrom,
      dateTo,
      reportDoctorId: req.query.doctorId ? Number(req.query.doctorId) : null,
      ...doctorAccess.params,
    })
    .map(parseBillingRow);

  res.json(withPaymentReview(bills));
});

router.get("/consultation-fees", (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT type_name, default_amount
        FROM consultation_fee_types
        ORDER BY id ASC
      `)
      .all();

    const fees = rows.reduce((acc, row) => {
      acc[row.type_name] = roundCurrency(row.default_amount);
      return acc;
    }, {});

    res.json(fees);
  } catch (error) {
    console.error("[billing][GET /consultation-fees]", error);
    return res.status(500).json({
      error: error?.message || "Failed to load consultation fees.",
    });
  }
});

router.get("/consultation-options", (req, res) => {
  const rows = db
    .prepare(`
      SELECT
        c.id,
        c.patient_id,
        c.doctor_id,
        c.consultation_date,
        p.full_name AS patient_name,
        d.full_name AS doctor_name,
        COUNT(b.id) AS bill_count
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      LEFT JOIN billing b ON b.consultation_id = c.id AND b.voided_at IS NULL
      WHERE p.deleted_at IS NULL
        AND c.voided_at IS NULL
        AND (@doctorId IS NULL OR c.doctor_id = @doctorId)
      GROUP BY c.id, p.full_name, d.full_name
      ORDER BY c.consultation_date DESC, c.created_at DESC
    `)
    .all({
      doctorId:
        req.auth.role === "doctor" ? Number(req.auth.doctor_id || 0) || -1 : null,
    })
    .map((row) => ({ ...row, bill_count: Number(row.bill_count || 0) }));

  res.json(rows);
});

router.get('/reconciliation', (req,res) => {
  if (req.auth.role === 'operator') {
    return res.status(403).json({error:'Financial reconciliation is restricted to finance and clinical users.'});
  }
  const doctorId = req.auth.role==='doctor' ? Number(req.auth.doctor_id || 0) : Number(req.query.doctorId || 0) || null;
  if (req.auth.role==='doctor' && !doctorId) return res.status(403).json({error:'Doctor account is not linked.'});
  const result=require('../lib/financialReconciliation').financialReconciliation(db,{doctorId,from:req.query.dateFrom,to:req.query.dateTo});
  if (req.auth.role==='doctor') delete result.stock;
  res.json(result);
});

// Void a duplicate unpaid service bill without voiding the clinical visit or restoring stock.
router.post('/:id/void', (req,res) => {
  if (req.auth.role!=='admin') return res.status(403).json({error:'Only an admin can void a duplicate bill.'});
  const bill=getJoinedBillById(Number(req.params.id));
  if (!bill) return res.status(404).json({error:'Bill not found.'});
  const reason=String(req.body.reason || '').trim();
  if (reason.length<8) return res.status(400).json({error:'Enter a meaningful reason for voiding this bill.'});
  if (bill.voided_at) return res.json(bill);
  if (bill.status!=='unpaid' || bill.items.some(i=>i.inventory_item_id)) return res.status(409).json({error:'Only unpaid service-only bills can be voided here. Review payments or stock-linked lines separately.'});
  if (Number(req.body.expected_version)!==Number(bill.row_version)) return res.status(409).json({error:'This bill changed. Reopen its details.'});
  const result=db.prepare("UPDATE billing SET voided_at=CURRENT_TIMESTAMP,voided_by_user_id=?,void_reason=?,updated_by_user_id=? WHERE id=? AND row_version=? AND voided_at IS NULL").run(req.auth.id,reason,req.auth.id,bill.id,bill.row_version);
  if (result.changes!==1) return res.status(409).json({error:'This bill changed. Reopen its details.'});
  publishPatientDataChange(bill.patient_id,{reason:'billing'});
  res.json(getJoinedBillById(bill.id));
});

router.get('/visit/:consultationId', (req,res) => {
  const consultation = getConsultationContext(Number(req.params.consultationId));
  if (!consultation || consultation.voided_at) return res.status(404).json({error:'Visit not found.'});
  if (req.auth.role==='doctor' && Number(req.auth.doctor_id || 0)!==Number(consultation.doctor_id)) return res.status(403).json({error:'You can only bill your own visits.'});
  const bills = db.prepare('SELECT id FROM billing WHERE consultation_id=? AND voided_at IS NULL ORDER BY id').all(consultation.id).map(b=>getJoinedBillById(b.id));
  const pending = pendingSales({patientId:consultation.patient_id,doctorId:consultation.doctor_id})
    .filter(m => {
      const meta = JSON.parse(m.meta_json || '{}');
      return (!meta.consultation_id && !meta.appointment_id) || matchesVisit(m, consultation);
    })
    .map(m=>({id:m.id,item_id:m.item_id,item_name:m.item_name,quantity:m.quantity,unit_price:m.unit_price_snapshot,created_at:m.created_at,valuation_basis:m.valuation_basis,matches_visit:matchesVisit(m,consultation)}));
  res.json({bills,pending_sales:pending});
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
  try {
    const consultationId = Number(req.params.consultationId || 0);
    const consultation = getConsultationContext(consultationId);
    if (!consultation) {
      return res.status(404).json({ error: "Consultation not found." });
    }
    if (
      req.auth?.role === "doctor" &&
      (!req.auth.doctor_id || Number(consultation.doctor_id) !== Number(req.auth.doctor_id))
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
        WHERE i.stock_scope = 'doctor'
          AND i.owner_doctor_id = ?
        ORDER BY i.item_name ASC
      `)
      .all(Number(consultation.doctor_id));
    const decorated = decorateInventoryItems(rows).map((row) => ({
      ...row,
      quantity: Number(row.on_hand_quantity ?? row.quantity ?? 0),
      available_to_promise: Number(row.available_to_promise ?? row.available_to_use ?? 0),
      expired_quantity: Number(row.expired_quantity || 0),
      quarantined_quantity: Number(row.quarantined_quantity || 0),
      minimum_quantity: Number(row.minimum_quantity || 0),
      selling_price: roundCurrency(row.selling_price),
      cost_price: roundCurrency(row.cost_price),
    }));

    res.json(decorated);
  } catch (error) {
    console.error("[billing][GET /inventory-options]", error);
    return res.status(500).json({
      error: error?.message || "Failed to load inventory suggestions.",
    });
  }
});

router.post("/", (req, res) => {
  try {
  const consultationId = Number(req.body.consultation_id);
  const patientId = Number(req.body.patient_id);
  const consultation = getConsultationContext(consultationId);

  if (!consultation) {
    return res.status(400).json({ error: "Select a valid consultation." });
  }
  if (consultation.voided_at) {
    return res.status(409).json({ error: "This consultation has been voided and cannot be billed." });
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
    (!req.auth.doctor_id || Number(consultation.doctor_id) !== Number(req.auth.doctor_id))
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

  if (req.auth.role === "operator") {
    const operatorIssueError = validateOperatorIssue(items, status);
    if (operatorIssueError) {
      return res.status(403).json({ error: operatorIssueError });
    }
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

  if (status === "paid" && !validPaymentDate(paymentDate)) {
    return res.status(400).json({ error: "Enter a valid payment date (YYYY-MM-DD)." });
  }
  const operation = operationFor(req, "billing:create", { legacyWindow: true });
  let createdId = null;
  let touchedItemIds = [];
  try {
    db.transaction(() => {
      const current = getConsultationContext(consultationId);
      if (!current || current.voided_at) throw Object.assign(new Error("This consultation is no longer available for billing."), {status:409});
      const replay = operation.read();
      if (replay) { createdId = replay.billId; return; }
      assertSingleVisitFee(db, consultationId, items);
      // Insert a placeholder bill first so the linkage helper has a billing
      // id to stamp onto any matched Sale movements. Items + total are
      // computed inside the same transaction below so callers never observe
      // the empty row.
      const inserted = db.prepare(`
        INSERT INTO billing (
          consultation_id,
          patient_id,
          items,
          total_amount,
          status,
          payment_method,
          payment_date, updated_by_user_id
        )
        VALUES (?, ?, '[]', 0, ?, ?, ?, ?)
      `).run(
        consultationId,
        patientId,
        status,
        paymentMethod,
        paymentDate,
        req.auth.id,
      );
      createdId = Number(inserted.lastInsertRowid);

      const { items: computedItems, touchedItemIds: itemIds } = applyInventoryTransactions({
        consultation,
        items,
        userId: req.auth?.id || null,
        actor: req.auth || {},
        billingId: createdId,
      });
      touchedItemIds = itemIds;

      db.prepare(`
        UPDATE billing
        SET items = ?, total_amount = ?
        WHERE id = ?
      `).run(
        JSON.stringify(computedItems),
        calculateBillingTotal(computedItems),
        createdId,
      );
      if (status === 'paid') assertVisitReadyForPayment(db, consultationId);
      operation.save({ billId: createdId });
    }).immediate();
  } catch (error) {
    const status = Number(error?.status || 400);
    return res.status(status).json({
      error: error?.message || "Failed to create billing entry.",
      ...(error?.extra || {}),
    });
  }

  // Fan stock-level changes out to every other connected tab/device so the
  // doctor's bag and OCS views stay in sync after a billing run.
  for (const itemId of touchedItemIds) {
    try {
      publishInventoryChange({ itemId, changedByUserId: req.auth?.id || null });
    } catch (publishError) {
      console.warn("[billing] publishInventoryChange failed:", publishError?.message || publishError);
    }
  }

  publishPatientDataChange(patientId, { reason: "billing" });
  notifyLinkhamBillingIfNeeded(patientId, req.auth?.id);

  res.status(201).json(getJoinedBillById(createdId));
  } catch (error) {
    console.error("[billing][POST /]", error);
    return res.status(error.status || 500).json({
      error: error?.message || "Failed to create billing entry.",
    });
  }
});

router.put("/:id", (req, res) => {
  if (req.auth.role === "operator") {
    return res.status(403).json({ error: "Operators can issue invoices but cannot edit an issued bill." });
  }
  const billId = Number(req.params.id);
  const existing = getJoinedBillById(billId);
  const accessError = ensureBillAccess(req, existing, { write: true });

  if (accessError) {
    return res.status(accessError.status).json({ error: accessError.error });
  }

  const items = normalizeBillingItems(req.body.items);
  if (!items.length) {
    return res.status(400).json({ error: "At least one billing line item is required." });
  }
  if (inventorySignature(items) !== inventorySignature(existing.items)) {
    return res.status(400).json({
      error:
        "Inventory-linked lines must remain unchanged. Use an explicit stock reversal or a separate adjustment bill.",
    });
  }

  try { assertSingleVisitFee(db, existing.consultation_id, items, billId); }
  catch (error) { return res.status(error.status || 409).json({error:error.message,...error.extra}); }
  if (existing.fee_review_required && req.body.confirm_consultation_fee !== true && String(req.body.status || existing.status) === 'paid') return res.status(409).json({error:'Review and confirm the consultation fee before recording payment.'});
  if (existing.fee_review_required && req.body.confirm_consultation_fee === true && !items.some(isConsultationFee)) return res.status(400).json({error:'Select the consultation charge before confirming the fee.'});
  const expectedVersion = req.body.expected_version;
  if (expectedVersion != null && Number(expectedVersion) !== Number(existing.row_version)) {
    return res.status(409).json({ error: "This bill changed elsewhere. Reopen it before saving." });
  }
  const correctionReason = String(req.body.correction_reason || "").trim();
  if (existing.legacy_fee_review_required && req.body.confirm_consultation_fee === true && (req.auth.role !== 'admin' || correctionReason.length < 8)) {
    return res.status(403).json({error:'An admin must verify this historical fee against the source record and document the reason before confirming it.'});
  }
  if (existing.status === "paid" && (req.auth.role !== "admin" || correctionReason.length < 8)) {
    return res.status(409).json({ error: "Paid bills require an admin correction with a meaningful reason." });
  }
  const preservedItems = items.filter(i => !i.inventory_item_id).concat(existing.items.filter(i => i.inventory_item_id));
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

  if (status === "paid" && !validPaymentDate(paymentDate)) {
    return res.status(400).json({ error: "Enter a valid payment date (YYYY-MM-DD)." });
  }
  let updated;
  try {
    updated = db.transaction(() => {
      assertSingleVisitFee(db, existing.consultation_id, preservedItems, billId);
      const result = db.prepare(`
    UPDATE billing
    SET
      items = ?,
      total_amount = ?,
      status = ?,
      payment_method = ?,
      payment_date = ?,
      updated_at = CURRENT_TIMESTAMP,
      updated_by_user_id = ?,
      change_reason = ?,
      fee_review_required = ?,
      legacy_fee_review_required = ?
    WHERE id = ? AND row_version = ? AND voided_at IS NULL
  `).run(
    JSON.stringify(preservedItems),
    calculateBillingTotal(preservedItems),
    status,
    paymentMethod,
    paymentDate || null,
    req.auth?.id || null,
    correctionReason || (existing.fee_review_required && req.body.confirm_consultation_fee ? "Consultation fee reviewed" : ""),
    req.body.confirm_consultation_fee === true ? 0 : existing.fee_review_required,
    req.body.confirm_consultation_fee === true ? 0 : existing.legacy_fee_review_required,
    billId,
    existing.row_version,
      );
      if (status === 'paid') assertVisitReadyForPayment(db, existing.consultation_id);
      return result;
    }).immediate();
  } catch (error) { return res.status(error.status || 400).json({error:error.message,...error.extra}); }
  if (updated.changes !== 1) return res.status(409).json({ error: "This bill changed elsewhere. Reopen it before saving." });

  if (existing?.patient_id) {
    publishPatientDataChange(existing.patient_id, { reason: "billing" });
    notifyLinkhamBillingIfNeeded(existing.patient_id, req.auth?.id);
  }

  res.json(getJoinedBillById(billId));
});

router.patch("/:id/pay", (req, res) => {
  if (req.auth.role === "operator") {
    return res.status(403).json({ error: "Operators can issue invoices but cannot record payment." });
  }
  const billId = Number(req.params.id);
  const existing = getJoinedBillById(billId);
  const accessError = ensureBillAccess(req, existing, { write: true });

  if (accessError) {
    return res.status(accessError.status).json({ error: accessError.error });
  }

  if (existing.fee_review_required) return res.status(409).json({error:'Open bill details to confirm Day, Night or Review Consultation before recording payment.', code:'FEE_REVIEW_REQUIRED'});
  const paymentMethod =
    normalizePaymentMethod(req.body.payment_method ?? (existing.status === 'paid' ? existing.payment_method : null));

  if (!PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({
      error: "Select a valid payment method: cash, juice, card, or IB.",
    });
  }

  const paymentDate = String(req.body.payment_date ?? (existing.status === 'paid' ? existing.payment_date : '')).trim();
  if (!validPaymentDate(paymentDate)) {
    return res.status(400).json({ error: "Enter a valid payment date (YYYY-MM-DD)." });
  }
  if (existing.status === "paid") {
    if (paymentMethod === existing.payment_method && paymentDate === existing.payment_date) return res.json(existing);
    return res.status(409).json({ error: "Payment already recorded. An admin must make a documented correction." });
  }
  if (Number(req.body.expected_version) !== Number(existing.row_version)) {
    return res.status(409).json({ error: "This bill changed elsewhere. Refresh before recording payment." });
  }

  let updated;
  try {
    updated = db.transaction(() => {
      assertVisitReadyForPayment(db, existing.consultation_id);
      return db.prepare(`
    UPDATE billing
    SET status = 'paid',
        change_reason = 'Payment recorded',
        payment_method = ?,
        payment_date = ?,
        updated_at = CURRENT_TIMESTAMP,
        updated_by_user_id = ?
    WHERE id = ? AND row_version = ? AND voided_at IS NULL
  `).run(paymentMethod, paymentDate, req.auth?.id || null, billId, existing.row_version);
    }).immediate();
  } catch (error) { return res.status(error.status || 400).json({error:error.message,...error.extra}); }
  if (updated.changes !== 1) return res.status(409).json({ error: "This bill changed elsewhere. Refresh before recording payment." });

  if (existing?.patient_id) {
    publishPatientDataChange(existing.patient_id, { reason: "billing" });
    notifyLinkhamBillingIfNeeded(existing.patient_id, req.auth?.id);
  }

  res.json(getJoinedBillById(billId));
});

module.exports = router;
