const { ocsMasterStockData } = require("../config/ocsMasterStockData");
const { ocsConsumablesExtension } = require("../config/ocsConsumablesExtension");
const { ocsIMDrugsExtension } = require("../config/ocsIMDrugsExtension");
const { upsertOcsMasterStockDataset } = require("./ocsMasterStockUpsert");
const { syncDoctorStockFromOcsSync } = require("../scripts/syncDoctorStockFromOcs");
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

function countMissingDoctorCatalogRows() {
  const doctors = db
    .prepare("SELECT id FROM doctors WHERE deleted_at IS NULL")
    .all();
  const ocsItems = db
    .prepare(`
      SELECT item_name
      FROM inventory
      WHERE stock_scope = 'ocs'
        AND owner_doctor_id IS NULL
    `)
    .all();

  let missing = 0;
  doctors.forEach((doctor) => {
    ocsItems.forEach((item) => {
      const existing = db
        .prepare(`
          SELECT id
          FROM inventory
          WHERE stock_scope = 'doctor'
            AND owner_doctor_id = ?
            AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
          LIMIT 1
        `)
        .get(doctor.id, item.item_name);
      if (!existing) missing += 1;
    });
  });
  return missing;
}

function ensureOcsCatalogSync({ force = false } = {}) {
  if (catalogEnsureComplete && !force) {
    return { ocs: null, doctors: null, skipped: true };
  }

  const missingOcs = countMissingOcsCatalogItems();
  const missingDoctorRows = countMissingDoctorCatalogRows();
  if (!force && missingOcs === 0 && missingDoctorRows === 0) {
    catalogEnsureComplete = true;
    return { ocs: null, doctors: null, skipped: true };
  }

  const ocsSummary = upsertOcsMasterStockDataset(OCS_CATALOG_ROWS, {
    skipInit: true,
    insertOnly: true,
  });
  const doctorSummary = syncDoctorStockFromOcsSync({
    skipInit: true,
    insertOnly: true,
    pruneExtras: false,
  });

  catalogEnsureComplete = true;
  return { ocs: ocsSummary, doctors: doctorSummary, skipped: false };
}

module.exports = {
  ensureOcsCatalogSync,
  countMissingOcsCatalogItems,
  OCS_CATALOG_ROWS,
  OCS_FULL_CATALOG_ROWS,
};
