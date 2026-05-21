const express = require("express");
const { ensureOcsCatalogSync } = require("../lib/ensureOcsCatalog");
const {
  ensureOcsCatalogExclusionsTable,
  recordOcsCatalogExclusion,
} = require("../lib/ocsCatalogExclusions");
const { prepareOcsMasterInventoryIntegrity, assertOcsMasterItemNameAvailable } = require("../lib/dedupeOcsMasterInventory");
const { maybeNotifyLowStock } = require("../lib/push");
const { db } = require("../db");
const { getTodayLocal, toNumber } = require("../lib/utils");

const { REQUIRED_INVENTORY_FOLDERS, inventoryFolderOrderSql } = require("../config/inventoryFolders");

const router = express.Router();
const REQUIRED_FOLDERS = REQUIRED_INVENTORY_FOLDERS;
const NEAR_EXPIRY_DAYS = 90;

let infrastructureReady = false;

function roundCurrency(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function createTransferTransactionId() {
  return `TX-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function safeParseJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isNearExpiry(expiryDate) {
  if (!expiryDate) return false;
  const diff = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return diff >= 0 && diff <= NEAR_EXPIRY_DAYS;
}

function ensureColumn(table, column, sql) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(sql);
  }
}

function ensureInfrastructure() {
  if (infrastructureReady) return;

  ensureColumn("inventory", "stock_scope", "ALTER TABLE inventory ADD COLUMN stock_scope TEXT NOT NULL DEFAULT 'ocs'");
  ensureColumn("inventory", "owner_doctor_id", "ALTER TABLE inventory ADD COLUMN owner_doctor_id INTEGER");
  ensureColumn("inventory", "attributes", "ALTER TABLE inventory ADD COLUMN attributes TEXT NOT NULL DEFAULT ''");
  ensureColumn("inventory", "moa_notes", "ALTER TABLE inventory ADD COLUMN moa_notes TEXT NOT NULL DEFAULT ''");
  ensureColumn("inventory", "expiry_date", "ALTER TABLE inventory ADD COLUMN expiry_date TEXT");
  ensureColumn("inventory_movements", "action_type", "ALTER TABLE inventory_movements ADD COLUMN action_type TEXT NOT NULL DEFAULT 'correction'");
  ensureColumn("inventory_movements", "reference_type", "ALTER TABLE inventory_movements ADD COLUMN reference_type TEXT");
  ensureColumn("inventory_movements", "reference_id", "ALTER TABLE inventory_movements ADD COLUMN reference_id INTEGER");
  ensureColumn("inventory_movements", "meta_json", "ALTER TABLE inventory_movements ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      quantity_remaining INTEGER NOT NULL DEFAULT 0 CHECK (quantity_remaining >= 0),
      expiry_date TEXT,
      unit_cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_staging (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      minimum_quantity INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'unit',
      cost_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      attributes TEXT NOT NULL DEFAULT '',
      moa_notes TEXT NOT NULL DEFAULT '',
      expiry_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released', 'cancelled')),
      created_by_user_id INTEGER,
      released_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      released_at TEXT,
      FOREIGN KEY (folder_id) REFERENCES inventory_folders(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS inventory_stocktakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      physical_quantity INTEGER NOT NULL DEFAULT 0,
      digital_quantity INTEGER NOT NULL DEFAULT 0,
      discrepancy INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      item_id INTEGER,
      item_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      target_doctor_id INTEGER,
      target_doctor_name TEXT NOT NULL DEFAULT '',
      performed_by_user_id INTEGER,
      performed_by_role TEXT NOT NULL DEFAULT '',
      performed_by_name TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory_activity_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_id INTEGER,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actor_user_id INTEGER,
      actor_name TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL DEFAULT '',
      action_type TEXT NOT NULL DEFAULT '',
      item_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT '',
      source_text TEXT NOT NULL DEFAULT '',
      destination_text TEXT NOT NULL DEFAULT '',
      batch_id TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_scope_owner ON inventory(stock_scope, owner_doctor_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_batches_item ON inventory_batches(item_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_staging_status ON inventory_staging(status);
    CREATE INDEX IF NOT EXISTS idx_inventory_audit_created_at ON inventory_audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_inventory_activity_timestamp ON inventory_activity_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_inventory_activity_action ON inventory_activity_history(action_type);
  `);

  ensureOcsCatalogExclusionsTable();

  try {
    const integrity = prepareOcsMasterInventoryIntegrity();
    if (integrity.removedRows > 0) {
      console.log(
        `[inventory] Merged ${integrity.mergedGroups} duplicate OCS SKU group(s); removed ${integrity.removedRows} row(s).`,
      );
    }
  } catch (error) {
    console.warn("[inventory] OCS master dedupe/unique index failed:", error.message);
  }

  try {
    const catalogResult = ensureOcsCatalogSync();
    if (!catalogResult.skipped && catalogResult.ocs?.inserted > 0) {
      console.log(`[catalog] Added ${catalogResult.ocs.inserted} missing OCS catalog item(s).`);
    }
    if (!catalogResult.skipped && catalogResult.doctors?.inserted > 0) {
      console.log(
        `[catalog] Added ${catalogResult.doctors.inserted} missing doctor bag catalog row(s).`,
      );
    }
  } catch (error) {
    console.warn("[catalog] OCS catalog ensure failed:", error.message);
  }

  infrastructureReady = true;
}

function recordAudit({
  actionType,
  itemId = null,
  itemName = "",
  quantity = 0,
  reason = "",
  targetDoctorId = null,
  targetDoctorName = "",
  performedByUserId = null,
  performedByRole = "",
  performedByName = "",
  metaJson = "{}",
}) {
  db.prepare(`
    INSERT INTO inventory_audit_logs (
      action_type, item_id, item_name, quantity, reason,
      target_doctor_id, target_doctor_name,
      performed_by_user_id, performed_by_role, performed_by_name, meta_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actionType,
    itemId,
    String(itemName || ""),
    Number(quantity || 0),
    String(reason || ""),
    targetDoctorId,
    String(targetDoctorName || ""),
    performedByUserId,
    String(performedByRole || ""),
    String(performedByName || ""),
    metaJson,
  );
}

function buildReceiptByTransaction(transactionId) {
  const rows = db
    .prepare(`
      SELECT
        m.id,
        m.created_at,
        m.quantity,
        m.action_type,
        m.meta_json,
        i.item_name,
        i.unit
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      WHERE m.action_type IN ('restock_out', 'restock_in')
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 500
    `)
    .all()
    .filter((row) => safeParseJson(row.meta_json, {}).transaction_id === transactionId);

  if (!rows.length) return null;
  const sourceRows = rows.filter((row) => row.action_type === "restock_out");
  const primaryMeta = safeParseJson(rows[0].meta_json, {});
  const items = sourceRows.map((row) => {
    const meta = safeParseJson(row.meta_json, {});
    const allocations = Array.isArray(meta.transfer_allocations) ? meta.transfer_allocations : [];
    if (!allocations.length) {
      return [
        {
          item_name: row.item_name,
          batch_number: "N/A",
          expiry: null,
          quantity: Number(row.quantity || 0),
          unit: row.unit || "unit",
        },
      ];
    }
    return allocations.map((allocation, index) => ({
      item_name: row.item_name,
      batch_number: `B${row.id}-${index + 1}`,
      expiry: allocation.expiry_date || null,
      quantity: Number(allocation.quantity || 0),
      unit: row.unit || "unit",
    }));
  }).flat();

  return {
    transaction_id: transactionId,
    title: "Stock Transfer Note",
    date_time: rows[rows.length - 1]?.created_at || rows[0].created_at,
    issued_by_name: primaryMeta.issued_by_name || "",
    received_by_name: primaryMeta.received_by_name || "",
    receipt_reference: `/inventory/receipts/${transactionId}`,
    items,
    printed_at: new Date().toISOString(),
  };
}

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
      updateStagingFolder.run(canonicalId, duplicateId);
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

function ensureFolders() {
  normalizeInventoryFolders();

  const insertFolder = db.prepare(`
    INSERT INTO inventory_folders (name, parent_id, owner_doctor_id, updated_at)
    VALUES (?, NULL, NULL, CURRENT_TIMESTAMP)
  `);
  REQUIRED_FOLDERS.forEach((name) => {
    const existing = db.prepare("SELECT id FROM inventory_folders WHERE owner_doctor_id IS NULL AND name = ?").get(name);
    if (!existing) insertFolder.run(name);
  });

  normalizeInventoryFolders();
}

function getFolders() {
  ensureFolders();
  return db
    .prepare(`
      SELECT id, name
      FROM inventory_folders
      WHERE owner_doctor_id IS NULL
        AND name IN (${REQUIRED_FOLDERS.map(() => "?").join(", ")})
      ORDER BY ${inventoryFolderOrderSql("name")}, name ASC
    `)
    .all(...REQUIRED_FOLDERS);
}

function getItems({ stockScope, doctorId = null }) {
  return db
    .prepare(`
      SELECT i.*, f.name AS folder_name
      ,
        (
          SELECT MIN(b.expiry_date)
          FROM inventory_batches b
          WHERE b.item_id = i.id
            AND b.quantity_remaining > 0
            AND b.expiry_date IS NOT NULL
        ) AS nearest_expiry_date
      FROM inventory i
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      WHERE i.stock_scope = @stockScope
        AND (
          (@stockScope = 'doctor' AND i.owner_doctor_id = @doctorId)
          OR (@stockScope = 'ocs' AND i.owner_doctor_id IS NULL)
        )
      ORDER BY f.name ASC, i.item_name ASC
    `)
    .all({ stockScope, doctorId })
    .map((row) => ({
      ...row,
      quantity: Number(row.quantity || 0),
      minimum_quantity: Number(row.minimum_quantity || 0),
      cost_price: toNumber(row.cost_price, 0),
      selling_price: toNumber(row.selling_price, 0),
      expiry_date: row.nearest_expiry_date || row.expiry_date || null,
      current_cost_value: roundCurrency(Number(row.quantity || 0) * toNumber(row.cost_price, 0)),
      is_near_expiry: isNearExpiry(row.nearest_expiry_date || row.expiry_date),
    }));
}

function getBatchesForItem(itemId) {
  return db
    .prepare(`
      SELECT id, quantity_remaining, expiry_date, unit_cost, created_at
      FROM inventory_batches
      WHERE item_id = ?
      ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, id ASC
    `)
    .all(itemId)
    .map((row) => ({
      ...row,
      quantity_remaining: Number(row.quantity_remaining || 0),
      unit_cost: roundCurrency(row.unit_cost),
    }));
}

function getDoctors() {
  return db
    .prepare(`
      SELECT id, full_name, specialization
      FROM doctors
      WHERE deleted_at IS NULL
      ORDER BY full_name ASC
    `)
    .all();
}

function findItem(itemId, stockScope, doctorId = null) {
  return db
    .prepare(`
      SELECT *
      FROM inventory
      WHERE id = ?
        AND stock_scope = ?
        AND (
          (? = 'doctor' AND inventory.owner_doctor_id = ?)
          OR (? = 'ocs' AND inventory.owner_doctor_id IS NULL)
        )
    `)
    .get(itemId, stockScope, stockScope, doctorId, stockScope);
}

function createBatch(itemId, quantity, expiryDate, unitCost) {
  db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost)
    VALUES (?, ?, ?, ?)
  `).run(itemId, quantity, expiryDate || null, roundCurrency(unitCost));
}

