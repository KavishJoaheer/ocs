#!/usr/bin/env node
/**
 * One-shot OCS stock baseline for production:
 * 1. Purge Consumable OCS + bag rows (with catalog exclusions)
 * 2. Seed IM Drugs from IM DRUGS.pdf catalog
 * 3. Mirror OCS catalog into every doctor bag (catalog rows, qty from OCS)
 *
 * Requires ALLOW_DB_PURGE=true
 *
 * Usage:
 *   docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/setupOcsStockBaseline.js
 */

const { purgeOcsConsumableStockSync } = require("./purgeOcsConsumableStock");
const { seedOcsIMDrugsExtensionSync } = require("./seedOcsIMDrugsExtension");
const { syncDoctorStockFromOcsSync } = require("./syncDoctorStockFromOcs");
const { db, initializeDatabase } = require("../db");
const { REQUIRED_INVENTORY_FOLDERS } = require("../config/inventoryFolders");

function audit() {
  const rows = db
    .prepare(`
      SELECT f.name AS folder_name,
        SUM(CASE WHEN i.stock_scope = 'ocs' AND i.owner_doctor_id IS NULL THEN 1 ELSE 0 END) AS ocs_count,
        SUM(CASE WHEN i.stock_scope = 'doctor' THEN 1 ELSE 0 END) AS bag_count
      FROM inventory_folders f
      LEFT JOIN inventory i ON i.folder_id = f.id
      WHERE f.owner_doctor_id IS NULL
        AND f.name IN (${REQUIRED_INVENTORY_FOLDERS.map(() => "?").join(", ")})
      GROUP BY f.name
      ORDER BY f.name
    `)
    .all(...REQUIRED_INVENTORY_FOLDERS);

  console.log("\nInventory audit:");
  rows.forEach((row) => {
    console.log(`  ${row.folder_name}: ${row.ocs_count} OCS, ${row.bag_count} doctor bag`);
  });
}

if (require.main === module) {
  try {
    initializeDatabase();
    console.log("Step 1: Purge Consumable stock...");
    const purge = purgeOcsConsumableStockSync();
    console.log(`  Removed ${purge.ocsRemoved} OCS + ${purge.doctorBagRemoved} bag row(s).`);

    console.log("\nStep 2: Seed IM Drugs catalog...");
    const seed = seedOcsIMDrugsExtensionSync({ skipInit: true });
    console.log(`  Inserted ${seed.imDrugs.inserted}, updated ${seed.imDrugs.updated}.`);

    console.log("\nStep 3: Sync doctor bags from OCS catalog...");
    const bagSync = syncDoctorStockFromOcsSync({
      skipInit: true,
      insertOnly: true,
      pruneExtras: true,
    });
    console.log(
      `  Doctors: ${bagSync.doctors}, bag rows added: ${bagSync.inserted}, pruned: ${bagSync.pruned}`,
    );

    audit();
    console.log("\nDone. Doctors: Inventory → My Stock → IM Drugs. Admins: OCS Stock → IM Drugs.");
  } catch (error) {
    console.error("Setup failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { audit };
