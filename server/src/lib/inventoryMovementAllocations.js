"use strict";

const { db } = require("../db");
const { toNumber } = require("./utils");

function recordMovementAllocations(movementId, allocations = []) {
  const id = Number(movementId || 0);
  if (!id) return;
  const insert = db.prepare(`
    INSERT INTO inventory_movement_allocations (
      movement_id, batch_id, quantity, expiry_date, unit_cost
    ) VALUES (?, ?, ?, ?, ?)
  `);
  for (const row of allocations || []) {
    const quantity = Number(row.quantity || 0);
    const batchId = Number(row.batch_id || 0);
    if (!batchId || !Number.isInteger(quantity) || quantity <= 0) continue;
    insert.run(
      id,
      batchId,
      quantity,
      row.expiry_date || null,
      toNumber(row.unit_cost, 0),
    );
  }
}

function allocationsForMovement(movementId) {
  return db
    .prepare(
      `
      SELECT a.*, b.expiry_date AS batch_expiry_date, b.unit_cost AS batch_unit_cost,
        b.item_id, COALESCE(b.status, 'usable') AS batch_status
      FROM inventory_movement_allocations a
      LEFT JOIN inventory_batches b ON b.id = a.batch_id
      WHERE a.movement_id = ?
      ORDER BY a.id ASC
    `,
    )
    .all(Number(movementId || 0));
}

function parseMetaAllocations(metaJson) {
  let meta = metaJson;
  if (typeof metaJson === "string") {
    try {
      meta = JSON.parse(metaJson);
    } catch {
      meta = {};
    }
  }
  const rows = Array.isArray(meta?.allocations) ? meta.allocations : [];
  return rows
    .map((row) => ({
      batch_id: Number(row.batch_id || 0),
      quantity: Number(row.quantity || 0),
      expiry_date: row.expiry_date || null,
      unit_cost: toNumber(row.unit_cost, 0),
    }))
    .filter((row) => row.batch_id > 0 && Number.isInteger(row.quantity) && row.quantity > 0);
}

function signedMovementQuantity(row = {}) {
  const magnitude = Math.abs(Number(row.quantity || 0));
  if (!magnitude) return 0;
  const previous = Number(row.previous_quantity);
  const next = Number(
    row.next_quantity == null || row.next_quantity === ""
      ? row.resulting_balance
      : row.next_quantity,
  );
  if (Number.isFinite(previous) && Number.isFinite(next) && previous !== next) {
    return next > previous ? magnitude : -magnitude;
  }
  const direction = String(row.direction || row.movement_type || "").trim().toLowerCase();
  if (direction === "out" || direction.endsWith("_out") || direction === "remove") {
    return -magnitude;
  }
  if (direction === "in" || direction.endsWith("_in") || direction === "add") {
    return magnitude;
  }
  const action = String(row.action_type || "").trim().toLowerCase();
  if (
    ["sell", "wastage", "stock_out", "restock_out", "remove", "write_off", "expired"].includes(action)
  ) {
    return -magnitude;
  }
  if (["reversal", "stock_in", "restock_in", "add", "restock"].includes(action)) {
    return magnitude;
  }
  return magnitude;
}

module.exports = {
  allocationsForMovement,
  parseMetaAllocations,
  recordMovementAllocations,
  signedMovementQuantity,
};
