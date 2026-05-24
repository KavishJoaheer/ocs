const { db } = require("../db");

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

module.exports = {
  LINKAGE_WINDOW_DAYS,
  findUnbilledSaleCredit,
  markSaleMovementsBilled,
  unlinkSaleMovementsForBills,
};
