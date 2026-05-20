#!/usr/bin/env node
/**
 * Remove all doctor medical-bag inventory rows in selected categories.
 * OCS master warehouse stock (stock_scope = ocs) is NOT changed.
 *
 * Targets: Consumable, IM Drugs, IV Drugs, Wound Dressing, Oral Drugs,
 *          Pediatric Drugs, Investigation
 *
 * Requires ALLOW_DB_PURGE=true
 *
 * Usage:
 *   ALLOW_DB_PURGE=true node src/scripts/purgeDoctorBagCategories.js
 *   docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeDoctorBagCategories.js
 */

const { db, initializeDatabase } = require("../db");
const { REQUIRED_INVENTORY_FOLDERS } = require("../config/inventoryFolders");

const PURGE_FOLDER_NAMES = [...REQUIRED_INVENTORY_FOLDERS];

function assertPurgeAllowed() {
  if (String(process.env.ALLOW_DB_PURGE || "").trim().toLowerCase() !== "true") {
    console.error(
      "[abort] Set ALLOW_DB_PURGE=true to remove doctor bag stock in the selected categories.",
    );
    process.exit(1);
  }
}

function tableExists(tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function deleteInventoryRows(rows) {
  const deleteBatches = db.prepare("DELETE FROM inventory_batches WHERE item_id = ?");
  const deleteMovements = db.prepare("DELETE FROM inventory_movements WHERE item_id = ?");
  const deleteStocktakes = db.prepare("DELETE FROM inventory_stocktakes WHERE item_id = ?");
  const deleteAudit = db.prepare("DELETE FROM inventory_audit_logs WHERE item_id = ?");
  const deleteItem = db.prepare("DELETE FROM inventory WHERE id = ?");

  const run = db.transaction((targets) => {
    targets.forEach((row) => {
      const itemId = Number(row.id);
      if (tableExists("inventory_batches")) {
        deleteBatches.run(itemId);
      }
      if (tableExists("inventory_movements")) {
        deleteMovements.run(itemId);
      }
      if (tableExists("inventory_stocktakes")) {
        try {
          deleteStocktakes.run(itemId);
        } catch {
          // Older DBs may lack stocktakes.
        }
      }
      if (tableExists("inventory_audit_logs")) {
        try {
          deleteAudit.run(itemId);
        } catch {
          // ignore
        }
      }
      deleteItem.run(itemId);
    });
  });

  run(rows);
}

function purgeDoctorBagCategoriesSync({ folderNames = PURGE_FOLDER_NAMES } = {}) {
  assertPurgeAllowed();
  initializeDatabase();

  const folders = db
    .prepare(`
      SELECT id, name
      FROM inventory_folders
      WHERE owner_doctor_id IS NULL
        AND name IN (${folderNames.map(() => "?").join(", ")})
    `)
    .all(...folderNames);

  const folderIds = folders.map((row) => Number(row.id));
  if (!folderIds.length) {
    return {
      folderNames,
      foldersFound: [],
      doctorBagRemoved: 0,
      byDoctor: [],
      names: [],
    };
  }

  const placeholders = folderIds.map(() => "?").join(", ");
  const targets = db
    .prepare(`
      SELECT
        i.id,
        i.item_name,
        i.owner_doctor_id,
        d.full_name AS doctor_name
      FROM inventory i
      LEFT JOIN doctors d ON d.id = i.owner_doctor_id
      WHERE i.stock_scope = 'doctor'
        AND i.owner_doctor_id IS NOT NULL
        AND i.folder_id IN (${placeholders})
    `)
    .all(...folderIds);

  if (!targets.length) {
    return {
      folderNames,
      foldersFound: folders.map((f) => f.name),
      doctorBagRemoved: 0,
      byDoctor: [],
      names: [],
    };
  }

  deleteInventoryRows(targets);

  const byDoctorMap = new Map();
  targets.forEach((row) => {
    const key = row.doctor_name || `Doctor #${row.owner_doctor_id}`;
    byDoctorMap.set(key, (byDoctorMap.get(key) || 0) + 1);
  });

  return {
    folderNames,
    foldersFound: folders.map((f) => f.name),
    doctorBagRemoved: targets.length,
    byDoctor: [...byDoctorMap.entries()].map(([doctor, count]) => ({ doctor, count })),
    names: targets.map((row) => row.item_name),
  };
}

if (require.main === module) {
  try {
    const result = purgeDoctorBagCategoriesSync();
    console.log("Doctor bag category purge complete.");
    console.log(`  Folders: ${result.foldersFound.join(", ") || "(none found)"}`);
    console.log(`  Doctor bag rows removed: ${result.doctorBagRemoved}`);
    console.log("  OCS master stock was not changed.");
    if (result.byDoctor.length) {
      console.log("  By doctor:");
      result.byDoctor.forEach(({ doctor, count }) =>
        console.log(`    - ${doctor}: ${count} row(s)`),
      );
    }
    const uniqueNames = [...new Set(result.names)];
    if (uniqueNames.length) {
      console.log(`  Unique SKUs removed: ${uniqueNames.length}`);
    }
  } catch (error) {
    console.error("Purge failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { purgeDoctorBagCategoriesSync, PURGE_FOLDER_NAMES };