function allocateRestockBatchesToPositive(itemId, allocations, previousQuantity) {
  // When stock is negative, inbound quantities first close the deficit without creating usable batches.
  let deficit = Math.max(0, 0 - Number(previousQuantity || 0));
  allocations.forEach((allocation) => {
    const inbound = Number(allocation.quantity || 0);
    if (inbound <= 0) return;
    const usedToHealDeficit = Math.min(deficit, inbound);
    deficit -= usedToHealDeficit;
    const batchQty = inbound - usedToHealDeficit;
    if (batchQty > 0) {
      createBatch(itemId, batchQty, allocation.expiry_date, allocation.unit_cost);
    }
  });
}

function consumeBatches(itemId, quantity, { disallowExpired = false } = {}) {
  const rows = db
    .prepare(`
      SELECT id, quantity_remaining, expiry_date, unit_cost
      FROM inventory_batches
      WHERE item_id = ?
        AND quantity_remaining > 0
      ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, id ASC
    `)
    .all(itemId);
  const today = getTodayLocal();
  const usable = disallowExpired ? rows.filter((row) => !row.expiry_date || row.expiry_date >= today) : rows;

  let remaining = quantity;
  const allocations = [];
  for (const row of usable) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(row.quantity_remaining || 0));
    if (!take) continue;
    db.prepare("UPDATE inventory_batches SET quantity_remaining = ? WHERE id = ?").run(row.quantity_remaining - take, row.id);
    allocations.push({
      quantity: take,
      expiry_date: row.expiry_date || null,
      unit_cost: toNumber(row.unit_cost, 0),
    });
    remaining -= take;
  }

  return { ok: remaining <= 0, allocations };
}

function getBatchQuantityTotal(itemId) {
  const row = db
    .prepare(`
      SELECT COALESCE(SUM(quantity_remaining), 0) AS total
      FROM inventory_batches
      WHERE item_id = ?
        AND quantity_remaining > 0
    `)
    .get(itemId);
  return Number(row?.total || 0);
}

/** Deduct stock using FEFO batches; heals missing batch rows when ledger quantity allows. */
function consumeStock(itemId, quantity, options = {}) {
  const amount = Number(quantity || 0);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, allocations: [] };
  }

  let batchTotal = getBatchQuantityTotal(itemId);
  if (batchTotal < amount) {
    const item = db
      .prepare("SELECT quantity, cost_price, expiry_date FROM inventory WHERE id = ?")
      .get(itemId);
    if (Number(item?.quantity || 0) >= amount) {
      const shortfall = amount - batchTotal;
      createBatch(
        itemId,
        shortfall,
        item?.expiry_date || null,
        toNumber(item?.cost_price, 0),
      );
    }
  }

  return consumeBatches(itemId, amount, options);
}

function doctorBagLabel(name) {
  const label = String(name || "").trim();
  return label ? `${label}'s Bag` : "Doctor's Bag";
}

function buildMovementLocationMeta(actionType, meta = {}, context = {}) {
  const existingSource = String(meta.source_location || "").trim();
  const existingDest = String(meta.destination_location || "").trim();
  if (existingSource && existingDest) {
    return { source_location: existingSource, destination_location: existingDest };
  }

  const at = String(actionType || "").toLowerCase();
  const master = "Master Stock";
  const doctorName =
    meta.received_by_name ||
    meta.doctor_name ||
    context.targetDoctorName ||
    context.ownerDoctorName ||
    "";

  if (at === "restock_in" || at === "restock_out") {
    return { source_location: master, destination_location: doctorBagLabel(doctorName) };
  }
  if (at === "sell") {
    return {
      source_location: doctorBagLabel(meta.doctor_name || context.ownerDoctorName),
      destination_location: "Patient Account",
    };
  }
  if (at === "stock_out") {
    const reason = String(meta.stock_out_reason || "").trim();
    return {
      source_location: doctorBagLabel(meta.doctor_name || context.ownerDoctorName),
      destination_location: reason ? `Stock Out (${reason})` : "Stock Out",
    };
  }
  if (at === "stock_in" || at === "add") {
    return { source_location: "Supplier / Intake", destination_location: master };
  }
  if (at === "remove") {
    return { source_location: master, destination_location: String(meta.reason || "Write-off") };
  }
  return {
    source_location: existingSource || "—",
    destination_location: existingDest || "—",
  };
}

function recordMovement({
  itemId,
  movementType,
  quantity,
  previousQuantity,
  nextQuantity,
  actionType,
  note,
  userId,
  referenceType = null,
  referenceId = null,
  metaJson = "{}",
}) {
  const meta = safeParseJson(metaJson, {});
  const movementItem = db
    .prepare("SELECT item_name, owner_doctor_id FROM inventory WHERE id = ?")
    .get(itemId);
  const locationContext = {};
  if (referenceType === "doctor" && referenceId) {
    const doctor = db.prepare("SELECT full_name FROM doctors WHERE id = ?").get(referenceId);
    locationContext.targetDoctorName = doctor?.full_name || "";
  }
  if (movementItem?.owner_doctor_id) {
    const ownerDoctor = db
      .prepare("SELECT full_name FROM doctors WHERE id = ?")
      .get(movementItem.owner_doctor_id);
    locationContext.ownerDoctorName = ownerDoctor?.full_name || "";
  }
  const locations = buildMovementLocationMeta(actionType, meta, locationContext);
  const enrichedMeta = { ...meta, ...locations };
  const finalMetaJson = JSON.stringify(enrichedMeta);

  db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
      recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
    )
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
  `).run(
    itemId,
    movementType,
    quantity,
    previousQuantity,
    nextQuantity,
    userId || null,
    String(note || "").trim(),
    actionType,
    referenceType,
    referenceId,
    finalMetaJson,
  );

  const inserted = db.prepare("SELECT last_insert_rowid() AS id").get();
  const movementId = Number(inserted?.id || 0);
  const actorName = String(enrichedMeta.performed_by_name || "");
  const actorRole = String(enrichedMeta.performed_by_role || "");
  const sourceText = enrichedMeta.source_location || "";
  const destinationText = enrichedMeta.destination_location || "";
  const transferAllocations = Array.isArray(enrichedMeta.transfer_allocations)
    ? enrichedMeta.transfer_allocations
    : [];
  const batchId =
    transferAllocations.length > 0
      ? transferAllocations.map((allocation, index) => `B${movementId}-${index + 1}`).join(", ")
      : "";

  db.prepare(`
    INSERT INTO inventory_activity_history (
      movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type, item_name,
      quantity, direction, source_text, destination_text, batch_id, meta_json
    )
    VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movementId || null,
    userId || null,
    actorName,
    actorRole,
    String(actionType || ""),
    String(movementItem?.item_name || ""),
    Number(quantity || 0),
    String(movementType || ""),
    sourceText,
    destinationText,
    batchId,
    finalMetaJson,
  );

  void maybeNotifyLowStock(itemId, userId).catch((error) => {
    console.warn("[push] low stock notification failed:", error?.message || error);
  });
}

function summarize(items, doctorId = null) {
  const totalAmount = items.reduce((sum, item) => sum + item.current_cost_value, 0);
  const lowStock = items.filter((item) => item.quantity <= item.minimum_quantity);
  const nearExpiry = items.filter((item) => isNearExpiry(item.expiry_date));

  const monthlyConsumed = doctorId
    ? db
      .prepare(`
        SELECT COALESCE(SUM(m.quantity * i.cost_price), 0) AS amount
        FROM inventory_movements m
        JOIN inventory i ON i.id = m.item_id
        WHERE i.stock_scope = 'doctor'
          AND i.owner_doctor_id = ?
          AND m.movement_type = 'out'
          AND strftime('%Y-%m', m.created_at) = strftime('%Y-%m', 'now')
      `)
      .get(doctorId)
    : db
      .prepare(`
        SELECT COALESCE(SUM(m.quantity * i.cost_price), 0) AS amount
        FROM inventory_movements m
        JOIN inventory i ON i.id = m.item_id
        WHERE i.stock_scope = 'ocs'
          AND m.movement_type = 'out'
          AND strftime('%Y-%m', m.created_at) = strftime('%Y-%m', 'now')
      `)
      .get();

  const monthlySales = db
    .prepare(`
      SELECT COALESCE(SUM(m.quantity * i.selling_price), 0) AS amount
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      WHERE m.action_type = 'sell'
        AND strftime('%Y-%m', m.created_at) = strftime('%Y-%m', 'now')
    `)
    .get();

  const monthlyReplenishments = db
    .prepare(`
      SELECT COALESCE(SUM(m.quantity * i.cost_price), 0) AS amount
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      WHERE m.action_type IN ('restock_in', 'add')
        AND strftime('%Y-%m', m.created_at) = strftime('%Y-%m', 'now')
    `)
    .get();

  return {
    total_amount_rs: roundCurrency(totalAmount),
    total_amount_consumed_rs: roundCurrency(monthlyConsumed?.amount),
    low_stock_count: lowStock.length,
    near_expiry_count: nearExpiry.length,
    total_monthly_sales_rs: roundCurrency(monthlySales?.amount),
    total_monthly_replenishments_rs: roundCurrency(monthlyReplenishments?.amount),
  };
}

