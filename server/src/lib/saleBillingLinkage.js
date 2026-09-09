const { db } = require("../db");
const {
  calculateBillingTotal,
  getTodayLocal,
  normalizeBillingItems,
} = require("./utils");

// Kept as an exported compatibility constant; billing linkage no longer expires.
const LINKAGE_WINDOW_DAYS = 7;
const parse = value => { try { return JSON.parse(value || '{}'); } catch { return {}; } };
function pendingSales({patientId, doctorId, itemId = null}) {
  return db.prepare(`SELECT m.*, i.item_name FROM inventory_movements m JOIN inventory i ON i.id=m.item_id
    WHERE m.movement_type='out' AND m.action_type='stock_out'
      AND json_extract(m.meta_json, '$.stock_out_reason')='Sale'
      AND CAST(json_extract(m.meta_json, '$.patient_id') AS INTEGER)=?
      AND CAST(json_extract(m.meta_json, '$.doctor_id') AS INTEGER)=?
      AND json_extract(m.meta_json, '$.billing_status')='Pending Manual Entry'
      AND (? IS NULL OR m.item_id=?)
      AND NOT EXISTS (SELECT 1 FROM inventory_movements r WHERE json_extract(r.meta_json,'$.reversed_movement_id')=m.id)
    ORDER BY m.created_at, m.id`).all(patientId, doctorId, itemId, itemId);
}
function matchesVisit(row, consultation) {
  const meta = parse(row.meta_json);
  if (meta.consultation_id) return Number(meta.consultation_id) === Number(consultation.id);
  if (meta.appointment_id) return Number(meta.appointment_id) === Number(consultation.appointment_id);
  const day = meta.dispensed_on || db.prepare("SELECT date(?,'+4 hours') AS day").get(row.created_at).day;
  if (day !== String(consultation.consultation_date).slice(0,10)) return false;
  const visits = db.prepare(`SELECT COUNT(*) AS n FROM consultations WHERE patient_id=? AND doctor_id=?
    AND date(consultation_date)=date(?) AND voided_at IS NULL`).get(consultation.patient_id, consultation.doctor_id, day);
  return visits.n === 1;
}
function linkageError(message) {
  return Object.assign(new Error(message), {status:409, extra:{code:'DISPENSING_REVIEW_REQUIRED'}});
}
function findUnbilledSaleCredit({ itemId, patientId, doctorId, maxQty, consultationId, movementIds = [] }) {
  const candidates = pendingSales({patientId, doctorId, itemId});
  const consultation = db.prepare('SELECT * FROM consultations WHERE id=?').get(consultationId || 0);
  const explicit = movementIds.length > 0;
  if (new Set(movementIds).size !== movementIds.length) throw linkageError('Select each dispensing record once.');
  let matched = explicit ? candidates.filter(r => movementIds.includes(r.id))
    : candidates.filter(r => consultation && matchesVisit(r, consultation));
  if (explicit && matched.length !== movementIds.length) throw linkageError('A selected dispensing record is already billed or does not belong to this patient, doctor and item. Reload billing.');
  if (explicit && matched.some(r => {
    const meta = parse(r.meta_json);
    return (meta.consultation_id && Number(meta.consultation_id) !== Number(consultationId))
      || (meta.appointment_id && Number(meta.appointment_id) !== Number(consultation?.appointment_id));
  })) throw linkageError('The selected dispensing belongs to another visit. Review that visit before billing.');
  if (!explicit && candidates.length && !matched.length) throw linkageError('Unbilled dispensing exists for this item. Select its original dispensing record before billing; stock has not been deducted again.');
  const consumedQty = matched.reduce((n,r)=>n+Number(r.quantity),0);
  if (consumedQty > maxQty) throw linkageError('The quantity is smaller than the original dispensing. Select the complete dispensing record or ask an admin to reconcile it.');
  return {matched, consumedQty, recordedAmount: matched.reduce((n,r)=>n+Number(r.quantity)*Number(r.unit_price_snapshot),0)};
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
    meta.consultation_id = db.prepare('SELECT consultation_id FROM billing WHERE id=?').get(billingId)?.consultation_id || meta.consultation_id;
    meta.billed_at = billedAt;
    stmt.run(JSON.stringify(meta), row.id);
    ids.push(Number(row.id));
  }

  return ids;
}

