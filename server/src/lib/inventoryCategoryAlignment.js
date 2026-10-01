const { db } = require("../db");
const { recordOcsCatalogExclusion } = require("./ocsCatalogExclusions");

// Catalogue categories are global. Keep existing warehouse and doctor-bag rows
// aligned without changing their quantities, batches, prices, or par levels.
const CATEGORY_RULES = [
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
  {
    itemName: "Atomic enema (Adult)",
    aliases: ["Atomic Enema 20ml box of 2", "Atomic enema 20ml box of 2"],
    folderName: "Consumable",
  },
  {
    itemName: "Atomic enema (Paediatric)",
    aliases: ["Atomic enema 10ml box of 2", "Atomic Enema 10ml box of 2"],
    folderName: "Consumable",
  },
  { itemName: "Sachet Monuril", folderName: "Oral Drugs", keepItemKind: true },
  {
    itemName: "IM Lasilix 20mg",
    aliases: ["Lasilix 20mg (IM/IV)"],
    folderName: "IM Drugs",
  },
  {
    itemName: "IM Ceftriaxone 1g + lidocaine",
    folderName: "Services",
    itemKind: "service",
    ensureEverywhere: true,
    unit: "service",
    costPrice: 300,
    sellingPrice: 1200,
  },
  {
    itemName: "IV Solu-cortef 100MG (Hisone) (including cannulation)",
    folderName: "Services",
    itemKind: "service",
    ensureEverywhere: true,
    unit: "service",
    costPrice: 300,
    sellingPrice: 2000,
  },
  {
    itemName: "Each next N/S 500ml",
    folderName: "Services",
    itemKind: "service",
    ensureEverywhere: true,
    unit: "service",
    costPrice: 100,
    sellingPrice: 500,
  },
  {
    itemName: "IV Lasilix 20mg",
    folderName: "Services",
    itemKind: "service",
    ensureEverywhere: true,
    unit: "service",
    costPrice: 200,
    sellingPrice: 800,
  },
];

const RETIRED_OCS_CONSUMABLE_SKUS = [
  "Micropore 1 inch (Box of 12)",
  "Gown",
  "White Adhesive Tape",
  "Nebulizer Mask (Adult)",
  "Nebulizer Mask (Paediatric)",
];
const RETIRED_OCS_IV_COMBINATION_SKUS = [
  "IV N/S + Dextrose 50%",
  "IV N/S + Pabrinex",
  "IV N/S + Perfalgan",
  "IV N/S + PPI",
  "IV N/S + Solucortef",
];
const RETIRED_OCS_DISCONTINUED_DRUG_SKUS = [
  "Ranitidine / Aciloc 50mg",
  "Fentanyl patch",
  "Lasilix 40mg",
  "Dextrose inj 50% 50ml",
  "Spasfon (IM/IV)",
  "IV Ocid 40mg",
];
const RETIRED_OCS_GO_LIVE_SKUS = [
  "BIB Roll",
  "Ceftriaxone 2g (IM/IV)",
  "Diprostene IA/IM",
  "Emetino 8mg (IM/IV)",
  "IM Ceftriaxone 2g + lidocaine",
  "Iodine Tulle dressing",
  "DNS/Dextrose 50%",
  "IV Nexium",
  "Micropore 5cm",
  "Instafene syrup",
  "Stoma care-colostomy bag",
  'Sterile Gauze 3"x3"',
  "Bactrim sulfaméthoxazole+triméthoprime",
  "Diprosone cream",
  "Morphine 10mg",
  "Nasal Oxygen Cannula",
  "On Call Extra Strips",
  "On call Plus Strips",
];
const RETIRED_OCS_SERVICE_ITEMS = [
  "O2 first 30mins",
  "O2 second 30 mins",
];
const RETIRED_OCS_WAREHOUSE_ONLY_SKUS = [
  "Supp.Diclowal 12.5mg / 25mg",
  "Supp.Vogalene 5mg",
  "Celestene 0.05%",
  "Gramocef Syrup (antibiotic)",
  "IV lasilix - each next 20mg",
  "IV Lasilix - first 20mg",
  "Avelac Syrup (lactulose)",
  "Otrivine",
];
const RETIRED_OCS_CATALOG_ITEMS = [
  ...RETIRED_OCS_CONSUMABLE_SKUS,
  ...RETIRED_OCS_IV_COMBINATION_SKUS,
  ...RETIRED_OCS_DISCONTINUED_DRUG_SKUS,
  ...RETIRED_OCS_GO_LIVE_SKUS,
  ...RETIRED_OCS_SERVICE_ITEMS,
];

