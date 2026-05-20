/**
 * Remove placeholder OCS master stock rows created during testing.
 * Matches names like "TEST", "TEST 10", "TEST 11" (case-insensitive).
 */

const { db } = require("../db");

const TEST_ITEM_PATTERN = /^test(\s+\S+)?$/i;

function isOcsTestItemName(name) {
  return TEST_ITEM_PATTERN.test(String(name || "").trim());
}

function purgeOcsTestInventoryItems() {
  const candidates = db
    .prepare(`
      SELECT id, item_name
      FROM inventory
      WHERE stock_scope = 'ocs'
        AND owner_doctor_id IS NULL
    `)
    .all();

  const toDelete = candidates.filter((row) => isOcsTestItemName(row.item_name));
  if (!toDelete.length) {
    return { removed: 0, names: [] };
  }

  const deleteBatches = db.prepare("DELETE FROM inventory_batches WHERE item_id = ?");
  const deleteMovements = db.prepare("DELETE FROM inventory_movements WHERE item_id = ?");
  const deleteStocktakes = db.prepare("DELETE FROM inventory_stocktakes WHERE item_id = ?");
  const deleteItem = db.prepare("DELETE FROM inventory WHERE id = ?");

  const run = db.transaction((rows) => {
    rows.forEach((row) => {
      deleteBatches.run(row.id);
      deleteMovements.run(row.id);
      try {
        deleteStocktakes.run(row.id);
      } catch {
        // inventory_stocktakes may not exist on older DBs
      }
      deleteItem.run(row.id);
    });
  });

  run(toDelete);

  return {
    removed: toDelete.length,
    names: toDelete.map((row) => row.item_name),
  };
}

if (require.main === module) {
  const { initializeDatabase } = require("../db");
  initializeDatabase();
  const result = purgeOcsTestInventoryItems();
  console.log(`Removed ${result.removed} OCS test item(s).`);
  if (result.names.length) {
    result.names.forEach((name) => console.log(`  - ${name}`));
  }
}

module.exports = { purgeOcsTestInventoryItems, isOcsTestItemName };
