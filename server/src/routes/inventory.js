const express = require("express");
const { ensureOcsCatalogSync } = require("../lib/ensureOcsCatalog");
const {
  ensureOcsCatalogExclusionsTable,
  recordOcsCatalogExclusion,
} = require("../lib/ocsCatalogExclusions");
const { prepareOcsMasterInventoryIntegrity, assertOcsMasterItemNameAvailable } = require("../lib/dedupeOcsMasterInventory");
const { maybeNotifyLowStock, sendPushToRole } = require("../lib/push");
const {
  InventoryVersionConflictError,
  assertInventoryQuantityUpdate,
  ensureInventoryRowVersionColumn,
  updateInventoryQuantity,
} = require("../lib/inventoryQuantity");
const {
  handleInventoryStream,
  publishInventoryChange,
  publishInventoryResyncBroadcast,
  publishPatientDataChange,
} = require("../lib/inventoryRealtime");
const { db } = require("../db");
const { getTodayLocal, toNumber } = require("../lib/utils");
const { attachSaleDeductToPatientBill } = require("../lib/saleBillingLinkage");
const {
  applyStocktakeSession,
  bulkReleaseShipment,
  closeShipmentIfIdle,
  consumeAllocatedBatches,
  createShipmentFromImport,
  createStocktakeSession,
  csvShipmentTemplate,
  doctorMayViewReceipt,
  excludeShipmentLines,
  getShipment,
  getStocktakeSession,
  isDoctorEmergencyRestockEnabled,
  listShipments,
  listStocktakeSessions,
  parseCsvShipment,
  parseNonExpiringFlag,
  previewAllocations,
  releaseStagingRows,
  reviewStocktakeSession,
  saveStocktakeCounts,
  shipmentQueueStats,
  stocktakeQueueStats,
  submitStocktakeSession,
  validateReceiptExpiry,
  applyExceptionalCorrection,
} = require("../lib/inventoryOperations");
const {
  assertAdminCatalogueAction,
  assertRoutineOperatorAction,
  assertWriteOffInputs,
  isAdminRole,
  isOperatorRole,
  isWarehouseViewer,
} = require("../lib/inventoryAccess");
const { availableToPromise } = require("../lib/restockFulfilment");
const {
  isAutomatedMovementMeta,
  resolveAuditActor,
} = require("../lib/auditActor");

const { REQUIRED_INVENTORY_FOLDERS, inventoryFolderOrderSql } = require("../config/inventoryFolders");

const router = express.Router();
const REQUIRED_FOLDERS = REQUIRED_INVENTORY_FOLDERS;
const NEAR_EXPIRY_DAYS = 90;

function isWarehouseManager(role) {
  return role === "admin" || role === "operator";
}

router.get("/stream", (req, res) => {
  handleInventoryStream(req, res);
});

router.post("/resync-broadcast", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only administrators can broadcast inventory resync." });
  }
  const result = publishInventoryResyncBroadcast();
  return res.json({ ok: true, delivered: result.delivered });
});

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

  ensureInventoryRowVersionColumn();
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
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released', 'cancelled', 'excluded')),
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
  const primaryMeta = safeParseJson((sourceRows[0] || rows[0]).meta_json, {});
  const items = sourceRows.map((row) => {
    const meta = safeParseJson(row.meta_json, {});
    const allocations = Array.isArray(meta.transfer_allocations) ? meta.transfer_allocations : [];
    if (!allocations.length) {
      return [
        {
          item_name: row.item_name,
          batch_number: "N/A",
          expiry: null,
          quantity: Number(row.quantity ?? 0),
          unit: row.unit || "unit",
        },
      ];
    }
    return allocations.map((allocation, index) => ({
      item_name: row.item_name,
      batch_number: `B${row.id}-${index + 1}`,
      expiry: allocation.expiry_date || null,
      quantity: Number(allocation.quantity ?? 0),
      unit: row.unit || "unit",
    }));
  }).flat();

  return {
    transaction_id: transactionId,
    title: "Stock Transfer Note",
    date_time: rows[rows.length - 1]?.created_at || rows[0].created_at,
    issued_by_name: primaryMeta.issued_by_name || "",
    received_by_name: primaryMeta.received_by_name || "",
    confirmed_by_name: primaryMeta.confirmed_by_name || "",
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
        AND i.archived_at IS NULL
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
      expiry_date: row.nearest_expiry_date || null,
      catalogue_expiry_date: row.expiry_date || null,
      current_cost_value: roundCurrency(Number(row.quantity || 0) * toNumber(row.cost_price, 0)),
      is_near_expiry: isNearExpiry(row.nearest_expiry_date),
    }));
}

function getBatchesForItem(itemId) {
  return db
    .prepare(`
      SELECT id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, created_at
      FROM inventory_batches
      WHERE item_id = ?
      ORDER BY
        CASE
          WHEN expiry_date IS NOT NULL AND COALESCE(is_non_expiring, 0) = 0 THEN 0
          WHEN COALESCE(is_non_expiring, 0) = 1 THEN 1
          ELSE 2
        END,
        expiry_date ASC,
        id ASC
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
        AND inventory.archived_at IS NULL
    `)
    .get(itemId, stockScope, stockScope, doctorId, stockScope);
}

function getInventoryQueryContext(req) {
  const selectedDoctorId = Number(req.query.doctorId || 0) || null;
  const doctorContext = String(req.query.context || "my").trim().toLowerCase() === "ocs" ? "ocs" : "my";
  return { selectedDoctorId, doctorContext };
}

function findItemForRequest(req, itemId) {
  const role = req.auth.role;
  const isDoctor = role === "doctor";

  if (isDoctor) {
    const doctorId = Number(req.auth.doctor_id || 0);
    if (!doctorId) return null;
    const { doctorContext } = getInventoryQueryContext(req);
    const stockScope = doctorContext === "ocs" ? "ocs" : "doctor";
    return findItem(itemId, stockScope, stockScope === "doctor" ? doctorId : null);
  }

  if (["admin", "operator"].includes(role)) {
    const { selectedDoctorId } = getInventoryQueryContext(req);
    if (selectedDoctorId) {
      const doctorItem = findItem(itemId, "doctor", selectedDoctorId);
      if (doctorItem) return doctorItem;
    }
    return findItem(itemId, "ocs", null);
  }

  return null;
}

function getPayloadFromRequest(req) {
  const { selectedDoctorId, doctorContext } = getInventoryQueryContext(req);
  return getPayload(req, selectedDoctorId, doctorContext);
}

function createBatch(itemId, quantity, expiryDate, unitCost, { isNonExpiring = false } = {}) {
  db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    itemId,
    quantity,
    isNonExpiring ? null : expiryDate || null,
    roundCurrency(unitCost),
    isNonExpiring ? 1 : 0,
  );
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
      createBatch(itemId, batchQty, allocation.expiry_date, allocation.unit_cost, {
        isNonExpiring: Boolean(allocation.is_non_expiring),
      });
    }
  });
}

