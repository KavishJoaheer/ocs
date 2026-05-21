const { db } = require("../db");

function normalizeCatalogItemName(name) {
  return String(name || "").trim().toLowerCase();
}

function ensureOcsCatalogExclusionsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ocs_catalog_exclusions (
      item_name_key TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      excluded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      excluded_by_user_id INTEGER
    );
  `);
}

function isOcsCatalogExcluded(itemName) {
  const key = normalizeCatalogItemName(itemName);
  if (!key) return false;
  ensureOcsCatalogExclusionsTable();
  const row = db
    .prepare("SELECT item_name_key FROM ocs_catalog_exclusions WHERE item_name_key = ?")
    .get(key);
  return Boolean(row);
}

function recordOcsCatalogExclusion(itemName, userId = null) {
  const key = normalizeCatalogItemName(itemName);
  const label = String(itemName || "").trim();
  if (!key || !label) return;

  ensureOcsCatalogExclusionsTable();
  db.prepare(`
    INSERT INTO ocs_catalog_exclusions (item_name_key, item_name, excluded_by_user_id)
    VALUES (?, ?, ?)
    ON CONFLICT(item_name_key) DO UPDATE SET
      item_name = excluded.item_name,
      excluded_at = CURRENT_TIMESTAMP,
      excluded_by_user_id = excluded.excluded_by_user_id
  `).run(key, label, userId || null);
}

function filterCatalogRowsNotExcluded(rows = []) {
  return rows.filter((row) => !isOcsCatalogExcluded(row.name));
}

/** Remove catalog exclusions so explicit seed scripts can re-import SKUs. */
function clearOcsCatalogExclusionsForNames(names = []) {
  const keys = [
    ...new Set(
      names
        .map((name) => normalizeCatalogItemName(name))
        .filter(Boolean),
    ),
  ];
  if (!keys.length) return 0;

  ensureOcsCatalogExclusionsTable();
  const placeholders = keys.map(() => "?").join(", ");
  const result = db
    .prepare(`DELETE FROM ocs_catalog_exclusions WHERE item_name_key IN (${placeholders})`)
    .run(...keys);
  return result.changes;
}

/** Block startup/catalog ensure from re-inserting bundled Consumable seed SKUs. */
function excludeOcsConsumablesCatalogSeed() {
  const { ocsConsumablesExtension } = require("../config/ocsConsumablesExtension");
  const { ocsMasterStockData } = require("../config/ocsMasterStockData");
  const names = new Set();
  [...ocsConsumablesExtension, ...ocsMasterStockData].forEach((row) => {
    const label = String(row.name || "").trim();
    if (label) names.add(label);
  });
  names.forEach((name) => recordOcsCatalogExclusion(name));
  return names.size;
}

module.exports = {
  ensureOcsCatalogExclusionsTable,
  normalizeCatalogItemName,
  isOcsCatalogExcluded,
  recordOcsCatalogExclusion,
  filterCatalogRowsNotExcluded,
  clearOcsCatalogExclusionsForNames,
  excludeOcsConsumablesCatalogSeed,
};
