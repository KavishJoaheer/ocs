"use strict";

const { db } = require("../db");
const { getTodayLocal, toNumber } = require("./utils");
const { updateInventoryQuantity } = require("./inventoryQuantity");
const { publishInventoryChange, publishInventoryResyncBroadcast } = require("./inventoryRealtime");
const { isEnvTrue } = require("./envFlags");
const { availableToPromise } = require("./restockFulfilment");

const CSV_REQUIRED_HEADERS = [
  "folder",
  "item_name",
  "quantity",
  "minimum_quantity",
  "unit",
  "cost_price",
  "selling_price",
  "expiry_date",
];
const WRITE_OFF_REASONS = ["Expired", "Discontinued", "Damaged"];

function HttpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function roundCurrency(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function createTransferTransactionId() {
  return `TX-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function isDoctorEmergencyRestockEnabled() {
  return isEnvTrue("ENABLE_DOCTOR_EMERGENCY_RESTOCK");
}

function parseNonExpiringFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "non-expiring" || raw === "non_expiring";
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function validateReceiptExpiry({ expiryDate, isNonExpiring = false, allowBlank = false } = {}) {
  if (isNonExpiring) {
    return { expiryDate: null, isNonExpiring: true };
  }
  const raw = String(expiryDate || "").trim();
  if (!raw) {
    if (allowBlank) return { expiryDate: null, isNonExpiring: false };
    throw HttpError(400, "Batch expiry date is required, or mark the batch as non-expiring.");
  }
  if (!isIsoDate(raw)) {
    throw HttpError(400, "Expiry date must be a valid calendar date (YYYY-MM-DD).");
  }
  const today = getTodayLocal();
  if (raw < today) {
    throw HttpError(400, "Expiry date cannot be in the past. Expired batches cannot become usable FEFO stock.");
  }
  return { expiryDate: raw, isNonExpiring: false };
}

function stagingRowErrors(row) {
  const errors = [];
  if (!String(row.item_name || "").trim()) errors.push("Missing item name");
  const qty = Number(row.quantity);
  if (!Number.isInteger(qty) || qty < 0) errors.push("Invalid quantity");
  const nonExpiring = Number(row.is_non_expiring || 0) === 1 || parseNonExpiringFlag(row.is_non_expiring);
  const expiry = String(row.expiry_date || "").trim();
  if (!nonExpiring && !expiry) {
    errors.push("Expiry date or explicit non-expiring flag required");
  }
  if (!nonExpiring && expiry) {
    if (!isIsoDate(expiry)) {
      errors.push("Expiry date must be YYYY-MM-DD");
    } else if (expiry < getTodayLocal()) {
      errors.push("Expiry date is in the past");
    }
  }
  return errors;
}

function batchQuantityTotal(itemId) {
  return Number(
    db
      .prepare(
        `SELECT COALESCE(SUM(quantity_remaining), 0) AS total
         FROM inventory_batches
         WHERE item_id = ? AND quantity_remaining > 0`,
      )
      .get(Number(itemId))?.total || 0,
  );
}

function assertBatchBalance(itemId) {
  const item = db.prepare("SELECT id, item_name, quantity FROM inventory WHERE id = ?").get(Number(itemId));
  if (!item) throw HttpError(404, "Stock item not found.");
  const batches = batchQuantityTotal(itemId);
  const quantity = Number(item.quantity || 0);
  if (batches !== quantity) {
    throw HttpError(
      409,
      `Batch totals (${batches}) do not match on-hand quantity (${quantity}) for ${item.item_name}.`,
    );
  }
}

function listWriteOffBatches(itemId) {
  const today = getTodayLocal();
  return db
    .prepare(
      `
      SELECT id, quantity_remaining, expiry_date, unit_cost, is_non_expiring
      FROM inventory_batches
      WHERE item_id = ? AND quantity_remaining > 0
      ORDER BY
        CASE
          WHEN expiry_date IS NOT NULL AND COALESCE(is_non_expiring, 0) = 0 AND expiry_date < ? THEN 0
          WHEN expiry_date IS NOT NULL AND COALESCE(is_non_expiring, 0) = 0 THEN 1
          WHEN COALESCE(is_non_expiring, 0) = 1 THEN 2
          ELSE 3
        END,
        expiry_date ASC,
        id ASC
    `,
    )
    .all(Number(itemId), today)
    .map((row) => {
      const reserved = Number(
        db
          .prepare(
            `
            SELECT COALESCE(SUM(rb.quantity), 0) AS total
            FROM inventory_reservation_batches rb
            JOIN inventory_reservations r ON r.id = rb.reservation_id
            WHERE rb.batch_id = ? AND r.status = 'active'
          `,
          )
          .get(row.id)?.total || 0,
      );
      const available = Math.max(0, Number(row.quantity_remaining || 0) - reserved);
      return {
        batch_id: row.id,
        quantity_remaining: Number(row.quantity_remaining || 0),
        reserved,
        available,
        expiry_date: row.expiry_date || null,
        is_non_expiring: Number(row.is_non_expiring || 0) === 1,
        unit_cost: toNumber(row.unit_cost, 0),
        expired:
          Boolean(row.expiry_date) &&
          Number(row.is_non_expiring || 0) !== 1 &&
          String(row.expiry_date) < today,
      };
    })
    .filter((row) => row.available > 0);
}

function previewAllocations(itemId, quantity, { includeExpired = false } = {}) {
  const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(Number(itemId));
  if (!item) throw HttpError(404, "Stock item not found.");
  const qty = Number(quantity || 0);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw HttpError(400, "Quantity must be a whole number greater than zero.");
  }
  const onHand = Number(item.quantity || 0);
  const reserved = Number(
    db
      .prepare(
        `SELECT COALESCE(SUM(quantity), 0) AS total
         FROM inventory_reservations
         WHERE inventory_id = ? AND status = 'active'`,
      )
      .get(itemId)?.total || 0,
  );
  const available = availableToPromise(itemId);
  const batches = includeExpired
    ? listWriteOffBatches(itemId)
    : listWriteOffBatches(itemId).filter((row) => !row.expired);
  let remaining = qty;
  const allocations = [];
  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.available);
    if (take <= 0) continue;
    allocations.push({
      batch_id: batch.batch_id,
      quantity: take,
      expiry_date: batch.expiry_date,
      is_non_expiring: batch.is_non_expiring,
      unit_cost: batch.unit_cost,
      expired: batch.expired,
    });
    remaining -= take;
  }
  const allocated = allocations.reduce((sum, row) => sum + row.quantity, 0);
  const estimatedValue = roundCurrency(
    allocations.reduce((sum, row) => sum + row.quantity * Number(row.unit_cost || 0), 0),
  );
  return {
    item_id: Number(itemId),
    item_name: item.item_name,
    unit: item.unit || "unit",
    current_quantity: onHand,
    reserved_quantity: reserved,
    available_to_transfer: available,
    requested_quantity: qty,
    resulting_quantity: onHand - allocated,
    can_fulfil: remaining === 0 && allocated <= available,
    remaining,
    estimated_value: estimatedValue,
    allocations,
  };
}

function consumeAllocatedBatches(allocations) {
  for (const allocation of allocations || []) {
    const take = Number(allocation.quantity || 0);
    if (take <= 0) continue;
    const batch = db.prepare("SELECT * FROM inventory_batches WHERE id = ?").get(allocation.batch_id);
    if (!batch || Number(batch.quantity_remaining || 0) < take) {
      throw HttpError(409, "A selected batch no longer has enough quantity.");
    }
    db.prepare("UPDATE inventory_batches SET quantity_remaining = quantity_remaining - ? WHERE id = ?").run(
      take,
      allocation.batch_id,
    );
  }
}

function actorMeta(actor = {}, extra = {}) {
  return {
    performed_by_user_id: actor.userId || extra.userId || null,
    performed_by_role: actor.role || extra.role || "",
    performed_by_name: actor.displayName || extra.displayName || "",
    ...extra,
  };
}

function applyExceptionalCorrection({
  itemId,
  nextQuantity = null,
  delta = null,
  reason,
  note = "",
  confirm,
  userId,
  actor = {},
}) {
  if (confirm !== true && confirm !== "true") {
    throw HttpError(400, "Confirm the exceptional inventory correction before applying it.");
  }
  const trimmedReason = String(reason || "").trim();
  if (trimmedReason.length < 10) {
    throw HttpError(400, "A reason of at least 10 characters is required for an exceptional correction.");
  }
  const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(Number(itemId));
  if (!item) throw HttpError(404, "Stock item not found.");
  const previous = Number(item.quantity || 0);
  let next = previous;
  if (nextQuantity != null && nextQuantity !== "") {
    next = Number(nextQuantity);
  } else if (delta != null && delta !== "") {
    next = previous + Number(delta);
  } else {
    throw HttpError(400, "Provide the corrected quantity or an explicit adjustment delta.");
  }
  if (!Number.isInteger(next) || next < 0) {
    throw HttpError(400, "Corrected quantity must be a whole number of zero or more.");
  }
  const change = next - previous;
  if (change === 0) {
    return { item, previous, next, change: 0, idempotent: true, movementId: null };
  }
  if (change < 0) {
    const available = availableToPromise(itemId);
    if (Math.abs(change) > available) {
      throw HttpError(
        409,
        `Cannot correct below reserved stock. ${available} unit(s) are available to adjust; ${Math.abs(change)} requested.`,
      );
    }
  }

  return db.transaction(() => {
    const locked = db.prepare("SELECT * FROM inventory WHERE id = ?").get(Number(itemId));
    const lockedPrev = Number(locked.quantity || 0);
    if (lockedPrev === next) {
      return { item: locked, previous: lockedPrev, next, change: 0, idempotent: true, movementId: null };
    }
    const lockedChange = next - lockedPrev;
    let allocations = [];
    if (lockedChange < 0) {
      const preview = previewAllocations(itemId, Math.abs(lockedChange), { includeExpired: true });
      if (!preview.can_fulfil) {
        throw HttpError(409, "Insufficient unreserved batch quantity for this correction.");
      }
      consumeAllocatedBatches(preview.allocations);
      allocations = preview.allocations;
    } else {
      db.prepare(
        `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
         VALUES (?, ?, NULL, ?, 1)`,
      ).run(itemId, lockedChange, roundCurrency(locked.cost_price || 0));
      allocations = [
        {
          batch_id: Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0),
          quantity: lockedChange,
          expiry_date: null,
          is_non_expiring: true,
          unit_cost: roundCurrency(locked.cost_price || 0),
        },
      ];
    }
    updateInventoryQuantity(itemId, next);
    assertBatchBalance(itemId);
    const movementId = recordOpsMovement({
      itemId,
      movementType: lockedChange > 0 ? "in" : "out",
      quantity: Math.abs(lockedChange),
      previousQuantity: lockedPrev,
      nextQuantity: next,
      actionType: "exceptional_correction",
      note: `Exceptional correction: ${trimmedReason}${note ? ` — ${note}` : ""}`,
      userId,
      skipPublish: true,
      meta: actorMeta(actor, {
        reason: trimmedReason,
        supporting_note: String(note || "").trim(),
        exceptional: true,
        allocations,
        source_location: "Master Stock",
        destination_location: "Exceptional correction",
      }),
    });
    publishInventoryResyncBroadcast({ reason: "exceptional_correction" });
    return {
      item: db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId),
      previous: lockedPrev,
      next,
      change: lockedChange,
      idempotent: false,
      movementId,
      allocations,
    };
  })();
}

function recordOpsMovement({
  itemId,
  movementType,
  quantity,
  previousQuantity,
  nextQuantity,
  actionType,
  note,
  userId,
  meta = {},
  skipPublish = false,
}) {
  const item = db.prepare("SELECT item_name FROM inventory WHERE id = ?").get(itemId);
  const metaJson = JSON.stringify(meta);
  db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
      recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    itemId,
    movementType,
    quantity,
    previousQuantity,
    nextQuantity,
    meta.doctor_id || null,
    userId || null,
    note || "",
    actionType,
    meta.reference_type || "",
    meta.reference_id || null,
    metaJson,
  );
  const movementId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0);
  db.prepare(`
    INSERT INTO inventory_activity_history (
      movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type, item_name,
      quantity, direction, source_text, destination_text, batch_id, meta_json
    ) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movementId || null,
    userId || null,
    meta.performed_by_name || "",
    meta.performed_by_role || "",
    actionType,
    item?.item_name || "",
    quantity,
    movementType,
    meta.source_location || "",
    meta.destination_location || "",
    String(meta.batch_id || ""),
    metaJson,
  );
  if (!skipPublish) {
    publishInventoryChange({ itemId, changedByUserId: userId });
  }
  return movementId;
}