function getActivityStaffList() {
  return db
    .prepare(`
      SELECT id, full_name, role
      FROM users
      WHERE is_active = 1
        AND role IN ('doctor', 'operator')
      ORDER BY
        CASE role WHEN 'doctor' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END,
        full_name ASC
    `)
    .all();
}

function getMovements(role, doctorId = null, activityFilters = {}) {
  const filterUserId = Number(activityFilters.userId || 0);
  const filterActorRole = String(activityFilters.actorRole || "").trim().toLowerCase();
  const dateFrom = String(activityFilters.dateFrom || "").trim();
  const dateTo = String(activityFilters.dateTo || "").trim();
  const rowLimit = role === "admin" && (dateFrom || dateTo) ? 2000 : 200;

  const rows = db
    .prepare(`
      SELECT
        m.*, i.item_name, i.stock_scope, i.owner_doctor_id, f.name AS folder_name,
        owner.full_name AS owner_doctor_name, target.full_name AS target_doctor_name
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      LEFT JOIN doctors owner ON owner.id = i.owner_doctor_id
      LEFT JOIN doctors target
        ON m.reference_type = 'doctor'
       AND target.id = m.reference_id
      WHERE
        (
          (@role = 'doctor' AND i.stock_scope = 'doctor' AND i.owner_doctor_id = @doctorId)
          OR (@role != 'doctor')
        )
        AND (@dateFrom = '' OR date(m.created_at) >= date(@dateFrom))
        AND (@dateTo = '' OR date(m.created_at) <= date(@dateTo))
        AND (
          @filterUserId = 0
          OR m.recorded_by_user_id = @filterUserId
        )
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT @rowLimit
    `)
    .all({
      role,
      doctorId,
      dateFrom,
      dateTo,
      filterUserId,
      rowLimit,
    });

  const filtered =
    role === "admin" && filterActorRole
      ? rows.filter((row) => {
          let meta = {};
          try {
            meta = JSON.parse(row.meta_json || "{}");
          } catch {
            meta = {};
          }
          if (filterActorRole && String(meta.performed_by_role || "").toLowerCase() !== filterActorRole) {
            return false;
          }
          return true;
        })
      : rows;

  return filtered.map((row) => {
    let meta = {};
    try {
      meta = JSON.parse(row.meta_json || "{}");
    } catch {
      meta = {};
    }
    const locations = buildMovementLocationMeta(row.action_type, meta, {
      targetDoctorName: row.target_doctor_name,
      ownerDoctorName: row.owner_doctor_name,
    });
    const enrichedMeta = { ...meta, ...locations };
    return {
      ...row,
      meta_json: JSON.stringify(enrichedMeta),
      visible_target_doctor_name:
        role === "operator" && row.action_type === "restock_out"
          ? "Doctor (hidden)"
          : row.target_doctor_name,
    };
  });
}

function movementPeriodSql(movementAlias = "m") {
  return `(
    (@useRange = 0 AND strftime('%Y-%m', ${movementAlias}.created_at) = strftime('%Y-%m', 'now'))
    OR (@useRange = 1 AND date(${movementAlias}.created_at) >= date(@dateFrom) AND date(${movementAlias}.created_at) <= date(@dateTo))
  )`;
}

function getCompareRows(dateFrom = "", dateTo = "") {
  const from = String(dateFrom || "").trim();
  const to = String(dateTo || "").trim();
  const useRange = Boolean(from && to);
  const periodSql = movementPeriodSql("m");
  const params = {
    useRange: useRange ? 1 : 0,
    dateFrom: from || null,
    dateTo: to || null,
  };

  return db
    .prepare(`
      SELECT
        d.id AS doctor_id,
        d.full_name AS doctor_name,
        (
          SELECT COALESCE(SUM(m.quantity * i.cost_price), 0)
          FROM inventory_movements m
          JOIN inventory i ON i.id = m.item_id
          WHERE i.stock_scope = 'doctor'
            AND i.owner_doctor_id = d.id
            AND m.action_type = 'restock_in'
            AND ${periodSql}
        ) AS total_restocked,
        (
          SELECT COALESCE(SUM(m.quantity * i.cost_price), 0)
          FROM inventory_movements m
          JOIN inventory i ON i.id = m.item_id
          WHERE i.stock_scope = 'doctor'
            AND i.owner_doctor_id = d.id
            AND m.action_type = 'sell'
            AND ${periodSql}
            AND EXISTS (
              SELECT 1
              FROM consultations c
              JOIN billing b ON b.consultation_id = c.id
              WHERE c.doctor_id = d.id
                AND b.status IN ('paid', 'unpaid')
                AND (
                  c.id = CAST(json_extract(m.meta_json, '$.consultation_id') AS INTEGER)
                  OR (
                    m.reference_type = 'appointment'
                    AND c.appointment_id = m.reference_id
                  )
                )
            )
        ) AS consumed_sales,
        (
          SELECT COALESCE(SUM(m.quantity * i.cost_price), 0)
          FROM inventory_movements m
          JOIN inventory i ON i.id = m.item_id
          WHERE i.stock_scope = 'doctor'
            AND i.owner_doctor_id = d.id
            AND ${periodSql}
            AND (
              m.action_type = 'wastage'
              OR (
                m.action_type = 'stock_out'
                AND lower(trim(coalesce(json_extract(m.meta_json, '$.stock_out_reason'), ''))) = 'wasted'
              )
            )
        ) AS consumed_wasted,
        (
          SELECT COALESCE(SUM(m.quantity * i.cost_price), 0)
          FROM inventory_movements m
          JOIN inventory i ON i.id = m.item_id
          WHERE i.stock_scope = 'doctor'
            AND i.owner_doctor_id = d.id
            AND ${periodSql}
            AND (
              m.action_type = 'expired'
              OR (
                m.action_type = 'stock_out'
                AND lower(trim(coalesce(json_extract(m.meta_json, '$.stock_out_reason'), ''))) = 'expired'
              )
            )
        ) AS consumed_expired
      FROM doctors d
      WHERE d.deleted_at IS NULL
      ORDER BY d.full_name ASC
    `)
    .all(params)
    .map((row) => {
      const totalRestocked = roundCurrency(row.total_restocked);
      const consumedSales = roundCurrency(row.consumed_sales);
      const consumedWasted = roundCurrency(row.consumed_wasted);
      const consumedExpired = roundCurrency(row.consumed_expired);
      const remainingInBag = roundCurrency(
        totalRestocked - consumedSales - consumedWasted - consumedExpired,
      );
      return {
        doctor_id: row.doctor_id,
        doctor_name: row.doctor_name,
        total_restocked: totalRestocked,
        consumed_sales: consumedSales,
        consumed_wasted: consumedWasted,
        consumed_expired: consumedExpired,
        remaining_in_bag: remainingInBag,
      };
    });
}

function getDoctorConsumptionRecord(doctorId) {
  const periods = [
    { id: "week", label: "This Week", startSql: "date('now', 'weekday 1', '-7 days')" },
    { id: "month", label: "This Month", startSql: "date('now', 'start of month')" },
    { id: "ytd", label: "Year to Date", startSql: "date('now', 'start of year')" },
  ];

  return periods.map((period) => {
    const patientVolumeRow = db
      .prepare(`
        SELECT COUNT(DISTINCT c.patient_id) AS patient_volume
        FROM consultations c
        WHERE c.doctor_id = ?
          AND c.consultation_date BETWEEN ${period.startSql} AND date('now')
      `)
      .get(doctorId);

    const stockConsumptionRow = db
      .prepare(`
        SELECT COALESCE(SUM(m.quantity * i.cost_price), 0) AS stock_consumption
        FROM inventory_movements m
        JOIN inventory i ON i.id = m.item_id
        WHERE i.stock_scope = 'doctor'
          AND i.owner_doctor_id = ?
          AND m.movement_type = 'out'
          AND date(m.created_at) BETWEEN ${period.startSql} AND date('now')
      `)
      .get(doctorId);

    return {
      period: period.label,
      period_key: period.id,
      patient_volume: Number(patientVolumeRow?.patient_volume || 0),
      stock_consumption_rs: roundCurrency(stockConsumptionRow?.stock_consumption || 0),
    };
  });
}

