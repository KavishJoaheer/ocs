/**
 * Remove placeholder inventory rows created during testing.
 * Applies to OCS master stock and every doctor medical bag.
 * Matches names like "TEST", "TEST 10", "TEST 11" (case-insensitive).
 */

const { db } = require("../db");

const TEST_ITEM_PATTERN = /^test(\s+\S+)?$/i;

function isTestInventoryItemName(name) {
  return TEST_ITEM_PATTERN.test(String(name || "").trim());
}

function purgeTestInventoryItems() {
  const candidates = db
    .prepare(`
      SELECT id, item_name, stock_scope, owner_doctor_id
      FROM inventory
      WHERE stock_scope IN ('ocs', 'doctor')
    `)
    .all();

  const toDelete = candidates.filter((row) => isTestInventoryItemName(row.item_name));
  if (!toDelete.length) {
    return { removed: 0, ocsRemoved: 0, doctorRemoved: 0, names: [] };
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

  const ocsRemoved = toDelete.filter((row) => row.stock_scope === "ocs").length;
  const doctorRemoved = toDelete.filter((row) => row.stock_scope === "doctor").length;

  return {
    removed: toDelete.length,
    ocsRemoved,
    doctorRemoved,
    names: toDelete.map((row) => row.item_name),
  };
}

function purgeOcsTestInventoryItems() {
  return purgeTestInventoryItems();
}

if (require.main === module) {
  const { initializeDatabase } = require("../db");
  initializeDatabase();
  const result = purgeTestInventoryItems();
  console.log(`Removed ${result.removed} test inventory item(s).`);
  console.log(`  OCS master stock: ${result.ocsRemoved}`);
  console.log(`  Doctor bags:      ${result.doctorRemoved}`);
  if (result.names.length) {
    result.names.forEach((name) => console.log(`  - ${name}`));
  }
}

module.exports = {
  purgeTestInventoryItems,
  purgeOcsTestInventoryItems,
  isTestInventoryItemName,
  isOcsTestItemName: isTestInventoryItemName,
};
