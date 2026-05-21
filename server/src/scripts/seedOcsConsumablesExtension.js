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
 *
 * Env:
 *   SYNC_DOCTOR_BAGS=true  (default) — mirror OCS Consumable rows into every doctor bag
 */

const { ocsConsumablesExtension } = require("../config/ocsConsumablesExtension");
const { clearOcsCatalogExclusionsForNames } = require("../lib/ocsCatalogExclusions");
const { upsertOcsMasterStockDataset } = require("../lib/ocsMasterStockUpsert");
const { syncDoctorStockFromOcsSync } = require("./syncDoctorStockFromOcs");

function seedOcsConsumablesExtensionSync({
  skipInit = false,
  syncDoctorBags = String(process.env.SYNC_DOCTOR_BAGS ?? "true").toLowerCase() !== "false",
  clearExclusions = true,
} = {}) {
  if (clearExclusions) {
    clearOcsCatalogExclusionsForNames(
      ocsConsumablesExtension.map((row) => row.name),
    );
  }

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
    console.log(`  Doctors synced: ${doctorBags.doctors}`);
  }

  console.log("  Refresh Inventory → OCS Stock / My Stock → Consumable.");
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