function consumeFefo(itemId, quantity) {
  const today = getTodayLocal();
  const rows = db
    .prepare(`
      SELECT id, quantity_remaining, expiry_date, unit_cost, is_non_expiring
      FROM inventory_batches
      WHERE item_id = ? AND quantity_remaining > 0
      ORDER BY
        CASE
          WHEN expiry_date IS NOT NULL AND COALESCE(is_non_expiring, 0) = 0 THEN 0
          WHEN COALESCE(is_non_expiring, 0) = 1 THEN 1
          ELSE 2
        END,
        expiry_date ASC,
        id ASC
    `)
    .all(Number(itemId));
  let remaining = Number(quantity || 0);
  const allocations = [];
  for (const row of rows) {
    if (remaining <= 0) break;
    const expired =
      row.expiry_date && Number(row.is_non_expiring || 0) !== 1 && String(row.expiry_date) < today;
    if (expired) continue;
    const take = Math.min(remaining, Number(row.quantity_remaining || 0));
    if (take <= 0) continue;
    db.prepare("UPDATE inventory_batches SET quantity_remaining = quantity_remaining - ? WHERE id = ?").run(
      take,
      row.id,
    );
    allocations.push({
      batch_id: row.id,
      quantity: take,
      expiry_date: row.expiry_date || null,
      is_non_expiring: Number(row.is_non_expiring || 0) === 1,
      unit_cost: toNumber(row.unit_cost, 0),
    });
    remaining -= take;
  }
  return { ok: remaining === 0, remaining, allocations };
}

