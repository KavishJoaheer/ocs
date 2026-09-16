const express = require("express");
const { db } = require("../db");
const {
  billingItemsValidationError,
  calculateBillingTotal,
  getTodayLocal,
  isValidCurrencyAmount,
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
const { decorateInventoryItems } = require("../lib/inventoryStockState");
const {
  consumeAvailableBatch,
  consumeAvailableFefo,
  listAllocatableBatches,
} = require("../lib/restockFulfilment");
const { assertInventoryQuantityUpdate, InventoryVersionConflictError } = require("../lib/inventoryQuantity");
const { recordMovementAllocations } = require("../lib/inventoryMovementAllocations");
const { reverseBillingSubmissionInventory } = require("../lib/inventoryReversal");
const { getDoctorUserId, sendPushToUser } = require("../lib/push");

const { operationFor } = require("../lib/operationReceipts");
const {
  CONSULTATION_FEES,
  isConsultationFee,
  assertSingleVisitFee,
  assertVisitReadyForPayment,
} = require("../lib/consultationFees");
const router = express.Router();
function validPaymentDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function billingDateSql(req) {
  return req.query.dateBasis === "payment"
    ? "CASE WHEN b.status = 'paid' THEN COALESCE(NULLIF(b.payment_date, ''), date(b.created_at, '+4 hours')) ELSE date(COALESCE(NULLIF(b.consultation_date_snapshot, ''), c.consultation_date)) END"
    : "date(COALESCE(NULLIF(b.consultation_date_snapshot, ''), c.consultation_date))";
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

function normalizeSourceReference(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function consultationTypeFromItems(items) {
  return String(normalizeBillingItems(items).find(isConsultationFee)?.description || "").trim();
}

function assertNoManualInventoryBypass(consultation, items) {
  const normalizeName = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const manualSales = normalizeBillingItems(items).filter(
    (item) => !item.inventory_item_id && item.type === "Sale" && !isConsultationFee(item) && item.description,
  );
  if (!manualSales.length) return;

  const catalogueNames = new Set(
    db.prepare(`
      SELECT item_name
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND archived_at IS NULL
    `).all(Number(consultation.doctor_id)).map((row) => normalizeName(row.item_name)),
  );
  const bypass = manualSales.find((item) => catalogueNames.has(normalizeName(item.description)));
  if (bypass) {
    throw Object.assign(
      new Error(`${bypass.description} is a stocked supply. Select it from inventory so stock and cost records stay complete.`),
      { status: 409, extra: { code: "STOCK_ITEM_REQUIRES_SELECTION" } },
    );
  }
}

function getBillingIssueSnapshot(consultation, items, actor) {
  const user = actor?.id
    ? db.prepare("SELECT full_name, role FROM users WHERE id = ?").get(actor.id)
    : null;
  return {
    issuedByUserId: actor?.id || null,
    issuedByName: String(actor?.full_name || user?.full_name || actor?.username || "System"),
    issuedByRole: String(actor?.role || user?.role || "system"),
    patientIdentifier: String(consultation?.patient_identifier || ""),
    patientName: String(consultation?.patient_name || ""),
    doctorId: Number(consultation?.doctor_id || 0) || null,
    doctorName: String(consultation?.doctor_name || ""),
    consultationDate: consultation?.consultation_date || null,
    consultationType: consultationTypeFromItems(items),
    partnerCategory: String(consultation?.insurance_provider || "").trim() || "Self-pay",
  };
}

function buildDoctorAccessClause(auth) {
  if (auth?.role === "doctor") {
    const accessDoctorId = Number(auth.doctor_id || 0);
    if (!accessDoctorId) {
      return {
        clause: "AND 1 = 0",
        params: {},
      };
    }

    return {
      clause: "AND COALESCE(b.doctor_id_snapshot, c.doctor_id) = @accessDoctorId",
      params: { accessDoctorId },
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
        p.patient_identifier,
        p.insurance_provider,
        d.full_name AS doctor_name
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE c.id = ?
        AND p.deleted_at IS NULL
    `)
    .get(consultationId);
}

function requireQuickBillingDoctor(req, res) {
  if (req.auth?.role !== "doctor" || !Number(req.auth?.doctor_id || 0)) {
    res.status(403).json({ error: "Quick billing is available to linked doctor accounts only." });
    return null;
  }
  return Number(req.auth.doctor_id);
}

function formatVisitNumber(consultationId) {
  return `V-${String(Number(consultationId || 0)).padStart(6, "0")}`;
}

function maskPatientName(fullName) {
  return String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${"•".repeat(Math.max(4, Math.min(7, part.length - 1)))}`)
    .join(" ");
}

function normalizeOcsCareNumber(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^OCS-?(\d+)$/);
  return match ? `OCS-${Number(match[1])}` : "";
}

function parseVisitReference(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^(?:V|VISIT)-?(\d+)$/);
  return match ? Number(match[1]) : null;
}

function quickVisitBaseRows(doctorId, { consultationId = null, patientIdentifier = "", todayOnly = false } = {}) {
  return db
    .prepare(`
      SELECT
        c.id AS consultation_id,
        c.appointment_id,
        c.patient_id,
        c.consultation_date,
        a.appointment_date,
        a.appointment_time,
        a.status AS appointment_status,
        p.full_name AS patient_name,
        p.patient_identifier
      FROM consultations c
      JOIN appointments a ON a.id = c.appointment_id
      JOIN patients p ON p.id = c.patient_id
      WHERE c.doctor_id = @doctorId
        AND c.voided_at IS NULL
        AND p.deleted_at IS NULL
        AND (@consultationId IS NULL OR c.id = @consultationId)
        AND (@patientIdentifier = '' OR UPPER(p.patient_identifier) = @patientIdentifier)
        AND (
          @todayOnly = 0
          OR date(COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date)) = date('now', '+4 hours')
        )
      ORDER BY
        CASE WHEN date(COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date)) = date('now', '+4 hours') THEN 0 ELSE 1 END,
        COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date || ' ' || a.appointment_time) DESC,
        c.id DESC
      LIMIT 100
    `)
    .all({
      doctorId,
      consultationId,
      patientIdentifier,
      todayOnly: todayOnly ? 1 : 0,
    });
}

function serializeQuickVisit(row) {
  const bills = db
    .prepare(`
      SELECT *
      FROM billing
      WHERE consultation_id = ?
        AND voided_at IS NULL
      ORDER BY id ASC
    `)
    .all(row.consultation_id)
    .map(parseBillingRow);
  const submissions = db
    .prepare(`
      SELECT id, item_count, amount_added, workflow_status, workflow_note, workflow_updated_at, created_at
      FROM billing_lite_submissions
      WHERE consultation_id = ?
        AND reversed_at IS NULL
      ORDER BY id DESC
    `)
    .all(row.consultation_id);
  const allItems = bills.flatMap((bill) => bill.items || []);
  const consultationFee = allItems.find(isConsultationFee) || null;
  const inventoryItemCount = allItems
    .filter((item) => item.inventory_item_id)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const activeBill = bills.find((bill) => bill.status === "unpaid") || bills[0] || null;
  const completed = bills.length > 0 && bills.every((bill) => bill.status === "paid");
  const submitted = submissions.length > 0 || inventoryItemCount > 0;
  const latestWorkflowStatus = submissions[0]?.workflow_status || "awaiting_operator";
  const submissionStatus = completed ? "completed" : submitted ? latestWorkflowStatus : "ready";

  return {
    consultation_id: Number(row.consultation_id),
    visit_number: formatVisitNumber(row.consultation_id),
    patient_identifier: String(row.patient_identifier || ""),
    patient_name: String(row.patient_name || ""),
    patient_masked_name: maskPatientName(row.patient_name),
    visit_date: row.appointment_date || String(row.consultation_date || "").slice(0, 10),
    visit_time: row.appointment_time || "",
    appointment_status: row.appointment_status,
    consultation_fee: consultationFee
      ? {
          type: consultationFee.description,
          amount: roundCurrency(consultationFee.amount),
          requires_review: bills.some((bill) => Boolean(bill.fee_review_required)),
        }
      : null,
    bill_id: activeBill ? Number(activeBill.id) : null,
    bill_status: activeBill?.status || null,
    bill_total: roundCurrency(bills.reduce((sum, bill) => sum + Number(bill.total_amount || 0), 0)),
    inventory_item_count: inventoryItemCount,
    submission_count: submissions.length,
    submission_status: submissionStatus,
    workflow_note: submissions[0]?.workflow_note || "",
    workflow_updated_at: submissions[0]?.workflow_updated_at || null,
    last_submitted_at: submissions[0]?.created_at || null,
    can_submit: Boolean(activeBill && activeBill.status === "unpaid"),
  };
}

function getQuickVisit(consultationId, doctorId) {
  const row = quickVisitBaseRows(doctorId, { consultationId: Number(consultationId || 0) })[0];
  return row ? serializeQuickVisit(row) : null;
}

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

function recordQuickBillingEvent({
  submissionId,
  consultationId,
  billingId,
  actor = {},
  eventType,
  previousStatus = null,
  nextStatus = null,
  reason = "",
  details = {},
}) {
  db.prepare(`
    INSERT INTO billing_quick_events (
      submission_id, consultation_id, billing_id, actor_user_id, actor_name, actor_role,
      event_type, previous_status, next_status, reason, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    submissionId || null,
    consultationId,
    billingId || null,
    actor.id || null,
    String(actor.full_name || actor.username || ""),
    String(actor.role || ""),
    eventType,
    previousStatus,
    nextStatus,
    String(reason || "").trim(),
    JSON.stringify(details || {}),
  );
}

function validateOperatorInvoice(items, status) {
  if (status !== "unpaid") {
    return "Operators must issue the invoice as unpaid, then record payment through the confirmed payment action.";
  }

  const tariffRows = db
    .prepare("SELECT type_name, default_amount FROM consultation_fee_types")
    .all();
  const tariffs = new Map(
    tariffRows.map((row) => [String(row.type_name), roundCurrency(row.default_amount)]),
  );

  for (const item of items) {
    if (isConsultationFee(item)) {
      const knownType = tariffs.has(String(item.description || "").trim());
      const amount = Number(item.amount);
      if (!knownType || Number(item.quantity) !== 1 || !Number.isFinite(amount) || amount < 0 || amount > 100000) {
        return "Operators must select Day, Night, or Review Consultation and enter a price between Rs 0 and Rs 100,000.";
      }
      continue;
    }

    if (item.type !== "Sale" || item.emergency_override === true) {
      return "Operators can bill sale lines only. Wastage, adjustments, and emergency stock overrides require an authorised clinician or admin.";
    }
    if (!item.inventory_item_id && !String(item.description || "").trim()) {
      return "Every line copied from the paper invoice needs a description.";
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
    const inventoryMovementIds = [];
    if (qtyToDecrement > 0) {
      const consumed = line.type === "Wastage"
        ? consumeAvailableBatch(stockItem.id, line.batch_id, qtyToDecrement)
        : consumeDoctorBatches(stockItem.id, qtyToDecrement);
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
            ? `Clinical wastage: ${line.wastage_reason}`
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
          wastage_reason: actionType === "wastage" ? line.wastage_reason : null,
          selected_batch_id: actionType === "wastage" ? Number(line.batch_id) : null,
          linked_sale_movement_ids: linkedSaleMovementIds,
          linked_sale_credit_qty: qty - qtyToDecrement,
        },
      });
      recordMovementAllocations(movementId, allocations);
      inventoryMovementIds.push(movementId);
    }

    touchedItemIds.add(Number(stockItem.id));

    const computedAmount =
      line.type === "Wastage"
        ? roundCurrency(allocations.reduce(
            (sum, allocation) => sum + Number(allocation.quantity || 0) * Number(allocation.unit_cost || 0),
            0,
          ))
        : line.type === "Adjustment"
          ? roundCurrency(Number(stockItem.cost_price || 0) * qty)
          : roundCurrency(recordedSaleAmount + Number(stockItem.selling_price || 0) * qtyToDecrement);

    processed.push({
      ...line,
      description: line.description || stockItem.item_name,
      amount: computedAmount,
      unit_price: qty > 0 ? roundCurrency(computedAmount / qty) : computedAmount,
      inventory_item_id: Number(stockItem.id),
      linked_sale_movement_ids: linkedSaleMovementIds,
      dispensing_movement_ids: linkedSaleMovementIds,
      inventory_movement_ids: inventoryMovementIds,
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
        COALESCE(NULLIF(b.patient_name_snapshot, ''), p.full_name) AS patient_name,
        COALESCE(NULLIF(b.patient_identifier_snapshot, ''), p.patient_identifier) AS patient_identifier,
        p.deleted_at AS patient_archived_at,
        c.voided_at AS consultation_voided_at,
        COALESCE(NULLIF(b.consultation_date_snapshot, ''), c.consultation_date) AS consultation_date,
        c.appointment_id,
        COALESCE(b.doctor_id_snapshot, c.doctor_id) AS doctor_id,
        COALESCE(NULLIF(b.doctor_name_snapshot, ''), d.full_name) AS doctor_name,
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
  const refunds = db.prepare(`
    SELECT *
    FROM billing_refunds
    WHERE billing_id = ?
    ORDER BY id DESC
  `).all(billId).map((refund) => ({ ...refund, amount: roundCurrency(refund.amount) }));
  const refundedAmount = roundCurrency(refunds.reduce((sum, refund) => sum + refund.amount, 0));
  return {
    ...parsed,
    refunds,
    refunded_amount: refundedAmount,
    refundable_amount: roundCurrency(Math.max(0, Number(parsed.total_amount || 0) - refundedAmount)),
    net_paid_amount: parsed.status === "paid"
      ? roundCurrency(Math.max(0, Number(parsed.total_amount || 0) - refundedAmount))
      : 0,
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

  if (!req.auth.doctor_id || Number(bill.doctor_id) !== Number(req.auth.doctor_id)) {
    return { status: 403, error: "You can only view billing linked to your own consultations." };
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
        b.patient_id AS patient_id,
        COALESCE(NULLIF(MAX(b.patient_name_snapshot), ''), MAX(p.full_name)) AS patient_name,
        COUNT(b.id) AS bill_count,
        COALESCE(SUM(b.total_amount), 0) AS total_billed,
        COALESCE(SUM(CASE WHEN b.status = 'paid' THEN b.total_amount - COALESCE((
          SELECT SUM(r.amount) FROM billing_refunds r WHERE r.billing_id = b.id
        ), 0) ELSE 0 END), 0) AS paid_amount,
        COALESCE(SUM(CASE WHEN b.status = 'paid' THEN COALESCE((
          SELECT SUM(r.amount) FROM billing_refunds r WHERE r.billing_id = b.id
        ), 0) ELSE 0 END), 0) AS refunded_amount,
        COALESCE(SUM(CASE WHEN b.status = 'unpaid' THEN b.total_amount ELSE 0 END), 0) AS unpaid_amount
      FROM patients p
      JOIN billing b ON b.patient_id = p.id
      JOIN consultations c ON c.id = b.consultation_id
      WHERE b.voided_at IS NULL AND c.voided_at IS NULL
        AND (@dateFrom = '' OR ${billingDateSql(req)} >= date(@dateFrom))
        AND (@dateTo = '' OR ${billingDateSql(req)} <= date(@dateTo))
        AND (@reportDoctorId IS NULL OR c.doctor_id = @reportDoctorId)
        ${doctorAccess.clause}
      GROUP BY b.patient_id
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
        COALESCE(NULLIF(b.patient_name_snapshot, ''), p.full_name) AS patient_name,
        COALESCE(NULLIF(b.patient_identifier_snapshot, ''), p.patient_identifier) AS patient_identifier,
        p.deleted_at AS patient_archived_at,
        c.voided_at AS consultation_voided_at,
        COALESCE(NULLIF(b.consultation_date_snapshot, ''), c.consultation_date) AS consultation_date,
        COALESCE(b.doctor_id_snapshot, c.doctor_id) AS doctor_id,
        COALESCE(NULLIF(b.doctor_name_snapshot, ''), d.full_name) AS doctor_name,
        COALESCE((SELECT SUM(r.amount) FROM billing_refunds r WHERE r.billing_id = b.id), 0) AS refunded_amount,
        CASE WHEN b.status = 'paid' THEN b.total_amount - COALESCE((
          SELECT SUM(r.amount) FROM billing_refunds r WHERE r.billing_id = b.id
        ), 0) ELSE 0 END AS net_paid_amount,
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

router.get("/quick/visits", (req, res) => {
  const doctorId = requireQuickBillingDoctor(req, res);
  if (!doctorId) return;

  const visits = quickVisitBaseRows(doctorId, { todayOnly: true }).map(serializeQuickVisit);
  res.json({
    visits,
    tariffs: CONSULTATION_FEES,
    local_date: db.prepare("SELECT date('now', '+4 hours') AS value").get().value,
  });
});

router.get("/quick/picker-options", (req, res) => {
  const doctorId = requireQuickBillingDoctor(req, res);
  if (!doctorId) return;

  const patientMap = new Map();
  const visits = quickVisitBaseRows(doctorId)
    .map((row) => ({ row, visit: serializeQuickVisit(row) }))
    .filter(({ visit }) => visit.can_submit);

  for (const { row, visit } of visits) {
    const patientId = Number(row.patient_id);
    if (!patientMap.has(patientId)) {
      patientMap.set(patientId, {
        patient_id: patientId,
        patient_name: String(row.patient_name || ""),
        patient_identifier: String(row.patient_identifier || ""),
        visits: [],
      });
    }
    patientMap.get(patientId).visits.push(visit);
  }

  const patients = [...patientMap.values()].sort((a, b) =>
    a.patient_name.localeCompare(b.patient_name, undefined, { sensitivity: "base" }),
  );

  res.json({ patients });
});

router.get("/quick/lookup", (req, res) => {
  const doctorId = requireQuickBillingDoctor(req, res);
  if (!doctorId) return;

  const reference = String(req.query.reference || "").trim();
  if (!reference) {
    return res.status(400).json({ error: "Enter an OCS care number or visit number." });
  }

  const consultationId = parseVisitReference(reference);
  const patientIdentifier = consultationId ? "" : normalizeOcsCareNumber(reference);
  if (!consultationId && !patientIdentifier) {
    return res.status(400).json({ error: "Use an OCS care number such as OCS-212 or a visit number such as V-000184." });
  }

  const matches = quickVisitBaseRows(doctorId, {
    consultationId,
    patientIdentifier,
  })
    .slice(0, 6)
    .map(serializeQuickVisit);

  if (!matches.length) {
    return res.status(404).json({
      error: "No visit belonging to your doctor account was found for that reference.",
    });
  }

  res.json({ visits: matches });
});

router.get("/quick/catalog/:consultationId", (req, res) => {
  const doctorId = requireQuickBillingDoctor(req, res);
  if (!doctorId) return;

  const visit = getQuickVisit(Number(req.params.consultationId), doctorId);
  if (!visit) {
    return res.status(404).json({ error: "This visit was not found in your doctor workspace." });
  }
  if (!visit.can_submit) {
    return res.status(409).json({ error: "This visit no longer has an unpaid bill that can receive supplies." });
  }

  const rows = db
    .prepare(`
      SELECT
        i.*,
        COALESCE(f.name, 'Other supplies') AS folder_name,
        f.parent_id,
        COALESCE(parent.name, '') AS parent_folder_name
      FROM inventory i
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      LEFT JOIN inventory_folders parent ON parent.id = f.parent_id
      WHERE i.stock_scope = 'doctor'
        AND i.owner_doctor_id = ?
        AND i.archived_at IS NULL
      ORDER BY COALESCE(parent.name, f.name, ''), f.name, i.item_name
    `)
    .all(doctorId);

  const decorated = decorateInventoryItems(rows);
  const items = decorated.map((item) => ({
    id: Number(item.id),
    item_name: String(item.item_name || ""),
    folder_id: item.folder_id ? Number(item.folder_id) : null,
    category: String(item.parent_folder_name || item.folder_name || "Other supplies"),
    subcategory: String(item.parent_folder_name ? item.folder_name : ""),
    unit: String(item.unit || "unit"),
    selling_price: roundCurrency(item.selling_price),
    available_to_use: Number(item.available_to_promise ?? item.available_to_use ?? 0),
  }));

  res.json({ visit, items });
});

router.get("/quick/unbilled-report", (req, res) => {
  if (!["admin", "operator", "accountant", "doctor"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "You do not have permission to view missing billing." });
  }
  if (req.auth.role === "doctor" && !Number(req.auth.doctor_id || 0)) {
    return res.status(403).json({ error: "Your account is not linked to a doctor profile." });
  }

  const sqlDates = db.prepare(`
    SELECT
      date('now', '+4 hours', '-14 days') AS default_from,
      date('now', '+4 hours', '-1 day') AS default_to,
      date('now', '+4 hours') AS today
  `).get();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const dateFrom = datePattern.test(String(req.query.dateFrom || "")) ? String(req.query.dateFrom) : sqlDates.default_from;
  const dateTo = datePattern.test(String(req.query.dateTo || "")) ? String(req.query.dateTo) : sqlDates.default_to;
  if (dateFrom > dateTo || dateTo >= sqlDates.today) {
    return res.status(400).json({ error: "Missing-billing reports must cover completed days before today." });
  }

  const requestedDoctorId = Number(req.query.doctorId || 0);
  const doctorId = req.auth.role === "doctor"
    ? Number(req.auth.doctor_id)
    : Number.isInteger(requestedDoctorId) && requestedDoctorId > 0
      ? requestedDoctorId
      : null;
  const visits = db.prepare(`
    SELECT
      c.id AS consultation_id,
      c.consultation_date,
      a.appointment_date,
      a.appointment_time,
      p.id AS patient_id,
      p.full_name AS patient_name,
      p.patient_identifier,
      d.id AS doctor_id,
      d.full_name AS doctor_name
    FROM consultations c
    JOIN appointments a ON a.id = c.appointment_id
    JOIN patients p ON p.id = c.patient_id
    JOIN doctors d ON d.id = c.doctor_id
    WHERE c.voided_at IS NULL
      AND p.deleted_at IS NULL
      AND date(COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date)) BETWEEN ? AND ?
      AND (? IS NULL OR c.doctor_id = ?)
    ORDER BY date(COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date)) DESC,
      a.appointment_time DESC, c.id DESC
    LIMIT 500
  `).all(dateFrom, dateTo, doctorId, doctorId);

  const missing = visits.filter((visit) => {
    const bills = db.prepare(`
      SELECT * FROM billing
      WHERE consultation_id = ? AND voided_at IS NULL
      ORDER BY id ASC
    `).all(visit.consultation_id).map(parseBillingRow);
    const hasActiveSubmission = Boolean(db.prepare(`
      SELECT 1 FROM billing_lite_submissions
      WHERE consultation_id = ? AND reversed_at IS NULL
      LIMIT 1
    `).get(visit.consultation_id));
    const hasDocumentedEdit = bills.some((bill) => db.prepare(`
      SELECT 1 FROM billing_events
      WHERE bill_id = ? AND event_type NOT IN ('created', 'migration_baseline')
      LIMIT 1
    `).get(bill.id));
    const hasNonConsultationCharge = bills.some((bill) =>
      (bill.items || []).some((item) => !isConsultationFee(item)),
    );
    const hasFinalBilling = hasActiveSubmission
      || hasDocumentedEdit
      || hasNonConsultationCharge
      || bills.length > 1
      || bills.some((bill) => bill.status === "paid");
    visit.bill_count = bills.length;
    visit.bill_id = bills[0]?.id ? Number(bills[0].id) : null;
    visit.bill_total = roundCurrency(bills.reduce((sum, bill) => sum + Number(bill.total_amount || 0), 0));
    return !hasFinalBilling;
  }).map((visit) => ({
    consultation_id: Number(visit.consultation_id),
    visit_number: formatVisitNumber(visit.consultation_id),
    visit_date: visit.appointment_date || String(visit.consultation_date || "").slice(0, 10),
    visit_time: visit.appointment_time || "",
    patient_name: visit.patient_name,
    patient_id: Number(visit.patient_id),
    patient_identifier: visit.patient_identifier,
    doctor_id: Number(visit.doctor_id),
    doctor_name: visit.doctor_name,
    bill_count: Number(visit.bill_count || 0),
    bill_id: visit.bill_id,
    bill_total: roundCurrency(visit.bill_total),
    status: "missing_final_billing",
  }));

  res.json({ date_from: dateFrom, date_to: dateTo, count: missing.length, visits: missing });
});

router.get("/quick/operator-queue", (req, res) => {
  if (!["admin", "operator"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "The doctor billing review queue is restricted to operators and administrators." });
  }

  const rows = db
    .prepare(`
      SELECT
        s.consultation_id,
        s.billing_id,
        p.full_name AS patient_name,
        p.patient_identifier,
        d.full_name AS doctor_name,
        a.appointment_date,
        a.appointment_time,
        b.total_amount,
        b.status AS bill_status,
        b.fee_review_required,
        SUM(CASE WHEN s.reversed_at IS NULL THEN s.item_count ELSE 0 END) AS supply_item_count,
        SUM(CASE WHEN s.reversed_at IS NULL THEN s.amount_added ELSE 0 END) AS supply_amount,
        MAX(s.created_at) AS submitted_at,
        COUNT(s.id) AS submission_count,
        (
          SELECT latest.id
          FROM billing_lite_submissions latest
          WHERE latest.consultation_id = s.consultation_id
            AND latest.reversed_at IS NULL
          ORDER BY latest.id DESC
          LIMIT 1
        ) AS latest_submission_id,
        (
          SELECT latest.workflow_status
          FROM billing_lite_submissions latest
          WHERE latest.consultation_id = s.consultation_id
            AND latest.reversed_at IS NULL
          ORDER BY latest.id DESC
          LIMIT 1
        ) AS workflow_status,
        (
          SELECT latest.workflow_note
          FROM billing_lite_submissions latest
          WHERE latest.consultation_id = s.consultation_id
            AND latest.reversed_at IS NULL
          ORDER BY latest.id DESC
          LIMIT 1
        ) AS workflow_note
      FROM billing_lite_submissions s
      JOIN consultations c ON c.id = s.consultation_id
      JOIN appointments a ON a.id = c.appointment_id
      JOIN patients p ON p.id = c.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      JOIN billing b ON b.id = s.billing_id
      WHERE c.voided_at IS NULL
        AND b.voided_at IS NULL
        AND s.reversed_at IS NULL
      GROUP BY
        s.consultation_id, s.billing_id, p.full_name, p.patient_identifier,
        d.full_name, a.appointment_date, a.appointment_time,
        b.total_amount, b.status, b.fee_review_required
      ORDER BY
        CASE WHEN b.status = 'unpaid' THEN 0 ELSE 1 END,
        MAX(s.created_at) DESC
      LIMIT 60
    `)
    .all()
    .map((row) => ({
      consultation_id: Number(row.consultation_id),
      submission_id: Number(row.latest_submission_id),
      visit_number: formatVisitNumber(row.consultation_id),
      bill_id: Number(row.billing_id),
      patient_name: row.patient_name,
      patient_identifier: row.patient_identifier,
      doctor_name: row.doctor_name,
      visit_date: row.appointment_date,
      visit_time: row.appointment_time,
      bill_total: roundCurrency(row.total_amount),
      bill_status: row.bill_status,
      fee_review_required: Boolean(row.fee_review_required),
      supply_item_count: Number(row.supply_item_count || 0),
      supply_amount: roundCurrency(row.supply_amount),
      submission_count: Number(row.submission_count || 0),
      submitted_at: row.submitted_at,
      workflow_status: row.bill_status === "paid" ? "completed" : row.workflow_status || "awaiting_operator",
      workflow_note: row.workflow_note || "",
    }));

  res.json({ submissions: rows });
});

router.patch("/quick/operator-queue/:consultationId/status", (req, res) => {
  if (!["admin", "operator"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "Only operators and administrators can update doctor submission status." });
  }

  const consultationId = Number(req.params.consultationId || 0);
  const status = String(req.body?.status || "").trim();
  const note = String(req.body?.note || "").trim().slice(0, 500);
  const allowed = new Set(["awaiting_operator", "needs_doctor", "ready_for_payment"]);
  if (!Number.isInteger(consultationId) || consultationId <= 0 || !allowed.has(status)) {
    return res.status(400).json({ error: "Select a valid doctor billing workflow status." });
  }
  if (status === "needs_doctor" && note.length < 3) {
    return res.status(400).json({ error: "Add a short note explaining what the doctor should clarify." });
  }

  const submission = db.prepare(`
    SELECT *
    FROM billing_lite_submissions
    WHERE consultation_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(consultationId);
  if (!submission) {
    return res.status(404).json({ error: "Doctor billing submission not found." });
  }

  if (submission.reversed_at) {
    return res.status(409).json({ error: "This submission has already been reversed." });
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE billing_lite_submissions
      SET workflow_status = ?,
          workflow_note = ?,
          workflow_updated_by_user_id = ?,
          workflow_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, note, req.auth.id, submission.id);
    recordQuickBillingEvent({
      submissionId: submission.id,
      consultationId,
      billingId: submission.billing_id,
      actor: req.auth,
      eventType: status === "needs_doctor" ? "clarification_requested" : "workflow_status_changed",
      previousStatus: submission.workflow_status,
      nextStatus: status,
      reason: note,
    });
  }).immediate();

  if (status === "needs_doctor") {
    const doctorUserId = getDoctorUserId(submission.doctor_id);
    if (doctorUserId) {
      void sendPushToUser(doctorUserId, {
        title: "Billing clarification needed",
        body: `${formatVisitNumber(consultationId)}: ${note}`,
        url: "/billing",
        icon: "/icon-192.png",
        tag: `billing-clarification-${consultationId}`,
        requireInteraction: true,
      }).catch((error) => {
        console.warn("[quick-billing] doctor clarification push failed:", error?.message || error);
      });
    }
  }

  res.json({ consultation_id: consultationId, workflow_status: status, workflow_note: note });
});

