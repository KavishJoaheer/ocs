const { db } = require("../db");
const {
  calculateBillingTotal,
  getTodayLocal,
  normalizeBillingItems,
  offsetLocalDate,
} = require("./utils");

// How far back we will look when trying to match a freshly-created bill
// against an earlier "Sale" stock-out the doctor logged from the field. A
// week is generous enough to cover normal admin lag but short enough to
// avoid accidental matches to historical entries.
const LINKAGE_WINDOW_DAYS = 7;

/**
 * Find unbilled "Sale" stock-out movements that can be credited against a
 * new billing line so the doctor's bag is not decremented twice.
 *
 * Matching is strict: same item, same patient, same doctor, billing_status
 * still "Pending Manual Entry", created within LINKAGE_WINDOW_DAYS. We only
 * consume whole movements (no partial credits) to keep the audit trail
 * unambiguous; any leftover quantity is decremented by the bill normally.
 *
 * @param {{ itemId: number, patientId: number, doctorId: number, maxQty: number }} args
 * @returns {{ matched: Array<{ id: number, quantity: number, meta_json: string }>, consumedQty: number }}
 */
function findUnbilledSaleCredit({ itemId, patientId, doctorId, maxQty }) {
  const item = Number(itemId || 0);
  const patient = Number(patientId || 0);
  const doctor = Number(doctorId || 0);
  const cap = Number(maxQty || 0);

  if (!item || !patient || !doctor || cap <= 0) {
    return { matched: [], consumedQty: 0 };
  }

  const candidates = db
    .prepare(
      `
        SELECT id, quantity, meta_json
        FROM inventory_movements
        WHERE item_id = ?
          AND movement_type = 'out'
          AND action_type = 'stock_out'
          AND json_extract(meta_json, '$.stock_out_reason') = 'Sale'
          AND CAST(json_extract(meta_json, '$.patient_id') AS INTEGER) = ?
          AND CAST(json_extract(meta_json, '$.doctor_id') AS INTEGER) = ?
          AND json_extract(meta_json, '$.billing_status') = 'Pending Manual Entry'
          AND datetime(created_at) >= datetime('now', ?)
        ORDER BY datetime(created_at) ASC, id ASC
      `,
    )
    .all(item, patient, doctor, `-${LINKAGE_WINDOW_DAYS} days`);

  const matched = [];
  let consumedQty = 0;

  for (const row of candidates) {
    const qty = Number(row.quantity || 0);
    if (qty <= 0) continue;
    if (consumedQty + qty > cap) {
      // Skip partial consumption — the bill will decrement the gap itself.
      break;
    }
    matched.push(row);
    consumedQty += qty;
    if (consumedQty === cap) {
      break;
    }
  }

  return { matched, consumedQty };
}

function markSaleMovementsBilled(movementRows, billingId) {
  if (!Array.isArray(movementRows) || movementRows.length === 0) return [];

  const billedAt = new Date().toISOString();
  const stmt = db.prepare("UPDATE inventory_movements SET meta_json = ? WHERE id = ?");
  const ids = [];

  for (const row of movementRows) {
    let meta;
    try {
      meta = JSON.parse(row.meta_json || "{}");
    } catch {
      meta = {};
    }
    meta.billing_status = "Billed";
    meta.billing_id = Number(billingId) || null;
    meta.billed_at = billedAt;
    stmt.run(JSON.stringify(meta), row.id);
    ids.push(Number(row.id));
  }

  return ids;
}

/**
 * Reverse the linkage between Sale stock-outs and a set of billing rows
 * that are about to be deleted. The bag stock itself stays decremented (the
 * doctor really did dispense the item) — we only flip billing_status back
 * to "Pending Manual Entry" so the next bill in the linkage window can pick
 * the credit up again.
 *
 * @param {number[]} billingIds
 * @returns {number} number of movements relinked
 */
