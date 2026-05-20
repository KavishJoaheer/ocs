#!/usr/bin/env node
/**
 * Remove all OCS master + doctor-bag rows in the Consumable folder.
 * Records catalog exclusions so items are not auto-re-inserted on restart.
 *
 * Requires ALLOW_DB_PURGE=true
 *
 * Usage:
 *   ALLOW_DB_PURGE=true node src/scripts/purgeOcsConsumableStock.js
 *   docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeOcsConsumableStock.js
 */

const { purgeOcsInventoryCategoriesSync } = require("./purgeOcsInventoryCategories");
const { excludeOcsConsumablesCatalogSeed } = require("../lib/ocsCatalogExclusions");

const CONSUMABLE_FOLDER = "Consumable";

if (require.main === module) {
  try {
    const result = purgeOcsInventoryCategoriesSync({ folderNames: [CONSUMABLE_FOLDER] });
    const seedExcluded = excludeOcsConsumablesCatalogSeed();

    console.log("OCS Consumable stock purge complete.");
    console.log(`  OCS master rows removed:  ${result.ocsRemoved}`);
    console.log(`  Doctor bag rows removed: ${result.doctorBagRemoved}`);
    console.log(`  Catalog seed SKUs excluded from auto-restore: ${seedExcluded}`);
    const uniqueNames = [...new Set(result.names)];
    if (uniqueNames.length) {
      console.log(`  Unique SKUs removed: ${uniqueNames.length}`);
    } else {
      console.log("  Consumable folder was already empty.");
    }
    console.log("");
    console.log("Other categories (IM/IV/Wound/Oral/Pediatric/Investigation) were not changed.");
    console.log("Re-import later with: node src/scripts/seedOcsConsumablesExtension.js");
  } catch (error) {
    console.error("Purge failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { purgeOcsInventoryCategoriesSync, CONSUMABLE_FOLDER };
