const { ocsConsumablesExtension } = require("../config/ocsConsumablesExtension");
const { upsertOcsMasterStockDataset } = require("./ocsMasterStockUpsert");
const { filterCatalogRowsNotExcluded, isOcsCatalogExcluded } = require("./ocsCatalogExclusions");
const { db } = require("../db");

/** Explicit seed scripts only — Consumable manifest (no IM/IV/etc auto-restore). */
const OCS_FULL_CATALOG_ROWS = [...ocsConsumablesExtension];

/** Startup ensure: disabled — use seed:ocs-consumables or seed:ocs-im-drugs explicitly. */
const OCS_CATALOG_ROWS = [];

let catalogEnsureComplete = false;

function getActiveCatalogRows() {
  return filterCatalogRowsNotExcluded(OCS_CATALOG_ROWS);
}

function countMissingOcsCatalogItems() {
  return getActiveCatalogRows().filter((entry) => {
    if (isOcsCatalogExcluded(entry.name)) return false;
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

  const ocsSummary = upsertOcsMasterStockDataset(getActiveCatalogRows(), {
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
  getActiveCatalogRows,
  OCS_CATALOG_ROWS,
  OCS_FULL_CATALOG_ROWS,
};