function upsertOcsFromStaging(row) {
  const existing = db
    .prepare(`
      SELECT *
      FROM inventory
      WHERE stock_scope = 'ocs'
        AND owner_doctor_id IS NULL
        AND folder_id = ?
        AND item_name = ?
        AND archived_at IS NULL
      LIMIT 1
    `)
    .get(row.folder_id, row.item_name);
  const qty = Number(row.quantity || 0);
  if (existing) {
    const prev = Number(existing.quantity || 0);
    const next = prev + qty;
    updateInventoryQuantity(existing.id, next);
    return { id: Number(existing.id), previous: prev, next, created: false, item: existing };
  }
  const inserted = db
    .prepare(`
      INSERT INTO inventory (
        item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
        cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
      ) VALUES (?, ?, 'ocs', NULL, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .run(
      row.item_name,
      row.folder_id,
      qty,
      row.minimum_quantity,
      row.unit,
      row.cost_price,
      row.selling_price,
      row.attributes || "",
      row.moa_notes || "",
      row.expiry_date || null,
    );
  return {
    id: Number(inserted.lastInsertRowid),
    previous: 0,
    next: qty,
    created: true,
    item: db.prepare("SELECT * FROM inventory WHERE id = ?").get(Number(inserted.lastInsertRowid)),
  };
}

function releaseStagingRows({ rows, userId, shipmentId = null, actor = {} }) {
  const pending = rows.filter((row) => String(row.status) === "pending");
  for (const row of pending) {
    const errors = stagingRowErrors(row);
    if (errors.length) {
      throw HttpError(400, `${row.item_name || "Row"}: ${errors.join("; ")}`);
    }
  }
  const transactionId = createTransferTransactionId();
  const movementIds = [];
  for (const row of pending) {
    const result = upsertOcsFromStaging(row);
    db.prepare(`
      INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      result.id,
      Number(row.quantity || 0),
      Number(row.is_non_expiring || 0) === 1 ? null : row.expiry_date || null,
      roundCurrency(row.cost_price || 0),
      Number(row.is_non_expiring || 0) === 1 ? 1 : 0,
    );
    const movementId = recordOpsMovement({
      itemId: result.id,
      movementType: "in",
      quantity: Number(row.quantity || 0),
      previousQuantity: result.previous,
      nextQuantity: result.next,
      actionType: "add",
      note: shipmentId ? `Released from shipment #${shipmentId}` : "Released from staging",
      userId,
      skipPublish: true,
      meta: {
        shipment_id: shipmentId,
        staging_id: row.id,
        transaction_id: transactionId,
        performed_by_user_id: userId,
        performed_by_name: actor.displayName || "",
        performed_by_role: actor.role || "",
        reference_type: "shipment",
        reference_id: shipmentId,
        source_location: "Incoming shipment",
        destination_location: "Master Stock",
      },
    });
    movementIds.push(movementId);
    db.prepare(`
      UPDATE inventory_staging
      SET status = 'released', released_by_user_id = ?, released_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(userId, row.id);
  }
  return { transactionId, movementIds, released: pending.length };
}

function serializeShipmentLine(line) {
  const errors = stagingRowErrors(line);
  return {
    ...line,
    validation_errors: errors,
    is_valid: errors.length === 0 && String(line.status) === "pending",
    line_value: roundCurrency(Number(line.quantity || 0) * Number(line.cost_price || 0)),
  };
}

function shipmentLineSummary(lines = []) {
  const pending = lines.filter((line) => String(line.status) === "pending");
  const valid = pending.filter((line) => (line.validation_errors || []).length === 0);
  const invalid = pending.filter((line) => (line.validation_errors || []).length > 0);
  const excluded = lines.filter((line) => String(line.status) === "excluded" || String(line.status) === "cancelled");
  const released = lines.filter((line) => String(line.status) === "released");
  const pendingUnits = valid.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const pendingValue = roundCurrency(
    valid.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.cost_price || 0), 0),
  );
  return {
    total_rows: lines.length,
    pending_rows: pending.length,
    valid_rows: valid.length,
    invalid_rows: invalid.length,
    excluded_rows: excluded.length,
    released_rows: released.length,
    pending_units: pendingUnits,
    pending_value: pendingValue,
    actionable: valid.length > 0,
  };
}

function decorateShipment(row) {
  const lines = db
    .prepare(
      `
      SELECT st.*, f.name AS folder_name
      FROM inventory_staging st
      LEFT JOIN inventory_folders f ON f.id = st.folder_id
      WHERE st.shipment_id = ?
      ORDER BY st.id ASC
    `,
    )
    .all(row.id)
    .map(serializeShipmentLine);
  const summary = shipmentLineSummary(lines);
  return {
    ...row,
    lines,
    ...summary,
    in_incoming_queue: summary.actionable || summary.pending_rows > 0,
  };
}

function listShipments({ incomingOnly = false } = {}) {
  const rows = db
    .prepare(
      `
      SELECT s.*, u.full_name AS imported_by_name, r.full_name AS released_by_name
      FROM inventory_shipments s
      LEFT JOIN users u ON u.id = s.imported_by_user_id
      LEFT JOIN users r ON r.id = s.released_by_user_id
      ORDER BY s.imported_at DESC, s.id DESC
      LIMIT 100
    `,
    )
    .all()
    .map(decorateShipment);
  if (incomingOnly) {
    return rows.filter((row) => row.in_incoming_queue);
  }
  return rows;
}

function shipmentQueueStats(shipments = listShipments()) {
  const incoming = shipments.filter((row) => row.in_incoming_queue);
  return {
    incoming_shipments: incoming.length,
    pending_lines: incoming.reduce((sum, row) => sum + Number(row.pending_rows || 0), 0),
    invalid_excluded_lines: incoming.reduce(
      (sum, row) => sum + Number(row.invalid_rows || 0) + Number(row.excluded_rows || 0),
      0,
    ),
    pending_shipment_value: roundCurrency(
      incoming.reduce((sum, row) => sum + Number(row.pending_value || 0), 0),
    ),
  };
}

function closeShipmentIfIdle(shipmentId, userId = null) {
  const remaining = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM inventory_staging WHERE shipment_id = ? AND status = 'pending'`,
      )
      .get(Number(shipmentId))?.count || 0,
  );
  if (remaining > 0) return false;
  const released = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM inventory_staging WHERE shipment_id = ? AND status = 'released'`,
      )
      .get(Number(shipmentId))?.count || 0,
  );
  db.prepare(
    `
    UPDATE inventory_shipments
    SET
      status = ?,
      released_by_user_id = COALESCE(released_by_user_id, ?),
      released_at = COALESCE(released_at, CURRENT_TIMESTAMP)
    WHERE id = ? AND status = 'pending'
  `,
  ).run(released > 0 ? "released" : "cancelled", userId || null, Number(shipmentId));
  return true;
}

function excludeShipmentLines({ shipmentId, lines, userId, actor = {} }) {
  const shipment = getShipment(shipmentId);
  if (!shipment) throw HttpError(404, "Shipment not found.");
  const entries = Array.isArray(lines) ? lines : [];
  if (!entries.length) throw HttpError(400, "Select at least one shipment line to exclude.");
  db.transaction(() => {
    for (const entry of entries) {
      const reason = String(entry?.reason || "").trim();
      if (reason.length < 3) {
        throw HttpError(400, "Excluded shipment lines require a reason.");
      }
      const updated = db
        .prepare(
          `
          UPDATE inventory_staging
          SET
            status = 'excluded',
            exclude_reason = ?,
            excluded_by_user_id = ?,
            excluded_at = CURRENT_TIMESTAMP
          WHERE id = ? AND shipment_id = ? AND status = 'pending'
        `,
        )
        .run(reason.slice(0, 500), userId || null, Number(entry.id), Number(shipmentId));
      if (!updated.changes) {
        const row = db.prepare("SELECT status FROM inventory_staging WHERE id = ?").get(Number(entry.id));
        if (row && String(row.status) === "excluded") continue;
        throw HttpError(409, "Only pending shipment lines can be excluded.");
      }
    }
    closeShipmentIfIdle(shipmentId, userId);
  })();
  void actor;
  return getShipment(shipmentId);
}

function getShipment(id) {
  const shipment = db.prepare("SELECT * FROM inventory_shipments WHERE id = ?").get(Number(id));
  if (!shipment) return null;
  return decorateShipment(shipment);
}

function bulkReleaseShipment({ shipmentId, rowIds, userId, actor }) {
  const shipment = getShipment(shipmentId);
  if (!shipment) throw HttpError(404, "Shipment not found.");
  if (shipment.status === "released") {
    return { shipment, idempotent: true, receipt: shipmentReceipt(shipment) };
  }
  const selected = (shipment.lines || []).filter((line) => {
    if (line.status !== "pending") return false;
    if ((line.validation_errors || stagingRowErrors(line)).length) return false;
    if (Array.isArray(rowIds) && rowIds.length) return rowIds.includes(Number(line.id));
    return true;
  });
  if (!selected.length) throw HttpError(400, "No valid pending rows selected for release.");
  const released = releaseStagingRows({
    rows: selected,
    userId,
    shipmentId: shipment.id,
    actor,
  });
  const remaining = Number(
    db
      .prepare(`SELECT COUNT(*) AS count FROM inventory_staging WHERE shipment_id = ? AND status = 'pending'`)
      .get(shipment.id)?.count || 0,
  );
  if (remaining === 0) {
    closeShipmentIfIdle(shipment.id, userId);
  }
  publishInventoryResyncBroadcast({ reason: "shipment_released" });
  const next = getShipment(shipment.id);
  return {
    shipment: next,
    idempotent: false,
    transactionId: released.transactionId,
    receipt: shipmentReceipt(next, released),
  };
}

function shipmentReceipt(shipment, released = {}) {
  const lines = (shipment.lines || []).filter((line) => line.status === "released");
  const quantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const value = lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.cost_price || 0),
    0,
  );
  return {
    shipment_id: shipment.id,
    transaction_id: released.transactionId || null,
    total_rows: lines.length,
    total_quantity: quantity,
    total_value: roundCurrency(value),
    released_at: shipment.released_at || null,
  };
}

function createShipmentFromImport({ supplier = "", deliveryNote = "", userId, rows, skipped }) {
  const info = db
    .prepare(`
      INSERT INTO inventory_shipments (
        supplier, delivery_note, status, total_rows, valid_rows, rejected_rows, imported_by_user_id
      ) VALUES (?, ?, 'pending', ?, ?, ?, ?)
    `)
    .run(
      supplier,
      deliveryNote,
      rows.length + skipped,
      rows.length,
      skipped,
      userId,
    );
  return Number(info.lastInsertRowid);
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseCsvShipment(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw HttpError(400, "csv_text is required.");
  const lines = text.split(/\r?\n/).filter((line) => String(line || "").trim());
  if (!lines.length) throw HttpError(400, "csv_text is required.");
  const headers = splitCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
  const missing = CSV_REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw HttpError(400, `CSV missing headers: ${missing.join(", ")}`);

  const folderMap = new Map(
    db
      .prepare("SELECT id, name FROM inventory_folders")
      .all()
      .map((folder) => [String(folder.name || "").toLowerCase(), folder]),
  );

  const parsed = [];
  const seen = new Map();
  lines.slice(1).forEach((line, index) => {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, idx) => [header, values[idx] || ""]));
    const lineNumber = index + 2;
    const folder = folderMap.get(String(row.folder || "").toLowerCase());
    const qty = Number(row.quantity || 0);
    const nonExpiring = parseNonExpiringFlag(row.non_expiring || row.is_non_expiring || row.expiry_date);
    const expiryRaw = nonExpiring ? "" : String(row.expiry_date || "").trim();
    const errors = [];
    if (!folder) errors.push(row.folder ? `Unknown folder "${row.folder}"` : "Missing folder");
    if (!String(row.item_name || "").trim()) errors.push("Missing item name");
    if (!Number.isInteger(qty) || qty < 0) errors.push("Invalid quantity");
    if (!nonExpiring && !expiryRaw) errors.push("Missing expiry. Set a date or mark the row as non-expiring.");
    if (!nonExpiring && expiryRaw) {
      try {
        validateReceiptExpiry({ expiryDate: expiryRaw, isNonExpiring: false });
      } catch (error) {
        errors.push(error.message);
      }
    }
    const key = `${String(row.folder || "").toLowerCase()}::${String(row.item_name || "").trim().toLowerCase()}::${nonExpiring ? "non-expiring" : expiryRaw}`;
    const duplicateOf = seen.get(key) || null;
    if (!duplicateOf) seen.set(key, lineNumber);
    else errors.push(`Duplicate of line ${duplicateOf}`);
    const cost = toNumber(row.cost_price, 0);
    parsed.push({
      line: lineNumber,
      folder_id: folder?.id || null,
      folder_name: folder?.name || row.folder || "",
      item_name: String(row.item_name || "").trim(),
      quantity: Number.isInteger(qty) ? qty : 0,
      minimum_quantity: Number(row.minimum_quantity || 0) || 0,
      unit: row.unit || "unit",
      cost_price: cost,
      selling_price: toNumber(row.selling_price, 0),
      attributes: row.attributes || "",
      moa_notes: row.moa_notes || "",
      expiry_date: nonExpiring ? null : expiryRaw || null,
      is_non_expiring: nonExpiring ? 1 : 0,
      line_value: roundCurrency((Number.isInteger(qty) ? qty : 0) * cost),
      errors,
      duplicate: Boolean(duplicateOf),
      missing_expiry: !nonExpiring && !expiryRaw,
    });
  });

  const valid = parsed.filter((row) => row.errors.length === 0);
  const invalid = parsed.filter((row) => row.errors.length > 0);
  return {
    headers,
    rows: parsed,
    valid_rows: valid,
    invalid_rows: invalid,
    summary: {
      total_rows: parsed.length,
      valid_rows: valid.length,
      invalid_rows: invalid.length,
      duplicate_rows: parsed.filter((row) => row.duplicate).length,
      missing_expiry: parsed.filter((row) => row.missing_expiry).length,
      total_quantity: valid.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      total_value: roundCurrency(valid.reduce((sum, row) => sum + Number(row.line_value || 0), 0)),
    },
  };
}

function csvShipmentTemplate() {
  return [
    CSV_REQUIRED_HEADERS.concat(["non_expiring"]).join(","),
    "Consumable,Gauze 10x10,20,5,pack,12,20,2027-01-01,",
    "Consumable,Reusable tray,4,1,unit,0,0,,yes",
  ].join("\n");
}

function createStocktakeSession({ scope = "ocs", folderId = null, itemIds = [], userId, notes = "" }) {
  const info = db
    .prepare(`
      INSERT INTO inventory_stocktake_sessions (
        scope, folder_id, status, notes, created_by_user_id, assigned_counter_user_id, started_at
      ) VALUES (?, ?, 'in_progress', ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .run(scope, folderId || null, notes, userId, userId);
  const sessionId = Number(info.lastInsertRowid);
  let items = [];
  if (Array.isArray(itemIds) && itemIds.length) {
    items = itemIds
      .map((id) =>
        db
          .prepare(
            `SELECT * FROM inventory WHERE id = ? AND stock_scope = 'ocs' AND owner_doctor_id IS NULL AND archived_at IS NULL`,
          )
          .get(Number(id)),
      )
      .filter(Boolean);
  } else {
    items = db
      .prepare(
        `
        SELECT * FROM inventory
        WHERE stock_scope = 'ocs'
          AND owner_doctor_id IS NULL
          AND archived_at IS NULL
          AND (? IS NULL OR folder_id = ?)
        ORDER BY item_name ASC
      `,
      )
      .all(folderId || null, folderId || null);
  }
  const insert = db.prepare(`
    INSERT INTO inventory_stocktake_session_items (
      session_id, inventory_id, system_quantity
    ) VALUES (?, ?, ?)
  `);
  for (const item of items) {
    insert.run(sessionId, item.id, Number(item.quantity || 0));
  }
  return getStocktakeSession(sessionId, { revealSystem: false });
}

