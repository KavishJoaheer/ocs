const { db, initializeDatabase } = require("../db");
const { REQUIRED_INVENTORY_FOLDERS } = require("../config/inventoryFolders");

const REQUIRED_FOLDERS = REQUIRED_INVENTORY_FOLDERS;
const STOCK_SCOPE = "ocs";

function normalizeInventoryFolders() {
  const updateInventoryFolder = db.prepare("UPDATE inventory SET folder_id = ? WHERE folder_id = ?");
  const updateStagingFolder = db.prepare("UPDATE inventory_staging SET folder_id = ? WHERE folder_id = ?");
  const deleteFolder = db.prepare("DELETE FROM inventory_folders WHERE id = ?");

  REQUIRED_FOLDERS.forEach((name) => {
    const matches = db
      .prepare(`
        SELECT id, parent_id
        FROM inventory_folders
        WHERE owner_doctor_id IS NULL
          AND name = ?
        ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, id ASC
      `)
      .all(name);

    if (!matches.length) return;

    const canonicalId = Number(matches[0].id);
    matches.slice(1).forEach((row) => {
      const duplicateId = Number(row.id);
      updateInventoryFolder.run(canonicalId, duplicateId);
      try {
        updateStagingFolder.run(canonicalId, duplicateId);
      } catch {
        // inventory_staging may not exist on older DBs
      }
      deleteFolder.run(duplicateId);
    });

    db.prepare(`
      UPDATE inventory
      SET folder_id = ?
      WHERE folder_id IN (
        SELECT id
        FROM inventory_folders
        WHERE owner_doctor_id IS NULL
          AND name = ?
          AND id != ?
      )
    `).run(canonicalId, name, canonicalId);
  });
}

function ensureInventoryFolders() {
  normalizeInventoryFolders();

  const insertFolder = db.prepare(`
    INSERT INTO inventory_folders (name, parent_id, owner_doctor_id, updated_at)
    VALUES (?, NULL, NULL, CURRENT_TIMESTAMP)
  `);

  REQUIRED_FOLDERS.forEach((name) => {
    const existing = db
      .prepare("SELECT id FROM inventory_folders WHERE owner_doctor_id IS NULL AND name = ?")
      .get(name);
    if (!existing) insertFolder.run(name);
  });

  normalizeInventoryFolders();
}

function getFolderIdByCategory(category) {
  const row = db
    .prepare(`
      SELECT id
      FROM inventory_folders
      WHERE owner_doctor_id IS NULL
        AND name = ?
      ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `)
    .get(category);
  return row ? Number(row.id) : null;
}

function findOcsItemByName(name) {
  return db
    .prepare(`
      SELECT id, quantity
      FROM inventory
      WHERE stock_scope = ?
        AND owner_doctor_id IS NULL
        AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      ORDER BY id ASC
      LIMIT 1
    `)
    .get(STOCK_SCOPE, name);
}

function syncBatches(itemId, quantity, expiryDate) {
  db.prepare("DELETE FROM inventory_batches WHERE item_id = ?").run(itemId);
  if (quantity > 0) {
    db.prepare(`
      INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost)
      VALUES (?, ?, ?, 0)
    `).run(itemId, quantity, expiryDate);
  }
}

function upsertOcsMasterStockRow(row, folderId, { insertOnly = false } = {}) {
  const itemName = String(row.name || "").trim();
  const quantity = Number(row.current_quantity ?? 0);
  const minimumQuantity = Number(row.par_level ?? 0);
  const expiryDate = row.nearest_expiry ? String(row.nearest_expiry).trim() : null;

  if (!itemName) {
    throw new Error("Row is missing name.");
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`${itemName}: current_quantity must be a non-negative integer.`);
  }
  if (!Number.isInteger(minimumQuantity) || minimumQuantity < 0) {
    throw new Error(`${itemName}: par_level must be a non-negative integer.`);
  }

  const existing = findOcsItemByName(itemName);

  if (existing) {
    if (insertOnly) {
      db.prepare(`
        UPDATE inventory
        SET folder_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(folderId, existing.id);
      return { action: "skipped", id: existing.id, itemName };
    }

    db.prepare(`
      UPDATE inventory
      SET
        folder_id = ?,
        quantity = ?,
        minimum_quantity = ?,
        expiry_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(folderId, quantity, minimumQuantity, expiryDate, existing.id);

    syncBatches(existing.id, quantity, expiryDate);
    return { action: "updated", id: existing.id, itemName };
  }

  const result = db
    .prepare(`
      INSERT INTO inventory (
        item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
        cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
      )
      VALUES (?, ?, ?, NULL, ?, ?, 'unit', 0, 0, '', '', '', ?, CURRENT_TIMESTAMP)
    `)
    .run(itemName, folderId, STOCK_SCOPE, quantity, minimumQuantity, expiryDate);

  const itemId = Number(result.lastInsertRowid);
  syncBatches(itemId, quantity, expiryDate);
  return { action: "inserted", id: itemId, itemName };
}

/**
 * Upsert OCS master warehouse rows (shared inventory table — visible to admin, operator, doctor).
 * @param {Array<{name:string,category:string,current_quantity:number,par_level:number,nearest_expiry:string|null}>} rows
 */
function upsertOcsMasterStockDataset(rows, { skipInit = false, insertOnly = false } = {}) {
  if (!skipInit) {
    initializeDatabase();
  }
  ensureInventoryFolders();

  const folderIds = new Map(
    REQUIRED_FOLDERS.map((name) => [name, getFolderIdByCategory(name)]),
  );

  const missingFolders = REQUIRED_FOLDERS.filter((name) => !folderIds.get(name));
  if (missingFolders.length) {
    throw new Error(`Missing inventory folders: ${missingFolders.join(", ")}`);
  }

  const unknownCategories = [
    ...new Set(rows.map((row) => row.category).filter((category) => !folderIds.has(category))),
  ];
  if (unknownCategories.length) {
    throw new Error(`Unknown categories in seed data: ${unknownCategories.join(", ")}`);
  }

  const run = db.transaction((dataset) => {
    const summary = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    dataset.forEach((row) => {
      try {
        const folderId = folderIds.get(row.category);
        const result = upsertOcsMasterStockRow(row, folderId, { insertOnly });
        if (result.action === "inserted") summary.inserted += 1;
        else if (result.action === "updated") summary.updated += 1;
        else summary.skipped += 1;
      } catch (error) {
        summary.errors.push({ name: row.name, message: error.message });
      }
    });

    return summary;
  });

  return run(rows);
}

module.exports = {
  upsertOcsMasterStockDataset,
  ensureInventoryFolders,
  findOcsItemByName,
};