function writeOffRetiredSkuRow(row, writeOffQty) {
  db.prepare(`
    UPDATE inventory_batches
    SET quantity_remaining = 0,
        row_version = COALESCE(row_version, 1) + 1
    WHERE item_id = ? AND quantity_remaining > 0
  `).run(row.id);
  db.prepare(`
    UPDATE inventory
    SET quantity = 0,
        row_version = COALESCE(row_version, 1) + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(row.id);
  const metaJson = JSON.stringify({
    reason: "Discontinued",
    catalogue_retirement: true,
    automated: true,
    performed_by_role: "system",
    stock_scope: row.stock_scope,
    owner_doctor_id: row.owner_doctor_id || null,
  });
  db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
      recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
    ) VALUES (?, 'out', ?, ?, 0, ?, NULL, ?, 'remove', 'catalogue_retirement', ?, ?)
  `).run(
    row.id,
    writeOffQty,
    Number(row.quantity || 0),
    row.owner_doctor_id || null,
    `Catalogue retirement write-off: ${row.item_name} removed from the OCS catalogue.`,
    String(row.id),
    metaJson,
  );
  db.prepare(`
    INSERT INTO inventory_audit_logs (
      action_type, item_id, item_name, quantity, reason,
      target_doctor_id, target_doctor_name,
      performed_by_user_id, performed_by_role, performed_by_name, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, '', NULL, 'system', 'System', ?)
  `).run(
    "retired_sku_write_off",
    row.id,
    row.item_name,
    writeOffQty,
    "Catalogue retirement write-off",
    row.owner_doctor_id || null,
    metaJson,
  );
}

