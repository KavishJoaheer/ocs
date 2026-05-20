const { createApp } = require("./app");
const { initializeDatabase } = require("./db");
const { ensureOcsCatalogSync } = require("./lib/ensureOcsCatalog");
const { prepareOcsMasterInventoryIntegrity } = require("./lib/dedupeOcsMasterInventory");
const { seedOcsMasterStockSync } = require("./scripts/seedOcsMasterStock");
const { purgeOcsTestInventoryItems } = require("./scripts/purgeOcsTestInventory");
const { syncDoctorStockFromOcsSync } = require("./scripts/syncDoctorStockFromOcs");
const { isEnvTrue } = require("./lib/envFlags");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3001;

initializeDatabase();

try {
  const integrity = prepareOcsMasterInventoryIntegrity();
  if (integrity.removedRows > 0) {
    console.log(
      `[inventory] Merged ${integrity.mergedGroups} duplicate OCS SKU group(s); removed ${integrity.removedRows} row(s).`,
    );
  }
} catch (error) {
  console.warn("[inventory] OCS master dedupe/unique index failed:", error.message);
}

try {
  const catalogResult = ensureOcsCatalogSync();
  if (!catalogResult.skipped) {
    if (catalogResult.ocs?.inserted > 0) {
      console.log(`[catalog] Added ${catalogResult.ocs.inserted} missing OCS catalog item(s).`);
    }
    if (catalogResult.doctors?.inserted > 0) {
      console.log(
        `[catalog] Added ${catalogResult.doctors.inserted} missing doctor bag catalog row(s).`,
      );
    }
  }
} catch (error) {
  console.warn("[catalog] OCS catalog ensure failed:", error.message);
}

if (isEnvTrue("SEED_OCS_MASTER_STOCK")) {
  try {
    const summary = seedOcsMasterStockSync({ skipInit: true });
    console.log(`[seed] OCS master stock synced (${summary.inserted} new, ${summary.updated} updated)`);
    if (summary.errors.length) {
      console.warn(`[seed] OCS master stock completed with ${summary.errors.length} row error(s).`);
    }
  } catch (error) {
    console.warn("[seed] OCS master stock sync failed:", error.message);
  }
}

try {
  const purgeResult = purgeOcsTestInventoryItems();
  if (purgeResult.removed > 0) {
    console.log(
      `[seed] Removed ${purgeResult.removed} test inventory item(s) (${purgeResult.ocsRemoved} OCS, ${purgeResult.doctorRemoved} doctor bag).`,
    );
  }
} catch (error) {
  console.warn("[seed] Test inventory purge failed:", error.message);
}

if (isEnvTrue("SEED_DOCTOR_STOCK_FROM_OCS")) {
  try {
    const doctorSummary = syncDoctorStockFromOcsSync({ skipInit: true, pruneExtras: true });
    console.log(
      `[seed] Doctor bags synced from OCS (${doctorSummary.doctors} doctors, ${doctorSummary.inserted} new, ${doctorSummary.updated} updated, ${doctorSummary.pruned} pruned).`,
    );
    if (doctorSummary.errors.length) {
      console.warn(`[seed] Doctor stock sync completed with ${doctorSummary.errors.length} doctor error(s).`);
    }
  } catch (error) {
    console.warn("[seed] Doctor stock sync from OCS failed:", error.message);
  }
}

const app = createApp();

app.listen(PORT, HOST, () => {
  const dbPath = process.env.DB_PATH || "server/data/clinic.db";
  console.log(`OCS API (SQLite, full billing + inventory) on http://${HOST}:${PORT}`);
  console.log(`[db] ${dbPath}`);
});