/**
 * Reverse the linkage between Sale stock-outs and a set of billing rows
 * that are about to be voided. The bag stock itself stays decremented (the
 * doctor really did dispense the item) — we only flip billing_status back
 * to "Pending Manual Entry" for explicit visit reconciliation.
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

function findOpenBillForSale({ patientId, doctorId, consultationId = null, dispensedOn = null }) {
  const day = dispensedOn || getTodayLocal();
  const visits = db.prepare(`SELECT * FROM consultations WHERE patient_id=? AND doctor_id=? AND voided_at IS NULL
    AND ((? IS NOT NULL AND id=?) OR (? IS NULL AND date(consultation_date)=date(?)))`)
    .all(patientId, doctorId, consultationId, consultationId, consultationId, day);
  if (visits.length !== 1) return null;
  return db.prepare("SELECT * FROM billing WHERE consultation_id=? AND status='unpaid' AND voided_at IS NULL ORDER BY id LIMIT 1").get(visits[0].id) || null;
}

function appendInventorySaleLineToBill({ billId, item, quantity, movementId }) {
  const id = Number(billId || 0);
  const qty = Number(quantity || 0);
  const inventoryItemId = Number(item?.id || item?.inventory_item_id || 0);
  const movement = Number(movementId || 0);

  if (!id || !inventoryItemId || !Number.isInteger(qty) || qty <= 0 || !movement) {
    return { attached: false, reason: "invalid_args" };
  }

  const bill = db.prepare("SELECT id, items, status, voided_at FROM billing WHERE id = ?").get(id);
  if (!bill || bill.voided_at || String(bill.status || "").toLowerCase() !== "unpaid") {
    return { attached: false, reason: "no_unpaid_bill" };
  }

  const sale = db.prepare('SELECT unit_price_snapshot, meta_json FROM inventory_movements WHERE id=?').get(movement);
  if (parse(sale?.meta_json).billing_status === 'Billed') return {attached:true,billingId:id,reason:'already_billed'};
  const unitPrice = Number(sale?.unit_price_snapshot ?? item?.selling_price ?? 0);
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
      dispensing_movement_ids: [...(items[existingIndex].dispensing_movement_ids || []), movement],
      amount: roundCurrency(Number(items[existingIndex].amount || 0) + unitPrice * qty),
      description: items[existingIndex].description || description,
    };
  } else {
    items.push({
      description,
      amount: roundCurrency(unitPrice * qty),
      type: "Sale",
      quantity: qty,
      dispensing_movement_ids: [movement],
      inventory_item_id: inventoryItemId,
      emergency_override: false,
      appointment_id: null,
    });
  }

  db.prepare(
    `
      UPDATE billing
      SET items = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP,
        updated_by_user_id = (SELECT recorded_by_user_id FROM inventory_movements WHERE id = ?),
        change_reason = 'Inventory sale attached to unpaid bill'
      WHERE id = ?
    `,
  ).run(JSON.stringify(items), calculateBillingTotal(items), movement, id);

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
 * unambiguous visit's unpaid bill (without deducting bag stock again).
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

  const bill = findOpenBillForSale({ patientId, doctorId, consultationId:meta.consultation_id || null, dispensedOn:meta.dispensed_on || null });
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
    .prepare("SELECT * FROM consultations WHERE id = ?")
    .get(Number(consultationId || 0));
  if (!consultation) {
    return { attached: 0 };
  }

  const bill = db.prepare("SELECT id, status, voided_at FROM billing WHERE id = ?").get(Number(billId || 0));
  if (!bill || bill.voided_at || String(bill.status || "").toLowerCase() !== "unpaid") {
    return { attached: 0 };
  }

  const pending = pendingSales({patientId:consultation.patient_id,doctorId:consultation.doctor_id})
    .filter(row => matchesVisit(row, consultation));

  let attached = 0;
  for (const row of pending) {
    const result = appendInventorySaleLineToBill({
      billId: bill.id,
      item: {
        id: row.item_id,
        item_name: row.item_name,
        selling_price: row.unit_price_snapshot,
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
  pendingSales,
  matchesVisit,
  findUnbilledSaleCredit,
  markSaleMovementsBilled,
  unlinkSaleMovementsForBills,
  findOpenBillForSale,
  attachSaleDeductToPatientBill,
  attachPendingSalesToConsultationBill,
};