function leaveRetiredItemOutOfOpenStocktakes(row) {
  const openSessions = db.prepare(`
    SELECT DISTINCT session_id
    FROM inventory_stocktake_session_items
    WHERE inventory_id = ?
      AND session_id IN (
        SELECT id
        FROM inventory_stocktake_sessions
        WHERE status IN ('draft', 'in_progress', 'recount_required', 'submitted', 'approved')
      )
  `).all(row.id);
  if (!openSessions.length) return 0;

  const reason = `Left unchanged because ${row.item_name} was retired from the catalogue.`;
  const result = db.prepare(`
    UPDATE inventory_stocktake_session_items
    SET physical_quantity = NULL,
        variance = 0,
        left_unchanged = 1,
        reason = ?,
        conflict_status = '',
        conflict_reason = '',
        conflict_live_quantity = NULL,
        conflict_detected_at = NULL,
        surplus_expiry_date = NULL,
        surplus_is_non_expiring = 0,
        surplus_unit_cost = NULL,
        surplus_supplier_name = '',
        surplus_received_date = NULL,
        shortage_reason = '',
        shortage_unit_cost = NULL,
        shortage_doctor_id = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE inventory_id = ?
      AND session_id IN (${openSessions.map(() => "?").join(", ")})
  `).run(reason, row.id, ...openSessions.map((session) => session.session_id));

  const updateSession = db.prepare(`
    UPDATE inventory_stocktake_sessions
    SET notes = TRIM(COALESCE(notes, '') || CASE WHEN TRIM(COALESCE(notes, '')) = '' THEN '' ELSE ' ' END || ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  for (const session of openSessions) {
    updateSession.run(reason, session.session_id);
  }
  return Number(result.changes || 0);
}

function legacyOxygenStockNames(db) {
  return db.prepare(`
    SELECT DISTINCT item_name
    FROM inventory
    WHERE archived_at IS NULL
      AND COALESCE(item_kind, 'stock') = 'stock'
      AND (
        lower(replace(trim(item_name), '₂', '2')) LIKE 'o2 with mask%'
        OR lower(replace(trim(item_name), '₂', '2')) LIKE 'each additional 30 min%'
      )
  `).all().map((row) => row.item_name);
}

function retireRemovedOcsCatalogItems() {
  return db.transaction(() => {
    let archived = 0;
    let blocked = 0;
    let writtenOff = 0;
    const names = [...new Set([
      ...RETIRED_OCS_CATALOG_ITEMS,
      ...legacyOxygenStockNames(db),
    ])];
    const rowSelect = `
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
    `;
    const loadRows = db.prepare(`
      ${rowSelect}
        AND (
          (i.stock_scope = 'ocs' AND i.owner_doctor_id IS NULL)
          OR (i.stock_scope = 'doctor' AND i.owner_doctor_id IS NOT NULL)
        )
    `);
    const loadWarehouseRows = db.prepare(`
      ${rowSelect}
        AND i.stock_scope = 'ocs'
        AND i.owner_doctor_id IS NULL
    `);
    function retireRows(itemName, rows) {
      recordOcsCatalogExclusion(itemName);
      for (const row of rows) {
        if (Number(row.reserved_quantity || 0) > 0) {
          blocked += 1;
          continue;
        }
        leaveRetiredItemOutOfOpenStocktakes(row);
        const writeOffQty = Math.max(Number(row.quantity || 0), Number(row.live_batch_quantity || 0));
        if (writeOffQty > 0) {
          writeOffRetiredSkuRow(row, writeOffQty);
          writtenOff += 1;
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
    for (const itemName of names) retireRows(itemName, loadRows.all(itemName));
    for (const itemName of RETIRED_OCS_WAREHOUSE_ONLY_SKUS) {
      retireRows(itemName, loadWarehouseRows.all(itemName));
    }
    return { archived, blocked, written_off: writtenOff };
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
    ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, '', '', NULL, CURRENT_TIMESTAMP)
  `);
  const updateRows = db.prepare(`
    UPDATE inventory
    SET folder_id = ?, item_kind = ?, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      AND archived_at IS NULL
      AND (folder_id != ? OR item_kind != ?)
  `);
  const updateFolderOnly = db.prepare(`
    UPDATE inventory
    SET folder_id = ?, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      AND archived_at IS NULL
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
              Number(rule.costPrice || 0),
              Number(rule.sellingPrice || 0),
              "Price must be configured before billing.",
            );
            inserted += 1;
          }
        }
      }
      if (rule.keepItemKind) {
        updated += Number(updateFolderOnly.run(folderId, rule.itemName, folderId).changes || 0);
        continue;
      }
      updated += Number(updateRows.run(folderId, itemKind, rule.itemName, folderId, itemKind).changes || 0);
      for (const alias of aliases) {
        updated += Number(updateRows.run(folderId, itemKind, alias, folderId, itemKind).changes || 0);
      }
      if (itemKind === "service") {
        db.prepare(`
          UPDATE inventory
          SET quantity = 0, minimum_quantity = 0, expiry_date = NULL,
              item_kind = 'service', unit = 'service',
              cost_price = ?, selling_price = ?,
              row_version = COALESCE(row_version, 1) + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE lower(trim(item_name)) = lower(trim(?))
            AND archived_at IS NULL
            AND (
              quantity != 0 OR minimum_quantity != 0 OR expiry_date IS NOT NULL
              OR item_kind != 'service' OR unit != 'service'
              OR cost_price != ? OR selling_price != ?
            )
        `).run(
          Number(rule.costPrice || 0),
          Number(rule.sellingPrice || 0),
          rule.itemName,
          Number(rule.costPrice || 0),
          Number(rule.sellingPrice || 0),
        );
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
  const retired = retireRemovedOcsCatalogItems();
  return {
    ...aligned,
    archived: retired.archived,
    blocked: retired.blocked,
    written_off: retired.written_off,
  };
}

module.exports = {
  alignInventoryCategories,
  CATEGORY_RULES,
  RETIRED_OCS_CONSUMABLE_SKUS,
  RETIRED_OCS_IV_COMBINATION_SKUS,
  RETIRED_OCS_DISCONTINUED_DRUG_SKUS,
  RETIRED_OCS_GO_LIVE_SKUS,
  RETIRED_OCS_SERVICE_ITEMS,
  RETIRED_OCS_WAREHOUSE_ONLY_SKUS,
  RETIRED_OCS_CATALOG_ITEMS,
  retireRemovedOcsCatalogItems,
};
