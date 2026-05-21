#!/usr/bin/env node
/**
 * Upsert IV Drugs extension rows into OCS master warehouse stock and mirror to doctor bags.
 *
 * Source: server/src/config/ocsIVDrugsExtension.js
 *
 * Usage:
 *   node src/scripts/seedOcsIVDrugsExtension.js
 *   docker exec clinicflow-app node src/scripts/seedOcsIVDrugsExtension.js
 *
 * Env:
 *   SYNC_DOCTOR_BAGS=true  (default) — mirror OCS IV rows into every doctor bag
 */

const { ocsIVDrugsExtension } = require("../config/ocsIVDrugsExtension");
const { upsertOcsMasterStockDataset } = require("../lib/ocsMasterStockUpsert");
const { syncDoctorStockFromOcsSync } = require("./syncDoctorStockFromOcs");

function seedOcsIVDrugsExtensionSync({
  skipInit = false,
  syncDoctorBags = String(process.env.SYNC_DOCTOR_BAGS ?? "true").toLowerCase() !== "false",
} = {}) {
  const summary = upsertOcsMasterStockDataset(ocsIVDrugsExtension, {
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

  return { ivDrugs: summary, doctorBags: doctorSync };
}

function printSummary(result) {
  const { ivDrugs, doctorBags } = result;
  console.log("OCS IV Drugs extension upsert complete.");
  console.log(`  Inserted: ${ivDrugs.inserted}`);
  console.log(`  Updated:  ${ivDrugs.updated}`);
  console.log(`  Skipped:  ${ivDrugs.skipped}`);
  console.log(`  Total:    ${ocsIVDrugsExtension.length}`);

  if (ivDrugs.errors.length) {
    console.error("  Errors:");
    ivDrugs.errors.forEach((entry) =>
      console.error(`    - ${entry.name}: ${entry.message}`),
    );
  }

  if (doctorBags) {
    console.log(`  Doctor bag rows added: ${doctorBags.inserted}`);
    console.log(`  Doctors synced: ${doctorBags.doctors}`);
  }

  console.log("  Refresh Inventory → OCS Stock / My Stock → IV Drugs.");
}

if (require.main === module) {
  try {
    const result = seedOcsIVDrugsExtensionSync();
    printSummary(result);
    if (result.ivDrugs.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error("OCS IV Drugs extension seed failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { seedOcsIVDrugsExtensionSync };