function getPayload(req, selectedDoctorId = null, doctorContext = "my") {
  ensureInfrastructure();
  const role = req.auth.role;
  const doctorId = role === "doctor" ? Number(req.auth.doctor_id || 0) : null;
  const folders = getFolders();
  const ocsStock = getItems({ stockScope: "ocs" });
  const myStock = doctorId ? getItems({ stockScope: "doctor", doctorId }) : [];
  const selectedDoctorStock =
    (role === "admin" || role === "operator") && selectedDoctorId
      ? getItems({ stockScope: "doctor", doctorId: selectedDoctorId })
      : [];
  const contextDoctorId = selectedDoctorId && (role === "admin" || role === "operator") ? Number(selectedDoctorId) : null;
  const doctorViewIsOcs = role === "doctor" && doctorContext === "ocs";
  const activeItems = doctorId
    ? doctorViewIsOcs
      ? ocsStock
      : myStock
    : contextDoctorId
      ? selectedDoctorStock
      : ocsStock;
  const summaryDoctorId = doctorId && !doctorViewIsOcs ? doctorId : contextDoctorId || null;

  const activityDateFrom = String(req.query.dateFrom || "").trim();
  const activityDateTo = String(req.query.dateTo || "").trim();

  return {
    folders,
    ocs_stock: ocsStock,
    my_stock: myStock,
    selected_doctor_stock: selectedDoctorStock,
    doctors: role === "admin" || role === "operator" ? getDoctors() : [],
    summary: summarize(activeItems, summaryDoctorId),
    low_stock_items: activeItems.filter((item) => item.quantity <= item.minimum_quantity),
    near_expiry_items: activeItems.filter((item) => isNearExpiry(item.expiry_date)),
    movements: getMovements(role, doctorId, {
      userId: req.query.activityUserId,
      actorRole: req.query.activityRole,
      dateFrom: activityDateFrom,
      dateTo: activityDateTo,
    }),
    activity_staff: role === "admin" ? getActivityStaffList() : [],
    staging: role === "admin" || role === "operator" ? db.prepare("SELECT * FROM inventory_staging ORDER BY created_at DESC, id DESC LIMIT 200").all() : [],
    compare_rows:
      role === "admin" || role === "operator"
        ? getCompareRows(activityDateFrom, activityDateTo)
        : [],
    my_consumption_rows: doctorId ? getDoctorConsumptionRecord(doctorId) : [],
  };
}

