#!/usr/bin/env node
/**
 * Mirror OCS master stock into every doctor medical bag.
 * Upserts by doctor + item name; optional prune removes bag rows not on OCS catalog.
 */

const { db, initializeDatabase } = require("../db");
const { RETIRED_OCS_CONSUMABLE_SKUS } = require("../lib/inventoryCategoryAlignment");

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
        AND archived_at IS NULL
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
        AND archived_at IS NULL
        AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      ORDER BY id ASC
      LIMIT 1
    `)
    .get(doctorId, itemName);
}

function findArchivedDoctorItemByName(doctorId, itemName) {
  return db.prepare(`
    SELECT id
    FROM inventory
    WHERE stock_scope = 'doctor'
      AND owner_doctor_id = ?
      AND archived_at IS NOT NULL
      AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
    ORDER BY id ASC
    LIMIT 1
  `).get(doctorId, itemName);
}

function upsertDoctorItemFromOcs(doctorId, source, { insertOnly = false } = {}) {
  const itemName = String(source.item_name || "").trim();
  const minimumQuantity = Number(source.minimum_quantity || 0);
  const existing = findDoctorItemByName(doctorId, itemName);

  if (existing) {
    if (insertOnly) {
      return "skipped";
    }
    db.prepare(`
      UPDATE inventory
      SET
        folder_id = ?,
        minimum_quantity = ?,
        unit = ?,
        attributes = ?,
        moa_notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      source.folder_id,
      minimumQuantity,
      source.unit || "unit",
      source.attributes || "",
      source.moa_notes || "",
      existing.id,
    );
    return "updated";
  }

  if (findArchivedDoctorItemByName(doctorId, itemName)) {
    throw new Error(`${itemName}: an archived doctor-bag item already exists. Restore it explicitly instead of recreating it.`);
  }

  const result = db
    .prepare(`
      INSERT INTO inventory (
        item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
        cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
      )
      VALUES (?, ?, 'doctor', ?, 0, ?, ?, ?, ?, '', ?, ?, NULL, CURRENT_TIMESTAMP)
    `)
    .run(
      itemName,
      source.folder_id,
      doctorId,
      minimumQuantity,
      source.unit || "unit",
      Number(source.cost_price || 0),
      Number(source.selling_price || 0),
      source.attributes || "",
      source.moa_notes || "",
    );

  void result;
  return "inserted";
}

function pruneDoctorItemsNotInOcsCatalog(doctorId, ocsNameKeys) {
  const retiredNameKeys = new Set(
    RETIRED_OCS_CONSUMABLE_SKUS.map((name) => String(name || "").trim().toLowerCase()).filter(Boolean),
  );
  const doctorItems = db
    .prepare(`
      SELECT id, item_name
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND archived_at IS NULL
    `)
    .all(doctorId);

  let archived = 0;
  let blocked = 0;
  doctorItems.forEach((row) => {
    const key = String(row.item_name || "").trim().toLowerCase();
    if (ocsNameKeys.has(key) || retiredNameKeys.has(key)) return;
    const state = db.prepare(`
      SELECT i.quantity,
        COALESCE((SELECT SUM(quantity_remaining) FROM inventory_batches WHERE item_id = i.id), 0) AS batch_quantity,
        COALESCE((SELECT SUM(quantity) FROM inventory_reservations WHERE inventory_id = i.id AND status = 'active'), 0) AS reserved_quantity
      FROM inventory i WHERE i.id = ?
    `).get(row.id);
    if (Number(state?.quantity || 0) !== 0 || Number(state?.batch_quantity || 0) !== 0 || Number(state?.reserved_quantity || 0) !== 0) {
      blocked += 1;
      return;
    }
    archived += Number(db.prepare(`
      UPDATE inventory
      SET archived_at = CURRENT_TIMESTAMP,
          row_version = COALESCE(row_version, 1) + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND archived_at IS NULL
    `).run(row.id).changes || 0);
  });

  return { archived, blocked };
}

function syncDoctorStockFromOcsSync({ skipInit = false, pruneExtras = true, insertOnly = false } = {}) {
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
      prune_blocked: 0,
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
    skipped: 0,
    pruned: 0,
    prune_blocked: 0,
    ocsItems: ocsItems.length,
    errors: [],
  };

  const run = db.transaction(() => {
    doctors.forEach((doctor) => {
      ocsItems.forEach((source) => {
        const action = upsertDoctorItemFromOcs(Number(doctor.id), source, { insertOnly });
        if (action === "inserted") summary.inserted += 1;
        else if (action === "updated") summary.updated += 1;
        else summary.skipped += 1;
      });

      if (pruneExtras) {
        const prune = pruneDoctorItemsNotInOcsCatalog(Number(doctor.id), ocsNameKeys);
        summary.pruned += prune.archived;
        summary.prune_blocked += prune.blocked;
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
  console.log(`  Prune blocked: ${summary.prune_blocked}`);
  if (summary.errors.length) {
    console.error("  Errors:");
    summary.errors.forEach((entry) =>
      console.error(`    - ${entry.doctorName}: ${entry.message}`),
    );
    process.exitCode = 1;
  }
}

module.exports = { syncDoctorStockFromOcsSync };
