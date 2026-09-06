const { db } = require("../db");
const { getTodayLocal, toNumber } = require("./utils");
const { updateInventoryQuantity } = require("./inventoryQuantity");
const { publishInventoryChange, publishInventoryResyncBroadcast, publishSupplyRequestChange } = require("./inventoryRealtime");

function createTransferTransactionId() {
  return `TX-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function roundCurrency(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function HttpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function integerQty(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function requiredIntegerQty(value, label) {
  const n = integerQty(value);
  if (n === null || !Number.isInteger(n) || n < 0) {
    throw HttpError(400, `${label} must be a whole number of zero or more.`);
  }
  return n;
}

function resolveOcsItem(requestItem) {
  const inventoryId = Number(requestItem.inventory_id || 0);
  if (inventoryId) {
    const byId = db
      .prepare(`
        SELECT * FROM inventory
        WHERE id = ?
          AND stock_scope = 'ocs'
          AND owner_doctor_id IS NULL
          AND archived_at IS NULL
        LIMIT 1
      `)
      .get(inventoryId);
    if (byId) return byId;
  }
  const name = String(requestItem.item_name || "").trim();
  if (!name) return null;
  return (
    db
      .prepare(`
        SELECT * FROM inventory
        WHERE stock_scope = 'ocs'
          AND owner_doctor_id IS NULL
          AND archived_at IS NULL
          AND LOWER(item_name) = LOWER(?)
        LIMIT 1
      `)
      .get(name) || null
  );
}

function reservedQuantityForItem(inventoryId, { exceptRequestId = null } = {}) {
  const row = db
    .prepare(`
      SELECT COALESCE(SUM(quantity), 0) AS total
      FROM inventory_reservations
      WHERE inventory_id = ?
        AND status = 'active'
        AND (? IS NULL OR request_id != ?)
    `)
    .get(Number(inventoryId), exceptRequestId, exceptRequestId);
  return integerQty(row?.total) ?? 0;
}

function reservedQuantityForBatch(batchId, { exceptReservationId = null } = {}) {
  const row = db
    .prepare(`
      SELECT COALESCE(SUM(rb.quantity), 0) AS total
      FROM inventory_reservation_batches rb
      JOIN inventory_reservations r ON r.id = rb.reservation_id
      WHERE rb.batch_id = ?
        AND r.status = 'active'
        AND (? IS NULL OR r.id != ?)
    `)
    .get(Number(batchId), exceptReservationId, exceptReservationId);
  return integerQty(row?.total) ?? 0;
}

function availableToPromise(inventoryId, { exceptRequestId = null } = {}) {
  const item = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(Number(inventoryId));
  const physical = integerQty(item?.quantity) ?? 0;
  const reserved = reservedQuantityForItem(inventoryId, { exceptRequestId });
  return Math.max(0, physical - reserved);
}

function isExpiredBatch(batch, today = getTodayLocal()) {
  if (!batch?.expiry_date) return false;
  if (Number(batch.is_non_expiring || 0) === 1) return false;
  return String(batch.expiry_date) < today;
}

function listAllocatableBatches(inventoryId) {
  const today = getTodayLocal();
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
    .all(Number(inventoryId));

  return rows
    .map((row) => {
      const reserved = reservedQuantityForBatch(row.id);
      const remaining = Math.max(0, (integerQty(row.quantity_remaining) ?? 0) - reserved);
      return {
        ...row,
        reserved,
        available: remaining,
        expired: isExpiredBatch(row, today),
        missing_expiry:
          !row.expiry_date && Number(row.is_non_expiring || 0) !== 1,
      };
    })
    .filter((row) => !row.expired && row.available > 0);
}

function allocateFefo(inventoryId, quantity) {
  let remaining = integerQty(quantity) ?? 0;
  const allocations = [];
  if (remaining <= 0) return allocations;
  for (const batch of listAllocatableBatches(inventoryId)) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.available);
    if (take <= 0) continue;
    allocations.push({
      batch_id: batch.id,
      quantity: take,
      expiry_date: batch.expiry_date || null,
      is_non_expiring: Number(batch.is_non_expiring || 0) === 1 ? 1 : 0,
      unit_cost: toNumber(batch.unit_cost, 0),
      missing_expiry: batch.missing_expiry,
    });
    remaining -= take;
  }
  return allocations;
}

function releaseReservations(requestId) {
  const active = db
    .prepare(`
      SELECT id FROM inventory_reservations
      WHERE request_id = ? AND status = 'active'
    `)
    .all(Number(requestId));
  db.prepare(`
    UPDATE inventory_reservations
    SET status = 'released', released_at = CURRENT_TIMESTAMP
    WHERE request_id = ? AND status = 'active'
  `).run(Number(requestId));
  return active.length;
}

function activeFulfilment(requestId) {
  return db
    .prepare(`
      SELECT * FROM restock_request_fulfillments
      WHERE request_id = ?
        AND status IN ('open', 'picking', 'packed')
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(Number(requestId));
}

