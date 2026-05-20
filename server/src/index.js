const { createApp } = require("./app");
const { initializeDatabase } = require("./db");
const { seedOcsMasterStockSync } = require("./scripts/seedOcsMasterStock");
const { purgeOcsTestInventoryItems } = require("./scripts/purgeOcsTestInventory");
const { syncDoctorStockFromOcsSync } = require("./scripts/syncDoctorStockFromOcs");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3001;

initializeDatabase();

const shouldSeedOcsStock = String(process.env.SEED_OCS_MASTER_STOCK ?? "false").toLowerCase() !== "false";
if (shouldSeedOcsStock) {
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

const shouldSyncDoctorStock = String(process.env.SEED_DOCTOR_STOCK_FROM_OCS ?? "false").toLowerCase() !== "false";
if (shouldSyncDoctorStock) {
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
  console.log(`Clinic management API running on http://${HOST}:${PORT}`);
});
