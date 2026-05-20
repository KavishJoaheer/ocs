const { createApp } = require("./app");
const { initializeDatabase } = require("./db");
const { seedOcsMasterStockSync } = require("./scripts/seedOcsMasterStock");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3001;

initializeDatabase();

const shouldSeedOcsStock = String(process.env.SEED_OCS_MASTER_STOCK ?? "true").toLowerCase() !== "false";
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

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`Clinic management API running on http://${HOST}:${PORT}`);
});
