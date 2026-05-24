const { db } = require("../db");
const { publishInventoryChange } = require("./inventoryRealtime");
const { unlinkSaleMovementsForBills } = require("./saleBillingLinkage");

function restoreBatch(itemId, quantity, expiryDate, unitCost) {
  if (quantity <= 0) return;
  db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost)
    VALUES (?, ?, ?, ?)
  `).run(itemId, quantity, expiryDate || null, Number(unitCost || 0));
}

function reverseInventoryForConsultation(consultationId, actor = {}) {
  const consultation = db
    .prepare("SELECT id, appointment_id FROM consultations WHERE id = ?")
    .get(consultationId);
  if (!consultation) {
    return { reversed: 0 };
  }

  // Any Sale movements that were "absorbed" into bills for this
  // consultation need to flip back to Pending Manual Entry so the next
  // bill in the linkage window can pick them up. The bag stays decremented
  // because the doctor really did dispense the item — only the linkage is
  // undone.
  const billIds = db
    .prepare("SELECT id FROM billing WHERE consultation_id = ?")
    .all(consultationId)
    .map((row) => Number(row.id))
    .filter(Boolean);
  if (billIds.length > 0) {
    unlinkSaleMovementsForBills(billIds);
  }

  const movements = db
    .prepare(`
      SELECT m.*
      FROM inventory_movements m
      WHERE m.movement_type = 'out'
        AND (
          CAST(json_extract(m.meta_json, '$.consultation_id') AS INTEGER) = ?
          OR (
            m.reference_type = 'appointment'
            AND ? > 0
            AND m.reference_id = ?
          )
        )
    `)
    .all(consultationId, Number(consultation.appointment_id || 0), Number(consultation.appointment_id || 0));

  if (!movements.length) {
    return { reversed: 0 };
  }

  let reversed = 0;
  const touchedItemIds = new Set();
  for (const movement of movements) {
    const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(movement.item_id);
    if (!item) continue;

    const qty = Number(movement.quantity || 0);
    if (qty <= 0) continue;

    const previousQuantity = Number(item.quantity || 0);
    const nextQuantity = previousQuantity + qty;

    restoreBatch(item.id, qty, item.expiry_date, item.cost_price);
    touchedItemIds.add(Number(item.id));
    db.prepare(`
      UPDATE inventory
      SET quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextQuantity, item.id);

    db.prepare(`
      INSERT INTO inventory_movements (
        item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
        recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
      )
      VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'reversal', 'consultation', ?, ?)
    `).run(
      item.id,
      qty,
      previousQuantity,
      nextQuantity,
      item.owner_doctor_id || null,
      actor.id || null,
      `Stock restored after consultation #${consultationId} was deleted.`,
      consultationId,
      JSON.stringify({
        consultation_id: consultationId,
        reversed_movement_id: movement.id,
        performed_by_user_id: actor.id || null,
        performed_by_role: actor.role || "",
        performed_by_name: actor.full_name || actor.username || "",
      }),
    );

    reversed += 1;
  }

  const movementIds = movements.map((row) => row.id);
  db.prepare(`
    DELETE FROM inventory_activity_history
    WHERE movement_id IN (${movementIds.map(() => "?").join(", ")})
  `).run(...movementIds);
  db.prepare(`
    DELETE FROM inventory_movements
    WHERE id IN (${movementIds.map(() => "?").join(", ")})
  `).run(...movementIds);

  for (const itemId of touchedItemIds) {
    try {
      publishInventoryChange({ itemId, changedByUserId: actor?.id || null });
    } catch (error) {
      console.warn("[inventoryReversal] publishInventoryChange failed:", error?.message || error);
    }
  }

  return { reversed };
}

module.exports = {
  reverseInventoryForConsultation,
};