function postedFulfilment(requestId) {
  return db
    .prepare(`
      SELECT * FROM restock_request_fulfillments
      WHERE request_id = ? AND status = 'posted'
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(Number(requestId));
}

function requestItems(requestId) {
  return db
    .prepare(`
      SELECT id, inventory_id, item_name, quantity
      FROM restock_request_items
      WHERE request_id = ?
      ORDER BY id ASC
    `)
    .all(Number(requestId));
}

function createReservationsForRequest(requestId) {
  const items = requestItems(requestId);
  let fulfilment = activeFulfilment(requestId);
  if (!fulfilment) {
    const info = db
      .prepare(`
        INSERT INTO restock_request_fulfillments (request_id, status)
        VALUES (?, 'open')
      `)
      .run(Number(requestId));
    fulfilment = db
      .prepare("SELECT * FROM restock_request_fulfillments WHERE id = ?")
      .get(Number(info.lastInsertRowid));
  }

  db.prepare("DELETE FROM restock_request_fulfillment_items WHERE fulfilment_id = ?").run(
    fulfilment.id,
  );

  let hasShortage = 0;
  const lines = [];
  for (const item of items) {
    const ocsItem = resolveOcsItem(item);
    const requested = requiredIntegerQty(item.quantity, "Requested quantity");
    let reserved = 0;
    let allocations = [];
    if (ocsItem) {
      const atp = availableToPromise(ocsItem.id, { exceptRequestId: requestId });
      reserved = Math.min(requested, atp);
      if (reserved > 0) {
        allocations = allocateFefo(ocsItem.id, reserved);
        reserved = allocations.reduce((sum, row) => sum + (integerQty(row.quantity) ?? 0), 0);
      }
    }
    const shortage = Math.max(0, requested - reserved);
    if (shortage > 0) hasShortage = 1;

    const lineInfo = db
      .prepare(`
        INSERT INTO restock_request_fulfillment_items (
          fulfilment_id, request_item_id, inventory_id, item_name,
          requested_quantity, reserved_quantity, shortage_quantity,
          picked_quantity, fulfilled_quantity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
      `)
      .run(
        fulfilment.id,
        item.id,
        ocsItem?.id || null,
        item.item_name,
        requested,
        reserved,
        shortage,
        reserved,
      );
    const fulfilmentItemId = Number(lineInfo.lastInsertRowid);

    if (reserved > 0 && ocsItem) {
      const reservationInfo = db
        .prepare(`
          INSERT INTO inventory_reservations (
            request_id, request_item_id, fulfilment_item_id, inventory_id, quantity, status
          ) VALUES (?, ?, ?, ?, ?, 'active')
        `)
        .run(requestId, item.id, fulfilmentItemId, ocsItem.id, reserved);
      const reservationId = Number(reservationInfo.lastInsertRowid);
      const insertBatch = db.prepare(`
        INSERT INTO inventory_reservation_batches (
          reservation_id, batch_id, quantity, expiry_date, is_non_expiring
        ) VALUES (?, ?, ?, ?, ?)
      `);
      for (const allocation of allocations) {
        insertBatch.run(
          reservationId,
          allocation.batch_id,
          allocation.quantity,
          allocation.expiry_date,
          allocation.is_non_expiring,
        );
      }
    }

    lines.push({
      request_item_id: item.id,
      inventory_id: ocsItem?.id || null,
      item_name: item.item_name,
      requested_quantity: requested,
      reserved_quantity: reserved,
      shortage_quantity: shortage,
    });
  }

  db.prepare(`
    UPDATE restock_request_fulfillments
    SET has_shortage = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(hasShortage, fulfilment.id);

  return { fulfilmentId: fulfilment.id, hasShortage: Boolean(hasShortage), lines };
}

function reserveAcceptedRequest(requestId) {
  releaseReservations(requestId);
  const cancelled = db
    .prepare(`
      UPDATE restock_request_fulfillments
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE request_id = ? AND status IN ('open', 'picking', 'packed')
    `)
    .run(Number(requestId));
  void cancelled;
  return createReservationsForRequest(requestId);
}

function replaceReservationsForAmendment(requestId) {
  releaseReservations(requestId);
  db.prepare(`
    UPDATE restock_request_fulfillments
    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
    WHERE request_id = ? AND status IN ('open', 'picking', 'packed')
  `).run(Number(requestId));
  return createReservationsForRequest(requestId);
}

function replaceLineAllocations(requestId, line, allocations) {
  const reservation = db
    .prepare(`
      SELECT * FROM inventory_reservations
      WHERE fulfilment_item_id = ? AND status = 'active'
      ORDER BY id DESC LIMIT 1
    `)
    .get(line.id);
  if (!reservation) {
    throw HttpError(400, `No active reservation to reallocate for ${line.item_name}.`);
  }
  let total = 0;
  for (const allocation of allocations) {
    const qty = Math.max(0, Math.floor(integerQty(allocation.quantity) ?? 0));
    if (qty <= 0) continue;
    const batch = db.prepare("SELECT * FROM inventory_batches WHERE id = ?").get(allocation.batch_id);
    if (!batch || Number(batch.item_id) !== Number(line.inventory_id)) {
      throw HttpError(400, `Batch ${allocation.batch_id} is not valid for ${line.item_name}.`);
    }
    if (isExpiredBatch(batch)) {
      throw HttpError(400, "Expired batches cannot be allocated.");
    }
    const available =
      (integerQty(batch.quantity_remaining) ?? 0) -
      reservedQuantityForBatch(batch.id, { exceptReservationId: reservation.id });
    if (available < qty) {
      throw HttpError(409, `Batch ${batch.id} does not have enough unreserved quantity.`);
    }
    total += qty;
  }
  if (total !== (integerQty(line.reserved_quantity) ?? 0)) {
    throw HttpError(400, "Replacement allocations must equal the reserved quantity.");
  }
  db.prepare("DELETE FROM inventory_reservation_batches WHERE reservation_id = ?").run(reservation.id);
  const insertBatch = db.prepare(`
    INSERT INTO inventory_reservation_batches (
      reservation_id, batch_id, quantity, expiry_date, is_non_expiring
    ) VALUES (?, ?, ?, ?, ?)
  `);
  for (const allocation of allocations) {
    const qty = Math.max(0, Math.floor(integerQty(allocation.quantity) ?? 0));
    if (qty <= 0) continue;
    const batch = db.prepare("SELECT * FROM inventory_batches WHERE id = ?").get(allocation.batch_id);
    insertBatch.run(
      reservation.id,
      batch.id,
      qty,
      batch.expiry_date,
      Number(batch.is_non_expiring || 0) === 1 ? 1 : 0,
    );
  }
  void requestId;
}

function resolveShortages(requestId) {
  const previous = db
    .prepare(`
      SELECT request_item_id, picked_quantity, fulfilled_quantity
      FROM restock_request_fulfillment_items
      WHERE fulfilment_id = (
        SELECT id FROM restock_request_fulfillments
        WHERE request_id = ? AND status IN ('open', 'picking')
        ORDER BY id DESC LIMIT 1
      )
    `)
    .all(Number(requestId));
  const result = replaceReservationsForAmendment(requestId);
  const pickedByItem = new Map(previous.map((row) => [Number(row.request_item_id), row]));
  const fulfilment = activeFulfilment(requestId);
  if (fulfilment) {
    const lines = db
      .prepare("SELECT * FROM restock_request_fulfillment_items WHERE fulfilment_id = ?")
      .all(fulfilment.id);
    for (const line of lines) {
      const prev = pickedByItem.get(Number(line.request_item_id));
      if (!prev) continue;
      const reserved = integerQty(line.reserved_quantity) ?? 0;
      const picked = Math.min(integerQty(prev.picked_quantity) ?? 0, reserved);
      const fulfilled = Math.min(integerQty(prev.fulfilled_quantity) ?? 0, reserved);
      db.prepare(`
        UPDATE restock_request_fulfillment_items
        SET picked_quantity = ?, fulfilled_quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(picked, fulfilled, line.id);
    }
  }
  return { ...result, detail: fulfilmentDetail(requestId) };
}

function assignRequest(requestId, userId) {
  db.prepare(`
    UPDATE restock_requests
    SET assigned_to_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(userId || null, Number(requestId));
  db.prepare(`
    UPDATE restock_request_fulfillments
    SET assigned_to_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE request_id = ? AND status IN ('open', 'picking', 'packed')
  `).run(userId || null, Number(requestId));
}

function reconcileLegacyFulfilment(requestId) {
  const request = db.prepare("SELECT * FROM restock_requests WHERE id = ?").get(Number(requestId));
  if (!request) throw HttpError(404, "Supply request not found.");
  if (!["accepted", "ready"].includes(String(request.status))) {
    throw HttpError(400, "Only accepted or ready requests can be reconciled.");
  }
  const existing = activeFulfilment(requestId) || postedFulfilment(requestId);
  if (existing) {
    throw HttpError(409, "Fulfilment already exists for this request.");
  }
  return createReservationsForRequest(requestId);
}

function fulfilmentDetail(requestId) {
  const request = db.prepare("SELECT * FROM restock_requests WHERE id = ?").get(Number(requestId));
  if (!request) return null;
  const fulfilment = activeFulfilment(requestId) || postedFulfilment(requestId);
  const linkageRequired =
    ["accepted", "ready"].includes(String(request.status || "")) && !fulfilment;
  const items = db
    .prepare(`
      SELECT * FROM restock_request_fulfillment_items
      WHERE fulfilment_id = ?
      ORDER BY id ASC
    `)
    .all(fulfilment?.id || 0)
    .map((line) => {
      const reservation = db
        .prepare(`
          SELECT * FROM inventory_reservations
          WHERE fulfilment_item_id = ? AND status IN ('active', 'consumed')
          ORDER BY id DESC LIMIT 1
        `)
        .get(line.id);
      const batches = reservation
        ? db
            .prepare(`
              SELECT rb.*, b.quantity_remaining, b.expiry_date AS batch_expiry
              FROM inventory_reservation_batches rb
              LEFT JOIN inventory_batches b ON b.id = rb.batch_id
              WHERE rb.reservation_id = ?
              ORDER BY rb.id ASC
            `)
            .all(reservation.id)
        : [];
      const atp = line.inventory_id
        ? availableToPromise(line.inventory_id, { exceptRequestId: requestId })
        : 0;
      return {
        ...line,
        available_to_promise: atp,
        allocations: batches.map((batch) => ({
          batch_id: batch.batch_id,
          quantity: integerQty(batch.quantity) ?? 0,
          expiry_date: batch.expiry_date || batch.batch_expiry || null,
          is_non_expiring: Number(batch.is_non_expiring || 0) === 1,
          remaining: integerQty(batch.quantity_remaining) ?? 0,
        })),
      };
    });

  return {
    request_id: Number(requestId),
    fulfilment,
    linkage_required: Boolean(linkageRequired),
    has_shortage: Boolean(fulfilment?.has_shortage),
    partial_approved: Boolean(request.partial_fulfilment_approved || fulfilment?.partial_approved),
    partial_reason: request.partial_fulfilment_reason || fulfilment?.partial_reason || "",
    transfer_transaction_id: request.transfer_transaction_id || fulfilment?.transfer_transaction_id || null,
    items,
  };
}

function assertCanMarkReady(requestId) {
  const detail = fulfilmentDetail(requestId);
  if (!detail || detail.linkage_required) {
    throw HttpError(
      409,
      "This request needs fulfilment linkage before it can be marked ready. Reconcile quantities and batches first.",
    );
  }
  const hasShortage = (detail.items || []).some((line) => {
    const shortage = integerQty(line.shortage_quantity) ?? 0;
    const reserved = integerQty(line.reserved_quantity) ?? 0;
    const requested = integerQty(line.requested_quantity) ?? 0;
    return shortage > 0 || reserved < requested;
  });
  const fullyPicked = (detail.items || []).every((line) => {
    const reserved = integerQty(line.reserved_quantity) ?? 0;
    const fulfilled = integerQty(line.fulfilled_quantity);
    const picked = integerQty(line.picked_quantity) ?? 0;
    const target = detail.partial_approved ? (fulfilled ?? 0) : reserved;
    if (detail.partial_approved && target === 0) return true;
    return picked >= target && (detail.partial_approved || target > 0);
  });
  if (hasShortage && !detail.partial_approved) {
    throw HttpError(400, "Resolve shortages or approve partial fulfilment before marking supply ready.");
  }
  if (!fullyPicked && !detail.partial_approved) {
    throw HttpError(400, "Pick every reserved line, or approve partial fulfilment, before marking supply ready.");
  }
  return detail;
}

function applyPicking(requestId, { lines = [], partialApproved, partialReason = "" } = {}) {
  const fulfilment = activeFulfilment(requestId);
  if (!fulfilment) {
    throw HttpError(409, "No active fulfilment exists for this request.");
  }
  if (fulfilment.status === "packed") {
    throw HttpError(400, "Packed quantities are locked. Unlock is not permitted after ready.");
  }
  if (partialApproved === true && String(partialReason || "").trim().length < 10) {
    throw HttpError(400, "A reason of at least 10 characters is required for partial fulfilment.");
  }

  const byId = new Map((lines || []).map((line) => [Number(line.id || line.fulfilment_item_id), line]));
  const existingLines = db
    .prepare("SELECT * FROM restock_request_fulfillment_items WHERE fulfilment_id = ?")
    .all(fulfilment.id);

  for (const line of existingLines) {
    const patch = byId.get(line.id);
    if (!patch) continue;
    const reserved = integerQty(line.reserved_quantity) ?? 0;
    const picked = Math.max(0, Math.floor(integerQty(patch.picked_quantity) ?? integerQty(line.picked_quantity) ?? 0));
    const fulfilled = Math.max(
      0,
      Math.floor(integerQty(patch.fulfilled_quantity) ?? integerQty(line.fulfilled_quantity) ?? picked),
    );
    if (fulfilled > reserved) {
      throw HttpError(400, `Fulfilled quantity for ${line.item_name} cannot exceed the reserved quantity.`);
    }
    if (picked > reserved) {
      throw HttpError(400, `Picked quantity for ${line.item_name} cannot exceed the reserved quantity.`);
    }
    if (Array.isArray(patch.allocations)) {
      const allocationReason = String(patch.allocation_reason || patch.reason || partialReason || "").trim();
      if (allocationReason.length < 10) {
        throw HttpError(400, "An audit reason of at least 10 characters is required to replace batch allocations.");
      }
      replaceLineAllocations(requestId, line, patch.allocations);
    }
    db.prepare(`
      UPDATE restock_request_fulfillment_items
      SET picked_quantity = ?, fulfilled_quantity = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(picked, fulfilled, line.id);
  }

  db.prepare(`
    UPDATE restock_request_fulfillments
    SET
      status = 'picking',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(fulfilment.id);

  if (partialApproved === true || partialApproved === false) {
    db.prepare(`
      UPDATE restock_request_fulfillments
      SET partial_approved = ?, partial_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(partialApproved ? 1 : 0, String(partialReason || "").slice(0, 500), fulfilment.id);
    db.prepare(`
      UPDATE restock_requests
      SET
        partial_fulfilment_approved = ?,
        partial_fulfilment_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(partialApproved ? 1 : 0, String(partialReason || "").slice(0, 500), requestId);
  }

  return fulfilmentDetail(requestId);
}

function lockPackedFulfilment(requestId, userId) {
  const detail = assertCanMarkReady(requestId);
  db.prepare(`
    UPDATE restock_request_fulfillments
    SET status = 'packed', packed_at = CURRENT_TIMESTAMP, packed_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(userId, detail.fulfilment.id);
  db.prepare(`
    UPDATE restock_requests
    SET fulfilment_locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(requestId);
  return fulfilmentDetail(requestId);
}

function recordTransferMovement({
  itemId,
  movementType,
  quantity,
  previousQuantity,
  nextQuantity,
  actionType,
  note,
  userId,
  doctorId,
  meta,
  skipPublish = false,
}) {
  const item = db.prepare("SELECT item_name, owner_doctor_id FROM inventory WHERE id = ?").get(itemId);
  const metaJson = JSON.stringify(meta || {});
  db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
      recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'restock_request', ?, ?)
  `).run(
    itemId,
    movementType,
    quantity,
    previousQuantity,
    nextQuantity,
    doctorId || null,
    userId || null,
    note || "",
    actionType,
    meta?.request_id || null,
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
    meta?.performed_by_name || "",
    meta?.performed_by_role || "",
    actionType,
    item?.item_name || "",
    quantity,
    movementType,
    meta?.source_location || "Master Stock",
    meta?.destination_location || "Doctor bag",
    "",
    metaJson,
  );
  if (!skipPublish) {
    publishInventoryChange({ itemId, changedByUserId: userId });
  }
  return movementId;
}

function upsertDoctorBagItem(source, doctorId, inboundQty) {
  const existing = db
    .prepare(`
      SELECT * FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND folder_id = ?
        AND item_name = ?
      LIMIT 1
    `)
    .get(doctorId, source.folder_id, source.item_name);
  if (existing) {
    const prev = integerQty(existing.quantity) ?? 0;
    const next = prev + inboundQty;
    updateInventoryQuantity(existing.id, next);
    return { id: Number(existing.id), previous: prev, next };
  }
  const created = db
    .prepare(`
      INSERT INTO inventory (
        item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit,
        cost_price, selling_price, notes, attributes, moa_notes, expiry_date, updated_at
      ) VALUES (?, ?, 'doctor', ?, ?, ?, ?, ?, ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    .run(
      source.item_name,
      source.folder_id,
      doctorId,
      inboundQty,
      source.minimum_quantity,
      source.unit,
      source.cost_price,
      source.selling_price,
      source.attributes || "",
      source.moa_notes || "",
      source.expiry_date || null,
    );
  return { id: Number(created.lastInsertRowid), previous: 0, next: inboundQty };
}

function consumeLockedAllocations(inventoryId, allocations, fulfilledQty) {
  const target = requiredIntegerQty(fulfilledQty, "Fulfilled quantity");
  if (target === 0) return [];

  let remaining = target;
  const consumed = [];
  for (const allocation of allocations || []) {
    if (remaining <= 0) break;
    const allocated = integerQty(allocation.quantity) ?? 0;
    if (allocated <= 0) continue;
    const take = Math.min(remaining, allocated);
    const batch = db.prepare("SELECT * FROM inventory_batches WHERE id = ?").get(allocation.batch_id);
    if (!batch || Number(batch.item_id) !== Number(inventoryId)) {
      throw HttpError(409, "A locked batch is no longer valid. Reconcile fulfilment before collection.");
    }
    if ((integerQty(batch.quantity_remaining) ?? 0) < take) {
      throw HttpError(409, "A locked batch no longer has enough remaining quantity.");
    }
    db.prepare("UPDATE inventory_batches SET quantity_remaining = quantity_remaining - ? WHERE id = ?").run(
      take,
      allocation.batch_id,
    );
    consumed.push({
      batch_id: allocation.batch_id,
      quantity: take,
      expiry_date: allocation.expiry_date || batch.expiry_date || null,
      unit_cost: toNumber(batch.unit_cost, 0),
      is_non_expiring: Number(allocation.is_non_expiring || batch.is_non_expiring || 0) === 1 ? 1 : 0,
    });
    remaining -= take;
  }
  if (remaining > 0) {
    throw HttpError(409, "Locked allocations cannot supply the fulfilled quantity.");
  }
  return consumed;
}

function finalizeLineReservation({ fulfilmentItemId, fulfilledQty, consumedBatches }) {
  const reservation = db
    .prepare(`
      SELECT * FROM inventory_reservations
      WHERE fulfilment_item_id = ? AND status = 'active'
      ORDER BY id DESC LIMIT 1
    `)
    .get(fulfilmentItemId);
  if (!reservation) {
    if (fulfilledQty > 0) {
      throw HttpError(409, "No active reservation remains for a fulfilled line.");
    }
    return;
  }
  if (fulfilledQty === 0) {
    db.prepare(`
      UPDATE inventory_reservations
      SET status = 'released', released_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reservation.id);
    return;
  }

  db.prepare(`
    UPDATE inventory_reservations
    SET status = 'consumed', quantity = ?, consumed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(fulfilledQty, reservation.id);
  db.prepare("DELETE FROM inventory_reservation_batches WHERE reservation_id = ?").run(reservation.id);
  const insertBatch = db.prepare(`
    INSERT INTO inventory_reservation_batches (
      reservation_id, batch_id, quantity, expiry_date, is_non_expiring
    ) VALUES (?, ?, ?, ?, ?)
  `);
  for (const row of consumedBatches) {
    insertBatch.run(
      reservation.id,
      row.batch_id,
      row.quantity,
      row.expiry_date || null,
      Number(row.is_non_expiring || 0) === 1 ? 1 : 0,
    );
  }
}

function lookupUserName(userId) {
  if (!userId) return null;
  return (
    db.prepare("SELECT id, full_name, username, role FROM users WHERE id = ?").get(Number(userId)) || null
  );
}

function postCollectionTransfer({ request, actor }) {
  const existingPosted = postedFulfilment(request.id);
  if (existingPosted?.transfer_transaction_id || request.transfer_transaction_id) {
    return {
      transactionId: existingPosted?.transfer_transaction_id || request.transfer_transaction_id,
      idempotent: true,
      movementIds: [],
    };
  }

  const detail = fulfilmentDetail(request.id);
  if (!detail || detail.linkage_required) {
    throw HttpError(
      409,
      "This request cannot be collected until an operator reconciles fulfilment quantities and batches.",
    );
  }
  if (String(detail.fulfilment?.status) !== "packed" && String(request.status) === "ready") {
    // ready without packed lock still allowed for legacy-linked rows that were packed via ready
  }

  const doctor = db.prepare("SELECT id, full_name FROM doctors WHERE id = ?").get(request.doctor_id);
  const packedUser =
    lookupUserName(detail.fulfilment?.packed_by_user_id) || lookupUserName(request.ready_by_user_id);
  const issuerName = packedUser?.full_name || packedUser?.username || "";
  const collectorName = doctor?.full_name || "";
  const confirmerName = actor.displayName || "";
  const transactionId = createTransferTransactionId();
  const receiptReference = `/inventory/receipts/${transactionId}`;
  const movementIds = [];

  function transferMeta(consumed) {
    return {
      request_id: request.id,
      transaction_id: transactionId,
      receipt_reference: receiptReference,
      performed_by_user_id: actor.userId,
      performed_by_role: actor.role,
      performed_by_name: confirmerName,
      issued_by_name: issuerName,
      issued_by_user_id: packedUser?.id || null,
      issued_by_role: packedUser?.role || null,
      received_by_name: collectorName,
      collector_name: collectorName,
      confirmed_by_name: confirmerName,
      confirmed_by_user_id: actor.userId,
      confirmed_by_role: actor.role,
      doctor_name: collectorName,
      transfer_allocations: consumed,
      source_location: "Master Stock",
      destination_location: `${collectorName || "Doctor"}'s Bag`,
    };
  }

  for (const line of detail.items) {
    const qty = requiredIntegerQty(line.fulfilled_quantity, `Fulfilled quantity for ${line.item_name}`);
    if (!line.inventory_id) {
      if (qty > 0) throw HttpError(409, `No OCS item is linked for ${line.item_name}.`);
      finalizeLineReservation({ fulfilmentItemId: line.id, fulfilledQty: 0, consumedBatches: [] });
      continue;
    }
    const source = db.prepare("SELECT * FROM inventory WHERE id = ?").get(line.inventory_id);
    if (!source) throw HttpError(409, `OCS item missing for ${line.item_name}.`);
    const allocations = line.allocations || [];
    if (qty > 0 && !allocations.length) {
      throw HttpError(409, `No locked batch allocation for ${line.item_name}.`);
    }
    const consumed = consumeLockedAllocations(source.id, allocations, qty);
    if (qty === 0) {
      finalizeLineReservation({ fulfilmentItemId: line.id, fulfilledQty: 0, consumedBatches: [] });
      continue;
    }
    const sourcePrev = integerQty(source.quantity) ?? 0;
    if (sourcePrev < qty) {
      throw HttpError(409, `OCS quantity for ${line.item_name} is no longer sufficient.`);
    }
    const sourceNext = sourcePrev - qty;
    updateInventoryQuantity(source.id, sourceNext);
    const outId = recordTransferMovement({
      itemId: source.id,
      movementType: "out",
      quantity: qty,
      previousQuantity: sourcePrev,
      nextQuantity: sourceNext,
      actionType: "restock_out",
      note: `Supply request #${request.id} collected`,
      userId: actor.userId,
      doctorId: request.doctor_id,
      skipPublish: true,
      meta: transferMeta(consumed),
    });
    movementIds.push(outId);

    const bag = upsertDoctorBagItem(source, request.doctor_id, qty);
    for (const allocation of consumed) {
      db.prepare(`
        INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        bag.id,
        allocation.quantity,
        allocation.expiry_date,
        roundCurrency(allocation.unit_cost),
        allocation.is_non_expiring ? 1 : 0,
      );
    }
    const inId = recordTransferMovement({
      itemId: bag.id,
      movementType: "in",
      quantity: qty,
      previousQuantity: bag.previous,
      nextQuantity: bag.next,
      actionType: "restock_in",
      note: `Supply request #${request.id} received`,
      userId: actor.userId,
      doctorId: request.doctor_id,
      skipPublish: true,
      meta: transferMeta(consumed),
    });
    movementIds.push(inId);
    finalizeLineReservation({
      fulfilmentItemId: line.id,
      fulfilledQty: qty,
      consumedBatches: consumed,
    });
  }

  db.prepare(`
    UPDATE inventory_reservations
    SET status = 'released', released_at = CURRENT_TIMESTAMP
    WHERE request_id = ? AND status = 'active'
  `).run(request.id);

  db.prepare(`
    UPDATE restock_request_fulfillments
    SET status = 'posted', posted_at = CURRENT_TIMESTAMP, transfer_transaction_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(transactionId, detail.fulfilment.id);

  db.prepare(`
    UPDATE restock_requests
    SET transfer_transaction_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(transactionId, request.id);

  publishInventoryResyncBroadcast({ reason: "supply_request_collected" });
  return { transactionId, receiptReference, movementIds, idempotent: false };
}

function workQueues() {
  const pending = db
    .prepare(`
      SELECT r.*, d.full_name AS doctor_name, u.full_name AS assigned_to_name
      FROM restock_requests r
      LEFT JOIN doctors d ON d.id = r.doctor_id
      LEFT JOIN users u ON u.id = r.assigned_to_user_id
      WHERE r.status = 'pending'
      ORDER BY datetime(r.collection_date) ASC, datetime(r.created_at) ASC
    `)
    .all();
  const changes = db
    .prepare(`
      SELECT DISTINCT r.*, d.full_name AS doctor_name, u.full_name AS assigned_to_name
      FROM restock_requests r
      JOIN restock_request_amendments a ON a.request_id = r.id AND a.status = 'pending'
      LEFT JOIN doctors d ON d.id = r.doctor_id
      LEFT JOIN users u ON u.id = r.assigned_to_user_id
      WHERE r.status = 'accepted'
      ORDER BY datetime(r.collection_date) ASC, datetime(r.created_at) ASC
    `)
    .all();
  const shortages = db
    .prepare(`
      SELECT r.*, d.full_name AS doctor_name, u.full_name AS assigned_to_name
      FROM restock_requests r
      JOIN restock_request_fulfillments f ON f.request_id = r.id AND f.status IN ('open', 'picking') AND f.has_shortage = 1
      LEFT JOIN doctors d ON d.id = r.doctor_id
      LEFT JOIN users u ON u.id = r.assigned_to_user_id
      WHERE r.status = 'accepted'
      ORDER BY datetime(r.collection_date) ASC, datetime(r.created_at) ASC
    `)
    .all();
  const pickToday = db
    .prepare(`
      SELECT r.*, d.full_name AS doctor_name, u.full_name AS assigned_to_name
      FROM restock_requests r
      LEFT JOIN restock_request_fulfillments f ON f.request_id = r.id AND f.status IN ('open', 'picking')
      LEFT JOIN doctors d ON d.id = r.doctor_id
      LEFT JOIN users u ON u.id = r.assigned_to_user_id
      WHERE r.status = 'accepted'
        AND NOT EXISTS (
          SELECT 1 FROM restock_request_amendments a WHERE a.request_id = r.id AND a.status = 'pending'
        )
        AND (f.id IS NULL OR f.has_shortage = 0 OR r.partial_fulfilment_approved = 1)
      ORDER BY datetime(r.collection_date) ASC, datetime(r.created_at) ASC
    `)
    .all();
  const awaiting = db
    .prepare(`
      SELECT r.*, d.full_name AS doctor_name, u.full_name AS assigned_to_name
      FROM restock_requests r
      LEFT JOIN doctors d ON d.id = r.doctor_id
      LEFT JOIN users u ON u.id = r.assigned_to_user_id
      WHERE r.status = 'ready'
      ORDER BY datetime(r.collection_date) ASC, datetime(r.created_at) ASC
    `)
    .all();
  const linkage = db
    .prepare(`
      SELECT r.*, d.full_name AS doctor_name
      FROM restock_requests r
      LEFT JOIN doctors d ON d.id = r.doctor_id
      WHERE r.status IN ('accepted', 'ready')
        AND NOT EXISTS (
          SELECT 1 FROM restock_request_fulfillments f
          WHERE f.request_id = r.id AND f.status IN ('open', 'picking', 'packed', 'posted')
        )
      ORDER BY datetime(r.created_at) ASC
    `)
    .all();
  const incomingRows = db
    .prepare(`
      SELECT * FROM inventory_shipments WHERE status = 'pending' ORDER BY imported_at ASC, id ASC
    `)
    .all();
  const varianceRows = db
    .prepare(`
      SELECT * FROM inventory_stocktake_sessions WHERE status = 'submitted' ORDER BY submitted_at ASC, id ASC
    `)
    .all();
  const incoming = incomingRows.length;
  const variances = varianceRows.length;

  function decorate(rows, nextAction) {
    return rows.map((row) => ({
      id: row.id,
      doctor_id: row.doctor_id,
      doctor_name: row.doctor_name,
      collection_date: row.collection_date,
      created_at: row.created_at,
      status: row.status,
      assigned_to_user_id: row.assigned_to_user_id,
      assigned_to_name: row.assigned_to_name || null,
      item_count: Number(
        db.prepare("SELECT COUNT(*) AS count FROM restock_request_items WHERE request_id = ?").get(row.id)
          ?.count || 0,
      ),
      has_shortage: Boolean(
        db.prepare(`
          SELECT has_shortage FROM restock_request_fulfillments
          WHERE request_id = ? AND status IN ('open', 'picking', 'packed')
          ORDER BY id DESC LIMIT 1
        `).get(row.id)?.has_shortage,
      ),
      overdue: row.collection_date && String(row.collection_date) < getTodayLocal(),
      next_action: nextAction,
    }));
  }

  return {
    new_requests: decorate(pending, "Accept and reserve"),
    changes: decorate(changes, "Review change request"),
    shortages: decorate(shortages, "Resolve shortage"),
    pick_today: decorate(pickToday, "Pick pack"),
    awaiting_collection: decorate(awaiting, "Waiting for doctor"),
    fulfilment_linkage_required: decorate(linkage, "Reconcile fulfilment"),
    incoming_shipments: incomingRows,
    count_variances: varianceRows,
    counts: {
      new_requests: pending.length,
      changes: changes.length,
      shortages: shortages.length,
      pick_today: pickToday.length,
      awaiting_collection: awaiting.length,
      incoming_shipments: incoming,
      count_variances: variances,
      fulfilment_linkage_required: linkage.length,
    },
  };
}

function productivityMetrics() {
  const rows = db
    .prepare(`
      SELECT
        created_at, accepted_at, ready_at, completed_at, collection_date,
        partial_fulfilment_approved
      FROM restock_requests
      WHERE status IN ('completed', 'cancelled', 'ready', 'accepted')
    `)
    .all();
  function median(values) {
    const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!nums.length) return null;
    const mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  }
  function hoursBetween(from, to) {
    if (!from || !to) return null;
    const a = new Date(from).getTime();
    const b = new Date(to).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return (b - a) / 36e5;
  }
  const completed = rows.filter((row) => row.completed_at);
  const onTime = completed.filter(
    (row) => row.collection_date && String(row.completed_at).slice(0, 10) <= String(row.collection_date),
  );
  const shortageCount = Number(
    db.prepare(`SELECT COUNT(*) AS count FROM restock_request_fulfillments WHERE has_shortage = 1`).get()
      ?.count || 0,
  );
  const requestCount = Number(db.prepare(`SELECT COUNT(*) AS count FROM restock_requests`).get()?.count || 0);
  const emergencyCount = Number(
    db
      .prepare(`
        SELECT COUNT(*) AS count FROM inventory_audit_logs
        WHERE action_type IN ('emergency_stock_transfer', 'restock_my_inventory')
          AND meta_json LIKE '%emergency_override%'
      `)
      .get()?.count || 0,
  );
  const missingExpiry = Number(
    db
      .prepare(`
        SELECT COUNT(*) AS count FROM inventory_batches
        WHERE quantity_remaining > 0 AND expiry_date IS NULL AND COALESCE(is_non_expiring, 0) = 0
      `)
      .get()?.count || 0,
  );
  const liveBatches = Number(
    db.prepare(`SELECT COUNT(*) AS count FROM inventory_batches WHERE quantity_remaining > 0`).get()?.count || 0,
  );

  return {
    median_request_to_accept_hours: median(rows.map((row) => hoursBetween(row.created_at, row.accepted_at))),
    median_accept_to_ready_hours: median(rows.map((row) => hoursBetween(row.accepted_at, row.ready_at))),
    median_ready_to_collection_hours: median(
      completed.map((row) => hoursBetween(row.ready_at, row.completed_at)),
    ),
    on_time_collection_rate: completed.length ? onTime.length / completed.length : null,
    full_first_fill_rate: requestCount
      ? (requestCount - shortageCount) / requestCount
      : null,
    shortage_rate: requestCount ? shortageCount / requestCount : null,
    emergency_override_count: emergencyCount,
    missing_expiry_rate: liveBatches ? missingExpiry / liveBatches : null,
  };
}

module.exports = {
  HttpError,
  activeFulfilment,
  allocateFefo,
  assertCanMarkReady,
  assignRequest,
  availableToPromise,
  applyPicking,
  fulfilmentDetail,
  lockPackedFulfilment,
  postCollectionTransfer,
  productivityMetrics,
  reconcileLegacyFulfilment,
  releaseReservations,
  replaceReservationsForAmendment,
  reserveAcceptedRequest,
  resolveOcsItem,
  resolveShortages,
  workQueues,
};
