#!/usr/bin/env node
/**
 * Upsert Consumable extension rows into OCS master warehouse stock.
 *
 * Source: server/src/config/ocsConsumablesExtension.js (manifest + PDF catalog)
 *
 * - Existing item_name (case-insensitive, stock_scope = ocs): update qty, par, folder, batches
 * - New names: insert into shared inventory table (admin / operator / doctor views)
 *
 * Usage:
 *   node src/scripts/seedOcsConsumablesExtension.js
 *   docker exec clinicflow-app node src/scripts/seedOcsConsumablesExtension.js
 */

const { ocsConsumablesExtension } = require("../config/ocsConsumablesExtension");
const { upsertOcsMasterStockDataset } = require("../lib/ocsMasterStockUpsert");
const { syncDoctorStockFromOcsSync } = require("./syncDoctorStockFromOcs");

function seedOcsConsumablesExtensionSync({ skipInit = false, syncDoctorBags = true } = {}) {
  const summary = upsertOcsMasterStockDataset(ocsConsumablesExtension, {
    skipInit,
    insertOnly: false,
  });

  let doctorSync = null;
  if (syncDoctorBags) {
    doctorSync = syncDoctorStockFromOcsSync({
      skipInit: true,
      insertOnly: true,
      pruneExtras: false,
    });
  }

  return { consumables: summary, doctorBags: doctorSync };
}

function printSummary(result) {
  const { consumables, doctorBags } = result;
  console.log("OCS Consumables extension upsert complete.");
  console.log(`  Inserted: ${consumables.inserted}`);
  console.log(`  Updated:  ${consumables.updated}`);
  console.log(`  Skipped:  ${consumables.skipped}`);
  console.log(`  Total:    ${ocsConsumablesExtension.length}`);

  if (consumables.errors.length) {
    console.error("  Errors:");
    consumables.errors.forEach((entry) =>
      console.error(`    - ${entry.name}: ${entry.message}`),
    );
  }

  if (doctorBags) {
    console.log(`  Doctor bag rows added: ${doctorBags.inserted}`);
  }

  console.log(
    "  Inventory API reads this table live — refresh Admin, Operator, and Doctor inventory screens.",
  );
}

if (require.main === module) {
  try {
    const result = seedOcsConsumablesExtensionSync();
    printSummary(result);
    if (result.consumables.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error("OCS Consumables extension seed failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { seedOcsConsumablesExtensionSync };
