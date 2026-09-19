const { db } = require("../db");
const { recordOcsCatalogExclusion } = require("./ocsCatalogExclusions");

// Catalogue categories are global. Keep existing warehouse and doctor-bag rows
// aligned without changing their quantities, batches, prices, or par levels.
const CATEGORY_RULES = [
  {
    itemName: "DNS/Dextrose 50%",
    aliases: [
      "Sodium Chloride&Dextrose(500ml)",
      "Sodium Chloride & Dextrose (500ml)",
      "Sodium Chloride & Dextrose(500ml)",
      "Sodium Chloride&Dextrose (500ml)",
    ],
    folderName: "IV Drugs",
    ensureEverywhere: true,
    unit: "bag",
  },
  { itemName: "N/S 100ml", folderName: "IV Drugs" },
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
  { itemName: "Urine bag", folderName: "Catherisation & NGT" },
  { itemName: "Nebulizer Mask (Adult)", folderName: "O2 & Nebuliser" },
  { itemName: "Nebulizer Mask (Paediatric)", folderName: "O2 & Nebuliser" },
  {
    itemName: "O2 first 30mins",
    folderName: "O2 & Nebuliser",
    ensureEverywhere: true,
    unit: "30 min session",
    itemKind: "service",
  },
  {
    itemName: "O2 second 30 mins",
    folderName: "O2 & Nebuliser",
    ensureEverywhere: true,
    unit: "30 min session",
    itemKind: "service",
  },
];

const RETIRED_OCS_CONSUMABLE_SKUS = [
  "Micropore 1 inch (Box of 12)",
  "Gown",
  "White Adhesive Tape",
];

function retireRemovedOcsConsumableSkus() {
  return db.transaction(() => {
    let archived = 0;
    let blocked = 0;
    for (const itemName of RETIRED_OCS_CONSUMABLE_SKUS) {
      recordOcsCatalogExclusion(itemName);
      const rows = db.prepare(`
        SELECT i.*,
          COALESCE((
            SELECT SUM(b.quantity_remaining)
            FROM inventory_batches b
            WHERE b.item_id = i.id AND b.quantity_remaining > 0
          ), 0) AS live_batch_quantity,
          COALESCE((
            SELECT SUM(r.quantity)
            FROM inventory_reservations r
            WHERE r.inventory_id = i.id AND r.status = 'active'
          ), 0) AS reserved_quantity
        FROM inventory i
        WHERE LOWER(TRIM(i.item_name)) = LOWER(TRIM(?))
          AND i.archived_at IS NULL
          AND (
            (i.stock_scope = 'ocs' AND i.owner_doctor_id IS NULL)
            OR (i.stock_scope = 'doctor' AND i.owner_doctor_id IS NOT NULL)
          )
      `).all(itemName);
      for (const row of rows) {
        const safeToArchive =
          Number(row.quantity || 0) === 0 &&
          Number(row.live_batch_quantity || 0) === 0 &&
          Number(row.reserved_quantity || 0) === 0;
        if (!safeToArchive) {
          blocked += 1;
          continue;
        }
        archived += Number(db.prepare(`
          UPDATE inventory
          SET archived_at = CURRENT_TIMESTAMP,
              row_version = COALESCE(row_version, 1) + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND archived_at IS NULL
        `).run(row.id).changes || 0);
      }
    }
    return { archived, blocked };
  })();
}

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
  const insertRow = db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity,
      unit, cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, 0, ?, '', '', NULL, CURRENT_TIMESTAMP)
  `);
  const updateRows = db.prepare(`
    UPDATE inventory
    SET folder_id = ?, item_kind = ?, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      AND folder_id != ?
  `);
  const renameRow = db.prepare(`
    UPDATE inventory
    SET item_name = ?, folder_id = ?, item_kind = ?, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const align = db.transaction(() => {
    let updated = 0;
    let inserted = 0;
    let renamed = 0;
    let conflicts = 0;
    const locations = [
      { scope: "ocs", ownerDoctorId: null },
      ...db.prepare("SELECT id FROM doctors WHERE deleted_at IS NULL ORDER BY id").all()
        .map((doctor) => ({ scope: "doctor", ownerDoctorId: Number(doctor.id) })),
    ];
    for (const rule of CATEGORY_RULES) {
      const folderId = globalFolderId(rule.folderName);
      const itemKind = rule.itemKind || "stock";
      const aliases = Array.isArray(rule.aliases) ? rule.aliases : [];
      if (rule.ensureEverywhere || aliases.length) {
        const candidateNames = [rule.itemName, ...aliases];
        const placeholders = candidateNames.map(() => "LOWER(TRIM(?))").join(", ");
        const findCandidates = db.prepare(`
          SELECT id, item_name
          FROM inventory
          WHERE stock_scope = ?
            AND COALESCE(owner_doctor_id, 0) = ?
            AND archived_at IS NULL
            AND LOWER(TRIM(item_name)) IN (${placeholders})
          ORDER BY id ASC
        `);
        for (const location of locations) {
          const rows = findCandidates.all(
            location.scope,
            location.ownerDoctorId || 0,
            ...candidateNames,
          );
          const canonical = rows.find(
            (row) => String(row.item_name || "").trim().toLowerCase() === rule.itemName.toLowerCase(),
          );
          const aliasRows = rows.filter((row) => row !== canonical);
          if (!canonical && aliasRows.length) {
            renameRow.run(rule.itemName, folderId, itemKind, aliasRows[0].id);
            renamed += 1;
            if (aliasRows.length > 1) conflicts += aliasRows.length - 1;
            continue;
          }
          if (canonical && aliasRows.length) {
            // Never merge potentially independent stock rows silently. Keep them
            // visible in the correct folder and report the conflict for review.
            conflicts += aliasRows.length;
          }
          if (!canonical && !aliasRows.length && rule.ensureEverywhere) {
            insertRow.run(
              rule.itemName,
              itemKind,
              folderId,
              location.scope,
              location.ownerDoctorId,
              rule.unit || "unit",
              "Price must be configured before billing.",
            );
            inserted += 1;
          }
        }
      }
      updated += Number(updateRows.run(folderId, itemKind, rule.itemName, folderId).changes || 0);
      for (const alias of aliases) {
        updated += Number(updateRows.run(folderId, itemKind, alias, folderId).changes || 0);
      }
      if (itemKind === "service") {
        db.prepare(`
          UPDATE inventory
          SET quantity = 0, minimum_quantity = 0, expiry_date = NULL,
              item_kind = 'service', updated_at = CURRENT_TIMESTAMP
          WHERE lower(trim(item_name)) = lower(trim(?))
        `).run(rule.itemName);
        db.prepare(`
          UPDATE inventory_batches
          SET quantity_remaining = 0
          WHERE item_id IN (
            SELECT id FROM inventory WHERE lower(trim(item_name)) = lower(trim(?))
          ) AND quantity_remaining != 0
        `).run(rule.itemName);
      }
    }
    return { updated, inserted, renamed, conflicts };
  });

  const aligned = align();
  const retired = retireRemovedOcsConsumableSkus();
  return { ...aligned, archived: retired.archived };
}

module.exports = {
  alignInventoryCategories,
  CATEGORY_RULES,
  RETIRED_OCS_CONSUMABLE_SKUS,
  retireRemovedOcsConsumableSkus,
};
