#!/usr/bin/env node
/**
 * Mirror OCS master stock into every doctor medical bag.
 * Upserts by doctor + item name; optional prune removes bag rows not on OCS catalog.
 */

const { db, initializeDatabase } = require("../db");
const { renameDoctorBagCatalogue } = require("../lib/doctorBagCatalogueSync");

const LEGACY_BAG_NAMES = [
  ["Syringe 5ml", "Syringe (5ml)"],
  ["N/S 100ml", "IV N/S 100ml"],
  ["N/S 500ml", "IV N/S 500ml"],
];

function getOcsMasterItems() {
  return db
    .prepare(`
      SELECT
        item_name,
        item_kind,
        folder_id,
        minimum_quantity,
        unit,
        cost_price,
        selling_price,
        catalogue_key,
        is_cost_only,
        attributes,
        moa_notes
      FROM inventory
      WHERE stock_scope = 'ocs'
        AND owner_doctor_id IS NULL
        AND archived_at IS NULL
      ORDER BY item_name ASC
    `)
    .all();
}

function getActiveDoctors() {
  return db
    .prepare(`
      SELECT id, full_name
      FROM doctors
      WHERE deleted_at IS NULL
      ORDER BY full_name ASC
    `)
    .all();
}

function findDoctorItem(doctorId, source) {
  const catalogueKey = String(source.catalogue_key || "").trim();
  return db
    .prepare(`
      SELECT id
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND archived_at IS NULL
        AND (
          (? != '' AND catalogue_key = ?)
          OR LOWER(TRIM(item_name)) = LOWER(TRIM(?))
        )
      ORDER BY CASE WHEN ? != '' AND catalogue_key = ? THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `)
    .get(doctorId, catalogueKey, catalogueKey, source.item_name, catalogueKey, catalogueKey);
}

function findArchivedDoctorItem(doctorId, source) {
  const catalogueKey = String(source.catalogue_key || "").trim();
  return db.prepare(`
    SELECT id
    FROM inventory
    WHERE stock_scope = 'doctor'
      AND owner_doctor_id = ?
      AND archived_at IS NOT NULL
      AND (
        (? != '' AND catalogue_key = ?)
        OR LOWER(TRIM(item_name)) = LOWER(TRIM(?))
      )
    ORDER BY CASE WHEN ? != '' AND catalogue_key = ? THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get(
    doctorId,
    catalogueKey,
    catalogueKey,
    source.item_name,
    catalogueKey,
    catalogueKey,
  );
}

function upsertDoctorItemFromOcs(doctorId, source, { insertOnly = false } = {}) {
  const itemName = String(source.item_name || "").trim();
  const itemKind = String(source.item_kind || "stock") === "service" ? "service" : "stock";
  const minimumQuantity = itemKind === "service" ? 0 : Number(source.minimum_quantity || 0);
  const costPrice = itemKind === "service" ? 0 : Number(source.cost_price || 0);
  const sellingPrice = Number(source.selling_price || 0);
  const existing = findDoctorItem(doctorId, source);

  const alignExisting = db.prepare(`
    UPDATE inventory
    SET
      item_name = ?,
      item_kind = ?,
      folder_id = ?,
      minimum_quantity = CASE WHEN ? = 'service' THEN 0 ELSE ? END,
      quantity = CASE WHEN ? = 'service' THEN 0 ELSE quantity END,
      expiry_date = CASE WHEN ? = 'service' THEN NULL ELSE expiry_date END,
      unit = ?,
      cost_price = ?,
      selling_price = ?,
      catalogue_key = CASE WHEN ? != '' THEN ? ELSE catalogue_key END,
      is_cost_only = ?,
      attributes = ?,
      moa_notes = ?,
      archived_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  if (existing) {
    if (insertOnly) return "skipped";
    const currentName = db.prepare("SELECT item_name FROM inventory WHERE id = ?").get(existing.id)?.item_name;
    if (String(currentName || "").trim() !== itemName) {
      renameDoctorBagCatalogue(currentName, itemName);
    }
    const target = findDoctorItem(doctorId, source) || existing;
    alignExisting.run(
      itemName,
      itemKind,
      source.folder_id,
      itemKind,
      minimumQuantity,
      itemKind,
      itemKind,
      itemKind === "service" ? "service" : source.unit || "unit",
      costPrice,
      sellingPrice,
      String(source.catalogue_key || "").trim(),
      String(source.catalogue_key || "").trim(),
      Number(source.is_cost_only || 0) === 1 ? 1 : 0,
      itemKind === "service" ? "" : source.attributes || "",
      itemKind === "service" ? "" : source.moa_notes || "",
      target.id,
    );
    if (itemKind === "service") {
      db.prepare("UPDATE inventory_batches SET quantity_remaining = 0 WHERE item_id = ? AND quantity_remaining != 0").run(target.id);
    }
    return "updated";
  }

  const archived = findArchivedDoctorItem(doctorId, source);
  if (archived) {
    alignExisting.run(
      itemName,
      itemKind,
      source.folder_id,
      itemKind,
      minimumQuantity,
      itemKind,
      itemKind,
      itemKind === "service" ? "service" : source.unit || "unit",
      costPrice,
      sellingPrice,
      String(source.catalogue_key || "").trim(),
      String(source.catalogue_key || "").trim(),
      Number(source.is_cost_only || 0) === 1 ? 1 : 0,
      itemKind === "service" ? "" : source.attributes || "",
      itemKind === "service" ? "" : source.moa_notes || "",
      archived.id,
    );
    if (itemKind === "service") {
      db.prepare("UPDATE inventory_batches SET quantity_remaining = 0 WHERE item_id = ? AND quantity_remaining != 0").run(archived.id);
    }
    return "restored";
  }

  db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
      cost_price, selling_price, notes, attributes, moa_notes, expiry_date,
      catalogue_key, is_cost_only, updated_at
    )
    VALUES (?, ?, ?, 'doctor', ?, 0, ?, ?, ?, ?, '', ?, ?, NULL, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    itemName,
    itemKind,
    source.folder_id,
    doctorId,
    minimumQuantity,
    itemKind === "service" ? "service" : source.unit || "unit",
    costPrice,
    sellingPrice,
    itemKind === "service" ? "" : source.attributes || "",
    itemKind === "service" ? "" : source.moa_notes || "",
    String(source.catalogue_key || "").trim(),
    Number(source.is_cost_only || 0) === 1 ? 1 : 0,
  );
  return "inserted";
}

