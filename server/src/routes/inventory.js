const express = require("express");
const { db } = require("../db");
const { toNumber } = require("../lib/utils");

const router = express.Router();
const MOVEMENT_TYPES = new Set(["in", "out", "adjustment"]);
const REQUIRED_FOLDERS = [
  "Consumable",
  "IM Drugs",
  "IV Drugs",
  "Wound Dressing",
  "Pediatric Drugs",
];

function requireDoctorAccess(req, res) {
  if (req.auth.role !== "doctor" || !req.auth.doctor_id) {
    res.status(403).json({ error: "My Stock is only available to doctor accounts." });
    return null;
  }
  return Number(req.auth.doctor_id);
}

function ensureDoctorFolders(doctorId) {
  const insertFolder = db.prepare(`
    INSERT INTO inventory_folders (name, owner_doctor_id, created_at, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  REQUIRED_FOLDERS.forEach((folderName) => {
    const exists = db
      .prepare("SELECT id FROM inventory_folders WHERE owner_doctor_id = ? AND name = ?")
      .get(doctorId, folderName);
    if (!exists) {
      insertFolder.run(folderName, doctorId);
    }
  });
}

function getDoctorFolders(doctorId) {
  return db
    .prepare(`
      SELECT id, name, owner_doctor_id, created_at, updated_at
      FROM inventory_folders
      WHERE owner_doctor_id = ?
      ORDER BY name ASC
    `)
    .all(doctorId);
}

function getDoctorItems(doctorId) {
  return db
    .prepare(`
      SELECT
        i.*,
        f.name AS folder_name
      FROM inventory i
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      WHERE i.owner_doctor_id = ?
      ORDER BY f.name ASC, i.item_name ASC
    `)
    .all(doctorId)
    .map((item) => ({
      ...item,
      quantity: Number(item.quantity || 0),
      minimum_quantity: Number(item.minimum_quantity || 0),
      cost_price: toNumber(item.cost_price, 0),
      selling_price: toNumber(item.selling_price, 0),
      current_cost_value: Number((Number(item.quantity || 0) * toNumber(item.cost_price, 0)).toFixed(2)),
      current_sell_value: Number((Number(item.quantity || 0) * toNumber(item.selling_price, 0)).toFixed(2)),
    }));
}

function getDoctorMovements(doctorId, limit = 120) {
  return db
    .prepare(`
      SELECT
        m.*,
        i.item_name,
        i.unit,
        f.name AS folder_name,
        u.full_name AS recorded_by_name
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      LEFT JOIN users u ON u.id = m.recorded_by_user_id
      WHERE i.owner_doctor_id = ?
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?
    `)
    .all(doctorId, limit)
    .map((movement) => ({
      ...movement,
      quantity: Number(movement.quantity || 0),
      previous_quantity: Number(movement.previous_quantity || 0),
      next_quantity: Number(movement.next_quantity || 0),
    }));
}

function getDoctorSummary(doctorId, items) {
  const totalAmountRs = items.reduce((sum, item) => sum + item.current_cost_value, 0);
  const lowStockItems = items.filter((item) => item.quantity <= item.minimum_quantity);
  const monthConsumed = db
    .prepare(`
      SELECT COALESCE(SUM(m.quantity * i.cost_price), 0) AS amount
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      WHERE i.owner_doctor_id = ?
        AND m.movement_type = 'out'
        AND strftime('%Y-%m', m.created_at) = strftime('%Y-%m', 'now')
    `)
    .get(doctorId);

  return {
    total_amount_rs: Number(totalAmountRs.toFixed(2)),
    total_amount_consumed_rs: Number(toNumber(monthConsumed?.amount, 0).toFixed(2)),
    low_stock_count: lowStockItems.length,
  };
}

function getInventoryPayload(doctorId) {
  ensureDoctorFolders(doctorId);
  const folders = getDoctorFolders(doctorId);
  const items = getDoctorItems(doctorId);
  const movements = getDoctorMovements(doctorId);
  const lowStockItems = items.filter((item) => item.quantity <= item.minimum_quantity);

  return {
    folders,
    items,
    movements,
    low_stock_items: lowStockItems,
    summary: getDoctorSummary(doctorId, items),
  };
}

function validateFolder(doctorId, folderId) {
  if (!folderId) {
    return null;
  }
  return (
    db
      .prepare("SELECT id, name FROM inventory_folders WHERE id = ? AND owner_doctor_id = ?")
      .get(folderId, doctorId) || null
  );
}

function createMovement({
  itemId,
  movementType,
  quantity,
  previousQuantity,
  nextQuantity,
  recordedByUserId = null,
  note = "",
}) {
  db.prepare(`
    INSERT INTO inventory_movements (
      item_id,
      movement_type,
      quantity,
      previous_quantity,
      next_quantity,
      doctor_id,
      recorded_by_user_id,
      note
    )
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    itemId,
    movementType,
    quantity,
    previousQuantity,
    nextQuantity,
    recordedByUserId,
    String(note || "").trim(),
  );
}

