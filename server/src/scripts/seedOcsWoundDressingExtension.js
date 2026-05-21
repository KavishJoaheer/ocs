#!/usr/bin/env node
/**
 * Upsert Wound Dressing extension rows into OCS master warehouse stock and mirror to doctor bags.
 *
 * Source: server/src/config/ocsWoundDressingExtension.js
 *
 * Usage:
 *   node src/scripts/seedOcsWoundDressingExtension.js
 *
 * Env:
 *   SYNC_DOCTOR_BAGS=true  (default) — mirror OCS Wound Dressing rows into every doctor bag
 */

const { ocsWoundDressingExtension } = require("../config/ocsWoundDressingExtension");
const { upsertOcsMasterStockDataset } = require("../lib/ocsMasterStockUpsert");
const { syncDoctorStockFromOcsSync } = require("./syncDoctorStockFromOcs");

function seedOcsWoundDressingExtensionSync({
  skipInit = false,
  syncDoctorBags = String(process.env.SYNC_DOCTOR_BAGS ?? "true").toLowerCase() !== "false",
} = {}) {
  const summary = upsertOcsMasterStockDataset(ocsWoundDressingExtension, {
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

  return { woundDressing: summary, doctorBags: doctorSync };
}

function printSummary(result) {
  const { woundDressing, doctorBags } = result;
  console.log("OCS Wound Dressing extension upsert complete.");
  console.log(`  Inserted: ${woundDressing.inserted}`);
  console.log(`  Updated:  ${woundDressing.updated}`);
  console.log(`  Skipped:  ${woundDressing.skipped}`);
  console.log(`  Total:    ${ocsWoundDressingExtension.length}`);

  if (woundDressing.errors.length) {
    console.error("  Errors:");
    woundDressing.errors.forEach((entry) =>
      console.error(`    - ${entry.name}: ${entry.message}`),
    );
  }

  if (doctorBags) {
    console.log(`  Doctor bag rows added: ${doctorBags.inserted}`);
    console.log(`  Doctors synced: ${doctorBags.doctors}`);
  }

  console.log("  Refresh Inventory → OCS Stock / My Stock → Wound Dressing.");
}

if (require.main === module) {
  try {
    const result = seedOcsWoundDressingExtensionSync();
    printSummary(result);
    if (result.woundDressing.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error("OCS Wound Dressing extension seed failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { seedOcsWoundDressingExtensionSync };