function unlinkSaleMovementsForBills(billingIds) {
  const ids = (billingIds || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return 0;

  const placeholders = ids.map(() => "?").join(", ");
  const candidates = db
    .prepare(
      `
        SELECT id, meta_json
        FROM inventory_movements
        WHERE movement_type = 'out'
          AND action_type = 'stock_out'
          AND json_extract(meta_json, '$.stock_out_reason') = 'Sale'
          AND CAST(json_extract(meta_json, '$.billing_id') AS INTEGER) IN (${placeholders})
      `,
    )
    .all(...ids);

  if (!candidates.length) return 0;

  const stmt = db.prepare("UPDATE inventory_movements SET meta_json = ? WHERE id = ?");
  let relinked = 0;

  for (const row of candidates) {
    let meta;
    try {
      meta = JSON.parse(row.meta_json || "{}");
    } catch {
      meta = {};
    }
    meta.billing_status = "Pending Manual Entry";
    delete meta.billing_id;
    delete meta.billed_at;
    stmt.run(JSON.stringify(meta), row.id);
    relinked += 1;
  }

  return relinked;
}

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

function findOpenBillForSale({ patientId, doctorId }) {
  const patient = Number(patientId || 0);
  const doctor = Number(doctorId || 0);
  if (!patient || !doctor) return null;

  const today = getTodayLocal();
  const windowStart = offsetLocalDate(-LINKAGE_WINDOW_DAYS);

  return (
    db
      .prepare(
        `
          SELECT
            b.id,
            b.items,
            b.status,
            b.consultation_id,
            c.consultation_date
          FROM billing b
          JOIN consultations c ON c.id = b.consultation_id
          JOIN patients p ON p.id = b.patient_id
          WHERE b.patient_id = ?
            AND c.doctor_id = ?
            AND lower(b.status) = 'unpaid'
            AND p.deleted_at IS NULL
            AND date(c.consultation_date) >= date(?)
            AND date(c.consultation_date) <= date(?)
          ORDER BY
            CASE WHEN date(c.consultation_date) = date(?) THEN 0 ELSE 1 END ASC,
            date(c.consultation_date) DESC,
            b.id DESC
          LIMIT 1
        `,
      )
      .get(patient, doctor, windowStart, today, today) || null
  );
}

function appendInventorySaleLineToBill({ billId, item, quantity, movementId }) {
  const id = Number(billId || 0);
  const qty = Number(quantity || 0);
  const inventoryItemId = Number(item?.id || item?.inventory_item_id || 0);
  const movement = Number(movementId || 0);

  if (!id || !inventoryItemId || !Number.isInteger(qty) || qty <= 0 || !movement) {
    return { attached: false, reason: "invalid_args" };
  }

  const bill = db.prepare("SELECT id, items, status FROM billing WHERE id = ?").get(id);
  if (!bill || String(bill.status || "").toLowerCase() !== "unpaid") {
    return { attached: false, reason: "no_unpaid_bill" };
  }

  const unitPrice = roundCurrency(Number(item?.selling_price || 0));
  const description = String(item?.item_name || item?.description || "").trim();
  const items = normalizeBillingItems(bill.items);
  const existingIndex = items.findIndex(
    (line) =>
      Number(line.inventory_item_id) === inventoryItemId &&
      line.type === "Sale" &&
      Number(line.quantity) > 0,
  );

  if (existingIndex >= 0) {
    const nextQty = Number(items[existingIndex].quantity) + qty;
    items[existingIndex] = {
      ...items[existingIndex],
      quantity: nextQty,
      amount: roundCurrency(unitPrice * nextQty),
      description: items[existingIndex].description || description,
    };
  } else {
    items.push({
      description,
      amount: roundCurrency(unitPrice * qty),
      type: "Sale",
      quantity: qty,
      inventory_item_id: inventoryItemId,
      emergency_override: false,
      appointment_id: null,
    });
  }

  db.prepare(
    `
      UPDATE billing
      SET items = ?, total_amount = ?
      WHERE id = ?
    `,
  ).run(JSON.stringify(items), calculateBillingTotal(items), id);

  const movementRow = db
    .prepare("SELECT id, meta_json FROM inventory_movements WHERE id = ?")
    .get(movement);
  if (movementRow) {
    markSaleMovementsBilled([movementRow], id);
  }

  return { attached: true, billingId: id };
}

/**
 * After a doctor Sale deduct, add quantity × selling price to the patient's
 * latest unpaid consultation bill (without deducting bag stock again).
 * If no unpaid bill exists yet, the movement stays Pending Manual Entry and
 * is picked up when the consultation bill is created.
 */
function attachSaleDeductToPatientBill({ patientId, doctorId, item, quantity, movementId }) {
  const movement = db
    .prepare("SELECT id, meta_json FROM inventory_movements WHERE id = ?")
    .get(Number(movementId || 0));
  if (!movement) {
    return { attached: false, reason: "missing_movement" };
  }

  let meta = {};
  try {
    meta = JSON.parse(movement.meta_json || "{}");
  } catch {
    meta = {};
  }
  if (String(meta.billing_status || "") === "Billed") {
    return {
      attached: true,
      billingId: Number(meta.billing_id) || null,
      reason: "already_billed",
    };
  }

  const bill = findOpenBillForSale({ patientId, doctorId });
  if (!bill) {
    return { attached: false, reason: "no_unpaid_bill" };
  }

  return appendInventorySaleLineToBill({
    billId: bill.id,
    item,
    quantity,
    movementId: movement.id,
  });
}

/**
 * When a consultation bill is created (or already exists unpaid), fold in any
 * field Sale deducts that are still waiting for a billing line.
 */
function attachPendingSalesToConsultationBill(consultationId, billId) {
  const consultation = db
    .prepare("SELECT id, patient_id, doctor_id FROM consultations WHERE id = ?")
    .get(Number(consultationId || 0));
  if (!consultation) {
    return { attached: 0 };
  }

  const bill = db.prepare("SELECT id, status FROM billing WHERE id = ?").get(Number(billId || 0));
  if (!bill || String(bill.status || "").toLowerCase() !== "unpaid") {
    return { attached: 0 };
  }

  const pending = db
    .prepare(
      `
        SELECT
          m.id,
          m.quantity,
          m.item_id,
          i.item_name,
          i.selling_price
        FROM inventory_movements m
        JOIN inventory i ON i.id = m.item_id
        WHERE m.movement_type = 'out'
          AND m.action_type = 'stock_out'
          AND json_extract(m.meta_json, '$.stock_out_reason') = 'Sale'
          AND CAST(json_extract(m.meta_json, '$.patient_id') AS INTEGER) = ?
          AND CAST(json_extract(m.meta_json, '$.doctor_id') AS INTEGER) = ?
          AND json_extract(m.meta_json, '$.billing_status') = 'Pending Manual Entry'
          AND datetime(m.created_at) >= datetime('now', ?)
        ORDER BY datetime(m.created_at) ASC, m.id ASC
      `,
    )
    .all(
      Number(consultation.patient_id),
      Number(consultation.doctor_id),
      `-${LINKAGE_WINDOW_DAYS} days`,
    );

  let attached = 0;
  for (const row of pending) {
    const result = appendInventorySaleLineToBill({
      billId: bill.id,
      item: {
        id: row.item_id,
        item_name: row.item_name,
        selling_price: row.selling_price,
      },
      quantity: row.quantity,
      movementId: row.id,
    });
    if (result.attached) {
      attached += 1;
    }
  }

  return { attached, billingId: Number(bill.id) };
}

module.exports = {
  LINKAGE_WINDOW_DAYS,
  findUnbilledSaleCredit,
  markSaleMovementsBilled,
  unlinkSaleMovementsForBills,
  findOpenBillForSale,
  attachSaleDeductToPatientBill,
  attachPendingSalesToConsultationBill,
};
