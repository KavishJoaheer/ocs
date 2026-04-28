const express = require("express");
const { db, ensureBillingForConsultation } = require("../db");
const { calculateBillingTotal, getTodayLocal, normalizeBillingItems, toNumber } = require("../lib/utils");

const router = express.Router();
const REQUIRED_FOLDERS = ["Consumable", "IM Drugs", "IV Drugs", "Wound Dressing", "Pediatric Drugs"];

let infrastructureReady = false;

function roundCurrency(value) {
  return Number(toNumber(value, 0).toFixed(2));
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

    CREATE INDEX IF NOT EXISTS idx_inventory_scope_owner ON inventory(stock_scope, owner_doctor_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_batches_item ON inventory_batches(item_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_staging_status ON inventory_staging(status);
  `);

  infrastructureReady = true;
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
  return db.prepare("SELECT id, name FROM inventory_folders WHERE owner_doctor_id IS NULL ORDER BY name ASC").all();
}

function getItems({ stockScope, doctorId = null }) {
  return db
    .prepare(`
      SELECT i.*, f.name AS folder_name
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
      current_cost_value: roundCurrency(Number(row.quantity || 0) * toNumber(row.cost_price, 0)),
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
}

function summarize(items, doctorId = null) {
  const totalAmount = items.reduce((sum, item) => sum + item.current_cost_value, 0);
  const lowStock = items.filter((item) => item.quantity <= item.minimum_quantity);
  const nearExpiry = items.filter((item) => {
    if (!item.expiry_date) return false;
    const diff = Math.ceil((new Date(item.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff >= 0 && diff <= 30;
  });

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
        COALESCE(SUM(CASE WHEN m.action_type IN ('sell', 'remove') THEN m.quantity ELSE 0 END), 0) AS stock_consumption
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
      stock_consumption: Number(row.stock_consumption || 0),
    }));
}

function getPayload(req, selectedDoctorId = null) {
  ensureInfrastructure();
  const role = req.auth.role;
  const doctorId = role === "doctor" ? Number(req.auth.doctor_id || 0) : null;
  const folders = getFolders();
  const ocsStock = getItems({ stockScope: "ocs" });
  const myStock = doctorId ? getItems({ stockScope: "doctor", doctorId }) : [];
  const selectedDoctorStock =
    role === "admin" && selectedDoctorId
      ? getItems({ stockScope: "doctor", doctorId: selectedDoctorId })
      : [];
  const activeItems = doctorId ? myStock : ocsStock;

  return {
    folders,
    ocs_stock: ocsStock,
    my_stock: myStock,
    selected_doctor_stock: selectedDoctorStock,
    doctors: role === "admin" || role === "operator" ? getDoctors() : [],
    summary: summarize(activeItems, doctorId),
    low_stock_items: activeItems.filter((item) => item.quantity <= item.minimum_quantity),
    near_expiry_items: activeItems.filter((item) => {
      if (!item.expiry_date) return false;
      const diff = Math.ceil((new Date(item.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return diff >= 0 && diff <= 30;
    }),
    movements: getMovements(role, doctorId),
    staging: role === "admin" || role === "operator" ? db.prepare("SELECT * FROM inventory_staging ORDER BY created_at DESC, id DESC LIMIT 200").all() : [],
    compare_rows: role === "admin" ? getCompareRows() : [],
  };
}

router.get("/", (req, res) => {
  const selectedDoctorId = Number(req.query.doctorId || 0) || null;
  res.json(getPayload(req, selectedDoctorId));
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

  if (movementType === "in") {
    createBatch(itemId, quantity, item.expiry_date || null, item.cost_price);
  } else {
    const consumed = consumeBatches(itemId, quantity, { disallowExpired: actionType === "sell" });
    if (!consumed.ok) {
      return res.status(400).json({ error: actionType === "sell" ? "Cannot sell expired or unavailable stock." : "Insufficient stock." });
    }
  }

  if (actionType === "sell") {
    const patientId = Number(req.body.patient_id || 0);
    const consultationId = Number(req.body.consultation_id || 0);
    if (!patientId || !consultationId) {
      return res.status(400).json({ error: "Sell requires patient_id and consultation_id." });
    }
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
  });

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

  const consumed = consumeBatches(source.id, quantity);
  if (!consumed.ok) return res.status(400).json({ error: "Insufficient batch stock in OCS inventory." });

  db.transaction(() => {
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
      metaJson: JSON.stringify({ doctor_name: doctor.full_name }),
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

    consumed.allocations.forEach((allocation) => {
      createBatch(targetItemId, allocation.quantity, allocation.expiry_date, allocation.unit_cost);
    });
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
    });
  })();

  res.status(201).json(getPayload(req));
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