function serializeStocktakeSession(session, { revealSystem = false } = {}) {
  const items = db
    .prepare(`
      SELECT si.*, i.item_name, i.unit, i.folder_id, i.cost_price
      FROM inventory_stocktake_session_items si
      JOIN inventory i ON i.id = si.inventory_id
      WHERE si.session_id = ?
      ORDER BY i.item_name ASC
    `)
    .all(session.id)
    .map((row) => {
      const submitted = ["submitted", "approved", "rejected", "applied"].includes(session.status);
      const counted = row.physical_quantity !== null && row.physical_quantity !== undefined;
      return {
        ...row,
        counted,
        system_quantity: revealSystem || submitted ? Number(row.system_quantity || 0) : null,
        variance: revealSystem || submitted ? row.variance : null,
        variance_value:
          revealSystem || submitted
            ? roundCurrency(Number(row.variance || 0) * Number(row.cost_price || 0))
            : null,
      };
    });
  const counted = items.filter((row) => row.counted).length;
  const discrepancyItems = items.filter((row) => Number(row.variance || 0) !== 0);
  const openVarianceQty = discrepancyItems.reduce((sum, row) => sum + Math.abs(Number(row.variance || 0)), 0);
  const openVarianceValue = roundCurrency(
    discrepancyItems.reduce((sum, row) => sum + Number(row.variance_value || 0), 0),
  );
  return {
    ...session,
    items,
    item_count: items.length,
    counted_count: counted,
    progress_percent: items.length ? Math.round((counted / items.length) * 100) : 0,
    last_saved_at: session.updated_at || session.started_at || session.created_at,
    discrepancy_count: discrepancyItems.length,
    open_variance_qty: ["submitted", "approved", "applied"].includes(session.status) ? openVarianceQty : null,
    open_variance_value: ["submitted", "approved", "applied"].includes(session.status)
      ? openVarianceValue
      : null,
  };
}

