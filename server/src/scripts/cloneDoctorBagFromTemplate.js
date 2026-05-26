#!/usr/bin/env node
/**
 * Purge every doctor medical bag, then clone one doctor's bag matrix to all others.
 *
 * Uses direct SQLite writes on `inventory` (stock_scope = 'doctor'). Does NOT touch
 * OCS master warehouse rows and does not call restock APIs (no warehouse draw-down).
 * There are no PostgreSQL triggers on doctor bags in this codebase.
 *
 * Required for execution:
 *   ALLOW_DB_PURGE=true
 *   SOURCE_DOCTOR_ID=<integer>   OR   SOURCE_DOCTOR_NAME=davish
 *
 * Optional:
 *   DRY_RUN=true                 — preview only (default when ALLOW_DB_PURGE is unset)
 *   DB_PATH=/data/clinic.db      — production NAS volume path
 *
 * Usage:
 *   DRY_RUN=true node src/scripts/cloneDoctorBagFromTemplate.js
 *   ALLOW_DB_PURGE=true SOURCE_DOCTOR_ID=4 DB_PATH=./nas-data/clinic.db node src/scripts/cloneDoctorBagFromTemplate.js
 *   docker exec -e ALLOW_DB_PURGE=true -e SOURCE_DOCTOR_NAME=davish clinicflow-app node src/scripts/cloneDoctorBagFromTemplate.js
 */

const { db, initializeDatabase } = require("../db");
const { ensureInventoryRowVersionColumn } = require("../lib/inventoryQuantity");

function tableExists(tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function assertPurgeAllowed() {
  const dryRun = String(process.env.DRY_RUN || "").trim().toLowerCase() === "true";
  const allowed = String(process.env.ALLOW_DB_PURGE || "").trim().toLowerCase() === "true";
  if (!allowed && !dryRun) {
    console.error(
      "[abort] Set ALLOW_DB_PURGE=true to run, or DRY_RUN=true to preview without writing.",
    );
    process.exit(1);
  }
  return dryRun;
}

function resolveSourceDoctor() {
  const explicitId = Number(process.env.SOURCE_DOCTOR_ID || 0);
  if (explicitId) {
    const doctor = db
      .prepare(`
        SELECT id, full_name
        FROM doctors
        WHERE id = ?
          AND deleted_at IS NULL
      `)
      .get(explicitId);
    if (!doctor) {
      throw new Error(`SOURCE_DOCTOR_ID ${explicitId} is not an active doctor.`);
    }
    return doctor;
  }

  const nameNeedle = String(process.env.SOURCE_DOCTOR_NAME || "davish").trim().toLowerCase();
  if (!nameNeedle) {
    throw new Error("Set SOURCE_DOCTOR_ID or SOURCE_DOCTOR_NAME.");
  }

  const matches = db
    .prepare(`
      SELECT id, full_name
      FROM doctors
      WHERE deleted_at IS NULL
        AND LOWER(full_name) LIKE '%' || ? || '%'
      ORDER BY full_name ASC
    `)
    .all(nameNeedle);

  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple doctors match "${nameNeedle}": ${matches.map((row) => row.full_name).join(", ")}. Set SOURCE_DOCTOR_ID.`,
    );
  }

  const roster = db
    .prepare("SELECT id, full_name FROM doctors WHERE deleted_at IS NULL ORDER BY full_name ASC")
    .all();
  throw new Error(
    `No active doctor matches SOURCE_DOCTOR_NAME="${nameNeedle}". Set SOURCE_DOCTOR_ID. Active doctors: ${roster
      .map((row) => `${row.full_name} (#${row.id})`)
      .join("; ")}`,
  );
}

function getOcsWarehouseSnapshot() {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS item_count, COALESCE(SUM(quantity), 0) AS total_quantity
      FROM inventory
      WHERE stock_scope = 'ocs'
        AND owner_doctor_id IS NULL
    `)
    .get();
  return {
    itemCount: Number(row?.item_count || 0),
    totalQuantity: Number(row?.total_quantity || 0),
  };
}

function getDoctorBagRows(doctorId) {
  return db
    .prepare(`
      SELECT
        item_name,
        folder_id,
        quantity,
        minimum_quantity,
        unit,
        cost_price,
        selling_price,
        notes,
        attributes,
        moa_notes,
        expiry_date
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
      ORDER BY LOWER(item_name) ASC
    `)
    .all(Number(doctorId));
}

function getActiveDoctorsExcept(sourceDoctorId) {
  return db
    .prepare(`
      SELECT id, full_name
      FROM doctors
      WHERE deleted_at IS NULL
        AND id != ?
      ORDER BY full_name ASC
    `)
    .all(Number(sourceDoctorId));
}

function deleteDoctorBagRows() {
  const targets = db
    .prepare(`
      SELECT id, owner_doctor_id, item_name
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id IS NOT NULL
    `)
    .all();

  if (!targets.length) {
    return { removed: 0 };
  }

  const deleteBatches = db.prepare("DELETE FROM inventory_batches WHERE item_id = ?");
  const deleteMovements = db.prepare("DELETE FROM inventory_movements WHERE item_id = ?");
  const deleteStocktakes = db.prepare("DELETE FROM inventory_stocktakes WHERE item_id = ?");
  const deleteAudit = db.prepare("DELETE FROM inventory_audit_logs WHERE item_id = ?");
  const deleteItem = db.prepare("DELETE FROM inventory WHERE id = ?");

  const run = db.transaction((rows) => {
    rows.forEach((row) => {
      const itemId = Number(row.id);
      if (tableExists("inventory_batches")) {
        deleteBatches.run(itemId);
      }
      if (tableExists("inventory_movements")) {
        deleteMovements.run(itemId);
      }
      if (tableExists("inventory_stocktakes")) {
        try {
          deleteStocktakes.run(itemId);
        } catch {
          // optional table
        }
      }
      if (tableExists("inventory_audit_logs")) {
        try {
          deleteAudit.run(itemId);
        } catch {
          // ignore
        }
      }
      deleteItem.run(itemId);
    });
  });

  run(targets);
  return { removed: targets.length };
}

