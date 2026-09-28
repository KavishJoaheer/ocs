const { createApp } = require("./app");
const { db, initializeDatabase } = require("./db");
const { ensureOcsCatalogSync } = require("./lib/ensureOcsCatalog");
const { prepareOcsMasterInventoryIntegrity } = require("./lib/dedupeOcsMasterInventory");
const { seedOcsMasterStockSync } = require("./scripts/seedOcsMasterStock");
const { purgeOcsTestInventoryItems } = require("./scripts/purgeOcsTestInventory");
const { syncDoctorStockFromOcsSync } = require("./scripts/syncDoctorStockFromOcs");
const { isEnvTrue } = require("./lib/envFlags");
const { alignInventoryCategories } = require("./lib/inventoryCategoryAlignment");
const { ensureTreatmentCatalogue } = require("./lib/treatmentSupplies");
const { applyTrialAkshayBagFill, correctTrialBagPlaceholders } = require("./lib/trialAkshayBagFill");

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

try {
  const categoryAlignment = alignInventoryCategories();
  if (
    categoryAlignment.updated > 0
    || categoryAlignment.inserted > 0
    || categoryAlignment.renamed > 0
    || categoryAlignment.archived > 0
  ) {
    console.log(
      `[inventory] Aligned ${categoryAlignment.updated} catalogue category row(s); renamed ${categoryAlignment.renamed} row(s); added ${categoryAlignment.inserted} required row(s); archived ${categoryAlignment.archived} retired catalogue row(s).`,
    );
  }
  if (categoryAlignment.written_off > 0) {
    console.log(
      `[inventory] Wrote off leftover stock on ${categoryAlignment.written_off} retired catalogue row(s) before archive.`,
    );
  }
  if (categoryAlignment.blocked > 0) {
    console.warn(
      `[inventory] ${categoryAlignment.blocked} retired catalogue row(s) still have active reservations and were left visible.`,
    );
  }
  if (categoryAlignment.conflicts > 0) {
    console.warn(`[inventory] ${categoryAlignment.conflicts} catalogue rename conflict(s) require review.`);
  }
} catch (error) {
  console.warn("[inventory] Catalogue category alignment failed:", error.message);
}

try {
  const treatmentCatalogue = ensureTreatmentCatalogue(db);
  if (treatmentCatalogue.inserted > 0) {
    console.log(`[inventory] Added ${treatmentCatalogue.inserted} treatment service or included supply row(s).`);
  }
} catch (error) {
  console.warn("[inventory] Treatment supply catalogue failed:", error.message);
}

try {
  const doctorCatalogue = syncDoctorStockFromOcsSync({ skipInit: true, pruneExtras: true });
  if (doctorCatalogue.inserted > 0 || doctorCatalogue.restored > 0 || doctorCatalogue.pruned > 0) {
    console.log(
      `[inventory] Doctor bags now follow the OCS warehouse catalogue (${doctorCatalogue.doctors} doctors, ${doctorCatalogue.inserted} added, ${doctorCatalogue.restored} restored, ${doctorCatalogue.pruned} removed).`,
    );
  }
  if (doctorCatalogue.prune_blocked > 0) {
    console.warn(
      `[inventory] ${doctorCatalogue.prune_blocked} doctor-bag row(s) are not in the warehouse catalogue and stay because they are reserved for a collection.`,
    );
  }
} catch (error) {
  console.warn("[inventory] Doctor bag catalogue sync failed:", error.message);
}

try {
  const trialFill = applyTrialAkshayBagFill(db);
  if (trialFill.applied) {
    console.log(
      `[inventory] Trial fill added 20 to ${trialFill.items} stock item(s) in ${trialFill.doctor_name}'s bag.`,
    );
  }
} catch (error) {
  console.warn("[inventory] Trial bag fill failed:", error.message);
}

try {
  const trialCorrection = correctTrialBagPlaceholders(db);
  if (trialCorrection.expiry_cleared > 0 || trialCorrection.lots_costed > 0) {
    console.log(
      `[inventory] Trial bag lots: cleared ${trialCorrection.expiry_cleared} placeholder expiry date(s), priced ${trialCorrection.lots_costed} unpriced lot(s) from the warehouse cost.`,
    );
  }
} catch (error) {
  console.warn("[inventory] Trial bag placeholder correction failed:", error.message);
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

let app;

try {
  app = createApp();
} catch (error) {
  console.error("[fatal] Failed to create API app:", error?.stack || error);
  process.exit(1);
}

app.listen(PORT, HOST, () => {
  const dbPath = process.env.DB_PATH || "server/data/clinic.db";
  console.log(`OCS API (SQLite, full billing + inventory) on http://${HOST}:${PORT}`);
  console.log(`[db] ${dbPath}`);
}).on("error", (error) => {
  console.error("[fatal] Failed to bind HTTP port:", error?.stack || error);
  process.exit(1);
});