function getStocktakeSession(id, options) {
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(id));
  if (!session) return null;
  return serializeStocktakeSession(session, options);
}

function listStocktakeSessions() {
  return db
    .prepare(`
      SELECT
        s.*,
        u.full_name AS created_by_name,
        counter.full_name AS assigned_counter_name,
        f.name AS folder_name,
        (SELECT COUNT(*) FROM inventory_stocktake_session_items si WHERE si.session_id = s.id) AS item_count,
        (SELECT COUNT(*) FROM inventory_stocktake_session_items si WHERE si.session_id = s.id AND si.physical_quantity IS NOT NULL) AS counted_count,
        (SELECT COALESCE(SUM(ABS(si.variance)), 0) FROM inventory_stocktake_session_items si WHERE si.session_id = s.id) AS open_variance_qty,
        (SELECT COALESCE(SUM(ABS(si.variance) * COALESCE(i.cost_price, 0)), 0)
           FROM inventory_stocktake_session_items si
           JOIN inventory i ON i.id = si.inventory_id
          WHERE si.session_id = s.id) AS open_variance_value
      FROM inventory_stocktake_sessions s
      LEFT JOIN users u ON u.id = s.created_by_user_id
      LEFT JOIN users counter ON counter.id = s.assigned_counter_user_id
      LEFT JOIN inventory_folders f ON f.id = s.folder_id
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 100
    `)
    .all()
    .map((row) => ({
      ...row,
      folder_name: row.folder_name || (row.folder_id ? "Folder" : "All OCS folders"),
      progress_percent: Number(row.item_count || 0)
        ? Math.round((Number(row.counted_count || 0) / Number(row.item_count || 1)) * 100)
        : 0,
      last_saved_at: row.updated_at || row.started_at || row.created_at,
      open_variance_qty: ["submitted", "approved", "applied"].includes(row.status)
        ? Number(row.open_variance_qty || 0)
        : null,
      open_variance_value: ["submitted", "approved", "applied"].includes(row.status)
        ? roundCurrency(row.open_variance_value || 0)
        : null,
    }));
}