router.get("/quick/submissions", (req, res) => {
  const doctorId = requireQuickBillingDoctor(req, res);
  if (!doctorId) return;

  const rows = db
    .prepare(`
      SELECT
        s.*,
        p.full_name AS patient_name,
        p.patient_identifier,
        a.appointment_date,
        a.appointment_time,
        b.status AS bill_status
      FROM billing_lite_submissions s
      JOIN consultations c ON c.id = s.consultation_id
      JOIN appointments a ON a.id = c.appointment_id
      JOIN patients p ON p.id = c.patient_id
      JOIN billing b ON b.id = s.billing_id
      WHERE s.doctor_id = ?
      ORDER BY s.id DESC
      LIMIT 30
    `)
    .all(doctorId)
    .map((row) => ({
      id: Number(row.id),
      consultation_id: Number(row.consultation_id),
      visit_number: formatVisitNumber(row.consultation_id),
      patient_identifier: String(row.patient_identifier || ""),
      patient_name: String(row.patient_name || ""),
      patient_masked_name: maskPatientName(row.patient_name),
      visit_date: row.appointment_date,
      visit_time: row.appointment_time,
      item_count: Number(row.item_count || 0),
      amount_added: roundCurrency(row.amount_added),
      items: normalizeBillingItems(row.items_json).map((item) => ({
        description: item.description,
        quantity: item.quantity,
        amount: item.amount,
      })),
      submitted_at: row.created_at,
      status: row.bill_status === "paid" ? "completed" : row.workflow_status || "awaiting_operator",
      workflow_note: row.workflow_note || "",
      reversed_at: row.reversed_at || null,
      reversal_reason: row.reversal_reason || "",
    }));

  res.json({ submissions: rows });
});

