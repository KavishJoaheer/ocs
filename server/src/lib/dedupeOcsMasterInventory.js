const { db } = require("../db");
const { findOcsItemByName } = require("./ocsMasterStockUpsert");

const UNIQUE_INDEX = "idx_inventory_ocs_master_item_name_unique";

function normalizeItemNameKey(name) {
  return String(name || "").trim().toLowerCase();
}

function tableExists(tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function reassignItemReferences(fromId, toId) {
  const tables = [
    ["inventory_batches", "item_id"],
    ["inventory_movements", "item_id"],
    ["inventory_stocktakes", "item_id"],
    ["inventory_audit_logs", "item_id"],
  ];

  tables.forEach(([table, column]) => {
    if (!tableExists(table)) return;
    try {
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(toId, fromId);
    } catch {
      // Older DBs may lack optional tables.
    }
  });
}

/**
 * Merge duplicate OCS master rows that share the same item name (case-insensitive).
 * Keeps the lowest id, sums quantities, takes max par level, moves batches/movements.
 */
function dedupeOcsMasterInventorySync() {
  const duplicateKeys = db
    .prepare(`
      SELECT LOWER(TRIM(item_name)) AS name_key
      FROM inventory
      WHERE stock_scope = 'ocs'
        AND owner_doctor_id IS NULL
      GROUP BY name_key
      HAVING COUNT(*) > 1
    `)
    .all()
    .map((row) => row.name_key)
    .filter(Boolean);

  if (!duplicateKeys.length) {
    return { mergedGroups: 0, removedRows: 0 };
  }

  let removedRows = 0;

  const run = db.transaction((keys) => {
    keys.forEach((nameKey) => {
      const rows = db
        .prepare(`
          SELECT id, quantity, minimum_quantity
          FROM inventory
          WHERE stock_scope = 'ocs'
            AND owner_doctor_id IS NULL
            AND LOWER(TRIM(item_name)) = ?
          ORDER BY id ASC
        `)
        .all(nameKey);

      if (rows.length < 2) return;

      const keeper = rows[0];
      const duplicates = rows.slice(1);
      const totalQuantity = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      const maxMinimum = rows.reduce(
        (max, row) => Math.max(max, Number(row.minimum_quantity || 0)),
        0,
      );

      duplicates.forEach((dup) => {
        reassignItemReferences(Number(dup.id), Number(keeper.id));
        db.prepare("DELETE FROM inventory WHERE id = ?").run(dup.id);
        removedRows += 1;
      });

      db.prepare(`
        UPDATE inventory
        SET quantity = ?, minimum_quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(totalQuantity, maxMinimum, keeper.id);
    });
  });

  run(duplicateKeys);

  return {
    mergedGroups: duplicateKeys.length,
    removedRows,
  };
}

function ensureOcsMasterItemNameUniqueIndex() {
  const existing = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(UNIQUE_INDEX);

  if (existing) return { created: false };

  db.exec(`
    CREATE UNIQUE INDEX ${UNIQUE_INDEX}
    ON inventory (item_name COLLATE NOCASE)
    WHERE stock_scope = 'ocs' AND owner_doctor_id IS NULL
  `);

  return { created: true };
}

function assertOcsMasterItemNameAvailable(itemName, excludeItemId = null) {
  const existing = findOcsItemByName(itemName);
  if (!existing) return;
  if (excludeItemId && Number(existing.id) === Number(excludeItemId)) return;
  throw new Error(`An OCS stock item named "${String(itemName).trim()}" already exists.`);
}

function prepareOcsMasterInventoryIntegrity() {
  const dedupeSummary = dedupeOcsMasterInventorySync();
  const indexSummary = ensureOcsMasterItemNameUniqueIndex();
  return { ...dedupeSummary, uniqueIndex: indexSummary };
}

module.exports = {
  dedupeOcsMasterInventorySync,
  ensureOcsMasterItemNameUniqueIndex,
  assertOcsMasterItemNameAvailable,
  prepareOcsMasterInventoryIntegrity,
  normalizeItemNameKey,
  UNIQUE_INDEX,
};