function consumeBatches(itemId, quantity, { disallowExpired = false } = {}) {
  const rows = db
    .prepare(`
      SELECT id, quantity_remaining, expiry_date, unit_cost, is_non_expiring
      FROM inventory_batches
      WHERE item_id = ?
        AND quantity_remaining > 0
      ORDER BY
        CASE
          WHEN expiry_date IS NOT NULL AND COALESCE(is_non_expiring, 0) = 0 THEN 0
          WHEN COALESCE(is_non_expiring, 0) = 1 THEN 1
          ELSE 2
        END,
        expiry_date ASC,
        id ASC
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
      batch_id: row.id,
      quantity: take,
      expiry_date: row.expiry_date || null,
      unit_cost: toNumber(row.unit_cost, 0),
      is_non_expiring: Number(row.is_non_expiring || 0) === 1,
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
    const reasonLower = reason.toLowerCase();
    return {
      source_location: doctorBagLabel(meta.doctor_name || context.ownerDoctorName),
      destination_location:
        reasonLower === "sale"
          ? "Patient Account"
          : reason
            ? `Stock Out (${reason})`
            : "Stock Out",
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
  referenceType = "",
  referenceId = null,
  metaJson = "{}",
}) {
  const referenceTypeValue = referenceType == null ? "" : String(referenceType);
  const meta = safeParseJson(metaJson, {});
  const movementItem = db
    .prepare("SELECT item_name, owner_doctor_id FROM inventory WHERE id = ?")
    .get(itemId);
  const locationContext = {};
  if (referenceTypeValue === "doctor" && referenceId) {
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
    referenceTypeValue,
    referenceId,
    finalMetaJson,
  );

  const inserted = db.prepare("SELECT last_insert_rowid() AS id").get();
  const movementId = Number(inserted?.id || 0);
  const actorName = resolveAuditActor({
    displayName: enrichedMeta.performed_by_name,
    userId: userId || enrichedMeta.performed_by_user_id,
    automated: isAutomatedMovementMeta(enrichedMeta),
    required: true,
  });
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

  void publishInventoryChange({ itemId, changedByUserId: userId });
  return movementId;
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

function stripFinancialSummaryFields(summary, role) {
  if (!summary || isWarehouseManager(role) || role === "accountant") {
    return summary;
  }

  const {
    total_monthly_sales_rs: _sales,
    total_monthly_replenishments_rs: _replenishments,
    total_amount_consumed_rs: _consumed,
    ...operational
  } = summary;

  return operational;
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
  const rowLimit = isWarehouseManager(role) && (dateFrom || dateTo) ? 2000 : 200;

  const rows = db
    .prepare(`
      SELECT
        m.*, i.item_name, i.stock_scope, i.owner_doctor_id, f.name AS folder_name,
        owner.full_name AS owner_doctor_name, target.full_name AS target_doctor_name,
        recorder.full_name AS recorded_by_name, recorder.username AS recorded_by_username
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      LEFT JOIN doctors owner ON owner.id = i.owner_doctor_id
      LEFT JOIN doctors target
        ON m.reference_type = 'doctor'
       AND target.id = m.reference_id
      LEFT JOIN users recorder ON recorder.id = m.recorded_by_user_id
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
    isWarehouseManager(role) && filterActorRole
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
    const actorUserId = meta.performed_by_user_id || row.recorded_by_user_id || null;
    const actorName = resolveAuditActor({
      displayName: meta.performed_by_name || row.recorded_by_name || row.recorded_by_username,
      userId: actorUserId,
      automated: isAutomatedMovementMeta(meta) && !actorUserId,
      required: true,
    });
    return {
      ...row,
      meta_json: JSON.stringify({
        ...enrichedMeta,
        performed_by_name: actorName,
      }),
      actor_name: actorName,
      actor_display_name: actorName,
      visible_target_doctor_name: row.target_doctor_name,
    };
  });
}

function movementPeriodSql(movementAlias = "m") {
  return `(
    (@useRange = 0 AND strftime('%Y-%m', ${movementAlias}.created_at) = strftime('%Y-%m', 'now'))
    OR (@useRange = 1 AND date(${movementAlias}.created_at) >= date(@dateFrom) AND date(${movementAlias}.created_at) <= date(@dateTo))
  )`;
}

function getCompareMetricByDoctor(params, periodSql, whereExtra) {
  return db
    .prepare(
      `
        SELECT
          i.owner_doctor_id AS doctor_id,
          COALESCE(SUM(m.quantity * i.cost_price), 0) AS amount,
          COALESCE(SUM(m.quantity), 0) AS qty,
          COALESCE(SUM(CASE WHEN COALESCE(i.cost_price, 0) = 0 THEN m.quantity ELSE 0 END), 0) AS unpriced_qty
        FROM inventory_movements m
        JOIN inventory i ON i.id = m.item_id
        WHERE i.stock_scope = 'doctor'
          AND i.owner_doctor_id IS NOT NULL
          AND ${periodSql}
          AND (${whereExtra})
        GROUP BY i.owner_doctor_id
      `,
    )
    .all(params);
}