router.post("/quick/visits/:consultationId/capture", (req, res) => {
  const doctorId = requireQuickBillingDoctor(req, res);
  if (!doctorId) return;

  const consultationId = Number(req.params.consultationId || 0);
  const operationId = String(req.body?.operation_id || "").trim();
  if (!operationId) {
    return res.status(400).json({ error: "A unique submission reference is required." });
  }

  const hasRequestedFee = Boolean(req.body?.consultation_fee && typeof req.body.consultation_fee === "object");
  const requestedFeeType = String(req.body?.consultation_fee?.type || "").trim();
  const requestedFeeAmount = Number(req.body?.consultation_fee?.amount);
  if (hasRequestedFee && !Object.prototype.hasOwnProperty.call(CONSULTATION_FEES, requestedFeeType)) {
    return res.status(400).json({ error: "Select Day, Night, or Review Consultation." });
  }
  if (hasRequestedFee && (!isValidCurrencyAmount(req.body?.consultation_fee?.amount) || requestedFeeAmount > 100000)) {
    return res.status(400).json({ error: "Enter a consultation price between Rs 0 and Rs 100,000 using no more than two decimal places." });
  }

  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (rawItems.length > 40) {
    return res.status(400).json({ error: "A quick billing submission can contain up to 40 different supplies." });
  }

  const mergedQuantities = new Map();
  for (const item of rawItems) {
    const itemId = Number(item?.inventory_item_id || 0);
    const quantity = Number(item?.quantity || 0);
    if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "Every selected supply needs a valid whole-number quantity." });
    }
    mergedQuantities.set(itemId, (mergedQuantities.get(itemId) || 0) + quantity);
  }

  let operation;
  try {
    operation = operationFor(req, `billing:quick-capture:${consultationId}`);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  let result = null;
  let touchedItemIds = [];
  let patientId = null;
  try {
    db.transaction(() => {
      const replay = operation.read();
      if (replay) {
        result = replay;
        return;
      }

      const consultation = getConsultationContext(consultationId);
      if (!consultation || consultation.voided_at || Number(consultation.doctor_id) !== doctorId) {
        throw Object.assign(new Error("This visit does not belong to your doctor account."), { status: 403 });
      }
      patientId = Number(consultation.patient_id);

      const billRow = db
        .prepare(`
          SELECT *
          FROM billing
          WHERE consultation_id = ?
            AND status = 'unpaid'
            AND voided_at IS NULL
          ORDER BY id ASC
          LIMIT 1
        `)
        .get(consultationId);
      if (!billRow) {
        throw Object.assign(new Error("This visit no longer has an unpaid bill that can receive supplies."), { status: 409 });
      }
      const bill = parseBillingRow(billRow);
      if (hasRequestedFee && bill.legacy_fee_review_required) {
        throw Object.assign(new Error("An admin must verify this historical consultation fee before it can be changed."), { status: 409 });
      }
      const existingFeeIndexes = (bill.items || [])
        .map((item, index) => (isConsultationFee(item) ? index : -1))
        .filter((index) => index >= 0);
      if (existingFeeIndexes.length !== 1) {
        throw Object.assign(new Error("This visit needs one valid consultation fee before quick billing can continue."), { status: 409 });
      }
      const feeIndex = existingFeeIndexes[0];
      const previousFee = bill.items[feeIndex];
      const consultationFeeType = hasRequestedFee ? requestedFeeType : String(previousFee.description || "");
      const consultationFeeAmount = hasRequestedFee
        ? roundCurrency(requestedFeeAmount)
        : roundCurrency(previousFee.amount);
      const feeChanged =
        String(previousFee.description || "") !== consultationFeeType ||
        roundCurrency(previousFee.amount) !== consultationFeeAmount;
      const feeConfirmed = hasRequestedFee && Boolean(bill.fee_review_required);
      const baseItems = (bill.items || []).map((item, index) =>
        index === feeIndex
          ? {
              ...item,
              description: consultationFeeType,
              amount: consultationFeeAmount,
              type: "Sale",
              quantity: 1,
              inventory_item_id: null,
              is_consultation_fee: true,
            }
          : item,
      );

      const requestedIds = [...mergedQuantities.keys()];
      let chargeLines = [];
      if (requestedIds.length) {
        const placeholders = requestedIds.map(() => "?").join(",");
        const stockRows = db
          .prepare(`
            SELECT id, item_name, selling_price
            FROM inventory
            WHERE id IN (${placeholders})
              AND stock_scope = 'doctor'
              AND owner_doctor_id = ?
              AND archived_at IS NULL
          `)
          .all(...requestedIds, doctorId);
        if (stockRows.length !== requestedIds.length) {
          throw Object.assign(new Error("One or more selected supplies are no longer available in your bag."), { status: 409 });
        }
        const stockById = new Map(stockRows.map((item) => [Number(item.id), item]));
        chargeLines = requestedIds.map((itemId) => {
          const item = stockById.get(itemId);
          const quantity = mergedQuantities.get(itemId);
          return {
            description: item.item_name,
            amount: roundCurrency(Number(item.selling_price || 0) * quantity),
            type: "Sale",
            quantity,
            inventory_item_id: itemId,
          };
        });
      }

      const applied = applyInventoryTransactions({
        consultation,
        items: chargeLines,
        userId: req.auth.id,
        actor: req.auth,
        billingId: bill.id,
      });
      touchedItemIds = applied.touchedItemIds;
      const addedItems = normalizeBillingItems(applied.items);

      if (addedItems.length || feeChanged || feeConfirmed) {
        const nextItems = normalizeBillingItems([...baseItems, ...addedItems]);
        const updated = db
          .prepare(`
            UPDATE billing
            SET items = ?,
                total_amount = ?,
                consultation_type_snapshot = ?,
                updated_at = CURRENT_TIMESTAMP,
                updated_by_user_id = ?,
                change_reason = ?,
                fee_review_required = CASE WHEN ? = 1 THEN 0 ELSE fee_review_required END
            WHERE id = ?
              AND row_version = ?
              AND status = 'unpaid'
              AND voided_at IS NULL
          `)
          .run(
            JSON.stringify(nextItems),
            calculateBillingTotal(nextItems),
            consultationTypeFromItems(nextItems),
            req.auth.id,
            feeChanged && addedItems.length
              ? "Consultation fee adjusted and supplies captured in quick billing"
              : feeChanged
                ? "Consultation fee adjusted in quick billing"
                : feeConfirmed
                  ? "Consultation fee confirmed in quick billing"
                  : "Supplies captured in quick billing",
            feeConfirmed ? 1 : 0,
            bill.id,
            bill.row_version,
          );
        if (updated.changes !== 1) {
          throw Object.assign(new Error("This bill changed on another device. Reload the visit before submitting again."), { status: 409 });
        }
      }

      const amountAdded = roundCurrency(
        addedItems.reduce((sum, item) => sum + (item.type === "Sale" ? Number(item.amount || 0) : 0), 0),
      );
      const inserted = db
        .prepare(`
          INSERT INTO billing_lite_submissions (
            consultation_id, billing_id, doctor_id, submitted_by_user_id,
            operation_id, item_count, items_json, amount_added
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          consultationId,
          bill.id,
          doctorId,
          req.auth.id,
          operationId,
          addedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          JSON.stringify(addedItems),
          amountAdded,
        );

      recordQuickBillingEvent({
        submissionId: Number(inserted.lastInsertRowid),
        consultationId,
        billingId: bill.id,
        actor: req.auth,
        eventType: "submitted",
        nextStatus: "awaiting_operator",
        details: {
          item_count: addedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          amount_added: amountAdded,
          consultation_fee: {
            previous_type: String(previousFee.description || ""),
            previous_amount: roundCurrency(previousFee.amount),
            type: consultationFeeType,
            amount: consultationFeeAmount,
            changed: feeChanged,
            confirmed: feeConfirmed,
          },
        },
      });

      result = {
        submission_id: Number(inserted.lastInsertRowid),
        bill_id: Number(bill.id),
        amount_added: amountAdded,
        item_count: addedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        consultation_fee: { type: consultationFeeType, amount: consultationFeeAmount, changed: feeChanged },
      };
      operation.save(result);
    }).immediate();
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  for (const itemId of touchedItemIds) {
    try {
      publishInventoryChange({ itemId, changedByUserId: req.auth.id });
    } catch (error) {
      console.warn("[billing-lite] inventory publish failed:", error?.message || error);
    }
  }
  if (patientId) {
    publishPatientDataChange(patientId, { reason: "billing" });
    notifyLinkhamBillingIfNeeded(patientId, req.auth.id);
  }

  res.status(201).json({
    submission: result,
    visit: getQuickVisit(consultationId, doctorId),
  });
});

router.post("/quick/submissions/:submissionId/reverse", (req, res) => {
  const submissionId = Number(req.params.submissionId || 0);
  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return res.status(400).json({ error: "Select a valid billing submission." });
  }
  if (reason.length < 5) {
    return res.status(400).json({ error: "Enter a clear reason for reversing the submitted supplies." });
  }

  const submission = db.prepare(`
    SELECT s.*, c.patient_id, c.doctor_id AS consultation_doctor_id, b.status AS bill_status, b.row_version
    FROM billing_lite_submissions s
    JOIN consultations c ON c.id = s.consultation_id
    JOIN billing b ON b.id = s.billing_id
    WHERE s.id = ? AND c.voided_at IS NULL AND b.voided_at IS NULL
  `).get(submissionId);
  if (!submission) {
    return res.status(404).json({ error: "Billing submission not found." });
  }
  const isOwnerDoctor = req.auth?.role === "doctor"
    && Number(req.auth?.doctor_id || 0) === Number(submission.doctor_id);
  if (!["admin", "operator"].includes(req.auth?.role) && !isOwnerDoctor) {
    return res.status(403).json({ error: "You cannot reverse this doctor billing submission." });
  }
  if (submission.bill_status === "paid") {
    return res.status(409).json({ error: "A paid bill requires the documented admin correction process before stock can be reversed." });
  }

  let operation;
  try {
    operation = operationFor(req, `billing:quick-reverse:${submissionId}`);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  let result;
  let touchedItemIds = [];
  try {
    db.transaction(() => {
      const replay = operation.read();
      if (replay) {
        result = replay;
        return;
      }
      const fresh = db.prepare("SELECT * FROM billing_lite_submissions WHERE id = ?").get(submissionId);
      if (fresh.reversed_at) {
        result = { submission_id: submissionId, reversed: 0, already_reversed: true };
        operation.save(result);
        return;
      }

      const submittedItems = normalizeBillingItems(fresh.items_json);
      const movementIds = submittedItems.flatMap((item) => item.inventory_movement_ids || []);
      const dispensingMovementIds = submittedItems.flatMap((item) => item.dispensing_movement_ids || []);
      if (!movementIds.length && !dispensingMovementIds.length) {
        throw Object.assign(new Error("This submission has no automatically reversible supply movements."), {
          status: 409,
          extra: { code: "SUBMISSION_REVERSAL_REQUIRES_CORRECTION" },
        });
      }
      const reversed = reverseBillingSubmissionInventory({
        movementIds,
        dispensingMovementIds,
        consultationId: fresh.consultation_id,
        billingId: fresh.billing_id,
        actor: req.auth,
        reason,
      });
      touchedItemIds = reversed.touchedItemIds;

      const bill = parseBillingRow(db.prepare("SELECT * FROM billing WHERE id = ?").get(fresh.billing_id));
      const movementIdSet = new Set([...movementIds, ...dispensingMovementIds].map(Number));
      const nextItems = (bill.items || []).filter(
        (item) => ![
          ...(item.inventory_movement_ids || []),
          ...(item.dispensing_movement_ids || []),
        ].some((id) => movementIdSet.has(Number(id))),
      );
      if (nextItems.length === (bill.items || []).length) {
        throw Object.assign(new Error("The submitted supply lines no longer match the unpaid bill. Reopen the bill and use an authorised correction."), {
          status: 409,
          extra: { code: "SUBMISSION_BILL_LINES_CHANGED" },
        });
      }
      const billUpdated = db.prepare(`
        UPDATE billing
        SET items = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP,
            updated_by_user_id = ?, change_reason = ?
        WHERE id = ? AND row_version = ? AND status = 'unpaid' AND voided_at IS NULL
      `).run(
        JSON.stringify(nextItems),
        calculateBillingTotal(nextItems),
        req.auth.id,
        `Reversed quick billing submission #${submissionId}: ${reason}`,
        bill.id,
        bill.row_version,
      );
      if (billUpdated.changes !== 1) {
        throw Object.assign(new Error("The bill changed on another device. Reopen it before reversing supplies."), { status: 409 });
      }

      db.prepare(`
        UPDATE billing_lite_submissions
        SET workflow_status = 'reversed', workflow_note = '',
            reversed_at = CURRENT_TIMESTAMP, reversed_by_user_id = ?, reversal_reason = ?,
            reversal_operation_id = ?, workflow_updated_by_user_id = ?, workflow_updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND reversed_at IS NULL
      `).run(req.auth.id, reason, String(req.body?.operation_id || ""), req.auth.id, submissionId);
      recordQuickBillingEvent({
        submissionId,
        consultationId: fresh.consultation_id,
        billingId: fresh.billing_id,
        actor: req.auth,
        eventType: "supplies_reversed",
        previousStatus: fresh.workflow_status,
        nextStatus: "reversed",
        reason,
        details: {
          movement_ids: movementIds,
          dispensing_movement_ids: dispensingMovementIds,
          reversal_movement_ids: reversed.reversalIds,
          reopened_dispensing_movement_ids: reversed.unlinkedDispensingIds,
        },
      });
      result = {
        submission_id: submissionId,
        reversed: reversed.reversed,
        stock_movements_reversed: reversed.stockMovementsReversed,
        dispensing_links_reopened: reversed.dispensingLinksReopened,
        already_reversed: false,
      };
      operation.save(result);
    }).immediate();
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  for (const itemId of touchedItemIds) {
    try {
      publishInventoryChange({ itemId, changedByUserId: req.auth.id });
    } catch (error) {
      console.warn("[quick-billing] reversal inventory publish failed:", error?.message || error);
    }
  }
  publishPatientDataChange(submission.patient_id, { reason: "billing" });
  res.json(result);
});

