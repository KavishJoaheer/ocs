#!/usr/bin/env node
/**
 * Upsert Oral Drugs extension rows into OCS master warehouse stock and mirror to doctor bags.
 *
 * Source: server/src/config/ocsOralDrugsExtension.js
 *
 * Usage:
 *   node src/scripts/seedOcsOralDrugsExtension.js
 *
 * Env:
 *   SYNC_DOCTOR_BAGS=true  (default) — mirror OCS Oral Drugs rows into every doctor bag
 */

const { ocsOralDrugsExtension } = require("../config/ocsOralDrugsExtension");
const { upsertOcsMasterStockDataset } = require("../lib/ocsMasterStockUpsert");
const { syncDoctorStockFromOcsSync } = require("./syncDoctorStockFromOcs");

function seedOcsOralDrugsExtensionSync({
  skipInit = false,
  syncDoctorBags = String(process.env.SYNC_DOCTOR_BAGS ?? "true").toLowerCase() !== "false",
} = {}) {
  const summary = upsertOcsMasterStockDataset(ocsOralDrugsExtension, {
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

  return { oralDrugs: summary, doctorBags: doctorSync };
}

function printSummary(result) {
  const { oralDrugs, doctorBags } = result;
  console.log("OCS Oral Drugs extension upsert complete.");
  console.log(`  Inserted: ${oralDrugs.inserted}`);
  console.log(`  Updated:  ${oralDrugs.updated}`);
  console.log(`  Skipped:  ${oralDrugs.skipped}`);
  console.log(`  Total:    ${ocsOralDrugsExtension.length}`);

  if (oralDrugs.errors.length) {
    console.error("  Errors:");
    oralDrugs.errors.forEach((entry) =>
      console.error(`    - ${entry.name}: ${entry.message}`),
    );
  }

  if (doctorBags) {
    console.log(`  Doctor bag rows added: ${doctorBags.inserted}`);
    console.log(`  Doctors synced: ${doctorBags.doctors}`);
  }

  console.log("  Refresh Inventory → OCS Stock / My Stock → Oral Drugs.");
}

if (require.main === module) {
  try {
    const result = seedOcsOralDrugsExtensionSync();
    printSummary(result);
    if (result.oralDrugs.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error("OCS Oral Drugs extension seed failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { seedOcsOralDrugsExtensionSync };
