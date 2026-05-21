#!/usr/bin/env node
/**
 * Upsert Investigation extension rows into OCS master warehouse stock and mirror to doctor bags.
 *
 * Source: server/src/config/ocsInvestigationsExtension.js
 *
 * Usage:
 *   node src/scripts/seedOcsInvestigationsExtension.js
 *
 * Env:
 *   SYNC_DOCTOR_BAGS=true  (default) — mirror OCS Investigation rows into every doctor bag
 */

const { ocsInvestigationsExtension } = require("../config/ocsInvestigationsExtension");
const { upsertOcsMasterStockDataset } = require("../lib/ocsMasterStockUpsert");
const { syncDoctorStockFromOcsSync } = require("./syncDoctorStockFromOcs");

function seedOcsInvestigationsExtensionSync({
  skipInit = false,
  syncDoctorBags = String(process.env.SYNC_DOCTOR_BAGS ?? "true").toLowerCase() !== "false",
} = {}) {
  const summary = upsertOcsMasterStockDataset(ocsInvestigationsExtension, {
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

  return { investigations: summary, doctorBags: doctorSync };
}

function printSummary(result) {
  const { investigations, doctorBags } = result;
  console.log("OCS Investigation extension upsert complete.");
  console.log(`  Inserted: ${investigations.inserted}`);
  console.log(`  Updated:  ${investigations.updated}`);
  console.log(`  Skipped:  ${investigations.skipped}`);
  console.log(`  Total:    ${ocsInvestigationsExtension.length}`);

  if (investigations.errors.length) {
    console.error("  Errors:");
    investigations.errors.forEach((entry) =>
      console.error(`    - ${entry.name}: ${entry.message}`),
    );
  }

  if (doctorBags) {
    console.log(`  Doctor bag rows added: ${doctorBags.inserted}`);
    console.log(`  Doctors synced: ${doctorBags.doctors}`);
  }

  console.log("  Refresh Inventory → OCS Stock / My Stock → Investigation.");
}

if (require.main === module) {
  try {
    const result = seedOcsInvestigationsExtensionSync();
    printSummary(result);
    if (result.investigations.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error("OCS Investigation extension seed failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { seedOcsInvestigationsExtensionSync };