function stocktakeQueueStats(sessions = listStocktakeSessions()) {
  const active = sessions.filter((row) => ["draft", "in_progress"].includes(row.status));
  const awaitingApproval = sessions.filter((row) => row.status === "submitted");
  const awaitingApplication = sessions.filter((row) => row.status === "approved");
  const openVarianceValue = roundCurrency(
    [...awaitingApproval, ...awaitingApplication].reduce(
      (sum, row) => sum + Number(row.open_variance_value || 0),
      0,
    ),
  );
  return {
    active_sessions: active.length,
    awaiting_approval: awaitingApproval.length,
    awaiting_application: awaitingApplication.length,
    total_open_variance: openVarianceValue,
  };
}

function parseSubmittedPhysicalCount(value) {
  if (value === null || value === undefined) {
    return { kind: "missing" };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return { kind: "invalid", error: "Physical counts cannot be blank." };
    }
    if (!/^\d+$/.test(trimmed)) {
      return { kind: "invalid", error: "Physical counts must be whole numbers of zero or more." };
    }
    return { kind: "value", value: Number(trimmed) };
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || !Number.isFinite(value)) {
      return { kind: "invalid", error: "Physical counts must be whole numbers of zero or more." };
    }
    return { kind: "value", value };
  }
  return { kind: "invalid", error: "Physical counts must be whole numbers of zero or more." };
}

