#!/usr/bin/env node
/**
 * Upsert IM Drugs extension rows into OCS master warehouse stock.
 *
 * Source: server/src/config/ocsIMDrugsExtension.js (master manifest extract)
 *
 * - Existing item_name (case-insensitive, stock_scope = ocs): update qty, par, expiry, batches
 * - New names: insert into shared inventory table (admin / operator / doctor views)
 *
 * Usage:
 *   node src/scripts/seedOcsIMDrugsExtension.js
 *   docker exec clinicflow-app node src/scripts/seedOcsIMDrugsExtension.js
 */

const { ocsIMDrugsExtension } = require("../config/ocsIMDrugsExtension");
const { upsertOcsMasterStockDataset } = require("../lib/ocsMasterStockUpsert");
const { syncDoctorStockFromOcsSync } = require("./syncDoctorStockFromOcs");

function seedOcsIMDrugsExtensionSync({ skipInit = false, syncDoctorBags = true } = {}) {
  const summary = upsertOcsMasterStockDataset(ocsIMDrugsExtension, {
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

  return { imDrugs: summary, doctorBags: doctorSync };
}

function printSummary(result) {
  const { imDrugs, doctorBags } = result;
  console.log("OCS IM Drugs extension upsert complete.");
  console.log(`  Inserted: ${imDrugs.inserted}`);
  console.log(`  Updated:  ${imDrugs.updated}`);
  console.log(`  Skipped:  ${imDrugs.skipped}`);
  console.log(`  Total:    ${ocsIMDrugsExtension.length}`);

  if (imDrugs.errors.length) {
    console.error("  Errors:");
    imDrugs.errors.forEach((entry) =>
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
    const result = seedOcsIMDrugsExtensionSync();
    printSummary(result);
    if (result.imDrugs.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error("OCS IM Drugs extension seed failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { seedOcsIMDrugsExtensionSync };