function syncBatches(itemId, quantity, expiryDate) {
  db.prepare("DELETE FROM inventory_batches WHERE item_id = ?").run(itemId);
  const qty = Number(quantity || 0);
  if (qty > 0) {
    db.prepare(`
      INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost)
      VALUES (?, ?, ?, 0)
    `).run(itemId, qty, expiryDate ? String(expiryDate).trim() : null);
  }
}

function insertDoctorBagRow(doctorId, templateRow) {
  const result = db
    .prepare(`
      INSERT INTO inventory (
        item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
        cost_price, selling_price, notes, attributes, moa_notes, expiry_date, row_version, updated_at
      )
      VALUES (?, ?, 'doctor', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `)
    .run(
      templateRow.item_name,
      templateRow.folder_id,
      Number(doctorId),
      Number(templateRow.quantity || 0),
      Number(templateRow.minimum_quantity || 0),
      templateRow.unit || "unit",
      Number(templateRow.cost_price || 0),
      Number(templateRow.selling_price || 0),
      templateRow.notes || "",
      templateRow.attributes || "",
      templateRow.moa_notes || "",
      templateRow.expiry_date ? String(templateRow.expiry_date).trim() : null,
    );

  const itemId = Number(result.lastInsertRowid);
  syncBatches(itemId, templateRow.quantity, templateRow.expiry_date);
  return itemId;
}

function cloneDoctorBagFromTemplateSync({ dryRun = false } = {}) {
  initializeDatabase();
  ensureInventoryRowVersionColumn();

  const sourceDoctor = resolveSourceDoctor();
  const templateRows = getDoctorBagRows(sourceDoctor.id);
  if (!templateRows.length) {
    throw new Error(
      `Source doctor ${sourceDoctor.full_name} (#${sourceDoctor.id}) has no bag items to clone.`,
    );
  }

  const targetDoctors = getActiveDoctorsExcept(sourceDoctor.id);
  const ocsBefore = getOcsWarehouseSnapshot();
  const existingDoctorRows = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id IS NOT NULL
    `)
    .get();

  const preview = {
    dryRun,
    sourceDoctor,
    templateItemCount: templateRows.length,
    templateTotalQuantity: templateRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    targetDoctorCount: targetDoctors.length,
    existingDoctorBagRows: Number(existingDoctorRows?.count || 0),
    rowsToInsert:
      templateRows.length + templateRows.length * targetDoctors.length,
    ocsWarehouseBefore: ocsBefore,
    targetDoctors: targetDoctors.map((row) => row.full_name),
  };

  if (dryRun) {
    return { ...preview, executed: false };
  }

  let purged = 0;
  let inserted = 0;

  const run = db.transaction(() => {
    purged = deleteDoctorBagRows().removed;

    templateRows.forEach((row) => {
      insertDoctorBagRow(sourceDoctor.id, row);
      inserted += 1;
    });

    targetDoctors.forEach((doctor) => {
      templateRows.forEach((row) => {
        insertDoctorBagRow(doctor.id, row);
        inserted += 1;
      });
    });
  });

  run();

  const ocsAfter = getOcsWarehouseSnapshot();
  const warehouseUnchanged =
    ocsBefore.itemCount === ocsAfter.itemCount &&
    ocsBefore.totalQuantity === ocsAfter.totalQuantity;

  if (!warehouseUnchanged) {
    throw new Error(
      `OCS warehouse totals changed (before ${ocsBefore.itemCount}/${ocsBefore.totalQuantity}, after ${ocsAfter.itemCount}/${ocsAfter.totalQuantity}). Aborting verification.`,
    );
  }

  return {
    ...preview,
    executed: true,
    purgedDoctorBagRows: purged,
    insertedDoctorBagRows: inserted,
    ocsWarehouseAfter: ocsAfter,
    warehouseUnchanged,
  };
}

if (require.main === module) {
  try {
    const dryRun = assertPurgeAllowed();
    const result = cloneDoctorBagFromTemplateSync({ dryRun });
    console.log(dryRun ? "Doctor bag clone preview (DRY_RUN)." : "Doctor bag clone complete.");
    console.log(`  Source: ${result.sourceDoctor.full_name} (#${result.sourceDoctor.id})`);
    console.log(`  Template items: ${result.templateItemCount} (total qty ${result.templateTotalQuantity})`);
    console.log(`  Target doctors: ${result.targetDoctorCount}`);
    if (result.targetDoctors.length) {
      result.targetDoctors.forEach((name) => console.log(`    - ${name}`));
    }
    console.log(
      `  Existing doctor bag rows before: ${result.existingDoctorBagRows} → planned rows after: ${result.rowsToInsert}`,
    );
    console.log(
      `  OCS warehouse (unchanged check): ${result.ocsWarehouseBefore.itemCount} items, ${result.ocsWarehouseBefore.totalQuantity} total qty`,
    );
    if (result.executed) {
      console.log(`  Purged doctor bag rows: ${result.purgedDoctorBagRows}`);
      console.log(`  Inserted doctor bag rows: ${result.insertedDoctorBagRows}`);
      console.log(`  Warehouse unchanged: ${result.warehouseUnchanged ? "yes" : "NO"}`);
      console.log(
        "\nLive clients: restart the app or wait for SSE resync if POST /api/inventory/resync-broadcast was triggered.",
      );
    }
  } catch (error) {
    console.error("Clone failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { cloneDoctorBagFromTemplateSync };