function saveStocktakeCounts(sessionId, lines, userId) {
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw HttpError(404, "Stocktake session not found.");
  if (!["draft", "in_progress"].includes(session.status)) {
    throw HttpError(400, "This stocktake session can no longer be edited.");
  }
  db.transaction(() => {
    for (const line of lines || []) {
      const parsed = parseSubmittedPhysicalCount(line.physical_quantity);
      if (parsed.kind === "invalid") {
        throw HttpError(400, parsed.error);
      }
      if (parsed.kind === "missing") {
        continue;
      }
      const physical = parsed.value;
      db.prepare(`
        UPDATE inventory_stocktake_session_items
        SET
          physical_quantity = ?,
          variance = ? - system_quantity,
          counted_by_user_id = ?,
          counted_at = CURRENT_TIMESTAMP,
          reason = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND id = ?
      `).run(physical, physical, userId, String(line.reason || "").slice(0, 500), sessionId, line.id);
    }
    db.prepare(`
      UPDATE inventory_stocktake_sessions
      SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionId);
  })();
  return getStocktakeSession(sessionId, { revealSystem: false });
}

function submitStocktakeSession(sessionId, userId) {
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw HttpError(404, "Stocktake session not found.");
  if (!["draft", "in_progress"].includes(session.status)) {
    throw HttpError(409, "This session has already been submitted.");
  }
  const missing = Number(
    db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM inventory_stocktake_session_items
        WHERE session_id = ? AND physical_quantity IS NULL
      `)
      .get(sessionId)?.count || 0,
  );
  if (missing > 0) {
    throw HttpError(400, "Count every line before submitting the session.");
  }
  const items = db
    .prepare("SELECT * FROM inventory_stocktake_session_items WHERE session_id = ?")
    .all(sessionId);
  const hasVariance = items.some((row) => Number(row.variance) !== 0);
  if (!hasVariance) {
    db.prepare(`
      UPDATE inventory_stocktake_sessions
      SET
        status = 'applied',
        submitted_at = CURRENT_TIMESTAMP,
        submitted_by_user_id = ?,
        applied_at = CURRENT_TIMESTAMP,
        applied_transaction_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(userId, `ST-ZERO-${sessionId}`, sessionId);
    return getStocktakeSession(sessionId, { revealSystem: true });
  }
  db.prepare(`
    UPDATE inventory_stocktake_sessions
    SET
      status = 'submitted',
      submitted_at = CURRENT_TIMESTAMP,
      submitted_by_user_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(userId, sessionId);
  return getStocktakeSession(sessionId, { revealSystem: true });
}

function otherActiveAdminExists(userId) {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM users
      WHERE role = 'admin' AND is_active = 1 AND id != ?
    `)
    .get(Number(userId));
  return Number(row?.count || 0) > 0;
}

function reviewStocktakeSession(sessionId, { decision, reason, userId, role }) {
  if (!["approved", "rejected"].includes(decision)) {
    throw HttpError(400, "Decision must be approved or rejected.");
  }
  if (role !== "admin") throw HttpError(403, "Only an admin can review stocktake variances.");
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw HttpError(404, "Stocktake session not found.");
  if (session.status !== "submitted") throw HttpError(400, "Only submitted sessions can be reviewed.");
  if (Number(session.submitted_by_user_id) === Number(userId) && otherActiveAdminExists(userId)) {
    throw HttpError(403, "The person who submitted this count cannot approve it while another admin is available.");
  }
  if (decision === "rejected" && String(reason || "").trim().length < 10) {
    throw HttpError(400, "A reason is required to reject a stocktake session.");
  }
  db.prepare(`
    UPDATE inventory_stocktake_sessions
    SET
      status = ?,
      reviewed_by_user_id = ?,
      reviewed_at = CURRENT_TIMESTAMP,
      review_reason = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(decision === "approved" ? "approved" : "rejected", userId, String(reason || "").slice(0, 500), sessionId);
  return getStocktakeSession(sessionId, { revealSystem: true });
}

function applyStocktakeSession(sessionId, userId, actor = {}) {
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw HttpError(404, "Stocktake session not found.");
  if (session.status === "applied" && session.applied_transaction_id) {
    return { session: getStocktakeSession(sessionId, { revealSystem: true }), idempotent: true };
  }
  if (session.status === "rejected" || session.status === "cancelled") {
    throw HttpError(400, "This session cannot be applied.");
  }
  if (session.status !== "approved" && session.status !== "applied") {
    const items = db
      .prepare("SELECT * FROM inventory_stocktake_session_items WHERE session_id = ?")
      .all(sessionId);
    const hasVariance = items.some((row) => Number(row.variance) !== 0);
    if (hasVariance && session.status !== "approved") {
      throw HttpError(400, "Non-zero variances must be approved before they can be applied.");
    }
  }

  return db.transaction(() => {
    const locked = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
    if (locked.status === "applied" && locked.applied_transaction_id) {
      return { session: getStocktakeSession(sessionId, { revealSystem: true }), idempotent: true };
    }
    if (locked.status === "rejected" || locked.status === "cancelled") {
      throw HttpError(400, "This session cannot be applied.");
    }
    const transactionId = `ST-${sessionId}-${Date.now().toString(36).toUpperCase()}`;
    const items = db
      .prepare("SELECT * FROM inventory_stocktake_session_items WHERE session_id = ?")
      .all(sessionId);
    for (const line of items) {
      const variance = Number(line.variance);
      if (!Number.isFinite(variance) || variance === 0) continue;
      const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(line.inventory_id);
      if (!item) throw HttpError(409, "A counted item is no longer available.");
      const previous = Number(item.quantity);
      const next = Number(line.physical_quantity);
      if (!Number.isInteger(next) || next < 0) {
        throw HttpError(409, `Counted quantity is missing for ${item.item_name}.`);
      }
      if (variance < 0) {
        const consumed = consumeFefo(item.id, Math.abs(variance));
        if (!consumed.ok) throw HttpError(409, `Insufficient batch quantity to apply the count for ${item.item_name}.`);
      } else {
        db.prepare(`
          INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
          VALUES (?, ?, NULL, ?, 1)
        `).run(item.id, variance, roundCurrency(item.cost_price || 0));
      }
      updateInventoryQuantity(item.id, next);
      recordOpsMovement({
        itemId: item.id,
        movementType: variance > 0 ? "in" : "out",
        quantity: Math.abs(variance),
        previousQuantity: previous,
        nextQuantity: next,
        actionType: "adjustment",
        note: line.reason || `Stocktake session #${sessionId}`,
        userId,
        skipPublish: true,
        meta: {
          stocktake_session_id: sessionId,
          transaction_id: transactionId,
          previous_quantity: previous,
          counted_quantity: next,
          performed_by_name: actor.displayName || "",
          performed_by_role: actor.role || "",
          reference_type: "stocktake_session",
          reference_id: sessionId,
        },
      });
    }
    const applied = db.prepare(`
      UPDATE inventory_stocktake_sessions
      SET
        status = 'applied',
        applied_at = CURRENT_TIMESTAMP,
        applied_transaction_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND applied_transaction_id IS NULL
    `).run(transactionId, sessionId);
    if (!applied.changes) {
      return { session: getStocktakeSession(sessionId, { revealSystem: true }), idempotent: true };
    }
    publishInventoryResyncBroadcast({ reason: "stocktake_applied" });
    return { session: getStocktakeSession(sessionId, { revealSystem: true }), idempotent: false, transactionId };
  })();
}

function doctorMayViewReceipt(transactionId, doctorId) {
  const rows = db
    .prepare(`
      SELECT m.doctor_id, m.meta_json, i.owner_doctor_id, i.stock_scope
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      WHERE m.action_type IN ('restock_out', 'restock_in')
    `)
    .all();
  return rows.some((row) => {
    let meta = {};
    try {
      meta = JSON.parse(row.meta_json || "{}");
    } catch {
      meta = {};
    }
    if (String(meta.transaction_id || "") !== String(transactionId)) return false;
    return (
      Number(row.doctor_id) === Number(doctorId) ||
      Number(row.owner_doctor_id) === Number(doctorId) ||
      Number(meta.doctor_id) === Number(doctorId)
    );
  });
}

function movementIdsForTransaction(transactionId) {
  if (!transactionId) return [];
  return db
    .prepare(
      `
      SELECT m.id, m.action_type, m.created_at
      FROM inventory_movements m
      WHERE m.action_type IN ('restock_out', 'restock_in')
        AND json_extract(m.meta_json, '$.transaction_id') = ?
      ORDER BY m.id ASC
    `,
    )
    .all(String(transactionId));
}

module.exports = {
  CSV_REQUIRED_HEADERS,
  HttpError,
  WRITE_OFF_REASONS,
  applyExceptionalCorrection,
  applyStocktakeSession,
  assertBatchBalance,
  batchQuantityTotal,
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
  listWriteOffBatches,
  movementIdsForTransaction,
  parseCsvShipment,
  parseNonExpiringFlag,
  previewAllocations,
  releaseStagingRows,
  reviewStocktakeSession,
  saveStocktakeCounts,
  shipmentQueueStats,
  stagingRowErrors,
  stocktakeQueueStats,
  submitStocktakeSession,
  validateReceiptExpiry,
};
