#!/usr/bin/env node
/**
 * One-shot: purge non-Consumable OCS master + all doctor bag rows in those categories.
 * Requires ALLOW_DB_PURGE=true
 *
 * Usage:
 *   docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeOcsNonConsumableAll.js
 */

const { purgeOcsInventoryCategoriesSync } = require("./purgeOcsInventoryCategories");

if (require.main === module) {
  try {
    const result = purgeOcsInventoryCategoriesSync();
    console.log("Done. Run auditInventoryCategories.js to verify.");
    if (!result.ocsRemoved && !result.doctorBagRemoved) {
      console.log("Nothing removed — database may already be clear for these categories.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { purgeOcsInventoryCategoriesSync };
