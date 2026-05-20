#!/usr/bin/env node
/**
 * Remove all OCS master stock and matching doctor-bag rows in selected inventory folders.
 * Consumable folder is NOT affected.
 *
 * Targets: IM Drugs, IV Drugs, Wound Dressing, Oral Drugs, Pediatric Drugs, Investigation
 *
 * Requires ALLOW_DB_PURGE=true
 *
 * Usage:
 *   ALLOW_DB_PURGE=true node src/scripts/purgeOcsInventoryCategories.js
 *   docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeOcsInventoryCategories.js
 */

const { db, initializeDatabase } = require("../db");

const PURGE_FOLDER_NAMES = [
  "IM Drugs",
  "IV Drugs",
  "Wound Dressing",
  "Oral Drugs",
  "Pediatric Drugs",
  "Investigation",
];

function assertPurgeAllowed() {
  if (String(process.env.ALLOW_DB_PURGE || "").trim().toLowerCase() !== "true") {
    console.error(
      "[abort] Set ALLOW_DB_PURGE=true to remove OCS stock in the selected categories.",
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

function purgeOcsInventoryCategoriesSync({ folderNames = PURGE_FOLDER_NAMES } = {}) {
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
      ocsRemoved: 0,
      doctorBagRemoved: 0,
      names: [],
    };
  }

  const placeholders = folderIds.map(() => "?").join(", ");
  const targets = db
    .prepare(`
      SELECT id, item_name, stock_scope, owner_doctor_id
      FROM inventory
      WHERE folder_id IN (${placeholders})
        AND (
          (stock_scope = 'ocs' AND owner_doctor_id IS NULL)
          OR stock_scope = 'doctor'
        )
    `)
    .all(...folderIds);

  if (!targets.length) {
    return {
      folderNames,
      foldersFound: folders.map((f) => f.name),
      ocsRemoved: 0,
      doctorBagRemoved: 0,
      names: [],
    };
  }

  const deleteBatches = db.prepare("DELETE FROM inventory_batches WHERE item_id = ?");
  const deleteMovements = db.prepare("DELETE FROM inventory_movements WHERE item_id = ?");
  const deleteStocktakes = db.prepare("DELETE FROM inventory_stocktakes WHERE item_id = ?");
  const deleteAudit = db.prepare("DELETE FROM inventory_audit_logs WHERE item_id = ?");
  const deleteItem = db.prepare("DELETE FROM inventory WHERE id = ?");

  const run = db.transaction((rows) => {
    rows.forEach((row) => {
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

  run(targets);

  const ocsRemoved = targets.filter(
    (row) => row.stock_scope === "ocs" && !row.owner_doctor_id,
  ).length;
  const doctorBagRemoved = targets.filter((row) => row.stock_scope === "doctor").length;

  return {
    folderNames,
    foldersFound: folders.map((f) => f.name),
    ocsRemoved,
    doctorBagRemoved,
    names: targets.map((row) => row.item_name),
  };
}

if (require.main === module) {
  try {
    const result = purgeOcsInventoryCategoriesSync();
    console.log("OCS inventory category purge complete.");
    console.log(`  Folders: ${result.foldersFound.join(", ") || "(none found)"}`);
    console.log(`  OCS master rows removed:  ${result.ocsRemoved}`);
    console.log(`  Doctor bag rows removed: ${result.doctorBagRemoved}`);
    console.log("  Consumable folder was not changed.");
    const uniqueNames = [...new Set(result.names)];
    if (uniqueNames.length) {
      console.log(`  Unique SKUs removed: ${uniqueNames.length}`);
      uniqueNames.forEach((name) => console.log(`    - ${name}`));
    }
  } catch (error) {
    console.error("Purge failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { purgeOcsInventoryCategoriesSync, PURGE_FOLDER_NAMES };