router.post("/:id/refunds", (req, res) => {
  if (!["admin", "accountant"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "Only administrators and accountants can issue credit notes." });
  }
  const billId = Number(req.params.id || 0);
  const amount = Number(req.body?.amount);
  const refundMethod = normalizePaymentMethod(req.body?.refund_method);
  const refundDate = String(req.body?.refund_date || "").trim();
  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  const externalReference = normalizeSourceReference(req.body?.external_reference);
  if (!Number.isInteger(billId) || billId <= 0) {
    return res.status(400).json({ error: "Select a valid paid invoice." });
  }
  if (!isValidCurrencyAmount(req.body?.amount) || amount <= 0) {
    return res.status(400).json({ error: "Enter a positive refund amount using no more than two decimal places." });
  }
  if (!PAYMENT_METHODS.has(refundMethod)) {
    return res.status(400).json({ error: "Select the method used to return the money." });
  }
  if (!validPaymentDate(refundDate)) {
    return res.status(400).json({ error: "Enter a valid refund date (YYYY-MM-DD)." });
  }
  if (reason.length < 8) {
    return res.status(400).json({ error: "Document why this refund is being issued." });
  }
  if (externalReference && externalReference.length < 3) {
    return res.status(400).json({ error: "External refund references must contain at least 3 characters." });
  }

  let operation;
  try {
    operation = operationFor(req, `billing:refund:${billId}`);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  let creditNote;
  try {
    db.transaction(() => {
      const replay = operation.read();
      if (replay) {
        creditNote = replay;
        return;
      }
      const bill = db.prepare(`
        SELECT b.*, c.voided_at AS consultation_voided_at
        FROM billing b
        JOIN consultations c ON c.id = b.consultation_id
        WHERE b.id = ?
      `).get(billId);
      if (!bill) throw Object.assign(new Error("Invoice not found."), { status: 404 });
      if (bill.status !== "paid" || bill.voided_at || bill.consultation_voided_at) {
        throw Object.assign(new Error("Credit notes can only be issued against an active paid invoice."), { status: 409 });
      }
      // Recover safely when the first response was lost and a client retries with
      // a newly generated operation id. Exact, same-actor duplicates in this
      // short window are treated as the original credit note, not new money.
      const recentDuplicate = db.prepare(`
        SELECT *
        FROM billing_refunds
        WHERE billing_id = ?
          AND amount = ?
          AND refund_method = ?
          AND refund_date = ?
          AND lower(trim(reason)) = lower(trim(?))
          AND COALESCE(lower(trim(external_reference)), '') = COALESCE(lower(trim(?)), '')
          AND issued_by_user_id = ?
          AND created_at >= datetime('now', '-15 minutes')
        ORDER BY id DESC
        LIMIT 1
      `).get(
        billId,
        roundCurrency(amount),
        refundMethod,
        refundDate,
        reason,
        externalReference || null,
        req.auth.id || null,
      );
      if (recentDuplicate) {
        creditNote = {
          ...recentDuplicate,
          amount: roundCurrency(recentDuplicate.amount),
          inventory_restored: false,
          accounting_note: "This credit note changes net collections only. Stock is not returned automatically.",
        };
        operation.save(creditNote);
        return;
      }
      const alreadyRefunded = roundCurrency(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount
        FROM billing_refunds
        WHERE billing_id = ?
      `).get(billId)?.amount || 0);
      const refundable = roundCurrency(Number(bill.total_amount || 0) - alreadyRefunded);
      if (amount > refundable) {
        throw Object.assign(
          new Error(`Only Rs ${refundable.toFixed(2)} remains refundable on this invoice.`),
          { status: 409, extra: { code: "REFUND_EXCEEDS_BALANCE", refundable_amount: refundable } },
        );
      }
      if (externalReference) {
        const duplicate = db.prepare(`
          SELECT id, credit_note_number
          FROM billing_refunds
          WHERE lower(trim(external_reference)) = lower(trim(?))
          LIMIT 1
        `).get(externalReference);
        if (duplicate) {
          throw Object.assign(
            new Error(`Refund reference ${externalReference} is already attached to ${duplicate.credit_note_number}.`),
            { status: 409, extra: { code: "DUPLICATE_REFUND_REFERENCE" } },
          );
        }
      }
      const nextId = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM billing_refunds").get().id);
      const creditNoteNumber = `OCS-CN-${String(nextId).padStart(8, "0")}`;
      db.prepare(`
        INSERT INTO billing_refunds (
          id, credit_note_number, billing_id, amount, refund_method, refund_date,
          reason, external_reference, issued_by_user_id, issued_by_name,
          issued_by_role, operation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nextId,
        creditNoteNumber,
        billId,
        roundCurrency(amount),
        refundMethod,
        refundDate,
        reason,
        externalReference || null,
        req.auth.id || null,
        String(req.auth.full_name || req.auth.username || ""),
        String(req.auth.role || ""),
        String(req.body.operation_id || ""),
      );
      creditNote = db.prepare("SELECT * FROM billing_refunds WHERE id = ?").get(nextId);
      creditNote = {
        ...creditNote,
        amount: roundCurrency(creditNote.amount),
        inventory_restored: false,
        accounting_note: "This credit note changes net collections only. Stock is not returned automatically.",
      };
      operation.save(creditNote);
    }).immediate();
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("idx_billing_refunds_external_reference")) {
      return res.status(409).json({ error: "That external refund reference has already been used.", code: "DUPLICATE_REFUND_REFERENCE" });
    }
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  const bill = getJoinedBillById(billId);
  publishPatientDataChange(bill.patient_id, { reason: "billing" });
  notifyLinkhamBillingIfNeeded(bill.patient_id, req.auth?.id);
  return res.status(201).json({ credit_note: creditNote, bill });
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
  const decorated = decorateInventoryItems(rows).map((row) => {
    const batches = listAllocatableBatches(row.id).map((batch) => ({
      id: Number(batch.id),
      available: Number(batch.available || 0),
      expiry_date: batch.expiry_date || null,
      is_non_expiring: Boolean(batch.is_non_expiring),
      missing_expiry: Boolean(batch.missing_expiry),
    }));
    return {
      ...row,
      batches,
      quantity: Number(row.on_hand_quantity ?? row.quantity ?? 0),
      available_to_promise: Number(row.available_to_promise ?? row.available_to_use ?? 0),
      expired_quantity: Number(row.expired_quantity || 0),
      quarantined_quantity: Number(row.quarantined_quantity || 0),
      minimum_quantity: Number(row.minimum_quantity || 0),
      selling_price: roundCurrency(row.selling_price),
      cost_price: roundCurrency(row.cost_price),
    };
  });

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
  if (req.auth?.role === "accountant") {
    return res.status(403).json({ error: "Accountants can reconcile payments and issue credit notes, but invoices must be issued by a doctor, operator, or administrator." });
  }
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

  const itemValidationError = billingItemsValidationError(req.body.items);
  if (itemValidationError) return res.status(400).json({ error: itemValidationError });
  const items = normalizeBillingItems(req.body.items);
  try {
    assertNoManualInventoryBypass(consultation, items);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  const status = String(req.body.status ?? "unpaid")
    .trim()
    .toLowerCase();
  if (!["paid", "unpaid"].includes(status)) {
    return res.status(400).json({ error: "Billing status is invalid." });
  }

  const sourceReference = normalizeSourceReference(req.body.source_reference);
  if (sourceReference && sourceReference.length < 3) {
    return res.status(400).json({ error: "Enter a source reference with at least 3 characters." });
  }

  if (req.auth.role === "operator") {
    if (sourceReference.length < 3) {
      return res.status(400).json({
        error: "Enter the OCS paper invoice number or photo reference before issuing this invoice.",
      });
    }
    const operatorIssueError = validateOperatorInvoice(items, status);
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
      if (sourceReference) {
        const duplicate = db.prepare(`
          SELECT id, invoice_number
          FROM billing
          WHERE lower(trim(source_reference)) = lower(trim(?))
          LIMIT 1
        `).get(sourceReference);
        if (duplicate) {
          throw Object.assign(
            new Error(`Source reference ${sourceReference} is already attached to ${duplicate.invoice_number || `bill #${duplicate.id}`}.`),
            { status: 409, extra: { code: "DUPLICATE_SOURCE_REFERENCE", bill_id: duplicate.id } },
          );
        }
      }
      assertSingleVisitFee(db, consultationId, items);
      // Insert a placeholder bill first so the linkage helper has a billing
      // id to stamp onto any matched Sale movements. Items + total are
      // computed inside the same transaction below so callers never observe
      // the empty row.
      const snapshot = getBillingIssueSnapshot(current, items, req.auth);
      const inserted = db.prepare(`
        INSERT INTO billing (
          consultation_id,
          patient_id,
          items,
          total_amount,
          status,
          payment_method,
          payment_date,
          updated_by_user_id,
          change_reason,
          source_reference,
          issued_at,
          issued_by_user_id,
          issued_by_name,
          issued_by_role,
          patient_identifier_snapshot,
          patient_name_snapshot,
          doctor_id_snapshot,
          doctor_name_snapshot,
          consultation_date_snapshot,
          consultation_type_snapshot,
          partner_category_snapshot
        )
        VALUES (?, ?, '[]', 0, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        consultationId,
        patientId,
        "unpaid",
        null,
        null,
        req.auth.id,
        req.auth.role === "operator"
          ? `Paper invoice: ${sourceReference}`
          : "",
        sourceReference || null,
        snapshot.issuedByUserId,
        snapshot.issuedByName,
        snapshot.issuedByRole,
        snapshot.patientIdentifier,
        snapshot.patientName,
        snapshot.doctorId,
        snapshot.doctorName,
        snapshot.consultationDate,
        snapshot.consultationType,
        snapshot.partnerCategory,
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

      if (status === "paid") assertVisitReadyForPayment(db, consultationId);
      db.prepare(`
        UPDATE billing
        SET items = ?, total_amount = ?, status = ?, payment_method = ?, payment_date = ?
        WHERE id = ?
      `).run(
        JSON.stringify(computedItems),
        calculateBillingTotal(computedItems),
        status,
        paymentMethod,
        paymentDate,
        createdId,
      );
      operation.save({ billId: createdId });
    }).immediate();
  } catch (error) {
    if (String(error?.message || "").includes("idx_billing_source_reference_unique")) {
      return res.status(409).json({
        error: "That paper invoice or source reference has already been used.",
        code: "DUPLICATE_SOURCE_REFERENCE",
      });
    }
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
  const billId = Number(req.params.id);
  const existing = getJoinedBillById(billId);
  const accessError = ensureBillAccess(req, existing, { write: true });

  if (accessError) {
    return res.status(accessError.status).json({ error: accessError.error });
  }

  const itemValidationError = billingItemsValidationError(req.body.items);
  if (itemValidationError) return res.status(400).json({ error: itemValidationError });
  const items = normalizeBillingItems(req.body.items);
  if (req.auth.role === "operator") {
    const requestedStatus = String(req.body.status ?? existing.status).trim().toLowerCase();
    if (requestedStatus !== existing.status) {
      return res.status(403).json({ error: "Use the confirmed payment action to record payment." });
    }
    const operatorEditError = validateOperatorInvoice(items, existing.status);
    if (operatorEditError) {
      return res.status(403).json({ error: operatorEditError });
    }
    if (String(req.body.correction_reason || "").trim().length < 8) {
      return res.status(400).json({ error: "Document the paper invoice reference or reason for this correction." });
    }
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
  const requestedStatus = String(req.body.status ?? existing.status).trim().toLowerCase();
  if (existing.status === "paid") {
    if (requestedStatus !== "paid") {
      return res.status(409).json({ error: "A paid invoice cannot be changed back to unpaid. Issue a credit note for money returned." });
    }
    if (JSON.stringify(normalizeBillingItems(items)) !== JSON.stringify(normalizeBillingItems(existing.items))) {
      return res.status(409).json({ error: "Paid invoice lines are immutable. Use a credit note and a separate adjustment invoice." });
    }
  }
  try {
    assertNoManualInventoryBypass(existing, items);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }
  const preservedItems = items.filter(i => !i.inventory_item_id).concat(existing.items.filter(i => i.inventory_item_id));
  const status = requestedStatus;
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
      consultation_type_snapshot = ?,
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
    consultationTypeFromItems(preservedItems),
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
      const result = db.prepare(`
    UPDATE billing
    SET status = 'paid',
        change_reason = 'Payment recorded',
        payment_method = ?,
        payment_date = ?,
        updated_at = CURRENT_TIMESTAMP,
        updated_by_user_id = ?
    WHERE id = ? AND row_version = ? AND voided_at IS NULL
  `).run(paymentMethod, paymentDate, req.auth?.id || null, billId, existing.row_version);
      if (result.changes === 1) {
        const quickSubmission = db.prepare(`
          SELECT * FROM billing_lite_submissions
          WHERE consultation_id = ? AND reversed_at IS NULL
          ORDER BY id DESC LIMIT 1
        `).get(existing.consultation_id);
        db.prepare(`
          UPDATE billing_lite_submissions
          SET workflow_status = 'completed',
              workflow_note = '',
              workflow_updated_by_user_id = ?,
              workflow_updated_at = CURRENT_TIMESTAMP
          WHERE id = (
            SELECT id
            FROM billing_lite_submissions
            WHERE consultation_id = ?
            ORDER BY id DESC
            LIMIT 1
          )
        `).run(req.auth?.id || null, existing.consultation_id);
        if (quickSubmission) {
          recordQuickBillingEvent({
            submissionId: quickSubmission.id,
            consultationId: existing.consultation_id,
            billingId: billId,
            actor: req.auth,
            eventType: "payment_completed",
            previousStatus: quickSubmission.workflow_status,
            nextStatus: "completed",
            reason: "Payment recorded",
          });
        }
      }
      return result;
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