function indexCompareMetric(rows) {
  const map = new Map();
  for (const row of rows || []) {
    map.set(Number(row.doctor_id), {
      amount: roundCurrency(row.amount),
      qty: Number(row.qty || 0),
      unpriced_qty: Number(row.unpriced_qty || 0),
    });
  }
  return map;
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

  const restocked = indexCompareMetric(
    getCompareMetricByDoctor(params, periodSql, `m.action_type = 'restock_in'`),
  );
  const consumedSales = indexCompareMetric(
    getCompareMetricByDoctor(
      params,
      periodSql,
      `
        (
          m.action_type = 'sell'
          AND EXISTS (
            SELECT 1
            FROM consultations c
            JOIN billing b ON b.consultation_id = c.id
            WHERE c.doctor_id = i.owner_doctor_id
              AND b.status IN ('paid', 'unpaid')
              AND (
                c.id = CAST(json_extract(m.meta_json, '$.consultation_id') AS INTEGER)
                OR (
                  m.reference_type = 'appointment'
                  AND c.appointment_id = m.reference_id
                )
              )
          )
        )
        OR (
          m.action_type = 'stock_out'
          AND lower(trim(coalesce(json_extract(m.meta_json, '$.stock_out_reason'), ''))) = 'sale'
        )
      `,
    ),
  );
  const consumedWasted = indexCompareMetric(
    getCompareMetricByDoctor(
      params,
      periodSql,
      `
        m.action_type = 'wastage'
        OR (
          m.action_type = 'stock_out'
          AND lower(trim(coalesce(json_extract(m.meta_json, '$.stock_out_reason'), ''))) = 'wasted'
        )
      `,
    ),
  );
  const consumedExpired = indexCompareMetric(
    getCompareMetricByDoctor(
      params,
      periodSql,
      `
        m.action_type = 'expired'
        OR (
          m.action_type = 'stock_out'
          AND lower(trim(coalesce(json_extract(m.meta_json, '$.stock_out_reason'), ''))) = 'expired'
        )
      `,
    ),
  );
  const exceptionalCorrections = indexCompareMetric(
    getCompareMetricByDoctor(
      params,
      periodSql,
      `m.action_type IN ('exceptional_correction', 'correction', 'override')`,
    ),
  );

  const bagOnHandRows = db
    .prepare(
      `
        SELECT
          owner_doctor_id AS doctor_id,
          COALESCE(SUM(quantity), 0) AS qty,
          COALESCE(SUM(quantity * cost_price), 0) AS amount,
          COALESCE(SUM(CASE WHEN COALESCE(cost_price, 0) = 0 THEN quantity ELSE 0 END), 0) AS unpriced_qty
        FROM inventory
        WHERE stock_scope = 'doctor'
          AND owner_doctor_id IS NOT NULL
        GROUP BY owner_doctor_id
      `,
    )
    .all();
  const bagOnHand = indexCompareMetric(bagOnHandRows);

  const emptyMetric = { amount: 0, qty: 0, unpriced_qty: 0 };

  return db
    .prepare(
      `
        SELECT id AS doctor_id, full_name AS doctor_name
        FROM doctors
        WHERE deleted_at IS NULL
        ORDER BY full_name ASC
      `,
    )
    .all()
    .map((row) => {
      const doctorId = Number(row.doctor_id);
      const restock = restocked.get(doctorId) || emptyMetric;
      const sales = consumedSales.get(doctorId) || emptyMetric;
      const wasted = consumedWasted.get(doctorId) || emptyMetric;
      const expired = consumedExpired.get(doctorId) || emptyMetric;
      const exceptional = exceptionalCorrections.get(doctorId) || emptyMetric;
      const onHand = bagOnHand.get(doctorId) || emptyMetric;
      const remainingInBag = roundCurrency(restock.amount - sales.amount - wasted.amount - expired.amount);
      const periodWorkflowQty =
        restock.qty + sales.qty + wasted.qty + expired.qty + exceptional.qty;
      return {
        doctor_id: doctorId,
        doctor_name: row.doctor_name,
        total_restocked: restock.amount,
        total_restocked_qty: restock.qty,
        consumed_sales: sales.amount,
        consumed_sales_qty: sales.qty,
        consumed_wasted: wasted.amount,
        consumed_wasted_qty: wasted.qty,
        consumed_expired: expired.amount,
        consumed_expired_qty: expired.qty,
        exceptional_correction_qty: exceptional.qty,
        exceptional_correction_value: exceptional.amount,
        remaining_in_bag: remainingInBag,
        bag_on_hand: onHand.amount,
        bag_on_hand_qty: onHand.qty,
        unpriced_qty: restock.unpriced_qty + sales.unpriced_qty + wasted.unpriced_qty + expired.unpriced_qty + onHand.unpriced_qty,
        variance_rs: roundCurrency(onHand.amount - remainingInBag),
        has_period_workflow: periodWorkflowQty > 0,
        period_note:
          periodWorkflowQty > 0
            ? ""
            : onHand.qty > 0
              ? "No restock, use, waste, or correction recorded in this period."
              : "No bag workflow movements in this period.",
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

function getBagPricingSummary() {
  const rows = db
    .prepare(
      `
        SELECT
          owner_doctor_id,
          LOWER(TRIM(item_name)) AS product_key,
          id,
          quantity,
          cost_price
        FROM inventory
        WHERE stock_scope = 'doctor'
          AND owner_doctor_id IS NOT NULL
          AND archived_at IS NULL
      `,
    )
    .all();
  const unpricedRows = rows.filter((row) => Number(row.cost_price || 0) === 0 && Number(row.quantity || 0) > 0);
  const uniqueProducts = new Set(unpricedRows.map((row) => row.product_key).filter(Boolean));
  const affectedBags = new Set(unpricedRows.map((row) => Number(row.owner_doctor_id)));
  const valuationComplete = uniqueProducts.size === 0;
  return {
    unpriced_catalogue_items: uniqueProducts.size,
    unpriced_bag_item_instances: unpricedRows.length,
    affected_doctor_bags: affectedBags.size,
    unpriced_product_keys: [...uniqueProducts],
    valuation_complete: valuationComplete,
  };
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
  const rawSummary = summarize(activeItems, summaryDoctorId);
  const warehouseManager = isWarehouseManager(role);
  const shipments = warehouseManager ? listShipments() : [];
  const stocktakeSessions = warehouseManager ? listStocktakeSessions() : [];
  const compareRows = warehouseManager ? getCompareRows(activityDateFrom, activityDateTo) : [];
  const shipmentStats = warehouseManager ? shipmentQueueStats(shipments) : null;
  const stocktakeStats = warehouseManager ? stocktakeQueueStats(stocktakeSessions) : null;
  const bagValue = compareRows.reduce((sum, row) => sum + Number(row.bag_on_hand || 0), 0);
  const bagPricing = warehouseManager ? getBagPricingSummary() : null;
  const periodExceptions = compareRows.reduce(
    (sum, row) => sum + Number(row.exceptional_correction_qty || 0),
    0,
  );
  const periodMovements = compareRows.filter((row) => row.has_period_workflow).length;

  return {
    folders,
    ocs_stock: ocsStock,
    my_stock: myStock,
    selected_doctor_stock: selectedDoctorStock,
    doctors: role === "admin" || role === "operator" ? getDoctors() : [],
    summary: stripFinancialSummaryFields(rawSummary, role),
    tab_summaries: warehouseManager
      ? {
          stock: {
            warehouse_value: rawSummary.total_amount_rs,
            low_stock: Number(rawSummary.low_stock_count || 0),
            near_expiry: Number(rawSummary.near_expiry_count || 0),
            missing_expiry: ocsStock.filter((item) => !item.expiry_date).length,
          },
          shipments: shipmentStats,
          count: stocktakeStats,
          bags: {
            doctor_bags: compareRows.filter((row) => Number(row.bag_on_hand_qty || 0) > 0).length,
            total_bag_value: roundCurrency(bagValue),
            valuation_complete: Boolean(bagPricing?.valuation_complete),
            unpriced_catalogue_items: Number(bagPricing?.unpriced_catalogue_items || 0),
            unpriced_bag_item_instances: Number(bagPricing?.unpriced_bag_item_instances || 0),
            affected_doctor_bags: Number(bagPricing?.affected_doctor_bags || 0),
            unpriced_product_keys: Array.isArray(bagPricing?.unpriced_product_keys)
              ? bagPricing.unpriced_product_keys
              : [],
            unpriced_items: Number(bagPricing?.unpriced_catalogue_items || 0),
            period_movements: periodMovements,
            period_exceptions: periodExceptions,
          },
        }
      : null,
    low_stock_items: activeItems.filter((item) => item.quantity <= item.minimum_quantity),
    near_expiry_items: activeItems.filter((item) => isNearExpiry(item.expiry_date)),
    movements: getMovements(role, doctorId, {
      userId: req.query.activityUserId,
      actorRole: req.query.activityRole,
      dateFrom: activityDateFrom,
      dateTo: activityDateTo,
    }),
    activity_staff: warehouseManager ? getActivityStaffList() : [],
    staging: warehouseManager
      ? db
          .prepare(
            `
      SELECT s.*, f.name AS folder_name
      FROM inventory_staging s
      LEFT JOIN inventory_folders f ON f.id = s.folder_id
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 200
    `,
          )
          .all()
      : [],
    shipments,
    incoming_shipments: shipments.filter((row) => row.in_incoming_queue),
    stocktake_sessions: stocktakeSessions,
    emergency_restock_enabled: role === "doctor" ? isDoctorEmergencyRestockEnabled() : false,
    compare_rows: compareRows,
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
  if (req.auth.role === "doctor") {
    const doctorId = Number(req.auth.doctor_id || 0);
    if (!doctorId || !doctorMayViewReceipt(transactionId, doctorId)) {
      return res.status(403).json({ error: "You can only view receipts for your own stock transfers." });
    }
  } else if (!isWarehouseManager(req.auth.role)) {
    return res.status(403).json({ error: "Not authorised to view inventory receipts." });
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

  const isDoctorViewer = req.auth.role === "doctor";
  const actors = isDoctorViewer
    ? []
    : db
        .prepare(`
      SELECT DISTINCT actor_user_id, actor_name, actor_role
      FROM inventory_activity_history
      WHERE actor_user_id IS NOT NULL
      ORDER BY actor_name ASC
    `)
        .all();
  const actions = ["stock_in", "restock", "sell", "wastage", "adjustment", "stock_out"];
  const rows = isDoctorViewer
    ? paginated.rows.map((row) => {
        const { cost_price, selling_price, value_rs, ...rest } = row;
        void cost_price;
        void selling_price;
        return { ...rest, value_rs: null };
      })
    : paginated.rows;

  res.json({
    page: paginated.page,
    limit: paginated.limit,
    total: paginated.total,
    totalPages: paginated.totalPages,
    rows,
    net_value_rs: isDoctorViewer ? null : netValueRs,
    analytics: isDoctorViewer ? null : analytics,
    actors,
    actions,
  });
});

router.get("/activity-history/export.csv", (req, res) => {
  ensureInfrastructure();
  if (!isWarehouseManager(String(req.auth?.role || "").toLowerCase())) {
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
  if (isDoctor) {
    return res.status(403).json({
      error: "Doctors cannot create inventory items. Request stock through a supply request.",
    });
  }
  if (role === "operator") {
    return res.status(403).json({
      error: "Operators cannot create master catalogue items. Receive stock into an existing approved item.",
    });
  }
  if (role !== "admin") {
    return res.status(403).json({ error: "You do not have permission to add stock items." });
  }

  const itemName = String(req.body.item_name || "").trim();
  const folderId = Number(req.body.folder_id || 0);
  const quantity = Number(req.body.quantity ?? 0);
  const minimumQuantity = Number(req.body.minimum_quantity || 0);
  const unit = String(req.body.unit || "unit").trim();
  const costPrice = roundCurrency(req.body.cost_price);
  const sellingPrice = roundCurrency(req.body.selling_price);
  const attributes = String(req.body.attributes || "").trim();
  const moaNotes = String(req.body.moa_notes || "").trim();
  // Catalogue expiry_date is deprecated. It is not an operational default for receipts or FEFO.
  const expiryDate = null;

  if (!itemName) return res.status(400).json({ error: "Item name is required." });
  if (!folderId) return res.status(400).json({ error: "Folder is required." });
  if (quantity !== 0) {
    return res.status(400).json({
      error: "Catalogue items start at zero on-hand. Receive stock after the item is created.",
    });
  }
  if (!Number.isInteger(minimumQuantity) || minimumQuantity < 0) return res.status(400).json({ error: "Minimum quantity must be zero or more." });
  if (sellingPrice < costPrice) return res.status(400).json({ error: "Selling price cannot be lower than cost price." });

  const folder = db.prepare("SELECT id FROM inventory_folders WHERE id = ?").get(folderId);
  if (!folder) return res.status(404).json({ error: "Folder not found." });

  try {
    assertOcsMasterItemNameAvailable(itemName);
  } catch (error) {
    return res.status(409).json({ error: error.message });
  }

  const result = db
    .prepare(`
      INSERT INTO inventory (
        item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
        cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
      )
      VALUES (?, ?, 'ocs', NULL, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .run(itemName, folderId, quantity, minimumQuantity, unit, costPrice, sellingPrice, attributes, moaNotes, expiryDate);

  const createdItemId = Number(result.lastInsertRowid);

  res.status(201).json(getPayload(req));
});

router.put("/items/:id", (req, res) => {
  ensureInfrastructure();
  const role = req.auth.role;
  const isDoctor = role === "doctor";
  const isOperator = role === "operator";
  const isAdmin = role === "admin";
  if (!isDoctor && !isOperator && !isAdmin) {
    return res.status(403).json({ error: "You do not have permission to edit stock items." });
  }
  const doctorId = isDoctor ? Number(req.auth.doctor_id || 0) : null;
  const itemId = Number(req.params.id);
  const existing = findItemForRequest(req, itemId);
  if (!existing) return res.status(404).json({ error: "Stock item not found." });

  const isOcsMasterRow =
    String(existing.stock_scope || "") === "ocs" &&
    (existing.owner_doctor_id == null || existing.owner_doctor_id === "");

  function fieldChanged(key, current, next) {
    return Object.prototype.hasOwnProperty.call(req.body || {}, key) && String(current ?? "") !== String(next ?? "");
  }

  if (isDoctor) {
    const protectedAttempts = [];
    if (fieldChanged("quantity", existing.quantity, req.body.quantity)) protectedAttempts.push("quantity");
    if (fieldChanged("cost_price", existing.cost_price, req.body.cost_price)) protectedAttempts.push("cost_price");
    if (fieldChanged("selling_price", existing.selling_price, req.body.selling_price)) protectedAttempts.push("selling_price");
    if (fieldChanged("item_name", existing.item_name, req.body.item_name)) protectedAttempts.push("item_name");
    if (fieldChanged("folder_id", existing.folder_id, req.body.folder_id)) protectedAttempts.push("folder_id");
    if (fieldChanged("unit", existing.unit, req.body.unit)) protectedAttempts.push("unit");
    if (req.body.batches || req.body.batch_quantity) protectedAttempts.push("batches");
    if (protectedAttempts.length) {
      return res.status(400).json({
        error: `Doctors cannot change ${protectedAttempts.join(", ")}. Update minimum/par quantity only, or use a documented stock movement.`,
      });
    }
  } else if (isOperator) {
    const protectedAttempts = [];
    if (fieldChanged("quantity", existing.quantity, req.body.quantity)) protectedAttempts.push("quantity");
    if (fieldChanged("cost_price", existing.cost_price, req.body.cost_price)) protectedAttempts.push("cost_price");
    if (fieldChanged("selling_price", existing.selling_price, req.body.selling_price)) protectedAttempts.push("selling_price");
    if (isOcsMasterRow && fieldChanged("item_name", existing.item_name, req.body.item_name)) protectedAttempts.push("item_name");
    if (isOcsMasterRow && fieldChanged("folder_id", existing.folder_id, req.body.folder_id)) protectedAttempts.push("folder_id");
    if (isOcsMasterRow && fieldChanged("unit", existing.unit, req.body.unit)) protectedAttempts.push("unit");
    if (req.body.batches || req.body.batch_quantity) protectedAttempts.push("batches");
    if (protectedAttempts.length) {
      return res.status(403).json({
        error: `Operators cannot change ${protectedAttempts.join(", ")} on inventory items.`,
      });
    }
  }

  const masterFieldsLocked = isDoctor || isOperator;
  const quantityLocked = true;

  if (!isDoctor && Object.prototype.hasOwnProperty.call(req.body || {}, "quantity") && fieldChanged("quantity", existing.quantity, req.body.quantity)) {
    return res.status(400).json({
      error: "Catalogue editing cannot change on-hand quantity. Use Exceptional inventory correction.",
    });
  }

  const itemName = masterFieldsLocked
    ? String(existing.item_name || "").trim()
    : String(req.body.item_name ?? existing.item_name).trim();
  const folderId = masterFieldsLocked
    ? Number(existing.folder_id || 0)
    : Number(req.body.folder_id || existing.folder_id || 0);
  const quantity = quantityLocked
    ? Number(existing.quantity)
    : Number(req.body.quantity ?? existing.quantity);
  const minimumQuantity = Number(req.body.minimum_quantity ?? existing.minimum_quantity);
  const unit = masterFieldsLocked
    ? String(existing.unit ?? "unit").trim()
    : String(req.body.unit ?? existing.unit ?? "unit").trim();
  const costPrice = masterFieldsLocked
    ? roundCurrency(existing.cost_price)
    : roundCurrency(req.body.cost_price ?? existing.cost_price);
  const sellingPrice = masterFieldsLocked
    ? roundCurrency(existing.selling_price)
    : roundCurrency(req.body.selling_price ?? existing.selling_price);
  const attributes = String(req.body.attributes ?? existing.attributes ?? "").trim();
  const moaNotes = String(req.body.moa_notes ?? existing.moa_notes ?? "").trim();
  // Deprecated catalogue expiry_date: preserve the historical column, never treat it as operational.
  // Incoming expiry_date is ignored so catalogue editing cannot change batch expiry or nearest-expiry.
  const expiryDate = String(existing.expiry_date || "").trim() || null;
  const adjustmentNote = String(req.body.adjustment_note || "").trim();

  if (!itemName) return res.status(400).json({ error: "Item name is required." });
  if (!folderId) return res.status(400).json({ error: "Folder is required." });
  if (!Number.isInteger(quantity) || quantity < 0) return res.status(400).json({ error: "Quantity must be zero or more." });
  if (!Number.isInteger(minimumQuantity) || minimumQuantity < 0) return res.status(400).json({ error: "Minimum quantity must be zero or more." });
  if (sellingPrice < costPrice) return res.status(400).json({ error: "Selling price cannot be lower than cost price." });

  if (!isDoctor && isOcsMasterRow) {
    try {
      assertOcsMasterItemNameAvailable(itemName, itemId);
    } catch (error) {
      return res.status(409).json({ error: error.message });
    }
  }

  const previousQuantity = Number(existing.quantity || 0);

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE inventory
        SET
          item_name = ?, folder_id = ?, quantity = ?, minimum_quantity = ?, unit = ?,
          cost_price = ?, selling_price = ?, attributes = ?, moa_notes = ?, expiry_date = ?,
          row_version = row_version + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(itemName, folderId, quantity, minimumQuantity, unit, costPrice, sellingPrice, attributes, moaNotes, expiryDate, itemId);
    })();
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Unable to update stock item." });
  }

  if (isDoctor && doctorId) {
    void maybeNotifyLowStock(itemId, req.auth.id).catch((error) => {
      console.warn("[push] low stock notification failed:", error?.message || error);
    });
  }

  publishInventoryChange({ itemId, changedByUserId: req.auth.id });

  res.json(getPayloadFromRequest(req));
});

router.post("/items/:id/ocs-actions", (req, res) => {
  ensureInfrastructure();
  let override;
  try {
    override = assertRoutineOperatorAction(
      req.auth,
      req.body,
      req.body?.action_type === "remove" ? "Warehouse write-off" : "Receiving warehouse stock",
    );
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message });
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
    return res.status(400).json({ error: "Quantity must be a whole number greater than zero." });
  }

  const previousQuantity = Number(item.quantity || 0);
  if (actionType === "stock_in") {
    if (
      req.auth.role === "operator" &&
      Object.prototype.hasOwnProperty.call(req.body || {}, "cost_price") &&
      roundCurrency(req.body.cost_price) !== roundCurrency(item.cost_price)
    ) {
      return res.status(403).json({
        error: "Operators cannot change cost price. Receive stock using the existing item cost.",
      });
    }
    const costPrice = req.auth.role === "admin"
      ? roundCurrency(req.body.cost_price ?? item.cost_price)
      : roundCurrency(item.cost_price);
    if (costPrice < 0) {
      return res.status(400).json({ error: "Cost price must be zero or more." });
    }
    let expiry;
    try {
      expiry = validateReceiptExpiry({
        expiryDate: req.body.expiry_date,
        isNonExpiring: parseNonExpiringFlag(req.body.is_non_expiring || req.body.non_expiring),
      });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    const nextQuantity = previousQuantity + quantity;

    db.transaction(() => {
      createBatch(itemId, quantity, expiry.expiryDate, costPrice, { isNonExpiring: expiry.isNonExpiring });
      db.prepare(`
        UPDATE inventory
        SET quantity = ?, cost_price = ?, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nextQuantity, costPrice, itemId);
      recordMovement({
        itemId,
        movementType: "in",
        quantity,
        previousQuantity,
        nextQuantity,
        actionType: "stock_in",
        note: override.override
          ? `Operational override receive: ${override.reason}`
          : "Stock In batch added",
        userId: req.auth.id,
        metaJson: JSON.stringify({
          performed_by_user_id: req.auth.id,
          performed_by_role: req.auth.role,
          performed_by_name: req.auth.full_name || req.auth.username || "",
          operational_override: Boolean(override.override),
          override_reason: override.reason || "",
          is_non_expiring: expiry.isNonExpiring,
          expiry_date: expiry.expiryDate,
        }),
      });
      recordAudit({
        actionType: override.override ? "operational_override_stock_in" : "stock_in",
        itemId,
        itemName: item.item_name,
        quantity,
        reason: override.reason || "",
        performedByUserId: req.auth.id,
        performedByRole: req.auth.role,
        performedByName: req.auth.full_name || req.auth.username || "",
      });
    })();

    return res.status(201).json(getPayload(req));
  }

  let writeOff;
  try {
    writeOff = assertWriteOffInputs({
      reason: req.body.reason,
      note: req.body.note,
      confirm: req.body.confirm,
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  const preview = previewAllocations(itemId, quantity, { includeExpired: true });
  if (!preview.can_fulfil || quantity > preview.available_to_transfer) {
    return res.status(400).json({
      error: "Cannot write off more than usable available stock. Active reservations are excluded.",
      preview,
    });
  }

  try {
    db.transaction(() => {
      consumeAllocatedBatches(preview.allocations);
      const nextQuantity = previousQuantity - quantity;
      updateInventoryQuantity(itemId, nextQuantity);
      recordMovement({
        itemId,
        movementType: "out",
        quantity,
        previousQuantity,
        nextQuantity,
        actionType: "remove",
        note: `Write-off (${writeOff.reason})${writeOff.note ? `: ${writeOff.note}` : ""}${
          override.override ? ` · override: ${override.reason}` : ""
        }`,
        userId: req.auth.id,
        metaJson: JSON.stringify({
          reason: writeOff.reason,
          note: writeOff.note,
          allocations: preview.allocations,
          estimated_value: preview.estimated_value,
          performed_by_user_id: req.auth.id,
          performed_by_role: req.auth.role,
          performed_by_name: req.auth.full_name || req.auth.username || "",
          operational_override: Boolean(override.override),
          override_reason: override.reason || "",
        }),
      });
      recordAudit({
        actionType: override.override ? "operational_override_remove" : "remove",
        itemId,
        itemName: item.item_name,
        quantity,
        reason: writeOff.reason,
        performedByUserId: req.auth.id,
        performedByRole: req.auth.role,
        performedByName: req.auth.full_name || req.auth.username || "",
        metaJson: JSON.stringify({ note: writeOff.note, allocations: preview.allocations }),
      });
    })();
  } catch (error) {
    return res.status(error.status || 400).json({ error: error?.message || "Unable to write off stock." });
  }

  return res.status(201).json({ ...getPayload(req), write_off: preview });
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
      updateInventoryQuantity(itemId, nextQuantity);
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
  const itemId = Number(req.params.id);
  const item = findItemForRequest(req, itemId);
  if (!item) return res.status(404).json({ error: "Stock item not found." });

  res.json({
    item_id: itemId,
    batches: getBatchesForItem(itemId),
  });
});

router.get("/items/:id/allocation-preview", (req, res) => {
  ensureInfrastructure();
  if (!isWarehouseViewer(req.auth.role)) {
    return res.status(403).json({ error: "Not authorised to preview stock allocations." });
  }
  const itemId = Number(req.params.id);
  const quantity = Number(req.query.quantity || 0);
  const mode = String(req.query.mode || "transfer").trim().toLowerCase();
  try {
    const preview = previewAllocations(itemId, quantity, { includeExpired: mode === "write_off" });
    const item = findItem(itemId, "ocs", null) || findItemForRequest(req, itemId);
    let destinationOnHand = null;
    const doctorId = Number(req.query.doctor_id || 0);
    if (doctorId && item) {
      const bag = db
        .prepare(
          `
          SELECT quantity FROM inventory
          WHERE stock_scope = 'doctor' AND owner_doctor_id = ? AND folder_id = ? AND item_name = ?
          LIMIT 1
        `,
        )
        .get(doctorId, item.folder_id, item.item_name);
      destinationOnHand = bag ? Number(bag.quantity || 0) : 0;
    }
    return res.json({
      preview: {
        ...preview,
        destination_on_hand: destinationOnHand,
        destination_resulting:
          destinationOnHand == null ? null : destinationOnHand + Number(preview.requested_quantity || 0),
      },
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
});

router.post("/items/:id/exceptional-correction", (req, res) => {
  ensureInfrastructure();
  try {
    assertAdminCatalogueAction(req.auth, "apply an exceptional inventory correction");
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message });
  }
  try {
    const result = applyExceptionalCorrection({
      itemId: Number(req.params.id),
      nextQuantity: req.body?.next_quantity ?? req.body?.quantity,
      delta: req.body?.delta,
      reason: req.body?.reason,
      note: req.body?.note,
      confirm: req.body?.confirm,
      userId: req.auth.id,
      actor: {
        userId: req.auth.id,
        role: req.auth.role,
        displayName: req.auth.full_name || req.auth.username || "",
      },
    });
    recordAudit({
      actionType: "exceptional_correction",
      itemId: Number(req.params.id),
      itemName: result.item?.item_name || "",
      quantity: Math.abs(result.change),
      reason: String(req.body?.reason || "").trim(),
      performedByUserId: req.auth.id,
      performedByRole: req.auth.role,
      performedByName: req.auth.full_name || req.auth.username || "",
      metaJson: JSON.stringify({
        previous: result.previous,
        next: result.next,
        change: result.change,
        note: String(req.body?.note || "").trim(),
        movement_id: result.movementId,
      }),
    });
    return res.status(result.idempotent ? 200 : 201).json({
      ...getPayload(req),
      correction: result,
      idempotent: result.idempotent,
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
});

router.post("/bulk/remove", (req, res) => {
  ensureInfrastructure();
  if (!isWarehouseManager(req.auth.role)) {
    return res.status(403).json({
      error: "Bulk write-off on master inventory is restricted to administrators.",
    });
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

        updateInventoryQuantity(itemId, 0);
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
  if (req.auth.role !== "admin") {
    return res.status(403).json({
      error: "Bulk schema edits on master inventory are restricted to administrators.",
    });
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
  if (!["remove", "stock_out"].includes(actionType)) {
    return res.status(400).json({
      error: "Doctors can record use/sale, wastage, or expiry only. Request replenishment through a supply request.",
    });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be greater than zero." });
  }

  const STOCK_OUT_REASONS = new Set(["Wasted", "Expired", "Sale"]);
  let stockOutReason = null;
  if (actionType === "stock_out") {
    stockOutReason = String(req.body.reason || "").trim();
    if (!STOCK_OUT_REASONS.has(stockOutReason)) {
      return res.status(400).json({
        error: "Stock out reason must be Wasted, Expired, or Sale.",
      });
    }
  }

  let salePatient = null;
  if (actionType === "stock_out" && stockOutReason === "Sale") {
    const requestedPatientId = Number(req.body.patient_id || 0);
    if (!Number.isInteger(requestedPatientId) || requestedPatientId <= 0) {
      return res.status(400).json({
        error: "Select a patient before logging a Sale deduction.",
      });
    }

    const patientRow = db
      .prepare(`
        SELECT *
        FROM patients
        WHERE id = ?
          AND deleted_at IS NULL
          AND COALESCE(status, 'active') = 'active'
      `)
      .get(requestedPatientId);

    if (!patientRow?.id) {
      return res.status(404).json({
        error: "Selected patient was not found.",
      });
    }

    salePatient = {
      id: Number(patientRow.id),
      full_name: String(patientRow.full_name || "").trim(),
      patient_identifier: String(patientRow.patient_identifier || "").trim(),
    };
  }

  const movementType = actionType === "add" ? "in" : "out";
  const previousQuantity = Number(item.quantity || 0);
  const nextQuantity = movementType === "in" ? previousQuantity + quantity : previousQuantity - quantity;
  if (nextQuantity < 0) return res.status(400).json({ error: "Cannot remove more stock than available." });

  let saleBilling = null;
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

      assertInventoryQuantityUpdate(
        itemId,
        nextQuantity,
        Number(req.body.expected_version ?? item.row_version ?? 0),
      );
      const movementId = recordMovement({
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
            ? {
                stock_out_reason: stockOutReason,
                stock_out_note: note || "",
                item_name: item.item_name,
                doctor_id: doctorId,
                admin_audit_action:
                  stockOutReason === "Sale"
                    ? "Sale"
                    : stockOutReason === "Expired"
                      ? "Expired"
                      : note === "Damage"
                        ? "Damage"
                        : stockOutReason,
                ...(stockOutReason === "Sale"
                  ? {
                      billing_status: "Pending Manual Entry",
                      patient_id: salePatient?.id ?? null,
                      patient_name: salePatient?.full_name || "",
                      patient_identifier: salePatient?.patient_identifier || "",
                    }
                  : {}),
              }
            : {}),
        }),
      });

      if (actionType === "stock_out" && stockOutReason === "Sale" && salePatient) {
        saleBilling = attachSaleDeductToPatientBill({
          patientId: salePatient.id,
          doctorId,
          item,
          quantity,
          movementId,
        });
      }
    })();
  } catch (error) {
    if (error instanceof InventoryVersionConflictError) {
      return res.status(409).json({
        error: error.message,
        inventory: getPayload(req),
      });
    }
    return res.status(400).json({ error: error?.message || "Unable to process My Stock action." });
  }

  if (saleBilling?.attached && salePatient?.id) {
    try {
      publishPatientDataChange(salePatient.id, { reason: "billing" });
    } catch (publishError) {
      console.warn("[inventory] publishPatientDataChange failed:", publishError?.message || publishError);
    }
  }

  res.status(201).json({
    ...getPayload(req),
    sale_billing: saleBilling,
  });
});

router.post("/restock", (req, res) => {
  ensureInfrastructure();
  let override;
  try {
    override = assertRoutineOperatorAction(req.auth, req.body, "Transfer to doctor bag");
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message });
  }

  const ocsItemId = Number(req.body.ocs_item_id || 0);
  const doctorId = Number(req.body.doctor_id || 0);
  const quantity = Number(req.body.quantity || 0);
  const note = String(req.body.note || "").trim();
  if (!ocsItemId || !doctorId || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "ocs_item_id, doctor_id, and a positive whole-number quantity are required." });
  }

  const doctor = db.prepare("SELECT id, full_name FROM doctors WHERE id = ? AND deleted_at IS NULL").get(doctorId);
  if (!doctor) return res.status(404).json({ error: "Doctor not found." });
  const source = findItem(ocsItemId, "ocs", null);
  if (!source) return res.status(404).json({ error: "OCS stock item not found." });
  const preview = previewAllocations(ocsItemId, quantity, { includeExpired: false });
  if (!preview.can_fulfil || quantity > preview.available_to_transfer) {
    return res.status(400).json({
      error: "Cannot transfer more than available-to-transfer stock. Active reservations and expired batches are excluded.",
      preview,
    });
  }

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
      consumeAllocatedBatches(preview.allocations);

      const sourcePrev = Number(source.quantity || 0);
      const sourceNext = sourcePrev - quantity;
      updateInventoryQuantity(source.id, sourceNext);
      recordMovement({
        itemId: source.id,
        movementType: "out",
        quantity,
        previousQuantity: sourcePrev,
        nextQuantity: sourceNext,
        actionType: "restock_out",
        note: override.override
          ? `${note || "Restocked to doctor stock"} · override: ${override.reason}`
          : note || "Restocked to doctor stock",
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
        transfer_allocations: preview.allocations,
        operational_override: Boolean(override.override),
        override_reason: override.reason || "",
      }),
      });

      let targetItemId;
      let targetPrev = 0;
      let targetNext = quantity;
      if (targetExisting) {
        targetItemId = targetExisting.id;
        targetPrev = Number(targetExisting.quantity || 0);
        targetNext = targetPrev + quantity;
        updateInventoryQuantity(targetItemId, targetNext);
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

      allocateRestockBatchesToPositive(targetItemId, preview.allocations, targetPrev);
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

router.get("/emergency-restock-capability", (req, res) => {
  if (req.auth.role !== "doctor") {
    return res.json({ enabled: false });
  }
  return res.json({ enabled: isDoctorEmergencyRestockEnabled() });
});

router.post("/restock/my-inventory", (req, res) => {
  ensureInfrastructure();
  if (req.auth.role !== "doctor" || !req.auth.doctor_id) {
    return res.status(403).json({ error: "Only doctor accounts can restock personal inventory." });
  }
  if (!isDoctorEmergencyRestockEnabled()) {
    return res.status(403).json({
      error: "Direct doctor restocking is disabled. Create a supply request so an operator can prepare the stock.",
    });
  }
  const reason = String(req.body?.reason || "").trim();
  if (reason.length < 10 || reason.length > 500) {
    return res.status(400).json({
      error: "Emergency stock transfer requires a reason between 10 and 500 characters.",
    });
  }
  if (req.body?.confirm !== true && req.body?.confirmed !== true) {
    return res.status(400).json({ error: "Confirm the emergency stock transfer before continuing." });
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
        updateInventoryQuantity(source.id, sourceNext);
        recordMovement({
          itemId: source.id,
          movementType: "out",
          quantity: request.quantity,
          previousQuantity: sourceQty,
          nextQuantity: sourceNext,
          actionType: "restock_out",
          note: `Emergency stock transfer: ${reason}`,
          userId: req.auth.id,
          referenceType: "doctor",
          referenceId: doctorId,
          metaJson: JSON.stringify({
            emergency_override: true,
            emergency_reason: reason,
            doctor_id: doctorId,
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
          updateInventoryQuantity(targetItemId, targetNext);
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

        allocateRestockBatchesToPositive(targetItemId, consumed.allocations, targetPrev);
        const soonestExpiry = consumed.allocations.find((row) => row.expiry_date)?.expiry_date || null;
        if (soonestExpiry) {
          db.prepare("UPDATE inventory SET expiry_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
            soonestExpiry,
            targetItemId,
          );
        }
        recordMovement({
          itemId: targetItemId,
          movementType: "in",
          quantity: request.quantity,
          previousQuantity: targetPrev,
          nextQuantity: targetNext,
          actionType: "restock_in",
          note: `Emergency stock transfer: ${reason}`,
          userId: req.auth.id,
          referenceType: "doctor",
          referenceId: doctorId,
          metaJson: JSON.stringify({
            emergency_override: true,
            emergency_reason: reason,
            doctor_id: doctorId,
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
        recordAudit({
          actionType: "emergency_stock_transfer",
          itemId: source.id,
          itemName: source.item_name,
          quantity: request.quantity,
          reason,
          targetDoctorId: doctorId,
          targetDoctorName: doctor.full_name,
          performedByUserId: req.auth.id,
          performedByRole: req.auth.role,
          performedByName: req.auth.full_name || req.auth.username || "",
          metaJson: JSON.stringify({
            emergency_override: true,
            emergency_reason: reason,
            source_item_id: source.id,
            target_item_id: targetItemId,
            transaction_id: transactionId,
            receipt_reference: receiptReference,
            restocked_at: new Date().toISOString(),
          }),
        });
      }
    })();
  } catch (error) {
    return res.status(400).json({ error: error?.message || "Doctor restock failed." });
  }

  void sendPushToRole("operator", {
    title: "Emergency stock transfer",
    body: `Dr. ${doctor.full_name} used an emergency transfer (${reason}).`,
    url: "/inventory",
    icon: "/icon-192.png",
    tag: `emergency-restock-${transactionId}`,
  }).catch((error) => {
    console.warn("[push] emergency restock operator notify failed:", error?.message || error);
  });
  void sendPushToRole("admin", {
    title: "Emergency stock transfer",
    body: `Dr. ${doctor.full_name} used an emergency transfer (${reason}).`,
    url: "/inventory",
    icon: "/icon-192.png",
    tag: `emergency-restock-${transactionId}`,
  }).catch((error) => {
    console.warn("[push] emergency restock admin notify failed:", error?.message || error);
  });

  res.status(201).json({
    ...getPayload(req, null, "my"),
    restock_receipt: buildReceiptByTransaction(transactionId),
    emergency_override: true,
  });
});

router.get("/staging/csv-template", (req, res) => {
  ensureInfrastructure();
  if (!isWarehouseViewer(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can download the shipment template." });
  }
  const csv = csvShipmentTemplate();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="ocs-shipment-template.csv"');
  return res.status(200).send(csv);
});

router.post("/staging/preview-csv", (req, res) => {
  ensureInfrastructure();
  try {
    assertRoutineOperatorAction(req.auth, req.body, "Preview shipment import");
  } catch (error) {
    if (req.auth.role !== "admin" && req.auth.role !== "operator") {
      return res.status(error.status || 403).json({ error: error.message });
    }
  }
  try {
    const preview = parseCsvShipment(req.body.csv_text);
    return res.json({
      preview: preview.summary,
      rows: preview.rows,
      supplier: String(req.body.supplier || "").trim(),
      delivery_note: String(req.body.delivery_note || req.body.invoice_reference || "").trim(),
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
});

router.post("/staging/import-csv", (req, res) => {
  ensureInfrastructure();
  try {
    assertRoutineOperatorAction(req.auth, req.body, "Import shipments");
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message });
  }
  let parsed;
  try {
    parsed = parseCsvShipment(req.body.csv_text);
  } catch (error) {
    return res.status(error.status || 400).json({
      error: error.message,
      import_summary: { imported: 0, skipped: 0, skipped_rows: [] },
    });
  }
  const validRows = parsed.valid_rows;
  const skippedRows = parsed.invalid_rows.map((row) => ({
    line: row.line,
    reason: row.errors.join("; "),
  }));
  if (!validRows.length) {
    return res.status(400).json({
      error: "No valid rows found in CSV.",
      import_summary: {
        imported: 0,
        skipped: skippedRows.length,
        skipped_rows: skippedRows.slice(0, 25),
        preview: parsed.summary,
      },
    });
  }

  const shipmentId = createShipmentFromImport({
    supplier: String(req.body.supplier || "").trim(),
    deliveryNote: String(req.body.delivery_note || req.body.invoice_reference || "").trim(),
    userId: req.auth.id,
    rows: validRows,
    skipped: skippedRows.length,
  });
  const insert = db.prepare(`
    INSERT INTO inventory_staging (
      folder_id, item_name, quantity, minimum_quantity, unit, cost_price, selling_price,
      attributes, moa_notes, expiry_date, status, created_by_user_id, shipment_id, is_non_expiring,
      exclude_reason, excluded_by_user_id, excluded_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of validRows) {
    insert.run(
      row.folder_id,
      row.item_name,
      row.quantity,
      row.minimum_quantity,
      row.unit,
      row.cost_price,
      row.selling_price,
      row.attributes,
      row.moa_notes,
      row.expiry_date,
      "pending",
      req.auth.id,
      shipmentId,
      row.is_non_expiring,
      "",
      null,
      null,
    );
  }
  const excludeInsert = db.prepare(`
    INSERT INTO inventory_staging (
      folder_id, item_name, quantity, minimum_quantity, unit, cost_price, selling_price,
      attributes, moa_notes, expiry_date, status, created_by_user_id, shipment_id, is_non_expiring,
      exclude_reason, excluded_by_user_id, excluded_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'excluded', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  for (const row of parsed.invalid_rows) {
    if (!row.folder_id) continue;
    excludeInsert.run(
      row.folder_id,
      row.item_name || `Line ${row.line}`,
      row.quantity || 0,
      row.minimum_quantity || 0,
      row.unit || "unit",
      row.cost_price || 0,
      row.selling_price || 0,
      row.attributes || "",
      row.moa_notes || "",
      row.expiry_date,
      req.auth.id,
      shipmentId,
      row.is_non_expiring || 0,
      row.errors.join("; ").slice(0, 500),
      req.auth.id,
    );
  }
  const importSummary = {
    imported: validRows.length,
    skipped: skippedRows.length,
    skipped_rows: skippedRows.slice(0, 25),
    shipment_id: shipmentId,
    preview: parsed.summary,
  };
  res.status(201).json({
    ...getPayload(req),
    import_summary: importSummary,
    shipment: getShipment(shipmentId),
  });
});

router.post("/staging/:id/release", (req, res) => {
  ensureInfrastructure();
  try {
    assertRoutineOperatorAction(req.auth, req.body, "Release shipments");
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message });
  }
  const stagingId = Number(req.params.id);
  const row = db.prepare("SELECT * FROM inventory_staging WHERE id = ?").get(stagingId);
  if (!row) return res.status(404).json({ error: "Staging row not found." });
  if (row.status === "released") {
    return res.status(200).json({ ...getPayload(req), idempotent: true });
  }
  if (row.status !== "pending") {
    return res.status(400).json({ error: "Only pending staging rows can be released." });
  }
  try {
    db.transaction(() => {
      releaseStagingRows({
        rows: [row],
        userId: req.auth.id,
        shipmentId: row.shipment_id || null,
        actor: {
          displayName: req.auth.full_name || req.auth.username || "",
          role: req.auth.role,
        },
      });
    })();
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return res.status(400).json({ error: error.message || "Unable to release staging row." });
  }
  publishInventoryResyncBroadcast({ reason: "staging_released" });
  res.status(201).json(getPayload(req));
});

router.get("/shipments", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can view shipments." });
  }
  return res.json({ shipments: listShipments() });
});

router.get("/shipments/:id", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can view shipments." });
  }
  const shipment = getShipment(req.params.id);
  if (!shipment) return res.status(404).json({ error: "Shipment not found." });
  return res.json({ shipment });
});

router.post("/shipments/:id/exclude", (req, res) => {
  ensureInfrastructure();
  try {
    assertRoutineOperatorAction(req.auth, req.body, "Exclude shipment lines");
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message });
  }
  try {
    const shipment = excludeShipmentLines({
      shipmentId: Number(req.params.id),
      lines: req.body?.lines || req.body?.exclude || [],
      userId: req.auth.id,
      actor: {
        displayName: req.auth.full_name || req.auth.username || "",
        role: req.auth.role,
      },
    });
    return res.json({ shipment, ...getPayload(req) });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
});

router.post("/shipments/:id/release", (req, res) => {
  ensureInfrastructure();
  try {
    assertRoutineOperatorAction(req.auth, req.body, "Release shipments");
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message });
  }
  const exclude = Array.isArray(req.body?.exclude) ? req.body.exclude : [];
  const mode = String(req.body?.mode || "all_valid");
  const rowIds =
    mode === "selected" && Array.isArray(req.body?.row_ids)
      ? req.body.row_ids.map(Number)
      : [];
  try {
    const result = db.transaction(() => {
      if (exclude.length) {
        excludeShipmentLines({
          shipmentId: Number(req.params.id),
          lines: exclude,
          userId: req.auth.id,
          actor: {
            displayName: req.auth.full_name || req.auth.username || "",
            role: req.auth.role,
          },
        });
      }
      const current = getShipment(Number(req.params.id));
      const validPending = (current?.lines || []).filter(
        (line) => line.status === "pending" && !(line.validation_errors || []).length,
      );
      const selectedPending =
        mode === "selected" && rowIds.length
          ? validPending.filter((line) => rowIds.includes(Number(line.id)))
          : validPending;
      if (!selectedPending.length) {
        if (["released", "cancelled"].includes(String(current?.status || ""))) {
          return {
            shipment: current,
            idempotent: true,
            receipt: current ? { shipment_id: current.id } : null,
            released: 0,
          };
        }
        return bulkReleaseShipment({
          shipmentId: Number(req.params.id),
          rowIds,
          userId: req.auth.id,
          actor: {
            displayName: req.auth.full_name || req.auth.username || "",
            role: req.auth.role,
          },
        });
      }
      return bulkReleaseShipment({
        shipmentId: Number(req.params.id),
        rowIds,
        userId: req.auth.id,
        actor: {
          displayName: req.auth.full_name || req.auth.username || "",
          role: req.auth.role,
        },
      });
    })();
    return res.status(result.idempotent ? 200 : 201).json({
      ...getPayload(req),
      shipment: result.shipment,
      receipt: result.receipt,
      idempotent: result.idempotent,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return res.status(400).json({ error: error.message || "Unable to release shipment." });
  }
});

router.post("/stocktake/sessions", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can create stocktake sessions." });
  }
  try {
    const session = createStocktakeSession({
      folderId: req.body?.folder_id ? Number(req.body.folder_id) : null,
      itemIds: Array.isArray(req.body?.item_ids) ? req.body.item_ids : [],
      userId: req.auth.id,
      notes: String(req.body?.notes || "").trim(),
    });
    return res.status(201).json({ session });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.get("/stocktake/sessions", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can view stocktake sessions." });
  }
  return res.json({ sessions: listStocktakeSessions() });
});

router.get("/stocktake/sessions/:id", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can view stocktake sessions." });
  }
  const reveal = req.auth.role === "admin" && String(req.query.reveal || "") === "1";
  const session = getStocktakeSession(req.params.id, { revealSystem: reveal });
  if (!session) return res.status(404).json({ error: "Stocktake session not found." });
  return res.json({ session });
});

router.patch("/stocktake/sessions/:id", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can update stocktake sessions." });
  }
  try {
    const session = saveStocktakeCounts(Number(req.params.id), req.body?.lines || [], req.auth.id);
    return res.json({ session });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post("/stocktake/sessions/:id/submit", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can submit stocktake sessions." });
  }
  try {
    const session = submitStocktakeSession(Number(req.params.id), req.auth.id);
    return res.json({ session });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post("/stocktake/sessions/:id/review", (req, res) => {
  ensureInfrastructure();
  try {
    const session = reviewStocktakeSession(Number(req.params.id), {
      decision: String(req.body?.decision || "").toLowerCase(),
      reason: req.body?.reason || "",
      userId: req.auth.id,
      role: req.auth.role,
    });
    return res.json({ session });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.post("/stocktake/sessions/:id/apply", (req, res) => {
  ensureInfrastructure();
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only an admin can apply stocktake adjustments." });
  }
  try {
    const result = db.transaction(() =>
      applyStocktakeSession(Number(req.params.id), req.auth.id, {
        displayName: req.auth.full_name || req.auth.username || "",
        role: req.auth.role,
      }),
    )();
    return res.json({
      session: result.session,
      idempotent: result.idempotent,
      transaction_id: result.transactionId || result.session?.applied_transaction_id || null,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

router.get("/stocktake/sessions/:id/export.csv", (req, res) => {
  ensureInfrastructure();
  if (!["admin", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin/operator can export stocktake sessions." });
  }
  const session = getStocktakeSession(req.params.id, { revealSystem: true });
  if (!session) return res.status(404).json({ error: "Stocktake session not found." });
  const lines = [
    ["Item", "System qty", "Physical qty", "Variance", "Reason"].join(","),
    ...(session.items || []).map((row) =>
      [row.item_name, row.system_quantity, row.physical_quantity, row.variance, JSON.stringify(row.reason || "")].join(","),
    ),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="stocktake-${session.id}.csv"`);
  return res.status(200).send(lines.join("\n"));
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
  res.status(201).json({ ok: true, discrepancy, legacy: true });
});

router.delete("/items/:id", (req, res) => {
  ensureInfrastructure();
  const role = req.auth.role;
  if (role === "doctor") {
    return res.status(403).json({ error: "Doctors cannot delete inventory records." });
  }
  if (role !== "admin") {
    return res.status(403).json({
      error: "Only an administrator can archive master catalogue items.",
    });
  }

  const itemId = Number(req.params.id);
  const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId);
  if (!item) return res.status(404).json({ error: "Stock item not found." });

  if (item.archived_at) {
    return res.status(409).json({ error: "This catalogue item is already archived." });
  }
  db.prepare(`
    UPDATE inventory
    SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(itemId);
  recordAudit({
    actionType: "archive_item",
    itemId,
    itemName: item.item_name,
    quantity: Number(item.quantity || 0),
    reason: String(req.body?.reason || "").trim() || "Inventory item archived",
    targetDoctorId: item.owner_doctor_id || null,
    performedByUserId: req.auth?.id || null,
    performedByRole: req.auth?.role || "",
    performedByName: req.auth?.full_name || req.auth?.username || "",
    metaJson: JSON.stringify({ stock_scope: item.stock_scope || null }),
  });
  publishInventoryResyncBroadcast({ reason: "item_archived" });
  return res.status(200).json({ archived: true, id: itemId });
});

module.exports = router;