function buildActivityHistoryFilter(query = {}) {
  const userId = Number(query.userId || 0);
  const actionValues = String(query.actions || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const search = String(query.search || "").trim();
  const dateFrom = String(query.dateFrom || "").trim();
  const dateTo = String(query.dateTo || "").trim();

  const where = ["1 = 1"];
  const params = {
    userId,
    search: `%${search}%`,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
  };

  if (userId) {
    where.push("actor_user_id = @userId");
  }
  if (search) {
    where.push("(item_name LIKE @search OR actor_name LIKE @search OR source_text LIKE @search OR destination_text LIKE @search)");
  }
  if (dateFrom) {
    where.push("date(timestamp) >= date(@dateFrom)");
  }
  if (dateTo) {
    where.push("date(timestamp) <= date(@dateTo)");
  }
  if (actionValues.length) {
    const expandedActions = [...new Set(actionValues.flatMap((action) => {
      if (action === "restock") return ["restock_in", "restock_out", "restock"];
      if (action === "adjustment") return ["adjustment", "override"];
      return [action];
    }))];
    where.push(`action_type IN (${expandedActions.map((_, index) => `@action${index}`).join(", ")})`);
    expandedActions.forEach((action, index) => {
      params[`action${index}`] = action;
    });
  }

  return {
    whereSql: where.join(" AND "),
    params,
  };
}

function escapeCsvValue(value) {
  const normalized = String(value ?? "");
  return `"${normalized.replace(/"/g, '""')}"`;
}

function calculateEventValue(row) {
  const quantity = Math.abs(Number(row.quantity || 0));
  const actionType = String(row.action_type || "").toLowerCase();
  const cost = Number(row.cost_price || 0);
  const sell = Number(row.selling_price || 0);
  if (actionType === "sell") return roundCurrency(quantity * sell);
  return roundCurrency(quantity * cost);
}

function buildConsolidatedActivity(rows) {
  const grouped = new Map();
  const passthrough = [];

  rows.forEach((row) => {
    const meta = safeParseJson(row.meta_json, {});
    const transactionId = String(meta.transaction_id || "").trim();
    const actionType = String(row.action_type || "").toLowerCase();
    if (!transactionId || (actionType !== "restock_in" && actionType !== "restock_out")) {
      passthrough.push({
        ...row,
        action_type: actionType,
        quantity: Math.abs(Number(row.quantity || 0)),
        value_rs: calculateEventValue(row),
        transaction_id: transactionId || null,
      });
      return;
    }

    const existing = grouped.get(transactionId) || {
      id: `tx-${transactionId}`,
      timestamp: row.timestamp,
      actor_user_id: row.actor_user_id,
      actor_name: row.actor_name,
      actor_role: row.actor_role,
      action_type: "restock",
      item_name: "",
      quantity: 0,
      direction: "transfer",
      source_text: "OCS Master",
      destination_text: String(meta.received_by_name || row.destination_text || ""),
      batch_id: "",
      meta_json: JSON.stringify({ transaction_id: transactionId }),
      transaction_id: transactionId,
      value_rs: 0,
      _itemNames: new Set(),
      _batchParts: new Set(),
    };

    existing.timestamp = existing.timestamp > row.timestamp ? existing.timestamp : row.timestamp;
    existing.actor_user_id = existing.actor_user_id || row.actor_user_id;
    existing.actor_name = existing.actor_name || row.actor_name;
    existing.actor_role = existing.actor_role || row.actor_role;
    existing.destination_text = existing.destination_text || String(meta.received_by_name || row.destination_text || "");
    if (actionType === "restock_out") {
      existing.quantity += Math.abs(Number(row.quantity || 0));
      existing.value_rs += calculateEventValue(row);
    }
    if (row.item_name) existing._itemNames.add(row.item_name);
    String(row.batch_id || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => existing._batchParts.add(part));

    grouped.set(transactionId, existing);
  });

  const consolidated = [
    ...passthrough,
    ...Array.from(grouped.values()).map((entry) => {
      const itemNames = Array.from(entry._itemNames);
      return {
        ...entry,
        item_name: itemNames.length <= 1 ? (itemNames[0] || "-") : `${itemNames.length} items`,
        batch_id: Array.from(entry._batchParts).join(", "),
        value_rs: roundCurrency(entry.value_rs || 0),
      };
    }),
  ]
    .sort((a, b) => {
      const at = new Date(a.timestamp).getTime();
      const bt = new Date(b.timestamp).getTime();
      if (at !== bt) return bt - at;
      return String(b.id).localeCompare(String(a.id));
    });

  return consolidated;
}

function paginateConsolidated(consolidated, { page = 1, limit = 50 } = {}) {
  const total = consolidated.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * limit;
  return {
    page: safePage,
    limit,
    total,
    totalPages,
    rows: consolidated.slice(offset, offset + limit),
  };
}

function computeActivityAnalytics(consolidated, rawRows) {
  const totalTransactions = consolidated.length;
  let totalUnitsMoved = 0;
  let totalCostValue = 0;
  let wastageUnits = 0;
  let wastageValue = 0;
  const actorCounts = new Map();

  consolidated.forEach((row) => {
    const action = String(row.action_type || "").toLowerCase();
    const units = Math.abs(Number(row.quantity || 0));
    totalUnitsMoved += units;
    if (action === "wastage") {
      wastageUnits += units;
      wastageValue += Number(row.value_rs || 0);
    } else if (action === "sell") {
      // Sell value is selling price; cost contribution computed below
    }

    const actorKey = `${row.actor_user_id || "0"}|${row.actor_name || "System"}|${row.actor_role || "N/A"}`;
    const previous = actorCounts.get(actorKey) || {
      actor_user_id: row.actor_user_id || null,
      name: row.actor_name || "System",
      role: row.actor_role || "N/A",
      count: 0,
    };
    previous.count += 1;
    actorCounts.set(actorKey, previous);
  });

  // Cost value uses raw movement rows (richer than consolidated for cost details)
  let sellRevenue = 0;
  let sellCost = 0;
  rawRows.forEach((row) => {
    const action = String(row.action_type || "").toLowerCase();
    const qty = Math.abs(Number(row.quantity || 0));
    const cost = Number(row.cost_price || 0);
    const sell = Number(row.selling_price || 0);
    if (action === "restock_in" || action === "restock_out") {
      // Restock cost counted once via restock_out only to avoid double-counting
      if (action === "restock_out") totalCostValue += qty * cost;
    } else if (action === "sell") {
      totalCostValue += qty * cost;
      sellRevenue += qty * sell;
      sellCost += qty * cost;
    } else {
      totalCostValue += qty * cost;
    }
  });

  const grossMarginPct = sellRevenue > 0 ? ((sellRevenue - sellCost) / sellRevenue) * 100 : null;
  const wastagePct = totalUnitsMoved > 0 ? (wastageUnits / totalUnitsMoved) * 100 : 0;
  const topPerformer = Array.from(actorCounts.values()).sort((a, b) => b.count - a.count)[0] || null;

  return {
    total_transactions: totalTransactions,
    total_units_moved: totalUnitsMoved,
    total_value_cost_rs: roundCurrency(totalCostValue),
    gross_margin_pct: grossMarginPct === null ? null : Number(grossMarginPct.toFixed(2)),
    wastage_value_rs: roundCurrency(wastageValue),
    wastage_pct: Number(wastagePct.toFixed(2)),
    top_performer: topPerformer,
  };
}

router.get("/", (req, res) => {
  const selectedDoctorId = Number(req.query.doctorId || 0) || null;
  const doctorContext = String(req.query.context || "my").trim().toLowerCase() === "ocs" ? "ocs" : "my";
  const payload = getPayload(req, selectedDoctorId, doctorContext);

  res.json(payload);
});

router.get("/receipts/:transactionId", (req, res) => {
  const transactionId = String(req.params.transactionId || "").trim();
  if (!transactionId) {
    return res.status(400).json({ error: "Transaction ID is required." });
  }
  const receipt = buildReceiptByTransaction(transactionId);
  if (!receipt) {
    return res.status(404).json({ error: "Receipt not found for this transaction." });
  }
  res.json(receipt);
});

router.get("/activity-history", (req, res) => {
  ensureInfrastructure();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const { whereSql, params } = buildActivityHistoryFilter(req.query);
  const doctorScopeSql =
    req.auth.role === "doctor" && req.auth.doctor_id
      ? " AND EXISTS (SELECT 1 FROM inventory inv WHERE inv.id = m.item_id AND inv.stock_scope = 'doctor' AND inv.owner_doctor_id = @doctorBagId)"
      : "";
  const scopedParams = {
    ...params,
    doctorBagId: req.auth.role === "doctor" ? Number(req.auth.doctor_id || 0) : null,
  };
  const rawRows = db
    .prepare(`
      SELECT h.*, m.item_id AS movement_item_id, i.cost_price, i.selling_price
      FROM inventory_activity_history h
      LEFT JOIN inventory_movements m ON m.id = h.movement_id
      LEFT JOIN inventory i ON i.id = m.item_id
      WHERE ${whereSql}${doctorScopeSql}
      ORDER BY h.timestamp DESC, h.id DESC
    `)
    .all(scopedParams);
  const consolidated = buildConsolidatedActivity(rawRows);
  const paginated = paginateConsolidated(consolidated, { page, limit });
  const analytics = computeActivityAnalytics(consolidated, rawRows);
  const netValueRs = roundCurrency(consolidated.reduce((sum, row) => sum + Number(row.value_rs || 0), 0));

  const actors = db
    .prepare(`
      SELECT DISTINCT actor_user_id, actor_name, actor_role
      FROM inventory_activity_history
      WHERE actor_user_id IS NOT NULL
      ORDER BY actor_name ASC
    `)
    .all();
  const actions = ["stock_in", "restock", "sell", "wastage", "adjustment", "stock_out"];

  res.json({
    page: paginated.page,
    limit: paginated.limit,
    total: paginated.total,
    totalPages: paginated.totalPages,
    rows: paginated.rows,
    net_value_rs: netValueRs,
    analytics,
    actors,
    actions,
  });
});

router.get("/activity-history/export.csv", (req, res) => {
  ensureInfrastructure();
  if (String(req.auth?.role || "").toLowerCase() !== "admin") {
    return res.status(403).json({ error: "Only admin can export stock activity." });
  }

  const { whereSql, params } = buildActivityHistoryFilter(req.query);
  const rows = db
    .prepare(`
      SELECT h.*, m.item_id AS movement_item_id, i.cost_price, i.selling_price
      FROM inventory_activity_history h
      LEFT JOIN inventory_movements m ON m.id = h.movement_id
      LEFT JOIN inventory i ON i.id = m.item_id
      WHERE ${whereSql}
      ORDER BY h.timestamp DESC, h.id DESC
    `)
    .all(params);
  const consolidated = buildConsolidatedActivity(rows);

  const csvLines = [
    ["Timestamp", "Actor", "Role", "Action Type", "Item Name", "Quantity", "Source", "Destination", "Batch ID", "Value (Rs)"].join(","),
    ...consolidated.map((row) =>
      [
        escapeCsvValue(row.timestamp),
        escapeCsvValue(row.actor_name),
        escapeCsvValue(row.actor_role),
        escapeCsvValue(row.action_type),
        escapeCsvValue(row.item_name),
        Number(row.quantity || 0),
        escapeCsvValue(row.source_text),
        escapeCsvValue(row.destination_text),
        escapeCsvValue(row.batch_id),
        Number(row.value_rs || 0).toFixed(2),
      ].join(","),
    ),
  ];

  const fileName = `stock-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("x-file-name", fileName);
  return res.status(200).send(csvLines.join("\n"));
});

router.post("/items", (req, res) => {
  ensureInfrastructure();
  const role = req.auth.role;
  const isDoctor = role === "doctor";
  if (!isDoctor && !["admin", "operator"].includes(role)) {
    return res.status(403).json({ error: "You do not have permission to add stock items." });
  }

  const doctorId = isDoctor ? Number(req.auth.doctor_id || 0) : null;
  if (isDoctor && !doctorId) {
    return res.status(403).json({ error: "Doctor profile is missing." });
  }

  const itemName = String(req.body.item_name || "").trim();
  const folderId = Number(req.body.folder_id || 0);
  const quantity = Number(req.body.quantity || 0);
  const minimumQuantity = Number(req.body.minimum_quantity || 0);
  const unit = String(req.body.unit || "unit").trim();
  const costPrice = roundCurrency(req.body.cost_price);
  const sellingPrice = roundCurrency(req.body.selling_price);
  const attributes = String(req.body.attributes || "").trim();
  const moaNotes = String(req.body.moa_notes || "").trim();
  const expiryDate = String(req.body.expiry_date || "").trim() || null;

  if (!itemName) return res.status(400).json({ error: "Item name is required." });
  if (!folderId) return res.status(400).json({ error: "Folder is required." });
  if (!Number.isInteger(quantity) || quantity < 0) return res.status(400).json({ error: "Quantity must be zero or more." });
  if (!Number.isInteger(minimumQuantity) || minimumQuantity < 0) return res.status(400).json({ error: "Minimum quantity must be zero or more." });
  if (sellingPrice < costPrice) return res.status(400).json({ error: "Selling price cannot be lower than cost price." });

  const folder = db.prepare("SELECT id FROM inventory_folders WHERE id = ?").get(folderId);
  if (!folder) return res.status(404).json({ error: "Folder not found." });

  const stockScope = isDoctor ? "doctor" : "ocs";
  if (!isDoctor) {
    try {
      assertOcsMasterItemNameAvailable(itemName);
    } catch (error) {
      return res.status(409).json({ error: error.message });
    }
  }

  const result = db
    .prepare(`
      INSERT INTO inventory (
        item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
        cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .run(itemName, folderId, stockScope, doctorId, quantity, minimumQuantity, unit, costPrice, sellingPrice, attributes, moaNotes, expiryDate);

  const createdItemId = Number(result.lastInsertRowid);

  if (quantity > 0) {
    createBatch(createdItemId, quantity, expiryDate, costPrice);
    recordMovement({
      itemId: createdItemId,
      movementType: "in",
      quantity,
      previousQuantity: 0,
      nextQuantity: quantity,
      actionType: "add",
      note: "Initial stock entry",
      userId: req.auth.id,
    });
  } else if (isDoctor && doctorId) {
    void maybeNotifyLowStock(createdItemId, req.auth.id).catch((error) => {
      console.warn("[push] low stock notification failed:", error?.message || error);
    });
  }

  res.status(201).json(getPayload(req));
});

router.put("/items/:id", (req, res) => {
  ensureInfrastructure();
  const role = req.auth.role;
  const isDoctor = role === "doctor";
  if (!isDoctor && !["admin", "operator"].includes(role)) {
    return res.status(403).json({ error: "You do not have permission to edit stock items." });
  }
  const doctorId = isDoctor ? Number(req.auth.doctor_id || 0) : null;
  const stockScope = isDoctor ? "doctor" : "ocs";
  const itemId = Number(req.params.id);
  const existing = findItem(itemId, stockScope, doctorId);
  if (!existing) return res.status(404).json({ error: "Stock item not found." });

  const itemName = isDoctor
    ? String(existing.item_name || "").trim()
    : String(req.body.item_name ?? existing.item_name).trim();
  const folderId = isDoctor
    ? Number(existing.folder_id || 0)
    : Number(req.body.folder_id || existing.folder_id || 0);
  const quantity = Number(req.body.quantity ?? existing.quantity);
  const minimumQuantity = Number(req.body.minimum_quantity ?? existing.minimum_quantity);
  const unit = String(req.body.unit ?? existing.unit ?? "unit").trim();
  const costPrice = isDoctor
    ? roundCurrency(existing.cost_price)
    : roundCurrency(req.body.cost_price ?? existing.cost_price);
  const sellingPrice = isDoctor
    ? roundCurrency(existing.selling_price)
    : roundCurrency(req.body.selling_price ?? existing.selling_price);
  const attributes = String(req.body.attributes ?? existing.attributes ?? "").trim();
  const moaNotes = String(req.body.moa_notes ?? existing.moa_notes ?? "").trim();
  const expiryDate = String(req.body.expiry_date ?? existing.expiry_date ?? "").trim() || null;
  const adjustmentNote = String(req.body.adjustment_note || "").trim();

  if (!itemName) return res.status(400).json({ error: "Item name is required." });
  if (!folderId) return res.status(400).json({ error: "Folder is required." });
  if (!Number.isInteger(quantity) || quantity < 0) return res.status(400).json({ error: "Quantity must be zero or more." });
  if (!Number.isInteger(minimumQuantity) || minimumQuantity < 0) return res.status(400).json({ error: "Minimum quantity must be zero or more." });
  if (sellingPrice < costPrice) return res.status(400).json({ error: "Selling price cannot be lower than cost price." });

  if (!isDoctor) {
    try {
      assertOcsMasterItemNameAvailable(itemName, itemId);
    } catch (error) {
      return res.status(409).json({ error: error.message });
    }
  }

  const previousQuantity = Number(existing.quantity || 0);
  const delta = quantity - previousQuantity;

  try {
    db.transaction(() => {
      if (delta < 0) {
        const consumed = consumeStock(itemId, Math.abs(delta));
        if (!consumed.ok) throw new Error("Insufficient batch stock for quantity reduction.");
      } else if (delta > 0) {
        createBatch(itemId, delta, expiryDate, costPrice);
      }

      db.prepare(`
        UPDATE inventory
        SET
          item_name = ?, folder_id = ?, quantity = ?, minimum_quantity = ?, unit = ?,
          cost_price = ?, selling_price = ?, attributes = ?, moa_notes = ?, expiry_date = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(itemName, folderId, quantity, minimumQuantity, unit, costPrice, sellingPrice, attributes, moaNotes, expiryDate, itemId);

      if (delta !== 0) {
        recordMovement({
          itemId,
          movementType: delta > 0 ? "in" : "out",
          quantity: Math.abs(delta),
          previousQuantity,
          nextQuantity: quantity,
          actionType: "correction",
          note: adjustmentNote || `Quantity adjusted from ${previousQuantity} to ${quantity}`,
          userId: req.auth.id,
        });
      }
    })();
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Unable to update stock item." });
  }

  if (delta === 0 && isDoctor && doctorId) {
    void maybeNotifyLowStock(itemId, req.auth.id).catch((error) => {
      console.warn("[push] low stock notification failed:", error?.message || error);
    });
  }

  res.json(getPayload(req));
});

router.post("/items/:id/ocs-actions", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can perform OCS stock actions." });
  }

  const itemId = Number(req.params.id);
  const item = findItem(itemId, "ocs", null);
  if (!item) return res.status(404).json({ error: "OCS stock item not found." });

  const actionType = String(req.body.action_type || "").trim().toLowerCase();
  const quantity = Number(req.body.quantity || 0);
  if (!["stock_in", "remove"].includes(actionType)) {
    return res.status(400).json({ error: "Action must be stock_in or remove." });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be greater than zero." });
  }

  const previousQuantity = Number(item.quantity || 0);
  if (actionType === "stock_in") {
    const costPrice = roundCurrency(req.body.cost_price ?? item.cost_price);
    const expiryDate = String(req.body.expiry_date || "").trim() || null;
    const nextQuantity = previousQuantity + quantity;

    db.transaction(() => {
      createBatch(itemId, quantity, expiryDate, costPrice);
      db.prepare(`
        UPDATE inventory
        SET quantity = ?, cost_price = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nextQuantity, costPrice, itemId);
      recordMovement({
        itemId,
        movementType: "in",
        quantity,
        previousQuantity,
        nextQuantity,
        actionType: "stock_in",
        note: "Stock In batch added",
        userId: req.auth.id,
        metaJson: JSON.stringify({
          performed_by_user_id: req.auth.id,
          performed_by_role: req.auth.role,
          performed_by_name: req.auth.full_name || req.auth.username || "",
        }),
      });
      recordAudit({
        actionType: "stock_in",
        itemId,
        itemName: item.item_name,
        quantity,
        performedByUserId: req.auth.id,
        performedByRole: req.auth.role,
        performedByName: req.auth.full_name || req.auth.username || "",
      });
    })();

    return res.status(201).json(getPayload(req));
  }

  const reason = String(req.body.reason || "").trim();
  if (!["Expired", "Discontinued", "Damaged"].includes(reason)) {
    return res.status(400).json({ error: "Reason must be Expired, Discontinued, or Damaged." });
  }
  if (previousQuantity < quantity) {
    return res.status(400).json({ error: "Cannot remove more stock than available." });
  }

  try {
    db.transaction(() => {
      const consumed = consumeStock(itemId, quantity);
      if (!consumed.ok) {
        throw new Error("Insufficient batch stock.");
      }
      const nextQuantity = previousQuantity - quantity;
      db.prepare("UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextQuantity, itemId);
      recordMovement({
        itemId,
        movementType: "out",
        quantity,
        previousQuantity,
        nextQuantity,
        actionType: "remove",
        note: `Write-off (${reason})`,
        userId: req.auth.id,
        metaJson: JSON.stringify({
          reason,
          performed_by_user_id: req.auth.id,
          performed_by_role: req.auth.role,
          performed_by_name: req.auth.full_name || req.auth.username || "",
        }),
      });
      recordAudit({
        actionType: "remove",
        itemId,
        itemName: item.item_name,
        quantity,
        reason,
        performedByUserId: req.auth.id,
        performedByRole: req.auth.role,
        performedByName: req.auth.full_name || req.auth.username || "",
      });
    })();
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Unable to remove stock." });
  }

  return res.status(201).json(getPayload(req));
});

router.post("/items/:id/bag-actions", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can adjust doctor bag stock." });
  }

  const itemId = Number(req.params.id);
  const item = db
    .prepare(`
      SELECT *
      FROM inventory
      WHERE id = ?
        AND stock_scope = 'doctor'
        AND owner_doctor_id IS NOT NULL
    `)
    .get(itemId);
  if (!item) return res.status(404).json({ error: "Doctor bag item not found." });

  const actionType = String(req.body.action_type || "").trim().toLowerCase();
  const quantity = Number(req.body.quantity || 0);
  if (actionType !== "remove") {
    return res.status(400).json({ error: "Action must be remove." });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be greater than zero." });
  }

  const reason = String(req.body.reason || "").trim();
  if (!["Expired", "Discontinued", "Damaged", "Wasted"].includes(reason)) {
    return res.status(400).json({ error: "Reason must be Expired, Discontinued, Damaged, or Wasted." });
  }

  const previousQuantity = Number(item.quantity || 0);
  if (previousQuantity < quantity) {
    return res.status(400).json({ error: "Cannot remove more stock than available." });
  }

  try {
    db.transaction(() => {
      const consumed = consumeStock(itemId, quantity);
      if (!consumed.ok) {
        throw new Error("Insufficient batch stock.");
      }
      const nextQuantity = previousQuantity - quantity;
      db.prepare("UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextQuantity, itemId);
      recordMovement({
        itemId,
        movementType: "out",
        quantity,
        previousQuantity,
        nextQuantity,
        actionType: reason === "Wasted" ? "wastage" : "remove",
        note: `Doctor bag write-off (${reason})`,
        userId: req.auth.id,
        metaJson: JSON.stringify({
          reason,
          stock_out_reason: reason === "Wasted" ? "Wasted" : undefined,
          performed_by_user_id: req.auth.id,
          performed_by_role: req.auth.role,
          performed_by_name: req.auth.full_name || req.auth.username || "",
          owner_doctor_id: item.owner_doctor_id,
        }),
      });
    })();
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Unable to adjust doctor bag stock." });
  }

  return res.status(201).json(getPayload(req));
});

router.get("/items/:id/batches", (req, res) => {
  ensureInfrastructure();
  const role = req.auth.role;
  const isDoctor = role === "doctor";
  const doctorId = isDoctor ? Number(req.auth.doctor_id || 0) : null;
  const stockScope = isDoctor ? "doctor" : "ocs";
  const itemId = Number(req.params.id);
  const item = findItem(itemId, stockScope, doctorId);
  if (!item) return res.status(404).json({ error: "Stock item not found." });

  res.json({
    item_id: itemId,
    batches: getBatchesForItem(itemId),
  });
});

router.post("/bulk/remove", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can run bulk remove." });
  }

  const itemIds = Array.isArray(req.body.item_ids) ? req.body.item_ids.map((id) => Number(id)).filter(Boolean) : [];
  const reason = String(req.body.reason || "").trim();
  if (!itemIds.length) return res.status(400).json({ error: "item_ids are required." });
  if (!["Expired", "Discontinued", "Damaged"].includes(reason)) {
    return res.status(400).json({ error: "Reason must be Expired, Discontinued, or Damaged." });
  }

  try {
    db.transaction(() => {
      itemIds.forEach((itemId) => {
        const item = findItem(itemId, "ocs", null);
        if (!item) throw new Error(`OCS stock item not found: ${itemId}`);
        const previousQuantity = Number(item.quantity || 0);
        if (previousQuantity <= 0) return;

        const consumed = consumeStock(itemId, previousQuantity);
        if (!consumed.ok) throw new Error(`Insufficient batch stock for item ${itemId}`);

        db.prepare("UPDATE inventory SET quantity = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(itemId);
        recordMovement({
          itemId,
          movementType: "out",
          quantity: previousQuantity,
          previousQuantity,
          nextQuantity: 0,
          actionType: "remove",
          note: `Bulk write-off (${reason})`,
          userId: req.auth.id,
          metaJson: JSON.stringify({
            reason,
            bulk: true,
            performed_by_user_id: req.auth.id,
            performed_by_role: req.auth.role,
            performed_by_name: req.auth.full_name || req.auth.username || "",
          }),
        });
        recordAudit({
          actionType: "bulk_remove",
          itemId,
          itemName: item.item_name,
          quantity: previousQuantity,
          reason,
          performedByUserId: req.auth.id,
          performedByRole: req.auth.role,
          performedByName: req.auth.full_name || req.auth.username || "",
          metaJson: JSON.stringify({ bulk: true }),
        });
      });
    })();
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Bulk remove failed." });
  }

  return res.status(201).json(getPayload(req));
});

router.post("/bulk/edit", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can run bulk edit." });
  }

  const itemIds = Array.isArray(req.body.item_ids) ? req.body.item_ids.map((id) => Number(id)).filter(Boolean) : [];
  const nextMinQty = req.body.minimum_quantity;
  const nextFolderId = req.body.folder_id;
  if (!itemIds.length) return res.status(400).json({ error: "item_ids are required." });

  const hasMinQty = nextMinQty !== undefined && nextMinQty !== null && String(nextMinQty) !== "";
  const hasFolderId = nextFolderId !== undefined && nextFolderId !== null && String(nextFolderId) !== "";
  if (!hasMinQty && !hasFolderId) {
    return res.status(400).json({ error: "Provide minimum_quantity and/or folder_id." });
  }

  if (hasMinQty) {
    const qty = Number(nextMinQty);
    if (!Number.isInteger(qty) || qty < 0) {
      return res.status(400).json({ error: "minimum_quantity must be zero or more." });
    }
  }

  if (hasFolderId) {
    const folderId = Number(nextFolderId);
    const folder = db
      .prepare("SELECT id FROM inventory_folders WHERE id = ? AND owner_doctor_id IS NULL")
      .get(folderId);
    if (!folder) return res.status(404).json({ error: "Folder not found." });
  }

  try {
    db.transaction(() => {
      itemIds.forEach((itemId) => {
        const item = findItem(itemId, "ocs", null);
        if (!item) throw new Error(`OCS stock item not found: ${itemId}`);

        db.prepare(`
          UPDATE inventory
          SET
            minimum_quantity = COALESCE(?, minimum_quantity),
            folder_id = COALESCE(?, folder_id),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          hasMinQty ? Number(nextMinQty) : null,
          hasFolderId ? Number(nextFolderId) : null,
          itemId,
        );
      });
    })();
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Bulk edit failed." });
  }

  return res.status(201).json(getPayload(req));
});

router.post("/items/:id/actions", (req, res) => {
  ensureInfrastructure();
  if (req.auth.role !== "doctor" || !req.auth.doctor_id) {
    return res.status(403).json({ error: "Only doctor accounts can perform My Stock actions." });
  }

  const doctorId = Number(req.auth.doctor_id);
  const itemId = Number(req.params.id);
  const item = findItem(itemId, "doctor", doctorId);
  if (!item) return res.status(404).json({ error: "My Stock item not found." });

  const actionType = String(req.body.action_type || "").trim().toLowerCase();
  const quantity = Number(req.body.quantity || 0);
  const note = String(req.body.note || "").trim();
  if (!["add", "remove", "stock_out"].includes(actionType)) {
    return res.status(400).json({ error: "Action must be add, remove, or stock_out." });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be greater than zero." });
  }

  const STOCK_OUT_REASONS = new Set(["Wasted", "Expired"]);
  let stockOutReason = null;
  if (actionType === "stock_out") {
    stockOutReason = String(req.body.reason || "").trim();
    if (!STOCK_OUT_REASONS.has(stockOutReason)) {
      return res.status(400).json({
        error: "Patient sales must be recorded through Billing. Stock out reasons are Wasted or Expired only.",
      });
    }
  }

  const movementType = actionType === "add" ? "in" : "out";
  const previousQuantity = Number(item.quantity || 0);
  const nextQuantity = movementType === "in" ? previousQuantity + quantity : previousQuantity - quantity;
  if (nextQuantity < 0) return res.status(400).json({ error: "Cannot remove more stock than available." });

  try {
    db.transaction(() => {
      if (movementType === "in") {
        const previousDeficit = Math.max(0, 0 - previousQuantity);
        const batchQty = Math.max(0, quantity - previousDeficit);
        if (batchQty > 0) {
          createBatch(itemId, batchQty, item.expiry_date || null, item.cost_price);
        }
      } else {
        const consumed = consumeStock(itemId, quantity);
        if (!consumed.ok) {
          throw new Error("Insufficient stock.");
        }
      }

      const movementActionType = actionType === "stock_out" ? "stock_out" : actionType;
      const movementNote =
        actionType === "stock_out"
          ? [
              `Stock out (${stockOutReason})`,
              note ? note : null,
            ]
              .filter(Boolean)
              .join(" — ")
          : note || (actionType === "remove" ? "Removed from stock." : "Added to stock.");

      db.prepare("UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextQuantity, itemId);
      recordMovement({
        itemId,
        movementType,
        quantity,
        previousQuantity,
        nextQuantity,
        actionType: movementActionType,
        note: movementNote,
        userId: req.auth.id,
        referenceType: null,
        referenceId: null,
        metaJson: JSON.stringify({
          performed_by_user_id: req.auth.id,
          performed_by_role: req.auth.role,
          performed_by_name: req.auth.full_name || req.auth.username || "",
          ...(actionType === "stock_out"
            ? { stock_out_reason: stockOutReason, stock_out_note: note || "" }
            : {}),
        }),
      });
    })();
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Unable to process My Stock action." });
  }

  res.status(201).json(getPayload(req));
});

router.post("/restock", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can restock doctors." });
  }

  const ocsItemId = Number(req.body.ocs_item_id || 0);
  const doctorId = Number(req.body.doctor_id || 0);
  const quantity = Number(req.body.quantity || 0);
  const note = String(req.body.note || "").trim();
  if (!ocsItemId || !doctorId || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "ocs_item_id, doctor_id, and positive quantity are required." });
  }

  const doctor = db.prepare("SELECT id, full_name FROM doctors WHERE id = ? AND deleted_at IS NULL").get(doctorId);
  if (!doctor) return res.status(404).json({ error: "Doctor not found." });
  const source = findItem(ocsItemId, "ocs", null);
  if (!source) return res.status(404).json({ error: "OCS stock item not found." });
  if (Number(source.quantity || 0) < quantity) return res.status(400).json({ error: "Insufficient OCS stock." });

  const targetExisting = db
    .prepare(`
      SELECT *
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND inventory.owner_doctor_id = ?
        AND folder_id = ?
        AND item_name = ?
      LIMIT 1
    `)
    .get(doctorId, source.folder_id, source.item_name);
  const transactionId = createTransferTransactionId();
  const receiptReference = `/inventory/receipts/${transactionId}`;

  try {
    db.transaction(() => {
      // IMPORTANT: batch consumption must happen inside the transaction
      const consumed = consumeBatches(source.id, quantity);
      if (!consumed.ok) {
        throw new Error("Insufficient batch stock in OCS inventory.");
      }

      const sourcePrev = Number(source.quantity || 0);
      const sourceNext = sourcePrev - quantity;
      db.prepare("UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sourceNext, source.id);
      recordMovement({
        itemId: source.id,
        movementType: "out",
        quantity,
        previousQuantity: sourcePrev,
        nextQuantity: sourceNext,
        actionType: "restock_out",
        note: note || "Restocked to doctor stock",
        userId: req.auth.id,
        referenceType: "doctor",
        referenceId: doctorId,
      metaJson: JSON.stringify({
        doctor_name: doctor.full_name,
        performed_by_user_id: req.auth.id,
        performed_by_role: req.auth.role,
        performed_by_name: req.auth.full_name || req.auth.username || "",
        transaction_id: transactionId,
        receipt_reference: receiptReference,
        issued_by_name: req.auth.full_name || req.auth.username || "",
        received_by_name: doctor.full_name,
        transfer_allocations: consumed.allocations,
      }),
      });

      let targetItemId;
      let targetPrev = 0;
      let targetNext = quantity;
      if (targetExisting) {
        targetItemId = targetExisting.id;
        targetPrev = Number(targetExisting.quantity || 0);
        targetNext = targetPrev + quantity;
        db.prepare("UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(targetNext, targetItemId);
      } else {
        const created = db
          .prepare(`
            INSERT INTO inventory (
              item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
              cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
            )
            VALUES (?, ?, 'doctor', ?, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
          `)
          .run(
            source.item_name,
            source.folder_id,
            doctorId,
            quantity,
            source.minimum_quantity,
            source.unit,
            source.cost_price,
            source.selling_price,
            source.attributes || "",
            source.moa_notes || "",
            source.expiry_date || null,
          );
        targetItemId = Number(created.lastInsertRowid);
      }

      allocateRestockBatchesToPositive(targetItemId, consumed.allocations, targetPrev);
      recordMovement({
        itemId: targetItemId,
        movementType: "in",
        quantity,
        previousQuantity: targetPrev,
        nextQuantity: targetNext,
        actionType: "restock_in",
        note: note || "Received from OCS stock",
        userId: req.auth.id,
        referenceType: "doctor",
        referenceId: doctorId,
      metaJson: JSON.stringify({
        performed_by_user_id: req.auth.id,
        performed_by_role: req.auth.role,
        performed_by_name: req.auth.full_name || req.auth.username || "",
        transaction_id: transactionId,
        receipt_reference: receiptReference,
        issued_by_name: req.auth.full_name || req.auth.username || "",
        received_by_name: doctor.full_name,
      }),
      });
    recordAudit({
      actionType: "restock_doctor",
      itemId: source.id,
      itemName: source.item_name,
      quantity,
      targetDoctorId: doctorId,
      targetDoctorName: doctor.full_name,
      performedByUserId: req.auth.id,
      performedByRole: req.auth.role,
      performedByName: req.auth.full_name || req.auth.username || "",
      metaJson: JSON.stringify({
        source_item_id: source.id,
        target_item_id: targetItemId,
        transaction_id: transactionId,
        receipt_reference: receiptReference,
      }),
    });
    })();
  } catch (err) {
    return res.status(400).json({ error: err?.message || "Restock failed." });
  }

  res.status(201).json({
    ...getPayload(req),
    restock_receipt: buildReceiptByTransaction(transactionId),
  });
});

router.post("/restock/my-inventory", (req, res) => {
  ensureInfrastructure();
  if (req.auth.role !== "doctor" || !req.auth.doctor_id) {
    return res.status(403).json({ error: "Only doctor accounts can restock personal inventory." });
  }

  const doctorId = Number(req.auth.doctor_id || 0);
  const requests = Array.isArray(req.body.items) ? req.body.items : [];
  if (!requests.length) {
    return res.status(400).json({ error: "At least one restock item is required." });
  }

  const sanitized = requests
    .map((entry) => ({
      ocs_item_id: Number(entry?.ocs_item_id || 0),
      quantity: Number(entry?.quantity || 0),
      expiry_date: entry?.expiry_date ? String(entry.expiry_date).trim() : null,
    }))
    .filter((entry) => entry.ocs_item_id && Number.isInteger(entry.quantity) && entry.quantity > 0);

  if (!sanitized.length) {
    return res.status(400).json({ error: "Each restock item must include ocs_item_id and positive quantity." });
  }

  const doctor = db.prepare("SELECT id, full_name FROM doctors WHERE id = ? AND deleted_at IS NULL").get(doctorId);
  if (!doctor) {
    return res.status(404).json({ error: "Doctor profile not found." });
  }
  const transactionId = createTransferTransactionId();
  const receiptReference = `/inventory/receipts/${transactionId}`;

  try {
    db.transaction(() => {
      for (const request of sanitized) {
        const source = findItem(request.ocs_item_id, "ocs", null);
        if (!source) {
          throw new Error("One or more OCS stock items were not found.");
        }

        const sourceQty = Number(source.quantity || 0);
        if (sourceQty < request.quantity) {
          throw new Error(`Insufficient OCS stock for ${source.item_name}.`);
        }

        const consumed = consumeBatches(source.id, request.quantity);
        if (!consumed.ok) {
          throw new Error(`Insufficient FEFO batch stock for ${source.item_name}.`);
        }

        const sourceNext = sourceQty - request.quantity;
        db.prepare("UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sourceNext, source.id);
        recordMovement({
          itemId: source.id,
          movementType: "out",
          quantity: request.quantity,
          previousQuantity: sourceQty,
          nextQuantity: sourceNext,
          actionType: "restock_out",
          note: "Doctor self-restock request",
          userId: req.auth.id,
          referenceType: "doctor",
          referenceId: doctorId,
          metaJson: JSON.stringify({
            doctor_name: doctor.full_name,
            performed_by_user_id: req.auth.id,
            performed_by_role: req.auth.role,
            performed_by_name: req.auth.full_name || req.auth.username || "",
            transaction_id: transactionId,
            receipt_reference: receiptReference,
            issued_by_name: req.auth.full_name || req.auth.username || "",
            received_by_name: doctor.full_name,
            transfer_allocations: consumed.allocations,
          }),
        });

        const targetExisting = db
          .prepare(`
            SELECT *
            FROM inventory
            WHERE stock_scope = 'doctor'
              AND owner_doctor_id = ?
              AND folder_id = ?
              AND item_name = ?
            LIMIT 1
          `)
          .get(doctorId, source.folder_id, source.item_name);

        let targetItemId;
        let targetPrev = 0;
        let targetNext = request.quantity;
        if (targetExisting) {
          targetItemId = Number(targetExisting.id);
          targetPrev = Number(targetExisting.quantity || 0);
          targetNext = targetPrev + request.quantity;
          db.prepare("UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(targetNext, targetItemId);
        } else {
          const created = db
            .prepare(`
              INSERT INTO inventory (
                item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
                cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
              )
              VALUES (?, ?, 'doctor', ?, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
            `)
            .run(
              source.item_name,
              source.folder_id,
              doctorId,
              request.quantity,
              source.minimum_quantity,
              source.unit,
              source.cost_price,
              source.selling_price,
              source.attributes || "",
              source.moa_notes || "",
              source.expiry_date || null,
            );
          targetItemId = Number(created.lastInsertRowid);
        }

        if (request.expiry_date) {
          createBatch(targetItemId, request.quantity, request.expiry_date, source.cost_price);
          db.prepare("UPDATE inventory SET expiry_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
            request.expiry_date,
            targetItemId,
          );
        } else {
          allocateRestockBatchesToPositive(targetItemId, consumed.allocations, targetPrev);
        }
        recordMovement({
          itemId: targetItemId,
          movementType: "in",
          quantity: request.quantity,
          previousQuantity: targetPrev,
          nextQuantity: targetNext,
          actionType: "restock_in",
          note: request.expiry_date
            ? `Restocked from OCS stock (exp ${request.expiry_date})`
            : "Restocked from OCS stock",
          userId: req.auth.id,
          referenceType: "doctor",
          referenceId: doctorId,
          metaJson: JSON.stringify({
            performed_by_user_id: req.auth.id,
            performed_by_role: req.auth.role,
            performed_by_name: req.auth.full_name || req.auth.username || "",
            transaction_id: transactionId,
            receipt_reference: receiptReference,
            issued_by_name: req.auth.full_name || req.auth.username || "",
            received_by_name: doctor.full_name,
            ...(request.expiry_date ? { batch_expiry_date: request.expiry_date } : {}),
          }),
        });
        recordAudit({
          actionType: "restock_my_inventory",
          itemId: source.id,
          itemName: source.item_name,
          quantity: request.quantity,
          targetDoctorId: doctorId,
          targetDoctorName: doctor.full_name,
          performedByUserId: req.auth.id,
          performedByRole: req.auth.role,
          performedByName: req.auth.full_name || req.auth.username || "",
          metaJson: JSON.stringify({
            source_item_id: source.id,
            target_item_id: targetItemId,
            transaction_id: transactionId,
            receipt_reference: receiptReference,
            restocked_at: new Date().toISOString(),
            ...(request.expiry_date ? { batch_expiry_date: request.expiry_date } : {}),
          }),
        });
      }
    })();
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Doctor restock failed." });
  }

  res.status(201).json({
    ...getPayload(req, null, "my"),
    restock_receipt: buildReceiptByTransaction(transactionId),
  });
});

router.post("/staging/import-csv", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can import CSV shipments." });
  }
  const csvText = String(req.body.csv_text || "").trim();
  if (!csvText) return res.status(400).json({ error: "csv_text is required." });

  const [headerLine, ...rowLines] = csvText.split(/\r?\n/).filter(Boolean);
  const headers = headerLine.split(",").map((value) => value.trim().toLowerCase());
  const required = ["folder", "item_name", "quantity", "minimum_quantity", "unit", "cost_price", "selling_price", "expiry_date"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) return res.status(400).json({ error: `CSV missing headers: ${missing.join(", ")}` });

  const folderMap = new Map(getFolders().map((folder) => [folder.name.toLowerCase(), folder.id]));
  const insert = db.prepare(`
    INSERT INTO inventory_staging (
      folder_id, item_name, quantity, minimum_quantity, unit, cost_price, selling_price,
      attributes, moa_notes, expiry_date, status, created_by_user_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);

  let inserted = 0;
  rowLines.forEach((line) => {
    const values = line.split(",").map((value) => value.trim());
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    const folderId = folderMap.get(String(row.folder || "").toLowerCase());
    const qty = Number(row.quantity || 0);
    if (!folderId || !row.item_name || !Number.isInteger(qty) || qty < 0) return;
    insert.run(
      folderId,
      row.item_name,
      qty,
      Number(row.minimum_quantity || 0),
      row.unit || "unit",
      toNumber(row.cost_price, 0),
      toNumber(row.selling_price, 0),
      row.attributes || "",
      row.moa_notes || "",
      row.expiry_date || null,
      req.auth.id,
    );
    inserted += 1;
  });
  if (!inserted) return res.status(400).json({ error: "No valid rows found in CSV." });
  res.status(201).json(getPayload(req));
});

router.post("/staging/:id/release", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can release staging items." });
  }
  const stagingId = Number(req.params.id);
  const row = db.prepare("SELECT * FROM inventory_staging WHERE id = ? AND status = 'pending'").get(stagingId);
  if (!row) return res.status(404).json({ error: "Pending staging row not found." });

  const existing = db
    .prepare(`
      SELECT *
      FROM inventory
      WHERE stock_scope = 'ocs'
        AND inventory.owner_doctor_id IS NULL
        AND folder_id = ?
        AND item_name = ?
      LIMIT 1
    `)
    .get(row.folder_id, row.item_name);

  db.transaction(() => {
    let itemId;
    let prevQty = 0;
    let nextQty = Number(row.quantity || 0);
    if (existing) {
      itemId = existing.id;
      prevQty = Number(existing.quantity || 0);
      nextQty = prevQty + Number(row.quantity || 0);
      db.prepare("UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextQty, itemId);
    } else {
      const inserted = db
        .prepare(`
          INSERT INTO inventory (
            item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
            cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
          )
          VALUES (?, ?, 'ocs', NULL, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
        `)
        .run(
          row.item_name,
          row.folder_id,
          row.quantity,
          row.minimum_quantity,
          row.unit,
          row.cost_price,
          row.selling_price,
          row.attributes || "",
          row.moa_notes || "",
          row.expiry_date || null,
        );
      itemId = Number(inserted.lastInsertRowid);
    }

    createBatch(itemId, Number(row.quantity || 0), row.expiry_date || null, row.cost_price || 0);
    recordMovement({
      itemId,
      movementType: "in",
      quantity: Number(row.quantity || 0),
      previousQuantity: prevQty,
      nextQuantity: nextQty,
      actionType: "add",
      note: "Released from staging",
      userId: req.auth.id,
    });
    db.prepare(`
      UPDATE inventory_staging
      SET status = 'released', released_by_user_id = ?, released_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.auth.id, stagingId);
  })();

  res.status(201).json(getPayload(req));
});

router.post("/stocktake", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can submit stocktake entries." });
  }

  const itemId = Number(req.body.item_id || 0);
  const physicalQuantity = Number(req.body.physical_quantity || 0);
  const note = String(req.body.note || "").trim();
  if (!itemId || !Number.isInteger(physicalQuantity) || physicalQuantity < 0) {
    return res.status(400).json({ error: "item_id and physical_quantity are required." });
  }

  const item = findItem(itemId, "ocs", null);
  if (!item) return res.status(404).json({ error: "OCS stock item not found." });
  const digitalQuantity = Number(item.quantity || 0);
  const discrepancy = physicalQuantity - digitalQuantity;
  db.prepare(`
    INSERT INTO inventory_stocktakes (
      item_id, physical_quantity, digital_quantity, discrepancy, note, created_by_user_id
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(itemId, physicalQuantity, digitalQuantity, discrepancy, note, req.auth.id);
  res.status(201).json({ ok: true, discrepancy });
});

router.delete("/items/:id", (req, res) => {
  ensureInfrastructure();
  const isDoctor = req.auth.role === "doctor";
  const doctorId = isDoctor ? Number(req.auth.doctor_id || 0) : null;
  if (!isDoctor && !["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin, operator, or owning doctor can delete items." });
  }

  const itemId = Number(req.params.id);
  const item = isDoctor ? findItem(itemId, "doctor", doctorId) : db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId);
  if (!item) return res.status(404).json({ error: "Stock item not found." });

  const isOcsMaster =
    String(item.stock_scope || "") === "ocs" && (item.owner_doctor_id == null || item.owner_doctor_id === "");

  db.transaction(() => {
    db.prepare("DELETE FROM inventory_batches WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM inventory_movements WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM inventory WHERE id = ?").run(itemId);
    if (isOcsMaster && item.item_name) {
      recordOcsCatalogExclusion(item.item_name, req.auth?.id || null);
    }
  })();
  res.status(204).send();
});

module.exports = router;
