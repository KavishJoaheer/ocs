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

function adjustInventoryQuantity(itemId, delta) {
  ensureInventoryRowVersionColumn();

  const normalizedItemId = Number(itemId || 0);
  const normalizedDelta = Number(delta);
  if (!normalizedItemId || !Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
    return { ok: false, reason: "invalid_arguments" };
  }

  const result = db
    .prepare(`
      UPDATE inventory
      SET
        quantity = quantity + ?,
        row_version = row_version + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND quantity + ? >= 0
    `)
    .run(normalizedDelta, normalizedItemId, normalizedDelta);

  if (result.changes === 0) {
    return {
      ok: false,
      reason: "insufficient_quantity",
      current: getInventoryRow(normalizedItemId),
    };
  }

  const current = getInventoryRow(normalizedItemId);
  const nextQuantity = Number(current?.quantity || 0);
  return {
    ok: true,
    previousQuantity: nextQuantity - normalizedDelta,
    nextQuantity,
    rowVersion: Number(current?.row_version || 1),
    current,
  };
}

function assertInventoryQuantityAdjust(itemId, delta) {
  const result = adjustInventoryQuantity(itemId, delta);
  if (result.ok) {
    return result;
  }

  const error = new Error("Inventory was updated on another device. Refresh and try again.");
  error.status = 409;
  error.code = result.reason || "INVENTORY_QUANTITY_CONFLICT";
  error.currentItem = result.current || null;
  throw error;
}

module.exports = {
  InventoryVersionConflictError,
  adjustInventoryQuantity,
  assertInventoryQuantityAdjust,
  assertInventoryQuantityUpdate,
  ensureInventoryRowVersionColumn,
  getInventoryRow,
  updateInventoryQuantity,
};
