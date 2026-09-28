"use strict";

const { db } = require("../db");

function roundCost(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Number(amount.toFixed(2));
}

function applyKnownCostToUnpricedDoctorBags(itemName, costPrice) {
  const name = String(itemName || "").trim();
  const cost = roundCost(costPrice);
  if (!name || !(cost > 0)) return [];

  const bags = db.prepare(`
    UPDATE inventory
    SET cost_price = ?,
        row_version = COALESCE(row_version, 1) + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE stock_scope = 'doctor'
      AND owner_doctor_id IS NOT NULL
      AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      AND COALESCE(cost_price, 0) <= 0
    RETURNING id
  `).all(cost, name);

  db.prepare(`
    UPDATE inventory_batches
    SET unit_cost = ?,
        row_version = COALESCE(row_version, 1) + 1
    WHERE COALESCE(unit_cost, 0) <= 0
      AND quantity_remaining > 0
      AND item_id IN (
        SELECT id FROM inventory
        WHERE stock_scope = 'doctor'
          AND owner_doctor_id IS NOT NULL
          AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      )
  `).run(cost, name);

  return bags.map((row) => Number(row.id));
}

function renameDoctorBagCatalogue(oldName, newName) {
  const from = String(oldName || "").trim();
  const to = String(newName || "").trim();
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return [];

  const rows = db.prepare(`
    SELECT id, owner_doctor_id, quantity, cost_price, selling_price, archived_at
    FROM inventory
    WHERE stock_scope = 'doctor'
      AND owner_doctor_id IS NOT NULL
      AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
  `).all(from);
  const touched = [];

  for (const row of rows) {
    if (row.archived_at) {
      db.prepare(`
        UPDATE inventory
        SET item_name = ?,
            row_version = COALESCE(row_version, 1) + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(to, row.id);
      touched.push(Number(row.id));
      continue;
    }

    const collision = db.prepare(`
      SELECT id, quantity, cost_price, selling_price
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND archived_at IS NULL
        AND id != ?
        AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
    `).get(row.owner_doctor_id, row.id, to);

    if (!collision) {
      db.prepare(`
        UPDATE inventory
        SET item_name = ?,
            row_version = COALESCE(row_version, 1) + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(to, row.id);
      touched.push(Number(row.id));
      continue;
    }

    db.prepare("UPDATE inventory_batches SET item_id = ? WHERE item_id = ?").run(collision.id, row.id);
    db.prepare("UPDATE inventory_reservations SET inventory_id = ? WHERE inventory_id = ?").run(collision.id, row.id);
    db.prepare("UPDATE inventory_movements SET item_id = ? WHERE item_id = ?").run(collision.id, row.id);
    db.prepare(`
      UPDATE inventory
      SET quantity = COALESCE(quantity, 0) + ?,
          cost_price = CASE WHEN COALESCE(cost_price, 0) > 0 THEN cost_price ELSE ? END,
          selling_price = CASE WHEN COALESCE(selling_price, 0) > 0 THEN selling_price ELSE ? END,
          row_version = COALESCE(row_version, 1) + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      Number(row.quantity || 0),
      Number(row.cost_price || 0),
      Number(row.selling_price || 0),
      collision.id,
    );
    db.prepare(`
      UPDATE inventory
      SET quantity = 0,
          archived_at = CURRENT_TIMESTAMP,
          notes = TRIM(COALESCE(notes, '') || ?),
          row_version = COALESCE(row_version, 1) + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(` Renamed into doctor-bag item #${collision.id}.`, row.id);
    touched.push(Number(collision.id), Number(row.id));
  }

  return touched;
}

module.exports = {
  applyKnownCostToUnpricedDoctorBags,
  renameDoctorBagCatalogue,
};
