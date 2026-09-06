"use strict";

const { db } = require("../db");
const { getTodayLocal, toNumber } = require("./utils");
const { updateInventoryQuantity } = require("./inventoryQuantity");
const { publishInventoryChange, publishInventoryResyncBroadcast } = require("./inventoryRealtime");
const { isEnvTrue } = require("./envFlags");

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

function stagingRowErrors(row) {
  const errors = [];
  if (!String(row.item_name || "").trim()) errors.push("Missing item name");
  const qty = Number(row.quantity);
  if (!Number.isInteger(qty) || qty < 0) errors.push("Invalid quantity");
  const nonExpiring = Number(row.is_non_expiring || 0) === 1;
  if (!nonExpiring && !String(row.expiry_date || "").trim()) {
    errors.push("Expiry date or explicit non-expiring flag required");
  }
  return errors;
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
    meta.reference_type || null,
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

function listShipments() {
  return db
    .prepare(`
      SELECT s.*, u.full_name AS imported_by_name, r.full_name AS released_by_name
      FROM inventory_shipments s
      LEFT JOIN users u ON u.id = s.imported_by_user_id
      LEFT JOIN users r ON r.id = s.released_by_user_id
      ORDER BY s.imported_at DESC, s.id DESC
      LIMIT 100
    `)
    .all()
    .map((row) => ({
      ...row,
      lines: db
        .prepare(`
          SELECT st.*, f.name AS folder_name
          FROM inventory_staging st
          LEFT JOIN inventory_folders f ON f.id = st.folder_id
          WHERE st.shipment_id = ?
          ORDER BY st.id ASC
        `)
        .all(row.id)
        .map((line) => ({
          ...line,
          validation_errors: stagingRowErrors(line),
        })),
    }));
}

function getShipment(id) {
  const shipment = db.prepare("SELECT * FROM inventory_shipments WHERE id = ?").get(Number(id));
  if (!shipment) return null;
  const lines = db
    .prepare(`
      SELECT st.*, f.name AS folder_name
      FROM inventory_staging st
      LEFT JOIN inventory_folders f ON f.id = st.folder_id
      WHERE st.shipment_id = ?
      ORDER BY st.id ASC
    `)
    .all(shipment.id)
    .map((line) => ({ ...line, validation_errors: stagingRowErrors(line) }));
  return { ...shipment, lines };
}

function bulkReleaseShipment({ shipmentId, rowIds, userId, actor }) {
  const shipment = getShipment(shipmentId);
  if (!shipment) throw HttpError(404, "Shipment not found.");
  if (shipment.status === "released") {
    return { shipment, idempotent: true, receipt: shipmentReceipt(shipment) };
  }
  const selected = (shipment.lines || []).filter((line) => {
    if (line.status !== "pending") return false;
    if (Array.isArray(rowIds) && rowIds.length) return rowIds.includes(Number(line.id));
    return stagingRowErrors(line).length === 0;
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
    db.prepare(`
      UPDATE inventory_shipments
      SET status = 'released', released_by_user_id = ?, released_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(userId, shipment.id);
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
      SELECT si.*, i.item_name, i.unit, i.folder_id
      FROM inventory_stocktake_session_items si
      JOIN inventory i ON i.id = si.inventory_id
      WHERE si.session_id = ?
      ORDER BY i.item_name ASC
    `)
    .all(session.id)
    .map((row) => {
      const submitted = ["submitted", "approved", "rejected", "applied"].includes(session.status);
      return {
        ...row,
        system_quantity: revealSystem || submitted ? Number(row.system_quantity || 0) : null,
        variance: revealSystem || submitted ? row.variance : null,
      };
    });
  return { ...session, items };
}

function getStocktakeSession(id, options) {
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(id));
  if (!session) return null;
  return serializeStocktakeSession(session, options);
}

function listStocktakeSessions() {
  return db
    .prepare(`
      SELECT s.*, u.full_name AS created_by_name
      FROM inventory_stocktake_sessions s
      LEFT JOIN users u ON u.id = s.created_by_user_id
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 100
    `)
    .all();
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

module.exports = {
  HttpError,
  applyStocktakeSession,
  bulkReleaseShipment,
  createShipmentFromImport,
  createStocktakeSession,
  doctorMayViewReceipt,
  getShipment,
  getStocktakeSession,
  isDoctorEmergencyRestockEnabled,
  listShipments,
  listStocktakeSessions,
  parseNonExpiringFlag,
  releaseStagingRows,
  reviewStocktakeSession,
  saveStocktakeCounts,
  stagingRowErrors,
  submitStocktakeSession,
};
