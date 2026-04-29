const express = require("express");
const { db, ensureBillingForConsultation } = require("../db");
const { calculateBillingTotal, getTodayLocal, normalizeBillingItems, toNumber } = require("../lib/utils");

const router = express.Router();
const REQUIRED_FOLDERS = ["Consumable", "IM Drugs", "IV Drugs", "Wound Dressing", "Pediatric Drugs"];
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

function ensureFolders() {
  const insertFolder = db.prepare(`
    INSERT INTO inventory_folders (name, parent_id, owner_doctor_id, updated_at)
    VALUES (?, NULL, NULL, CURRENT_TIMESTAMP)
  `);
  REQUIRED_FOLDERS.forEach((name) => {
    const existing = db.prepare("SELECT id FROM inventory_folders WHERE owner_doctor_id IS NULL AND name = ?").get(name);
    if (!existing) insertFolder.run(name);
  });
}

function getFolders() {
  ensureFolders();
  return db
    .prepare(`
      SELECT id, name
      FROM inventory_folders
      WHERE owner_doctor_id IS NULL
        AND name IN (${REQUIRED_FOLDERS.map(() => "?").join(", ")})
      ORDER BY CASE name
        WHEN 'Consumable' THEN 1
        WHEN 'IM Drugs' THEN 2
        WHEN 'IV Drugs' THEN 3
        WHEN 'Wound Dressing' THEN 4
        WHEN 'Pediatric Drugs' THEN 5
        ELSE 999
      END, name ASC
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
          (? = 'doctor' AND owner_doctor_id = ?)
          OR (? = 'ocs' AND owner_doctor_id IS NULL)
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
    metaJson,
  );

  const inserted = db.prepare("SELECT last_insert_rowid() AS id").get();
  const movementId = Number(inserted?.id || 0);
  const meta = safeParseJson(metaJson, {});
  const movementItem = db.prepare("SELECT item_name FROM inventory WHERE id = ?").get(itemId);
  const actorName = String(meta.performed_by_name || "");
  const actorRole = String(meta.performed_by_role || "");
  const sourceText =
    actionType === "restock_out"
      ? "OCS Master"
      : actionType === "restock_in"
        ? String(meta.issued_by_name || "OCS Master")
        : actionType === "sell"
          ? String(meta.doctor_name || "Doctor")
          : "";
  const destinationText =
    actionType === "restock_out"
      ? String(meta.received_by_name || "")
      : actionType === "restock_in"
        ? String(meta.received_by_name || "")
        : actionType === "sell"
          ? "Patient Bill"
          : "";
  const transferAllocations = Array.isArray(meta.transfer_allocations) ? meta.transfer_allocations : [];
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
    metaJson,
  );
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

function getMovements(role, doctorId = null) {
  return db
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
        (@role = 'doctor' AND i.stock_scope = 'doctor' AND i.owner_doctor_id = @doctorId)
        OR (@role != 'doctor')
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 200
    `)
    .all({ role, doctorId })
    .map((row) => ({
      ...row,
      visible_target_doctor_name:
        role === "operator" && row.action_type === "restock_out"
          ? "Doctor (hidden)"
          : row.target_doctor_name,
    }));
}

