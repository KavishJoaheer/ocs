#!/usr/bin/env node
/**
 * Upsert Pediatric Drugs extension rows into OCS master warehouse stock and mirror to doctor bags.
 *
 * Source: server/src/config/ocsPediatricDrugsExtension.js
 *
 * Usage:
 *   node src/scripts/seedOcsPediatricDrugsExtension.js
 *
 * Env:
 *   SYNC_DOCTOR_BAGS=true  (default) — mirror OCS Pediatric Drugs rows into every doctor bag
 */

const { ocsPediatricDrugsExtension } = require("../config/ocsPediatricDrugsExtension");
const { upsertOcsMasterStockDataset } = require("../lib/ocsMasterStockUpsert");
const { syncDoctorStockFromOcsSync } = require("./syncDoctorStockFromOcs");

function seedOcsPediatricDrugsExtensionSync({
  skipInit = false,
  syncDoctorBags = String(process.env.SYNC_DOCTOR_BAGS ?? "true").toLowerCase() !== "false",
} = {}) {
  const summary = upsertOcsMasterStockDataset(ocsPediatricDrugsExtension, {
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

  return { pediatricDrugs: summary, doctorBags: doctorSync };
}

function printSummary(result) {
  const { pediatricDrugs, doctorBags } = result;
  console.log("OCS Pediatric Drugs extension upsert complete.");
  console.log(`  Inserted: ${pediatricDrugs.inserted}`);
  console.log(`  Updated:  ${pediatricDrugs.updated}`);
  console.log(`  Skipped:  ${pediatricDrugs.skipped}`);
  console.log(`  Total:    ${ocsPediatricDrugsExtension.length}`);

  if (pediatricDrugs.errors.length) {
    console.error("  Errors:");
    pediatricDrugs.errors.forEach((entry) =>
      console.error(`    - ${entry.name}: ${entry.message}`),
    );
  }

  if (doctorBags) {
    console.log(`  Doctor bag rows added: ${doctorBags.inserted}`);
    console.log(`  Doctors synced: ${doctorBags.doctors}`);
  }

  console.log("  Refresh Inventory → OCS Stock / My Stock → Pediatric Drugs.");
}

if (require.main === module) {
  try {
    const result = seedOcsPediatricDrugsExtensionSync();
    printSummary(result);
    if (result.pediatricDrugs.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error("OCS Pediatric Drugs extension seed failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { seedOcsPediatricDrugsExtensionSync };
