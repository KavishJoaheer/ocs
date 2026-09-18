const { db } = require("../db");

// Catalogue categories are global. Keep existing warehouse and doctor-bag rows
// aligned without changing their quantities, batches, prices, or par levels.
const CATEGORY_RULES = [
  { itemName: "N/S 500ml", folderName: "IV Drugs" },
  { itemName: "2 Way Foley Catheter (Ch/Fr 14)", folderName: "Catherisation & NGT" },
  { itemName: "2 Way Foley Catheter (Ch/Fr 16)", folderName: "Catherisation & NGT" },
  { itemName: "2 Way Foley Catheter (Ch/Fr 18)", folderName: "Catherisation & NGT" },
  { itemName: "2 Way Foley Catheter (Ch/Fr 20)", folderName: "Catherisation & NGT" },
  { itemName: "2 Way Foley Catheter (Ch/Fr 22)", folderName: "Catherisation & NGT" },
  { itemName: "Irrigation Syringe (50ml)", folderName: "Catherisation & NGT" },
  { itemName: "NGT (14fg x105cm)", folderName: "Catherisation & NGT" },
  { itemName: "NGT (16fg x105cm)", folderName: "Catherisation & NGT" },
  { itemName: "NGT (18fg x105cm)", folderName: "Catherisation & NGT" },
  { itemName: "Nebulizer Mask (Adult)", folderName: "O2 & Nebuliser" },
  { itemName: "Nebulizer Mask (Paediatric)", folderName: "O2 & Nebuliser" },
  {
    itemName: "O2 first 30mins",
    folderName: "O2 & Nebuliser",
    ensureEverywhere: true,
    unit: "30 min session",
  },
  {
    itemName: "O2 second 30 mins",
    folderName: "O2 & Nebuliser",
    ensureEverywhere: true,
    unit: "30 min session",
  },
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
  const findRow = db.prepare(`
    SELECT id
    FROM inventory
    WHERE stock_scope = ?
      AND COALESCE(owner_doctor_id, 0) = ?
      AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
    ORDER BY id ASC
    LIMIT 1
  `);
  const insertRow = db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity,
      unit, cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
    ) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 0, ?, '', '', NULL, CURRENT_TIMESTAMP)
  `);
  const updateRows = db.prepare(`
    UPDATE inventory
    SET folder_id = ?, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      AND folder_id != ?
  `);

  const align = db.transaction(() => {
    let updated = 0;
    let inserted = 0;
    for (const rule of CATEGORY_RULES) {
      const folderId = globalFolderId(rule.folderName);
      if (rule.ensureEverywhere) {
        const locations = [
          { scope: "ocs", ownerDoctorId: null },
          ...db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id").all()
            .map((doctor) => ({ scope: "doctor", ownerDoctorId: Number(doctor.id) })),
        ];
        for (const location of locations) {
          if (findRow.get(location.scope, location.ownerDoctorId || 0, rule.itemName)) continue;
          insertRow.run(
            rule.itemName,
            folderId,
            location.scope,
            location.ownerDoctorId,
            rule.unit || "unit",
            "Price must be configured before billing.",
          );
          inserted += 1;
        }
      }
      updated += Number(updateRows.run(folderId, rule.itemName, folderId).changes || 0);
    }
    return { updated, inserted };
  });

  return align();
}

module.exports = { alignInventoryCategories, CATEGORY_RULES };