function getCompareRows() {
  return db
    .prepare(`
      SELECT
        d.id AS doctor_id,
        d.full_name AS doctor_name,
        COUNT(DISTINCT c.patient_id) AS patient_volume,
        COALESCE(
          SUM(
            CASE
              WHEN m.action_type IN ('sell', 'remove', 'wastage') THEN m.quantity * i.cost_price
              ELSE 0
            END
          ),
          0
        ) AS stock_consumption
      FROM doctors d
      LEFT JOIN consultations c
        ON c.doctor_id = d.id
       AND strftime('%Y-%m', c.consultation_date) = strftime('%Y-%m', 'now')
      LEFT JOIN inventory i
        ON i.stock_scope = 'doctor'
       AND i.owner_doctor_id = d.id
      LEFT JOIN inventory_movements m
        ON m.item_id = i.id
       AND strftime('%Y-%m', m.created_at) = strftime('%Y-%m', 'now')
      WHERE d.deleted_at IS NULL
      GROUP BY d.id, d.full_name
      ORDER BY d.full_name ASC
    `)
    .all()
    .map((row) => ({
      ...row,
      patient_volume: Number(row.patient_volume || 0),
      stock_consumption: roundCurrency(row.stock_consumption),
    }));
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

  return {
    folders,
    ocs_stock: ocsStock,
    my_stock: myStock,
    selected_doctor_stock: selectedDoctorStock,
    doctors: role === "admin" || role === "operator" ? getDoctors() : [],
    summary: summarize(activeItems, summaryDoctorId),
    low_stock_items: activeItems.filter((item) => item.quantity <= item.minimum_quantity),
    near_expiry_items: activeItems.filter((item) => isNearExpiry(item.expiry_date)),
    movements: getMovements(role, doctorId),
    staging: role === "admin" || role === "operator" ? db.prepare("SELECT * FROM inventory_staging ORDER BY created_at DESC, id DESC LIMIT 200").all() : [],
    compare_rows: role === "admin" || role === "operator" ? getCompareRows() : [],
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
    where.push(`action_type IN (${actionValues.map((_, index) => `@action${index}`).join(", ")})`);
    actionValues.forEach((action, index) => {
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

router.get("/", (req, res) => {
  const selectedDoctorId = Number(req.query.doctorId || 0) || null;
  const doctorContext = String(req.query.context || "my").trim().toLowerCase() === "ocs" ? "ocs" : "my";
  res.json(getPayload(req, selectedDoctorId, doctorContext));
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
  const offset = (page - 1) * limit;
  const { whereSql, params } = buildActivityHistoryFilter(req.query);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS total FROM inventory_activity_history WHERE ${whereSql}`)
    .get(params);
  const rows = db
    .prepare(`
      SELECT *
      FROM inventory_activity_history
      WHERE ${whereSql}
      ORDER BY timestamp DESC, id DESC
      LIMIT @limit OFFSET @offset
    `)
    .all({ ...params, limit, offset });

  const actors = db
    .prepare(`
      SELECT DISTINCT actor_user_id, actor_name, actor_role
      FROM inventory_activity_history
      WHERE actor_user_id IS NOT NULL
      ORDER BY actor_name ASC
    `)
    .all();
  const actions = db
    .prepare(`
      SELECT DISTINCT action_type
      FROM inventory_activity_history
      WHERE action_type != ''
      ORDER BY action_type ASC
    `)
    .all()
    .map((row) => row.action_type);

  res.json({
    page,
    limit,
    total: Number(totalRow?.total || 0),
    totalPages: Math.max(1, Math.ceil(Number(totalRow?.total || 0) / limit)),
    rows,
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
      SELECT *
      FROM inventory_activity_history
      WHERE ${whereSql}
      ORDER BY timestamp DESC, id DESC
    `)
    .all(params);

  const csvLines = [
    ["Timestamp", "Actor", "Role", "Action Type", "Item Name", "Quantity", "Direction", "Source", "Destination", "Batch ID"].join(","),
    ...rows.map((row) =>
      [
        escapeCsvValue(row.timestamp),
        escapeCsvValue(row.actor_name),
        escapeCsvValue(row.actor_role),
        escapeCsvValue(row.action_type),
        escapeCsvValue(row.item_name),
        Number(row.quantity || 0),
        escapeCsvValue(row.direction),
        escapeCsvValue(row.source_text),
        escapeCsvValue(row.destination_text),
        escapeCsvValue(row.batch_id),
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
  const result = db
    .prepare(`
      INSERT INTO inventory (
        item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
        cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .run(itemName, folderId, stockScope, doctorId, quantity, minimumQuantity, unit, costPrice, sellingPrice, attributes, moaNotes, expiryDate);

  if (quantity > 0) {
    createBatch(Number(result.lastInsertRowid), quantity, expiryDate, costPrice);
    recordMovement({
      itemId: Number(result.lastInsertRowid),
      movementType: "in",
      quantity,
      previousQuantity: 0,
      nextQuantity: quantity,
      actionType: "add",
      note: "Initial stock entry",
      userId: req.auth.id,
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

  const itemName = String(req.body.item_name ?? existing.item_name).trim();
  const folderId = Number(req.body.folder_id || existing.folder_id || 0);
  const quantity = Number(req.body.quantity ?? existing.quantity);
  const minimumQuantity = Number(req.body.minimum_quantity ?? existing.minimum_quantity);
  const unit = String(req.body.unit ?? existing.unit ?? "unit").trim();
  const costPrice = roundCurrency(req.body.cost_price ?? existing.cost_price);
  const sellingPrice = roundCurrency(req.body.selling_price ?? existing.selling_price);
  const attributes = String(req.body.attributes ?? existing.attributes ?? "").trim();
  const moaNotes = String(req.body.moa_notes ?? existing.moa_notes ?? "").trim();
  const expiryDate = String(req.body.expiry_date ?? existing.expiry_date ?? "").trim() || null;
  const adjustmentNote = String(req.body.adjustment_note || "").trim();

  if (!itemName) return res.status(400).json({ error: "Item name is required." });
  if (!folderId) return res.status(400).json({ error: "Folder is required." });
  if (!Number.isInteger(quantity) || quantity < 0) return res.status(400).json({ error: "Quantity must be zero or more." });
  if (!Number.isInteger(minimumQuantity) || minimumQuantity < 0) return res.status(400).json({ error: "Minimum quantity must be zero or more." });
  if (sellingPrice < costPrice) return res.status(400).json({ error: "Selling price cannot be lower than cost price." });

  const previousQuantity = Number(existing.quantity || 0);
  const delta = quantity - previousQuantity;
  if (delta < 0) {
    const consumed = consumeBatches(itemId, Math.abs(delta));
    if (!consumed.ok) return res.status(400).json({ error: "Insufficient batch stock for quantity reduction." });
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
      movementType: "adjustment",
      quantity: Math.abs(delta),
      previousQuantity,
      nextQuantity: quantity,
      actionType: "correction",
      note: adjustmentNote || `Quantity adjusted from ${previousQuantity} to ${quantity}`,
      userId: req.auth.id,
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
      const consumed = consumeBatches(itemId, quantity);
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

        const consumed = consumeBatches(itemId, previousQuantity);
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
  if (!["add", "remove", "sell"].includes(actionType)) {
    return res.status(400).json({ error: "Action must be add, remove, or sell." });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be greater than zero." });
  }

  const movementType = actionType === "add" ? "in" : "out";
  const previousQuantity = Number(item.quantity || 0);
  const nextQuantity = movementType === "in" ? previousQuantity + quantity : previousQuantity - quantity;
  if (nextQuantity < 0) return res.status(400).json({ error: "Cannot remove more stock than available." });

  if (actionType === "sell") {
    const patientId = Number(req.body.patient_id || 0);
    const consultationId = Number(req.body.consultation_id || 0);
    if (!patientId || !consultationId) {
      return res.status(400).json({ error: "Sell requires patient_id and consultation_id." });
    }
  }

  try {
    db.transaction(() => {
      if (movementType === "in") {
        const previousDeficit = Math.max(0, 0 - previousQuantity);
        const batchQty = Math.max(0, quantity - previousDeficit);
        if (batchQty > 0) {
          createBatch(itemId, batchQty, item.expiry_date || null, item.cost_price);
        }
      } else {
        const consumed = consumeBatches(itemId, quantity, { disallowExpired: actionType === "sell" });
        if (!consumed.ok) {
          throw new Error(
            actionType === "sell" ? "Cannot sell expired or unavailable stock." : "Insufficient stock.",
          );
        }
      }

      if (actionType === "sell") {
        const patientId = Number(req.body.patient_id || 0);
        const consultationId = Number(req.body.consultation_id || 0);
        const billId = ensureBillingForConsultation(consultationId, patientId);
        const bill = db.prepare("SELECT * FROM billing WHERE id = ?").get(billId);
        const items = normalizeBillingItems(bill.items);
        items.push({
          description: `${item.item_name} x${quantity}`,
          amount: roundCurrency(quantity * toNumber(item.selling_price, 0)),
        });
        db.prepare("UPDATE billing SET items = ?, total_amount = ? WHERE id = ?").run(
          JSON.stringify(items),
          calculateBillingTotal(items),
          billId,
        );
      }

      db.prepare("UPDATE inventory SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextQuantity, itemId);
      recordMovement({
        itemId,
        movementType,
        quantity,
        previousQuantity,
        nextQuantity,
        actionType,
        note: note || (actionType === "sell" ? "Sold and synced to billing." : actionType === "remove" ? "Removed from stock." : "Added to stock."),
        userId: req.auth.id,
        referenceType: actionType === "sell" ? "patient" : null,
        referenceId: actionType === "sell" ? Number(req.body.patient_id || 0) : null,
        metaJson: JSON.stringify({
          performed_by_user_id: req.auth.id,
          performed_by_role: req.auth.role,
          performed_by_name: req.auth.full_name || req.auth.username || "",
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
        AND owner_doctor_id = ?
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

        allocateRestockBatchesToPositive(targetItemId, consumed.allocations, targetPrev);
        recordMovement({
          itemId: targetItemId,
          movementType: "in",
          quantity: request.quantity,
          previousQuantity: targetPrev,
          nextQuantity: targetNext,
          actionType: "restock_in",
          note: "Restocked from OCS stock",
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
        AND owner_doctor_id IS NULL
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
  if (!isDoctor && req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin or owning doctor can delete items." });
  }

  const itemId = Number(req.params.id);
  const item = isDoctor ? findItem(itemId, "doctor", doctorId) : db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId);
  if (!item) return res.status(404).json({ error: "Stock item not found." });

  db.transaction(() => {
    db.prepare("DELETE FROM inventory_batches WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM inventory_movements WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM inventory WHERE id = ?").run(itemId);
  })();
  res.status(204).send();
});

module.exports = router;
