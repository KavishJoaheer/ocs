#!/usr/bin/env node
/**
 * Remove OCS master stock and doctor-bag rows in non-Consumable inventory folders.
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
const { recordOcsCatalogExclusion } = require("../lib/ocsCatalogExclusions");

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
      const isOcsMaster =
        row.stock_scope === "ocs" && (row.owner_doctor_id == null || row.owner_doctor_id === "");
      if (isOcsMaster && row.item_name) {
        recordOcsCatalogExclusion(row.item_name);
      }
    });
  });

  run(rows);
}

function purgeOcsInventoryCategoriesSync({ folderNames = PURGE_FOLDER_NAMES } = {}) {
  assertPurgeAllowed();
  initializeDatabase();

  const folderPlaceholders = folderNames.map(() => "?").join(", ");

  const targets = db
    .prepare(`
      SELECT
        i.id,
        i.item_name,
        i.stock_scope,
        i.owner_doctor_id,
        f.name AS folder_name
      FROM inventory i
      JOIN inventory_folders f ON f.id = i.folder_id
      WHERE f.name IN (${folderPlaceholders})
        AND (
          (i.stock_scope = 'ocs' AND i.owner_doctor_id IS NULL)
          OR (i.stock_scope = 'doctor' AND i.owner_doctor_id IS NOT NULL)
        )
    `)
    .all(...folderNames);

  if (!targets.length) {
    return {
      folderNames,
      ocsRemoved: 0,
      doctorBagRemoved: 0,
      names: [],
    };
  }

  deleteInventoryRows(targets);

  const ocsRemoved = targets.filter(
    (row) => row.stock_scope === "ocs" && !row.owner_doctor_id,
  ).length;
  const doctorBagRemoved = targets.filter((row) => row.stock_scope === "doctor").length;

  return {
    folderNames,
    ocsRemoved,
    doctorBagRemoved,
    names: targets.map((row) => row.item_name),
  };
}

if (require.main === module) {
  try {
    const result = purgeOcsInventoryCategoriesSync();
    console.log("OCS non-Consumable category purge complete.");
    console.log(`  Categories: ${result.folderNames.join(", ")}`);
    console.log(`  OCS master rows removed:  ${result.ocsRemoved}`);
    console.log(`  Doctor bag rows removed: ${result.doctorBagRemoved}`);
    console.log("  Consumable folder was not changed.");
    const uniqueNames = [...new Set(result.names)];
    if (uniqueNames.length) {
      console.log(`  Unique SKUs removed: ${uniqueNames.length}`);
    } else {
      console.log("  No rows found (already clear).");
    }
    console.log("");
    console.log("Ensure NAS .env has SEED_OCS_MASTER_STOCK=false so items are not re-added on restart.");
  } catch (error) {
    console.error("Purge failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { purgeOcsInventoryCategoriesSync, PURGE_FOLDER_NAMES };
