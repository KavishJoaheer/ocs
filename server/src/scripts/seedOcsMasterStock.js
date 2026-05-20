#!/usr/bin/env node
/**
 * Upsert OCS master stock from server/src/config/ocsMasterStockData.js
 *
 * Usage:
 *   node src/scripts/seedOcsMasterStock.js
 *   DB_PATH=/path/to/clinic.db node src/scripts/seedOcsMasterStock.js
 *
 * Matches existing rows by item_name (case-insensitive) on stock_scope = 'ocs'.
 * Safe to re-run: updates quantities/par levels/expiry without duplicating items.
 */

const { ocsMasterStockData } = require("../config/ocsMasterStockData");
const { upsertOcsMasterStockDataset } = require("../lib/ocsMasterStockUpsert");

function seedOcsMasterStockSync(options = {}) {
  return upsertOcsMasterStockDataset(ocsMasterStockData, options);
}

function printSeedSummary(summary) {
  console.log("OCS master stock seed complete.");
  console.log(`  Inserted: ${summary.inserted}`);
  console.log(`  Updated:  ${summary.updated}`);
  console.log(`  Skipped:  ${summary.skipped}`);
  console.log(`  Total:    ${ocsMasterStockData.length}`);

  if (summary.errors.length) {
    console.error("  Errors:");
    summary.errors.forEach((entry) => console.error(`    - ${entry.name}: ${entry.message}`));
  }
}

if (require.main === module) {
  try {
    const summary = seedOcsMasterStockSync();
    printSeedSummary(summary);
    if (summary.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error("OCS master stock seed failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { seedOcsMasterStockSync };
