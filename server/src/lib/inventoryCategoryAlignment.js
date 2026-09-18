const { db } = require("../db");

// Catalogue categories are global. Keep existing warehouse and doctor-bag rows
// aligned without changing their quantities, batches, prices, or par levels.
const CATEGORY_RULES = [
  { itemName: "N/S 500ml", folderName: "IV Drugs" },
];

function globalFolderId(folderName) {
  const folder = db
    .prepare(`
      SELECT id
      FROM inventory_folders
      WHERE owner_doctor_id IS NULL
        AND name = ?
      ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `)
    .get(folderName);

  if (folder) return Number(folder.id);

  return Number(
    db
      .prepare(`
        INSERT INTO inventory_folders (name, parent_id, owner_doctor_id, updated_at)
        VALUES (?, NULL, NULL, CURRENT_TIMESTAMP)
      `)
      .run(folderName).lastInsertRowid,
  );
}

function alignInventoryCategories() {
  const updateRows = db.prepare(`
    UPDATE inventory
    SET folder_id = ?, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      AND folder_id != ?
  `);

  const align = db.transaction(() => {
    let updated = 0;
    for (const rule of CATEGORY_RULES) {
      const folderId = globalFolderId(rule.folderName);
      updated += Number(updateRows.run(folderId, rule.itemName, folderId).changes || 0);
    }
    return updated;
  });

  return { updated: align() };
}

module.exports = { alignInventoryCategories, CATEGORY_RULES };