router.get("/", (req, res) => {
  const doctorId = requireDoctorAccess(req, res);
  if (!doctorId) {
    return;
  }
  res.json(getInventoryPayload(doctorId));
});

router.post("/", (req, res) => {
  const doctorId = requireDoctorAccess(req, res);
  if (!doctorId) {
    return;
  }

  const itemName = String(req.body.item_name ?? "").trim();
  const attributes = String(req.body.attributes ?? "").trim();
  const moaNotes = String(req.body.moa_notes ?? "").trim();
  const unit = String(req.body.unit ?? "").trim() || "unit";
  const quantity = Number(req.body.quantity ?? 0);
  const minimumQuantity = Number(req.body.minimum_quantity ?? 0);
  const costPrice = toNumber(req.body.cost_price, 0);
  const sellingPrice = toNumber(req.body.selling_price, 0);
  const expiryDate = String(req.body.expiry_date ?? "").trim();
  const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;

  if (!itemName) {
    return res.status(400).json({ error: "Item name is required." });
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    return res.status(400).json({ error: "Current quantity must be a whole number of zero or more." });
  }
  if (!Number.isInteger(minimumQuantity) || minimumQuantity < 0) {
    return res.status(400).json({ error: "Minimum quantity must be zero or more." });
  }
  if (!folderId || !validateFolder(doctorId, folderId)) {
    return res.status(400).json({ error: "Please select one of the My Stock folders." });
  }

  const result = db
    .prepare(`
      INSERT INTO inventory (
        item_name,
        folder_id,
        owner_doctor_id,
        quantity,
        minimum_quantity,
        unit,
        cost_price,
        selling_price,
        notes,
        attributes,
        moa_notes,
        expiry_date,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .run(itemName, folderId, doctorId, quantity, minimumQuantity, unit, costPrice, sellingPrice, attributes, moaNotes, expiryDate || null);

  if (quantity > 0) {
    createMovement({
      itemId: Number(result.lastInsertRowid),
      movementType: "in",
      quantity,
      previousQuantity: 0,
      nextQuantity: quantity,
      recordedByUserId: req.auth?.id ? Number(req.auth.id) : null,
      note: "Initial stock entry",
    });
  }

  res.status(201).json(getInventoryPayload(doctorId));
});

router.put("/:id", (req, res) => {
  const doctorId = requireDoctorAccess(req, res);
  if (!doctorId) {
    return;
  }

  const id = Number(req.params.id);
  const existing = db
    .prepare("SELECT * FROM inventory WHERE id = ? AND owner_doctor_id = ?")
    .get(id, doctorId);
  if (!existing) {
    return res.status(404).json({ error: "Stock item not found." });
  }

  const itemName = String(req.body.item_name ?? existing.item_name).trim();
  const attributes = String(req.body.attributes ?? existing.attributes ?? "").trim();
  const moaNotes = String(req.body.moa_notes ?? existing.moa_notes ?? "").trim();
  const unit = String(req.body.unit ?? existing.unit ?? "").trim() || "unit";
  const quantity = Number(req.body.quantity ?? existing.quantity);
  const minimumQuantity = Number(req.body.minimum_quantity ?? existing.minimum_quantity);
  const costPrice = toNumber(req.body.cost_price ?? existing.cost_price, 0);
  const sellingPrice = toNumber(req.body.selling_price ?? existing.selling_price, 0);
  const expiryDate = String(req.body.expiry_date ?? existing.expiry_date ?? "").trim();
  const folderId = req.body.folder_id ? Number(req.body.folder_id) : existing.folder_id;

  if (!itemName) {
    return res.status(400).json({ error: "Item name is required." });
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    return res.status(400).json({ error: "Current quantity must be zero or more." });
  }
  if (!Number.isInteger(minimumQuantity) || minimumQuantity < 0) {
    return res.status(400).json({ error: "Minimum quantity must be zero or more." });
  }
  if (!folderId || !validateFolder(doctorId, folderId)) {
    return res.status(400).json({ error: "Please select one of the My Stock folders." });
  }

  const previousQuantity = Number(existing.quantity || 0);
  const quantityDelta = quantity - previousQuantity;

  db.prepare(`
    UPDATE inventory
    SET
      item_name = ?,
      folder_id = ?,
      quantity = ?,
      minimum_quantity = ?,
      unit = ?,
      cost_price = ?,
      selling_price = ?,
      attributes = ?,
      moa_notes = ?,
      expiry_date = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND owner_doctor_id = ?
  `).run(
    itemName,
    folderId,
    quantity,
    minimumQuantity,
    unit,
    costPrice,
    sellingPrice,
    attributes,
    moaNotes,
    expiryDate || null,
    id,
    doctorId,
  );

  if (quantityDelta !== 0) {
    createMovement({
      itemId: id,
      movementType: "adjustment",
      quantity: Math.abs(quantityDelta),
      previousQuantity,
      nextQuantity: quantity,
      recordedByUserId: req.auth?.id ? Number(req.auth.id) : null,
      note:
        String(req.body.adjustment_note ?? "").trim() ||
        `Quantity adjusted from ${previousQuantity} to ${quantity}`,
    });
  }

  res.json(getInventoryPayload(doctorId));
});

router.post("/:id/movements", (req, res) => {
  const doctorId = requireDoctorAccess(req, res);
  if (!doctorId) {
    return;
  }

  const id = Number(req.params.id);
  const existing = db
    .prepare("SELECT * FROM inventory WHERE id = ? AND owner_doctor_id = ?")
    .get(id, doctorId);
  if (!existing) {
    return res.status(404).json({ error: "Stock item not found." });
  }

  const movementType = String(req.body.movement_type ?? "").trim().toLowerCase();
  const quantity = Number(req.body.quantity ?? 0);
  const note = String(req.body.note ?? "").trim();
  const actionType = String(req.body.action_type ?? "").trim().toLowerCase();

  if (!MOVEMENT_TYPES.has(movementType) || movementType === "adjustment") {
    return res.status(400).json({ error: "Movement type must be either in or out." });
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be greater than zero." });
  }

  const previousQuantity = Number(existing.quantity || 0);
  const nextQuantity = movementType === "in" ? previousQuantity + quantity : previousQuantity - quantity;
  if (nextQuantity < 0) {
    return res.status(400).json({ error: "Cannot remove more stock than is currently available." });
  }

  db.prepare(`
    UPDATE inventory
    SET quantity = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND owner_doctor_id = ?
  `).run(nextQuantity, id, doctorId);

  createMovement({
    itemId: id,
    movementType,
    quantity,
    previousQuantity,
    nextQuantity,
    recordedByUserId: req.auth?.id ? Number(req.auth.id) : null,
    note:
      note ||
      (actionType === "sell"
        ? "Sold via billing flow"
        : actionType === "remove"
          ? "Removed / waste adjustment"
          : "Stock action recorded"),
  });

  res.status(201).json(getInventoryPayload(doctorId));
});

router.delete("/:id", (req, res) => {
  const doctorId = requireDoctorAccess(req, res);
  if (!doctorId) {
    return;
  }

  const id = Number(req.params.id);
  const existing = db
    .prepare("SELECT id FROM inventory WHERE id = ? AND owner_doctor_id = ?")
    .get(id, doctorId);
  if (!existing) {
    return res.status(404).json({ error: "Stock item not found." });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM inventory_movements WHERE item_id = ?").run(id);
    db.prepare("DELETE FROM inventory WHERE id = ? AND owner_doctor_id = ?").run(id, doctorId);
  })();

  res.status(204).send();
});

module.exports = router;
