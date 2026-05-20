#!/usr/bin/env node
/**
 * Go-live warehouse reset: purge sandbox OCS master stock and inventory activity logs,
 * remove TEST* placeholder rows, then upsert final master stock from ocsMasterStockData.js.
 *
 * Requires: ALLOW_DB_PURGE=true
 *
 * Usage (local):
 *   ALLOW_DB_PURGE=true node src/scripts/purgeAndReseedOcsWarehouse.js
 *   ALLOW_DB_PURGE=true DB_PATH=/data/clinic.db node src/scripts/purgeAndReseedOcsWarehouse.js
 *
 * Usage (NAS Docker):
 *   docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeAndReseedOcsWarehouse.js
 */

const { db, initializeDatabase } = require("../db");
const { seedOcsMasterStockSync } = require("./seedOcsMasterStock");
const { purgeTestInventoryItems } = require("./purgeOcsTestInventory");

const PURGE_ENV_FLAG = "ALLOW_DB_PURGE";

function assertPurgeAllowed() {
  if (String(process.env[PURGE_ENV_FLAG] || "").trim().toLowerCase() !== "true") {
    console.error(
      `[abort] Set ${PURGE_ENV_FLAG}=true to run this destructive script. No database changes were made.`,
    );
    process.exit(1);
  }
}

function tableExists(tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row?.name);
}

function deleteAllFromTable(tableName) {
  if (!tableExists(tableName)) {
    return 0;
  }

  const countRow = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
  const before = Number(countRow?.count || 0);
  if (before === 0) {
    return 0;
  }

  db.prepare(`DELETE FROM ${tableName}`).run();
  return before;
}

function purgeOcsMasterInventory() {
  const ocsItems = db
    .prepare(`
      SELECT id
      FROM inventory
      WHERE stock_scope = 'ocs'
        AND owner_doctor_id IS NULL
    `)
    .all();

  if (!ocsItems.length) {
    return { ocsItemsRemoved: 0 };
  }

  const itemIds = ocsItems.map((row) => Number(row.id));
  const deleteBatches = db.prepare("DELETE FROM inventory_batches WHERE item_id = ?");
  const deleteStocktakes = db.prepare("DELETE FROM inventory_stocktakes WHERE item_id = ?");
  const deleteItem = db.prepare("DELETE FROM inventory WHERE id = ?");

  const run = db.transaction((ids) => {
    ids.forEach((itemId) => {
      if (tableExists("inventory_batches")) {
        deleteBatches.run(itemId);
      }
      if (tableExists("inventory_stocktakes")) {
        try {
          deleteStocktakes.run(itemId);
        } catch {
          // Older DBs may lack stocktakes.
        }
      }
      deleteItem.run(itemId);
    });
  });

  run(itemIds);
  return { ocsItemsRemoved: itemIds.length };
}

function purgeSandboxInventoryLogs() {
  const activityRemoved = deleteAllFromTable("inventory_activity_history");
  const auditRemoved = deleteAllFromTable("inventory_audit_logs");
  const movementsRemoved = deleteAllFromTable("inventory_movements");
  const stagingRemoved = deleteAllFromTable("inventory_staging");

  return {
    activityRemoved,
    auditRemoved,
    movementsRemoved,
    stagingRemoved,
  };
}

function purgeAndReseedOcsWarehouseSync() {
  assertPurgeAllowed();
  initializeDatabase();

  const logSummary = purgeSandboxInventoryLogs();
  const ocsSummary = purgeOcsMasterInventory();
  const testSummary = purgeTestInventoryItems();

  const seedSummary = seedOcsMasterStockSync({ skipInit: true, insertOnly: false });

  return {
    logSummary,
    ocsSummary,
    testSummary,
    seedSummary,
  };
}

if (require.main === module) {
  try {
    const result = purgeAndReseedOcsWarehouseSync();

    console.log("SUCCESS: Sandbox data purged completely.");
    console.log(
      `  Activity history removed: ${result.logSummary.activityRemoved}`,
    );
    console.log(`  Audit logs removed:       ${result.logSummary.auditRemoved}`);
    console.log(`  Movements removed:        ${result.logSummary.movementsRemoved}`);
    console.log(`  Staging rows removed:   ${result.logSummary.stagingRemoved}`);
    console.log(`  OCS master items removed: ${result.ocsSummary.ocsItemsRemoved}`);
    console.log(
      `  TEST placeholder items removed: ${result.testSummary.removed}`,
    );
    if (result.testSummary.names.length) {
      result.testSummary.names.forEach((name) => console.log(`    - ${name}`));
    }

    console.log("SUCCESS: Live master stock records seeded accurately.");
    console.log(`  Inserted: ${result.seedSummary.inserted}`);
    console.log(`  Updated:  ${result.seedSummary.updated}`);
    console.log(`  Catalog rows: ${result.seedSummary.inserted + result.seedSummary.updated + result.seedSummary.skipped}`);

    if (result.seedSummary.errors.length) {
      console.error("Seed completed with errors:");
      result.seedSummary.errors.forEach((entry) => {
        console.error(`  - ${entry.name}: ${entry.message}`);
      });
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("Purge and reseed failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  purgeAndReseedOcsWarehouseSync,
  purgeOcsMasterInventory,
  purgeSandboxInventoryLogs,
  assertPurgeAllowed,
};
