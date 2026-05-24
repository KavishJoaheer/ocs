const { db } = require("../db");

class InventoryVersionConflictError extends Error {
  constructor(currentItem = null) {
    super("Inventory was updated on another device. Refresh and try again.");
    this.name = "InventoryVersionConflictError";
    this.code = "INVENTORY_VERSION_CONFLICT";
    this.currentItem = currentItem;
  }
}

function ensureInventoryRowVersionColumn() {
  const columns = db.prepare("PRAGMA table_info(inventory)").all().map((column) => column.name);
  if (!columns.includes("row_version")) {
    db.exec("ALTER TABLE inventory ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1");
  }
}

function getInventoryRow(itemId) {
  ensureInventoryRowVersionColumn();
  return db.prepare("SELECT * FROM inventory WHERE id = ?").get(Number(itemId));
}

function updateInventoryQuantity(itemId, nextQuantity, options = {}) {
  ensureInventoryRowVersionColumn();

  const normalizedItemId = Number(itemId || 0);
  const normalizedQuantity = Number(nextQuantity);
  const expectedVersion =
    options.expectedVersion == null ? null : Number(options.expectedVersion);

  if (!normalizedItemId || !Number.isFinite(normalizedQuantity) || normalizedQuantity < 0) {
    return { ok: false, reason: "invalid_arguments" };
  }

  if (expectedVersion != null && Number.isFinite(expectedVersion)) {
    const result = db
      .prepare(`
        UPDATE inventory
        SET
          quantity = ?,
          row_version = row_version + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND row_version = ?
      `)
      .run(normalizedQuantity, normalizedItemId, expectedVersion);

    if (result.changes === 0) {
      return {
        ok: false,
        conflict: true,
        current: getInventoryRow(normalizedItemId),
      };
    }
  } else {
    db.prepare(`
      UPDATE inventory
      SET
        quantity = ?,
        row_version = row_version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(normalizedQuantity, normalizedItemId);
  }

  const current = getInventoryRow(normalizedItemId);
  return {
    ok: true,
    rowVersion: Number(current?.row_version || 1),
    current,
  };
}

function assertInventoryQuantityUpdate(itemId, nextQuantity, expectedVersion) {
  const result = updateInventoryQuantity(itemId, nextQuantity, { expectedVersion });
  if (result.ok) {
    return result;
  }

  if (result.conflict) {
    throw new InventoryVersionConflictError(result.current);
  }

  throw new Error("Unable to update inventory quantity.");
}

module.exports = {
  InventoryVersionConflictError,
  assertInventoryQuantityUpdate,
  ensureInventoryRowVersionColumn,
  getInventoryRow,
  updateInventoryQuantity,
};
