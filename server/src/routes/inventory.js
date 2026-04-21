const express = require("express");
const { db } = require("../db");
const { toNumber } = require("../lib/utils");

const router = express.Router();
const MOVEMENT_TYPES = new Set(["in", "out", "adjustment"]);

function getFolders() {
  return db
    .prepare(`
      SELECT *
      FROM inventory_folders
      ORDER BY
        CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
        COALESCE(parent_id, id),
        name ASC
    `)
    .all();
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

function getItems() {
  return db
    .prepare(`
      SELECT
        i.*,
        f.name AS folder_name,
        parent.name AS parent_folder_name
      FROM inventory i
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      LEFT JOIN inventory_folders parent ON parent.id = f.parent_id
      ORDER BY
        COALESCE(parent.name, f.name, 'Unassigned') ASC,
        COALESCE(f.name, 'Unassigned') ASC,
        i.item_name ASC
    `)
    .all()
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

function getMovements(limit = 120) {
  return db
    .prepare(`
      SELECT
        m.*,
        i.item_name,
        i.unit,
        f.name AS folder_name,
        d.full_name AS doctor_name,
        u.full_name AS recorded_by_name
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      LEFT JOIN doctors d ON d.id = m.doctor_id
      LEFT JOIN users u ON u.id = m.recorded_by_user_id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?
    `)
    .all(limit)
    .map((movement) => ({
      ...movement,
      quantity: Number(movement.quantity || 0),
      previous_quantity: Number(movement.previous_quantity || 0),
      next_quantity: Number(movement.next_quantity || 0),
    }));
}

function getReports(items) {
  const byDoctor = db
    .prepare(`
      SELECT
        d.id AS doctor_id,
        d.full_name AS doctor_name,
        COALESCE(SUM(CASE WHEN m.movement_type = 'out' THEN m.quantity ELSE 0 END), 0) AS total_out_quantity,
        COUNT(DISTINCT CASE WHEN m.movement_type = 'out' THEN m.item_id END) AS item_count
      FROM doctors d
      LEFT JOIN inventory_movements m ON m.doctor_id = d.id
      WHERE d.deleted_at IS NULL
      GROUP BY d.id, d.full_name
      HAVING total_out_quantity > 0
      ORDER BY total_out_quantity DESC, doctor_name ASC
    `)
    .all()
    .map((row) => ({
      ...row,
      total_out_quantity: Number(row.total_out_quantity || 0),
      item_count: Number(row.item_count || 0),
    }));

  const byMonth = db
    .prepare(`
      SELECT
        strftime('%Y-%m', m.created_at) AS month_label,
        COALESCE(SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE 0 END), 0) AS in_quantity,
        COALESCE(SUM(CASE WHEN m.movement_type = 'out' THEN m.quantity ELSE 0 END), 0) AS out_quantity,
        COUNT(*) AS movement_count
      FROM inventory_movements m
      GROUP BY strftime('%Y-%m', m.created_at)
      ORDER BY month_label DESC
      LIMIT 12
    `)
    .all()
    .map((row) => ({
      ...row,
      in_quantity: Number(row.in_quantity || 0),
      out_quantity: Number(row.out_quantity || 0),
      movement_count: Number(row.movement_count || 0),
    }));

  const byItems = items
    .map((item) => {
      const totals = db
        .prepare(`
          SELECT
            COALESCE(SUM(CASE WHEN movement_type = 'in' THEN quantity ELSE 0 END), 0) AS total_in,
            COALESCE(SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END), 0) AS total_out,
            COUNT(*) AS movement_count
          FROM inventory_movements
          WHERE item_id = ?
        `)
        .get(item.id);

      return {
        item_id: item.id,
        item_name: item.item_name,
        folder_name: item.folder_name || "Unassigned",
        unit: item.unit,
        quantity: item.quantity,
        minimum_quantity: item.minimum_quantity,
        total_in: Number(totals.total_in || 0),
        total_out: Number(totals.total_out || 0),
        movement_count: Number(totals.movement_count || 0),
        current_cost_value: item.current_cost_value,
      };
    })
    .sort((left, right) => right.total_out - left.total_out || left.item_name.localeCompare(right.item_name));

  return { byDoctor, byMonth, byItems };
}

function getSummary(items, movements) {
  const totalAmountRs = items.reduce((sum, item) => sum + item.current_cost_value, 0);
  const totalRetailValue = items.reduce((sum, item) => sum + item.current_sell_value, 0);
  const lowStockCount = items.filter((item) => item.quantity <= item.minimum_quantity).length;

  return {
    total_items: items.length,
    low_stock_count: lowStockCount,
    total_amount_rs: Number(totalAmountRs.toFixed(2)),
    total_retail_value: Number(totalRetailValue.toFixed(2)),
    recent_movements: movements.length,
  };
}

function getInventoryPayload() {
  const folders = getFolders();
  const items = getItems();
  const movements = getMovements();

  return {
    folders,
    items,
    movements,
    doctors: getDoctors(),
    summary: getSummary(items, movements),
    reports: getReports(items),
  };
}

function validateFolder(parentId) {
  if (!parentId) {
    return null;
  }

  return db.prepare("SELECT id FROM inventory_folders WHERE id = ?").get(parentId) || null;
}

function validateDoctor(doctorId) {
  if (!doctorId) {
    return null;
  }

  return db
    .prepare("SELECT id FROM doctors WHERE id = ? AND deleted_at IS NULL")
    .get(doctorId) || null;
}

function createMovement({
  itemId,
  movementType,
  quantity,
  previousQuantity,
  nextQuantity,
  doctorId = null,
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemId,
    movementType,
    quantity,
    previousQuantity,
    nextQuantity,
    doctorId,
    recordedByUserId,
    String(note || "").trim(),
  );
}

router.get("/", (_req, res) => {
  res.json(getInventoryPayload());
});

router.post("/folders", (req, res) => {
  const name = String(req.body.name ?? "").trim();
  const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;

  if (!name) {
    return res.status(400).json({ error: "Folder name is required." });
  }

  if (parentId && !validateFolder(parentId)) {
    return res.status(400).json({ error: "Selected parent folder was not found." });
  }

  db.prepare(`
    INSERT INTO inventory_folders (name, parent_id, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(name, parentId);

  res.status(201).json(getInventoryPayload());
});

router.post("/", (req, res) => {
  const itemName = String(req.body.item_name ?? "").trim();
  const unit = String(req.body.unit ?? "").trim();
  const quantity = Number(req.body.quantity ?? 0);
  const minimumQuantity = Number(req.body.minimum_quantity ?? 0);
  const costPrice = toNumber(req.body.cost_price, 0);
  const sellingPrice = toNumber(req.body.selling_price, 0);
  const notes = String(req.body.notes ?? "").trim();
  const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;

  if (!itemName) {
    return res.status(400).json({ error: "Item name is required." });
  }

  if (!unit) {
    return res.status(400).json({ error: "Unit is required." });
  }

  if (!Number.isInteger(quantity) || quantity < 0) {
    return res.status(400).json({ error: "Quantity must be a whole number of zero or more." });
  }

  if (!Number.isInteger(minimumQuantity) || minimumQuantity < 0) {
    return res.status(400).json({ error: "Minimum quantity must be zero or more." });
  }

  if (folderId && !validateFolder(folderId)) {
    return res.status(400).json({ error: "Selected folder was not found." });
  }

  const createItem = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO inventory (
          item_name,
          folder_id,
          quantity,
          minimum_quantity,
          unit,
          cost_price,
          selling_price,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(itemName, folderId, quantity, minimumQuantity, unit, costPrice, sellingPrice, notes);

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
  });

  createItem();

  res.status(201).json(getInventoryPayload());
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM inventory WHERE id = ?").get(id);

  if (!existing) {
    return res.status(404).json({ error: "Inventory item not found." });
  }

  const itemName = String(req.body.item_name ?? existing.item_name).trim();
  const unit = String(req.body.unit ?? existing.unit).trim();
  const quantity = Number(req.body.quantity ?? existing.quantity);
  const minimumQuantity = Number(req.body.minimum_quantity ?? existing.minimum_quantity ?? 0);
  const costPrice = toNumber(req.body.cost_price ?? existing.cost_price, 0);
  const sellingPrice = toNumber(req.body.selling_price ?? existing.selling_price, 0);
  const notes = String(req.body.notes ?? existing.notes ?? "").trim();
  const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;

  if (!itemName) {
    return res.status(400).json({ error: "Item name is required." });
  }

  if (!unit) {
    return res.status(400).json({ error: "Unit is required." });
  }

  if (!Number.isInteger(quantity) || quantity < 0) {
    return res.status(400).json({ error: "Quantity must be a whole number of zero or more." });
  }

  if (!Number.isInteger(minimumQuantity) || minimumQuantity < 0) {
    return res.status(400).json({ error: "Minimum quantity must be zero or more." });
  }

  if (folderId && !validateFolder(folderId)) {
    return res.status(400).json({ error: "Selected folder was not found." });
  }

  const previousQuantity = Number(existing.quantity || 0);
  const nextQuantity = quantity;
  const quantityDelta = nextQuantity - previousQuantity;

  db.transaction(() => {
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
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      itemName,
      folderId,
      quantity,
      minimumQuantity,
      unit,
      costPrice,
      sellingPrice,
      notes,
      id,
    );

    if (quantityDelta !== 0) {
      createMovement({
        itemId: id,
        movementType: "adjustment",
        quantity: Math.abs(quantityDelta),
        previousQuantity,
        nextQuantity,
        recordedByUserId: req.auth?.id ? Number(req.auth.id) : null,
        note:
          String(req.body.adjustment_note ?? "").trim() ||
          `Quantity adjusted from ${previousQuantity} to ${nextQuantity}`,
      });
    }
  })();

  res.json(getInventoryPayload());
});

router.post("/:id/movements", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM inventory WHERE id = ?").get(id);

  if (!existing) {
    return res.status(404).json({ error: "Inventory item not found." });
  }

  const movementType = String(req.body.movement_type ?? "").trim().toLowerCase();
  const quantity = Number(req.body.quantity ?? 0);
  const doctorId = req.body.doctor_id ? Number(req.body.doctor_id) : null;
  const note = String(req.body.note ?? "").trim();

  if (!MOVEMENT_TYPES.has(movementType) || movementType === "adjustment") {
    return res.status(400).json({ error: "Movement type must be either in or out." });
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "Movement quantity must be greater than zero." });
  }

  if (doctorId && !validateDoctor(doctorId)) {
    return res.status(400).json({ error: "Selected doctor was not found." });
  }

  const previousQuantity = Number(existing.quantity || 0);
  const nextQuantity =
    movementType === "in" ? previousQuantity + quantity : previousQuantity - quantity;

  if (nextQuantity < 0) {
    return res.status(400).json({ error: "Cannot remove more stock than is currently available." });
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE inventory
      SET quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextQuantity, id);

    createMovement({
      itemId: id,
      movementType,
      quantity,
      previousQuantity,
      nextQuantity,
      doctorId,
      recordedByUserId: req.auth?.id ? Number(req.auth.id) : null,
      note,
    });
  })();

  res.status(201).json(getInventoryPayload());
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM inventory WHERE id = ?").get(id);

  if (!existing) {
    return res.status(404).json({ error: "Inventory item not found." });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM inventory_movements WHERE item_id = ?").run(id);
    db.prepare("DELETE FROM inventory WHERE id = ?").run(id);
  })();

  res.status(204).send();
});

module.exports = router;
