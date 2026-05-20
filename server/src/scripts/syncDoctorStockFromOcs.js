#!/usr/bin/env node
/**
 * Mirror OCS master stock into every doctor medical bag.
 * Upserts by doctor + item name; optional prune removes bag rows not on OCS catalog.
 */

const { db, initializeDatabase } = require("../db");

function syncBatches(itemId, quantity, expiryDate) {
  db.prepare("DELETE FROM inventory_batches WHERE item_id = ?").run(itemId);
  if (quantity > 0) {
    db.prepare(`
      INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost)
      VALUES (?, ?, ?, 0)
    `).run(itemId, quantity, expiryDate);
  }
}

function getOcsMasterItems() {
  return db
    .prepare(`
      SELECT
        item_name,
        folder_id,
        quantity,
        minimum_quantity,
        unit,
        cost_price,
        selling_price,
        attributes,
        moa_notes,
        expiry_date
      FROM inventory
      WHERE stock_scope = 'ocs'
        AND owner_doctor_id IS NULL
      ORDER BY item_name ASC
    `)
    .all();
}

function getActiveDoctors() {
  return db
    .prepare(`
      SELECT id, full_name
      FROM doctors
      WHERE deleted_at IS NULL
      ORDER BY full_name ASC
    `)
    .all();
}

function findDoctorItemByName(doctorId, itemName) {
  return db
    .prepare(`
      SELECT id
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      ORDER BY id ASC
      LIMIT 1
    `)
    .get(doctorId, itemName);
}

function upsertDoctorItemFromOcs(doctorId, source) {
  const itemName = String(source.item_name || "").trim();
  const quantity = Number(source.quantity || 0);
  const minimumQuantity = Number(source.minimum_quantity || 0);
  const expiryDate = source.expiry_date ? String(source.expiry_date).trim() : null;
  const existing = findDoctorItemByName(doctorId, itemName);

  if (existing) {
    db.prepare(`
      UPDATE inventory
      SET
        folder_id = ?,
        quantity = ?,
        minimum_quantity = ?,
        unit = ?,
        cost_price = ?,
        selling_price = ?,
        attributes = ?,
        moa_notes = ?,
        expiry_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      source.folder_id,
      quantity,
      minimumQuantity,
      source.unit || "unit",
      Number(source.cost_price || 0),
      Number(source.selling_price || 0),
      source.attributes || "",
      source.moa_notes || "",
      expiryDate,
      existing.id,
    );
    syncBatches(existing.id, quantity, expiryDate);
    return "updated";
  }

  const result = db
    .prepare(`
      INSERT INTO inventory (
        item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
        cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
      )
      VALUES (?, ?, 'doctor', ?, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .run(
      itemName,
      source.folder_id,
      doctorId,
      quantity,
      minimumQuantity,
      source.unit || "unit",
      Number(source.cost_price || 0),
      Number(source.selling_price || 0),
      source.attributes || "",
      source.moa_notes || "",
      expiryDate,
    );

  const itemId = Number(result.lastInsertRowid);
  syncBatches(itemId, quantity, expiryDate);
  return "inserted";
}

function pruneDoctorItemsNotInOcsCatalog(doctorId, ocsNameKeys) {
  const doctorItems = db
    .prepare(`
      SELECT id, item_name
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
    `)
    .all(doctorId);

  const deleteBatches = db.prepare("DELETE FROM inventory_batches WHERE item_id = ?");
  const deleteMovements = db.prepare("DELETE FROM inventory_movements WHERE item_id = ?");
  const deleteStocktakes = db.prepare("DELETE FROM inventory_stocktakes WHERE item_id = ?");
  const deleteItem = db.prepare("DELETE FROM inventory WHERE id = ?");

  let removed = 0;
  doctorItems.forEach((row) => {
    const key = String(row.item_name || "").trim().toLowerCase();
    if (ocsNameKeys.has(key)) return;
    deleteBatches.run(row.id);
    deleteMovements.run(row.id);
    try {
      deleteStocktakes.run(row.id);
    } catch {
      // optional table
    }
    deleteItem.run(row.id);
    removed += 1;
  });

  return removed;
}

function syncDoctorStockFromOcsSync({ skipInit = false, pruneExtras = true } = {}) {
  if (!skipInit) {
    initializeDatabase();
  }

  const ocsItems = getOcsMasterItems();
  if (!ocsItems.length) {
    return {
      doctors: 0,
      inserted: 0,
      updated: 0,
      pruned: 0,
      ocsItems: 0,
      errors: [],
    };
  }

  const doctors = getActiveDoctors();
  const ocsNameKeys = new Set(
    ocsItems.map((item) => String(item.item_name || "").trim().toLowerCase()),
  );

  const summary = {
    doctors: doctors.length,
    inserted: 0,
    updated: 0,
    pruned: 0,
    ocsItems: ocsItems.length,
    errors: [],
  };

  const run = db.transaction(() => {
    doctors.forEach((doctor) => {
      try {
        ocsItems.forEach((source) => {
          const action = upsertDoctorItemFromOcs(Number(doctor.id), source);
          if (action === "inserted") summary.inserted += 1;
          else summary.updated += 1;
        });

        if (pruneExtras) {
          summary.pruned += pruneDoctorItemsNotInOcsCatalog(Number(doctor.id), ocsNameKeys);
        }
      } catch (error) {
        summary.errors.push({
          doctorId: doctor.id,
          doctorName: doctor.full_name,
          message: error.message,
        });
      }
    });
  });

  run();
  return summary;
}

if (require.main === module) {
  const summary = syncDoctorStockFromOcsSync();
  console.log("Doctor stock sync from OCS complete.");
  console.log(`  Doctors:  ${summary.doctors}`);
  console.log(`  OCS rows: ${summary.ocsItems}`);
  console.log(`  Inserted: ${summary.inserted}`);
  console.log(`  Updated:  ${summary.updated}`);
  console.log(`  Pruned:   ${summary.pruned}`);
  if (summary.errors.length) {
    console.error("  Errors:");
    summary.errors.forEach((entry) =>
      console.error(`    - ${entry.doctorName}: ${entry.message}`),
    );
    process.exitCode = 1;
  }
}

module.exports = { syncDoctorStockFromOcsSync };