function pruneDoctorItemsNotInOcsCatalog(doctorId, ocsNameKeys) {
  const doctorItems = db
    .prepare(`
      SELECT id, item_name
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND archived_at IS NULL
    `)
    .all(doctorId);

  let archived = 0;
  let blocked = 0;
  doctorItems.forEach((row) => {
    const key = String(row.item_name || "").trim().toLowerCase();
    if (ocsNameKeys.has(key)) return;
    const state = db.prepare(`
      SELECT i.item_name, i.quantity, i.owner_doctor_id,
        COALESCE((SELECT SUM(quantity_remaining) FROM inventory_batches WHERE item_id = i.id), 0) AS batch_quantity,
        COALESCE((SELECT SUM(quantity) FROM inventory_reservations WHERE inventory_id = i.id AND status = 'active'), 0) AS reserved_quantity
      FROM inventory i WHERE i.id = ?
    `).get(row.id);
    if (Number(state?.reserved_quantity || 0) > 0) {
      blocked += 1;
      return;
    }
    const writeOffQty = Math.max(Number(state?.quantity || 0), Number(state?.batch_quantity || 0));
    if (writeOffQty > 0) {
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
        reason: "Not in the OCS warehouse catalogue",
        automated: true,
        performed_by_role: "system",
        owner_doctor_id: state?.owner_doctor_id || null,
      });
      db.prepare(`
        INSERT INTO inventory_movements (
          item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
          recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
        ) VALUES (?, 'out', ?, ?, 0, ?, NULL, ?, 'remove', 'catalogue_sync', ?, ?)
      `).run(
        row.id,
        writeOffQty,
        Number(state?.quantity || 0),
        state?.owner_doctor_id || null,
        `${state?.item_name || row.item_name} is not in the OCS warehouse catalogue, so it was removed from the bag.`,
        String(row.id),
        metaJson,
      );
    }
    archived += Number(db.prepare(`
      UPDATE inventory
      SET archived_at = CURRENT_TIMESTAMP,
          quantity = 0,
          row_version = COALESCE(row_version, 1) + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND archived_at IS NULL
    `).run(row.id).changes || 0);
  });

  return { archived, blocked };
}

function syncDoctorStockFromOcsSync({ skipInit = false, pruneExtras = true, insertOnly = false } = {}) {
  if (!skipInit) {
    initializeDatabase();
  }

  const ocsItems = getOcsMasterItems();
  if (!ocsItems.length) {
    return {
      doctors: 0,
      inserted: 0,
      updated: 0,
      pruned: 0,
      prune_blocked: 0,
      ocsItems: 0,
      errors: [],
    };
  }

  const doctors = getActiveDoctors();
  const ocsNameKeys = new Set(
    ocsItems.map((item) => String(item.item_name || "").trim().toLowerCase()),
  );

  const summary = {
    doctors: doctors.length,
    inserted: 0,
    updated: 0,
    restored: 0,
    skipped: 0,
    pruned: 0,
    prune_blocked: 0,
    ocsItems: ocsItems.length,
    errors: [],
  };

  const run = db.transaction(() => {
    for (const [from, to] of LEGACY_BAG_NAMES) {
      if (ocsNameKeys.has(String(to).trim().toLowerCase())) {
        renameDoctorBagCatalogue(from, to);
      }
    }
    doctors.forEach((doctor) => {
      ocsItems.forEach((source) => {
        const action = upsertDoctorItemFromOcs(Number(doctor.id), source, { insertOnly });
        if (action === "inserted") summary.inserted += 1;
        else if (action === "updated") summary.updated += 1;
        else if (action === "restored") summary.restored += 1;
        else summary.skipped += 1;
      });

      if (pruneExtras) {
        const prune = pruneDoctorItemsNotInOcsCatalog(Number(doctor.id), ocsNameKeys);
        summary.pruned += prune.archived;
        summary.prune_blocked += prune.blocked;
      }
    });
  });

  run();
  return summary;
}

if (require.main === module) {
  const summary = syncDoctorStockFromOcsSync();
  console.log("Doctor stock sync from OCS complete.");
  console.log(`  Doctors:  ${summary.doctors}`);
  console.log(`  OCS rows: ${summary.ocsItems}`);
  console.log(`  Inserted: ${summary.inserted}`);
  console.log(`  Updated:  ${summary.updated}`);
  console.log(`  Pruned:   ${summary.pruned}`);
  console.log(`  Prune blocked: ${summary.prune_blocked}`);
  if (summary.errors.length) {
    console.error("  Errors:");
    summary.errors.forEach((entry) =>
      console.error(`    - ${entry.doctorName}: ${entry.message}`),
    );
    process.exitCode = 1;
  }
}

module.exports = { syncDoctorStockFromOcsSync };
