const { ocsMasterStockData } = require("../config/ocsMasterStockData");
const { ocsConsumablesExtension } = require("../config/ocsConsumablesExtension");
const { ocsIMDrugsExtension } = require("../config/ocsIMDrugsExtension");
const { upsertOcsMasterStockDataset } = require("./ocsMasterStockUpsert");
const { db } = require("../db");

/** Full catalog for explicit seed scripts (seed:ocs-stock, warehouse purge/reseed). */
const OCS_FULL_CATALOG_ROWS = [
  ...ocsMasterStockData,
  ...ocsConsumablesExtension,
  ...ocsIMDrugsExtension,
];

/** Startup ensure: Consumable SKUs only (other categories stay empty after category purge). */
const OCS_CATALOG_ROWS = [...ocsConsumablesExtension];

let catalogEnsureComplete = false;

function countMissingOcsCatalogItems() {
  return OCS_CATALOG_ROWS.filter((entry) => {
    const existing = db
      .prepare(`
        SELECT id
        FROM inventory
        WHERE stock_scope = 'ocs'
          AND owner_doctor_id IS NULL
          AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
        LIMIT 1
      `)
      .get(entry.name);
    return !existing;
  }).length;
}

function ensureOcsCatalogSync({ force = false } = {}) {
  if (catalogEnsureComplete && !force) {
    return { ocs: null, doctors: null, skipped: true };
  }

  const missingOcs = countMissingOcsCatalogItems();
  if (!force && missingOcs === 0) {
    catalogEnsureComplete = true;
    return { ocs: null, doctors: null, skipped: true };
  }

  const ocsSummary = upsertOcsMasterStockDataset(OCS_CATALOG_ROWS, {
    skipInit: true,
    insertOnly: true,
  });

  // Doctor bag rows are NOT auto-created here (purges would be undone on the next
  // inventory page load). Use seed:doctor-stock or SEED_DOCTOR_STOCK_FROM_OCS=true.
  catalogEnsureComplete = true;
  return { ocs: ocsSummary, doctors: null, skipped: false };
}

module.exports = {
  ensureOcsCatalogSync,
  countMissingOcsCatalogItems,
  OCS_CATALOG_ROWS,
  OCS_FULL_CATALOG_ROWS,
};
