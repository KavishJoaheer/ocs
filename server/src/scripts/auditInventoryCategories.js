#!/usr/bin/env node
/**
 * Read-only audit: OCS master vs doctor bag counts per inventory folder.
 *
 * Usage:
 *   node src/scripts/auditInventoryCategories.js
 *   docker exec clinicflow-app node src/scripts/auditInventoryCategories.js
 */

const { db, initializeDatabase } = require("../db");
const { REQUIRED_INVENTORY_FOLDERS } = require("../config/inventoryFolders");

function auditInventoryCategoriesSync() {
  initializeDatabase();

  const rows = db
    .prepare(`
      SELECT
        f.name AS folder_name,
        i.stock_scope,
        COUNT(*) AS count
      FROM inventory i
      JOIN inventory_folders f ON f.id = i.folder_id
      WHERE f.owner_doctor_id IS NULL
        AND f.name IN (${REQUIRED_INVENTORY_FOLDERS.map(() => "?").join(", ")})
        AND (
          (i.stock_scope = 'ocs' AND i.owner_doctor_id IS NULL)
          OR (i.stock_scope = 'doctor' AND i.owner_doctor_id IS NOT NULL)
        )
      GROUP BY f.name, i.stock_scope
      ORDER BY f.name, i.stock_scope
    `)
    .all(...REQUIRED_INVENTORY_FOLDERS);

  const byFolder = {};
  REQUIRED_INVENTORY_FOLDERS.forEach((name) => {
    byFolder[name] = { ocs: 0, doctor: 0 };
  });
  rows.forEach((row) => {
    const key = row.stock_scope === "doctor" ? "doctor" : "ocs";
    byFolder[row.folder_name][key] = Number(row.count || 0);
  });

  return { byFolder, raw: rows };
}

if (require.main === module) {
  const { byFolder } = auditInventoryCategoriesSync();
  console.log("Inventory category audit (read-only)");
  console.log("");
  Object.entries(byFolder).forEach(([folder, counts]) => {
    const ocs = counts.ocs ? `${counts.ocs} OCS` : "0 OCS";
    const doctor = counts.doctor ? `${counts.doctor} doctor bag` : "0 doctor bag";
    console.log(`  ${folder}: ${ocs}, ${doctor}`);
  });
  console.log("");
  console.log("Expected after full purge:");
  console.log("  Consumable: OCS only (if master kept), 0 doctor bag");
  console.log("  Other 6 folders: 0 OCS, 0 doctor bag");
}

module.exports = { auditInventoryCategoriesSync };
