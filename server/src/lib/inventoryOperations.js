"use strict";

const crypto = require("crypto");
const { db } = require("../db");
const { getTodayLocal, toNumber } = require("./utils");
const { updateInventoryQuantity } = require("./inventoryQuantity");
const { publishInventoryChange, publishInventoryResyncBroadcast } = require("./inventoryRealtime");
const { isEnvTrue } = require("./envFlags");
const { availableToPromise, consumeAvailableFefo, listImpactedActiveRequests, reduceReservationsForCorrection, reservedQuantityForItem } = require("./restockFulfilment");
const { decorateInventoryItems } = require("./inventoryStockState");
const { resolveAuditActor, isAutomatedMovementMeta } = require("./auditActor");
const { isValidIsoCalendarDate } = require("./calendarDate");
const { recordMovementAllocations } = require("./inventoryMovementAllocations");

const CSV_REQUIRED_HEADERS = [
  "folder",
  "item_name",
  "quantity",
  "cost_price",
  "expiry_date",
];
const WRITE_OFF_REASONS = ["Expired", "Discontinued", "Damaged"];

function HttpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, extra });
}

function roundCurrency(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function storedTimestampMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function latestStoredTimestamp(values = []) {
  const latest = values.reduce((current, value) => {
    const timestamp = storedTimestampMs(value);
    return timestamp !== null && timestamp > current ? timestamp : current;
  }, -1);
  return latest >= 0 ? new Date(latest).toISOString() : null;
}

function mauritiusMonthKey(timestamp) {
  return new Date(timestamp + 4 * 60 * 60 * 1000).toISOString().slice(0, 7);
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
  return isValidIsoCalendarDate(value);
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
  if (!Number.isInteger(qty) || !Number.isFinite(qty) || qty <= 0) errors.push("Quantity must be a positive whole number greater than zero");
  const nonExpiring = Number(row.is_non_expiring || 0) === 1 || parseNonExpiringFlag(row.is_non_expiring);
  const expiry = String(row.expiry_date || "").trim();
  if (!nonExpiring && !expiry) {
    errors.push("Expiry date or explicit non-expiring flag required");
  }
  if (!nonExpiring && expiry) {
    if (!isIsoDate(expiry)) {
      errors.push("Expiry date must be a valid calendar date (YYYY-MM-DD)");
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

function lastKnownBatchIdentity(itemId) {
  const today = getTodayLocal();
  const batches = db
    .prepare(
      `
      SELECT expiry_date, unit_cost, is_non_expiring, status
      FROM inventory_batches
      WHERE item_id = ? AND quantity_remaining > 0
      ORDER BY id DESC
    `,
    )
    .all(Number(itemId));
  const item = db.prepare("SELECT cost_price FROM inventory WHERE id = ?").get(Number(itemId));
  const preferred =
    batches.find((row) => {
      if (String(row.status || "usable").trim().toLowerCase() === "quarantined") return false;
      if (Number(row.is_non_expiring || 0) === 1) return true;
      const expiry = row.expiry_date ? String(row.expiry_date).slice(0, 10) : null;
      if (expiry && expiry < today) return false;
      return true;
    }) || null;
  const unitCost = Number(preferred?.unit_cost || 0) > 0
    ? Number(preferred.unit_cost)
    : Number(item?.cost_price || 0);
  return {
    unit_cost: unitCost,
    expiry_date: preferred?.expiry_date || null,
    is_non_expiring: Number(preferred?.is_non_expiring || 0) === 1 ? 1 : 0,
  };
}

function listWriteOffBatches(itemId) {
  const today = getTodayLocal();
  return db
    .prepare(
      `
      SELECT id, quantity_remaining, expiry_date, unit_cost, is_non_expiring,
        COALESCE(status, 'usable') AS status
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
        missing_expiry:
          Number(row.is_non_expiring || 0) !== 1 &&
          !(row.expiry_date && String(row.expiry_date).trim()),
        expired:
          Boolean(row.expiry_date) &&
          Number(row.is_non_expiring || 0) !== 1 &&
          String(row.expiry_date) < today,
        quarantined: String(row.status || "usable") === "quarantined",
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
  const stockState = decorateInventoryItems([
    {
      id: itemId,
      quantity: onHand,
    },
  ])[0];
  const availableToUse = Number(stockState?.available_to_use || 0);
  const batches = includeExpired
    ? listWriteOffBatches(itemId)
    : listWriteOffBatches(itemId).filter((row) => !row.expired && !row.quarantined);
  // Dispatch and use may include lots that still need cost or expiry details.
  // Write-offs and corrections can also touch expired or quarantined lots so
  // unusable physical stock can still be reconciled.
  const available = includeExpired
    ? batches.reduce((sum, row) => sum + Number(row.available || 0), 0)
    : availableToUse;
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
    expired_quantity: Number(stockState?.expired_quantity || 0),
    available_to_use: availableToUse,
    available_to_transfer: available,
    requested_quantity: qty,
    resulting_quantity: onHand - allocated,
    can_fulfil: remaining === 0 && allocated <= available,
    remaining,
    estimated_value: estimatedValue,
    allocations,
  };
}

function findOcsCatalogueItemByName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return null;
  return (
    db
      .prepare(
        `
        SELECT *
        FROM inventory
        WHERE stock_scope = 'ocs'
          AND owner_doctor_id IS NULL
          AND archived_at IS NULL
          AND LOWER(TRIM(item_name)) = LOWER(TRIM(?))
        ORDER BY id ASC
        LIMIT 1
      `,
      )
      .get(trimmed) || null
  );
}

function consumeAllocatedBatches(allocations) {
  for (const allocation of allocations || []) {
    const take = Number(allocation.quantity || 0);
    if (take <= 0) continue;
    const batch = db.prepare("SELECT * FROM inventory_batches WHERE id = ?").get(allocation.batch_id);
    if (!batch) throw HttpError(409, "A selected batch no longer has enough quantity.");
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
        .get(allocation.batch_id)?.total || 0,
    );
    const available = Math.max(0, Number(batch.quantity_remaining || 0) - reserved);
    if (available < take) {
      throw HttpError(409, "A selected batch no longer has enough unreserved quantity.");
    }
    const updated = db
      .prepare(
        `UPDATE inventory_batches
         SET quantity_remaining = quantity_remaining - ?,
             row_version = COALESCE(row_version, 1) + 1
         WHERE id = ?
           AND quantity_remaining >= ?
           AND COALESCE(row_version, 1) = ?`,
      )
      .run(take, allocation.batch_id, take, Number(batch.row_version || 1));
    if (!updated.changes) {
      throw HttpError(409, "A selected batch was updated concurrently. Retry the operation.");
    }
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

function previewReservationImpact(inventoryId, reduceBy) {
  const needed = Math.max(0, Math.floor(Number(reduceBy) || 0));
  const impacted = listImpactedActiveRequests(inventoryId);
  let remaining = needed;
  return impacted.map((row) => {
    const reserved = Number(row.reserved_quantity || 0);
    const requested = Number(row.requested_quantity || 0);
    let reduced = 0;
    if (!row.blocking && remaining > 0 && reserved > 0) {
      reduced = Math.min(reserved, remaining);
      remaining -= reduced;
    }
    const nextReserved = reserved - reduced;
    return {
      request_id: row.request_id,
      request_number: row.request_id,
      doctor_name: row.doctor_name || "Doctor",
      reserved_quantity: reserved,
      picked_quantity: Number(row.picked_quantity || 0),
      fulfilled_quantity: Number(row.fulfilled_quantity || 0),
      requested_quantity: requested,
      status: row.status,
      blocking: Boolean(row.blocking),
      reduced_quantity: reduced,
      remaining_reserved: nextReserved,
      resulting_shortage: Math.max(0, requested - nextReserved),
    };
  });
}

function resolveCorrectionQuantity(item, { nextQuantity = null, delta = null } = {}) {
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
  return { previous, next, change: next - previous };
}

function previewExceptionalCorrection({ itemId, nextQuantity = null, delta = null }) {
  const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(Number(itemId));
  if (!item) throw HttpError(404, "Stock item not found.");
  const { previous, next, change } = resolveCorrectionQuantity(item, { nextQuantity, delta });
  const atp = availableToPromise(itemId);
  const reserved = reservedQuantityForItem(itemId);
  const shortageNeed = change < 0 ? Math.max(0, Math.abs(change) - atp) : 0;
  const impacted = previewReservationImpact(itemId, shortageNeed);
  const blocking = impacted.filter((row) => row.blocking);
  const affectsReservations = shortageNeed > 0 && blocking.length === 0;
  return {
    previous,
    next,
    change,
    available_to_promise: atp,
    reserved_quantity: reserved,
    row_version: Number(item.row_version || 1),
    quantity: previous,
    affects_reservations: affectsReservations,
    requires_affect_reservations: affectsReservations,
    can_apply: blocking.length === 0 || change >= 0,
    blocking_requests: blocking,
    impacted_requests: impacted,
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
  affectReservations = false,
  expectedRowVersion = null,
  expectedQuantity = null,
  batchCost = null,
  batchExpiryDate = null,
  batchIsNonExpiring = false,
  batchReference = "",
  confirmBatchEvidence = false,
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
  if (
    expectedRowVersion != null &&
    expectedRowVersion !== "" &&
    Number(item.row_version || 1) !== Number(expectedRowVersion)
  ) {
    throw HttpError(409, "Inventory was updated on another device. Refresh and try again.");
  }
  if (
    expectedQuantity != null &&
    expectedQuantity !== "" &&
    Number(item.quantity || 0) !== Number(expectedQuantity)
  ) {
    throw HttpError(409, "Inventory was updated on another device. Refresh and try again.");
  }
  const { previous, next, change } = resolveCorrectionQuantity(item, { nextQuantity, delta });
  if (change === 0) {
    return { item, previous, next, change: 0, idempotent: true, movementId: null };
  }
  let positiveBatch = null;
  if (change > 0) {
    const verifiedCost = roundCurrency(batchCost);
    const reference = String(batchReference || "").trim().slice(0, 200);
    if (!(verifiedCost > 0)) {
      throw HttpError(400, "Enter the verified unit cost for stock being added.");
    }
    if (reference.length < 3) {
      throw HttpError(400, "Enter the receipt, count sheet, or evidence reference for stock being added.");
    }
    if (confirmBatchEvidence !== true && confirmBatchEvidence !== "true") {
      throw HttpError(400, "Confirm that the batch cost and expiry details were verified from source evidence.");
    }
    const expiry = validateReceiptExpiry({
      expiryDate: batchExpiryDate,
      isNonExpiring: parseNonExpiringFlag(batchIsNonExpiring),
    });
    positiveBatch = {
      unitCost: verifiedCost,
      expiryDate: expiry.expiryDate,
      isNonExpiring: expiry.isNonExpiring,
      reference,
    };
  }
  const impacted = listImpactedActiveRequests(itemId);
  const blocking = impacted.filter((row) => row.blocking);
  if (change < 0 && blocking.length) {
    const error = HttpError(
      409,
      "Cannot correct stock reserved by a picked or Supply Ready request. Resolve those requests first.",
    );
    error.impacted_requests = impacted;
    throw error;
  }
  if (change < 0) {
    const available = availableToPromise(itemId);
    if (Math.abs(change) > available && !affectReservations) {
      const error = HttpError(
        409,
        `Cannot correct below reserved stock. ${available} unit(s) are available to adjust; ${Math.abs(change)} requested.`,
      );
      error.impacted_requests = impacted;
      throw error;
    }
  }

  const result = db.transaction(() => {
    const locked = db.prepare("SELECT * FROM inventory WHERE id = ?").get(Number(itemId));
    const lockedPrev = Number(locked.quantity || 0);
    if (lockedPrev === next) {
      return { item: locked, previous: lockedPrev, next, change: 0, idempotent: true, movementId: null };
    }
    const lockedChange = next - lockedPrev;
    let allocations = [];
    let reservationAdjustments = { reduced: 0, request_ids: [], lines: [] };
    if (lockedChange < 0) {
      const liveImpacted = listImpactedActiveRequests(itemId);
      const liveBlocking = liveImpacted.filter((row) => row.blocking);
      if (liveBlocking.length) {
        const error = HttpError(
          409,
          "Cannot correct stock reserved by a picked or Supply Ready request. Resolve those requests first.",
        );
        error.impacted_requests = liveImpacted;
        throw error;
      }
      const available = availableToPromise(itemId);
      if (Math.abs(lockedChange) > available) {
        if (!affectReservations) {
          const error = HttpError(
            409,
            `Cannot correct below reserved stock. ${available} unit(s) are available to adjust; ${Math.abs(lockedChange)} requested.`,
          );
          error.impacted_requests = liveImpacted;
          throw error;
        }
        reservationAdjustments = reduceReservationsForCorrection(itemId, Math.abs(lockedChange) - available, {
          actor,
          reason: trimmedReason,
        });
      }
      const consumeQty = Math.abs(lockedChange);
      const preview = previewAllocations(itemId, consumeQty, { includeExpired: true });
      if (!preview.can_fulfil) {
        throw HttpError(409, "Insufficient unreserved batch quantity for this correction.");
      }
      consumeAllocatedBatches(preview.allocations);
      allocations = preview.allocations;
    } else {
      db.prepare(
        `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        itemId,
        lockedChange,
        positiveBatch.expiryDate,
        positiveBatch.unitCost,
        positiveBatch.isNonExpiring ? 1 : 0,
      );
      allocations = [
        {
          batch_id: Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0),
          quantity: lockedChange,
          expiry_date: positiveBatch.expiryDate,
          is_non_expiring: positiveBatch.isNonExpiring,
          unit_cost: positiveBatch.unitCost,
        },
      ];
    }
    const qtyUpdate = updateInventoryQuantity(itemId, next, {
      expectedVersion: Number(locked.row_version || 1),
    });
    if (!qtyUpdate.ok) {
      throw HttpError(409, "Inventory was updated on another device. Refresh and try again.");
    }
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
        affect_reservations: Boolean(affectReservations),
        impact_reservations: Boolean(affectReservations),
        impacted_requests: listImpactedActiveRequests(itemId),
        reservation_adjustments: reservationAdjustments,
        allocations,
        batch_evidence_reference: positiveBatch?.reference || null,
        source_location: "Master Stock",
        destination_location: "Exceptional correction",
      }),
    });
    if (allocations.length) {
      recordMovementAllocations(movementId, allocations);
    }
    publishInventoryResyncBroadcast({ reason: "exceptional_correction" });
    return {
      item: db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId),
      previous: lockedPrev,
      next,
      change: lockedChange,
      idempotent: false,
      movementId,
      allocations,
      impacted_requests: listImpactedActiveRequests(itemId),
      reservation_adjustments: reservationAdjustments,
      notify_request_ids: reservationAdjustments.request_ids || [],
    };
  })();
  return result;
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
  const actorName = resolveAuditActor({
    displayName: meta.performed_by_name,
    userId: userId || meta.performed_by_user_id,
    automated: isAutomatedMovementMeta(meta) && !(userId || meta.performed_by_user_id),
    required: true,
  });
  db.prepare(`
    INSERT INTO inventory_activity_history (
      movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type, item_name,
      quantity, direction, source_text, destination_text, batch_id, meta_json
    ) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movementId || null,
    userId || meta.performed_by_user_id || null,
    actorName,
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
  const qty = Number(quantity || 0);
  if (!Number.isInteger(qty) || qty <= 0) {
    return { ok: true, remaining: 0, allocations: [] };
  }
  try {
    const result = consumeAvailableFefo(itemId, qty);
    return { ok: true, remaining: 0, allocations: result.allocations };
  } catch (error) {
    if (error.status === 409) {
      return { ok: false, remaining: qty, allocations: [], error: error.message };
    }
    throw error;
  }
}

function matchCatalogueForStagingRow(row) {
  const catalogue = findOcsCatalogueItemByName(row.item_name);
  if (!catalogue) {
    return {
      error: `Catalogue action required: "${row.item_name}" is not an approved catalogue item.`,
      catalogue_action_required: true,
    };
  }
  if (row.folder_id && Number(catalogue.folder_id) !== Number(row.folder_id)) {
    const folderName =
      db.prepare("SELECT name FROM inventory_folders WHERE id = ?").get(catalogue.folder_id)?.name ||
      "another folder";
    return {
      error: `Folder mismatch: "${catalogue.item_name}" belongs to ${folderName}, not the imported folder.`,
      catalogue_action_required: false,
      folder_mismatch: true,
      catalogue,
    };
  }
  return { catalogue };
}

function upsertOcsFromStaging(row) {
  const match = matchCatalogueForStagingRow(row);
  if (match.error) {
    throw HttpError(409, match.error);
  }
  const existing = match.catalogue;
  const qty = Number(row.quantity || 0);
  const prev = Number(existing.quantity || 0);
  const next = prev + qty;
  updateInventoryQuantity(existing.id, next);
  return { id: Number(existing.id), previous: prev, next, created: false, item: existing };
}

function releaseStagingRows({ rows, userId, shipmentId = null, actor = {} }) {
  const pending = rows.filter((row) => String(row.status) === "pending");
  for (const row of pending) {
    const errors = stagingRowErrors(row);
    if (errors.length) {
      throw HttpError(400, `${row.item_name || "Row"}: ${errors.join("; ")}`);
    }
  }
    const seen = new Set();
  for (const row of pending) {
    const id = Number(row.id);
    if (seen.has(id)) {
      throw HttpError(400, `Duplicate row_ids are not allowed: ${id}.`);
    }
    seen.add(id);
  }
  const receiptIdentity = shipmentReceiptIdentity(shipmentId);
  return db.transaction(() => {
    for (const row of pending) {
      const match = matchCatalogueForStagingRow(row);
      if (!match.catalogue) continue;
      const repeat = countedLotRepeatingShipment(match.catalogue.id, {
        supplierName: receiptIdentity.supplier_name,
        receivedDate: receiptIdentity.received_date,
        quantity: Number(row.quantity || 0),
      });
      if (!repeat) continue;
      const countLabel = repeat.session_id ? `stock count #${repeat.session_id}` : "a stock count";
      throw HttpError(
        409,
        `${match.catalogue.item_name}: ${repeat.quantity} from ${receiptIdentity.supplier_name} on ${receiptIdentity.received_date} was already added from ${countLabel}. Leave this line out of Receive Delivery, or the shelf will count the same delivery twice.`,
      );
    }
    const transactionId = createTransferTransactionId();
    const movementIds = [];
    const releasedIds = [];
    for (const row of pending) {
      const claimed = db
        .prepare(
          `
          UPDATE inventory_staging
          SET
            status = 'released',
            released_by_user_id = ?,
            released_at = CURRENT_TIMESTAMP,
            release_transaction_id = ?
          WHERE id = ? AND status = 'pending'
        `,
        )
        .run(userId, transactionId, row.id);
      if (!claimed.changes) {
        const current = db.prepare("SELECT status FROM inventory_staging WHERE id = ?").get(row.id);
        if (String(current?.status) === "released") {
          continue;
        }
        throw HttpError(409, `Shipment line #${row.id} is no longer pending and cannot be released.`);
      }
      const result = upsertOcsFromStaging(row);
      const insertedBatch = db.prepare(`
        INSERT INTO inventory_batches (
          item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, supplier_name, received_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.id,
        Number(row.quantity || 0),
        Number(row.is_non_expiring || 0) === 1 ? null : row.expiry_date || null,
        roundCurrency(row.cost_price || 0),
        Number(row.is_non_expiring || 0) === 1 ? 1 : 0,
        receiptIdentity.supplier_name,
        receiptIdentity.received_date,
      );
      const batchId = Number(insertedBatch.lastInsertRowid);
      db.prepare(`
        UPDATE inventory_staging
        SET released_inventory_id = ?, released_batch_id = ?
        WHERE id = ?
      `).run(result.id, batchId, row.id);
      const movementId = recordOpsMovement({
        itemId: result.id,
        movementType: "in",
        quantity: Number(row.quantity || 0),
        previousQuantity: result.previous,
        nextQuantity: result.next,
        actionType: "add",
        note: shipmentId ? `Added from Receive Delivery #${shipmentId}` : "Released from staging",
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
          source_location: "Receive Delivery",
          destination_location: "Master Stock",
        },
      });
      recordMovementAllocations(movementId, [{
        batch_id: batchId,
        quantity: Number(row.quantity || 0),
        expiry_date: Number(row.is_non_expiring || 0) === 1 ? null : row.expiry_date || null,
        unit_cost: roundCurrency(row.cost_price || 0),
      }]);
      movementIds.push(movementId);
      releasedIds.push(Number(row.id));
    }
    return { transactionId, movementIds, released: releasedIds.length, released_ids: releasedIds };
  })();
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

function shipmentQueueStats(shipments = listShipments(), { now = Date.now() } = {}) {
  const incoming = shipments.filter((row) => row.in_incoming_queue);
  const receivedShipments = shipments
    .map((shipment) => {
      const releasedAt = latestStoredTimestamp([
        shipment.released_at,
        ...(shipment.lines || []).map((line) => line.released_at),
      ]);
      return { shipment, releasedAt, timestamp: storedTimestampMs(releasedAt) };
    })
    .filter((entry) => entry.timestamp !== null);
  const currentMonth = mauritiusMonthKey(now);
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
    received_this_month: receivedShipments.filter(
      (entry) => mauritiusMonthKey(entry.timestamp) === currentMonth,
    ).length,
    last_received_at: latestStoredTimestamp(receivedShipments.map((entry) => entry.releasedAt)),
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
  if (!shipment) throw HttpError(404, "Receive Delivery record not found.");
  const entries = Array.isArray(lines) ? lines : [];
  if (!entries.length) throw HttpError(400, "Select at least one Receive Delivery line to exclude.");
  db.transaction(() => {
    for (const entry of entries) {
      const reason = String(entry?.reason || "").trim();
      if (reason.length < 3) {
        throw HttpError(400, "Excluded Receive Delivery lines require a reason.");
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
        throw HttpError(409, "Only pending Receive Delivery lines can be excluded.");
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

function releasedLinesForTransaction(shipment, transactionId) {
  const tx = String(transactionId || "");
  if (!tx) return [];
  return (shipment.lines || []).filter(
    (line) => String(line.status) === "released" && String(line.release_transaction_id || "") === tx,
  );
}

function buildReleaseReceipt(shipment, transactionId, lines) {
  const quantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const value = lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.cost_price || 0),
    0,
  );
  return {
    kind: "release_receipt",
    shipment_id: shipment.id,
    transaction_id: transactionId,
    total_rows: lines.length,
    total_quantity: quantity,
    total_value: roundCurrency(value),
    supplier: shipment.supplier || "",
    delivery_note: shipment.delivery_note || "",
    released_at: lines[0]?.released_at || shipment.released_at || null,
    released_by_user_id: lines[0]?.released_by_user_id || shipment.released_by_user_id || null,
    lines: lines.map((line) => ({
      shipment_id: shipment.id,
      staging_row_id: Number(line.id),
      release_transaction_id: transactionId,
      inventory_item_id: line.released_inventory_id || null,
      batch_id: line.released_batch_id || null,
      item_name: line.item_name,
      quantity: Number(line.quantity || 0),
      unit_cost: roundCurrency(line.cost_price || 0),
      total_value: roundCurrency(Number(line.quantity || 0) * Number(line.cost_price || 0)),
      expiry_date: line.expiry_date || null,
      is_non_expiring: Number(line.is_non_expiring || 0) === 1,
      supplier: shipment.supplier || "",
      delivery_note: shipment.delivery_note || "",
      released_by_user_id: line.released_by_user_id || null,
      released_at: line.released_at || null,
    })),
  };
}

function shipmentReceipt(shipment, released = {}) {
  const transactionId = released.transactionId || released.transaction_id || null;
  if (!transactionId) return null;
  return buildReleaseReceipt(shipment, transactionId, releasedLinesForTransaction(shipment, transactionId));
}

function shipmentCumulativeSummary(shipment) {
  const lines = (shipment.lines || []).filter((line) => String(line.status) === "released");
  const quantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const value = lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.cost_price || 0),
    0,
  );
  const transactionIds = [
    ...new Set(lines.map((line) => line.release_transaction_id).filter(Boolean)),
  ];
  return {
    kind: "shipment_summary",
    shipment_id: shipment.id,
    transaction_ids: transactionIds,
    total_rows: lines.length,
    total_quantity: quantity,
    total_value: roundCurrency(value),
    released_at: shipment.released_at || null,
  };
}

function originalReceiptForRowIds(shipment, ids) {
  const selected = new Set((ids || []).map(Number));
  const lines = (shipment.lines || []).filter((line) => selected.has(Number(line.id)));
  const txIds = [...new Set(lines.map((line) => line.release_transaction_id).filter(Boolean))];
  if (txIds.length === 1) {
    return {
      transactionId: txIds[0],
      receipt: shipmentReceipt(shipment, { transactionId: txIds[0] }),
    };
  }
  return { transactionId: null, receipt: null };
}

function bulkReleaseShipment({ shipmentId, rowIds, userId, actor, requireSelection = false }) {
  const shipment = getShipment(shipmentId);
  if (!shipment) throw HttpError(404, "Receive Delivery record not found.");
  const summary = () => shipmentCumulativeSummary(getShipment(shipment.id) || shipment);
  if (shipment.status === "released" && !requireSelection) {
    const releasedIds = (shipment.lines || [])
      .filter((line) => String(line.status) === "released")
      .map((line) => Number(line.id));
    const original = originalReceiptForRowIds(shipment, releasedIds);
    return {
      shipment,
      idempotent: true,
      transactionId: original.transactionId,
      receipt: original.receipt,
      summary: summary(),
    };
  }
  const incomingIds = Array.isArray(rowIds) ? rowIds : [];
  const normalizedIds = incomingIds
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  if (requireSelection) {
    if (!incomingIds.length) {
      throw HttpError(400, "row_ids is required and must contain at least one Receive Delivery line.");
    }
    const invalid = incomingIds.filter((id) => !Number.isInteger(Number(id)) || Number(id) <= 0);
    if (invalid.length) {
      throw HttpError(400, "row_ids must be a non-empty array of positive integers.");
    }
    const selectedIds = incomingIds.map(Number);
    const seen = new Set();
    const duplicates = [];
    for (const id of selectedIds) {
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }
    if (duplicates.length) {
      throw HttpError(400, `Duplicate row_ids are not allowed: ${[...new Set(duplicates)].join(", ")}.`);
    }
    const byId = new Map((shipment.lines || []).map((line) => [Number(line.id), line]));
    const missing = [];
    const ineligible = [];
    const alreadyReleased = [];
    const excluded = [];
    const selectedPending = [];
    for (const id of selectedIds) {
      const line = byId.get(id);
      if (!line) {
        missing.push(id);
        continue;
      }
      if (String(line.status) === "released") {
        alreadyReleased.push(id);
        continue;
      }
      if (String(line.status) === "excluded" || String(line.status) === "cancelled") {
        excluded.push(id);
        continue;
      }
      if (String(line.status) !== "pending" || (line.validation_errors || stagingRowErrors(line)).length) {
        ineligible.push(id);
        continue;
      }
      selectedPending.push(line);
    }
    if (missing.length) {
      throw HttpError(400, `Selected row(s) do not belong to Receive Delivery #${shipmentId}: ${missing.join(", ")}.`);
    }
    if (ineligible.length) {
      throw HttpError(400, `Selected row(s) are not eligible for release: ${ineligible.join(", ")}.`);
    }
    if (excluded.length) {
      throw HttpError(
        400,
        `Selected row(s) are excluded and cannot be released: ${excluded.join(", ")}.`,
      );
    }
    if (!selectedPending.length && alreadyReleased.length === selectedIds.length) {
      const original = originalReceiptForRowIds(shipment, alreadyReleased);
      return {
        shipment,
        idempotent: true,
        released: 0,
        released_ids: [],
        already_released: alreadyReleased,
        invalid: [],
        excluded,
        transactionId: original.transactionId,
        receipt: original.receipt,
        summary: shipmentCumulativeSummary(shipment),
      };
    }
    if (!selectedPending.length) {
      throw HttpError(400, "No valid pending rows selected for release.");
    }
    const released = releaseStagingRows({
      rows: selectedPending,
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
      released: released.released,
      released_ids: released.released_ids,
      already_released: alreadyReleased,
      invalid: ineligible,
      excluded,
      receipt: shipmentReceipt(next, released),
      summary: shipmentCumulativeSummary(next),
    };
  }
  const selected = (shipment.lines || []).filter((line) => {
    if (line.status !== "pending") return false;
    if ((line.validation_errors || stagingRowErrors(line)).length) return false;
    if (normalizedIds.length) return normalizedIds.includes(Number(line.id));
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
    summary: shipmentCumulativeSummary(next),
  };
}

function createShipmentFromImport({ supplier = "", deliveryNote = "", receivedDate = null, operationId, userId, rows, skipped }) {
  const info = db
    .prepare(`
      INSERT INTO inventory_shipments (
        supplier, delivery_note, received_date, operation_id, status, total_rows, valid_rows, rejected_rows, imported_by_user_id
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `)
    .run(
      supplier,
      deliveryNote,
      receivedDate,
      operationId,
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

function isShipmentHintRow(row) {
  const folder = String(row.folder || "").trim().toLowerCase();
  const name = String(row.item_name || "").trim().toLowerCase();
  return folder.startsWith("pick the shelf") || name.startsWith("exact name from the catalogue");
}

function isBlankShipmentRow(row) {
  return !String(row.folder || "").trim()
    && !String(row.item_name || "").trim()
    && !String(row.quantity || "").trim()
    && !String(row.expiry_date || "").trim();
}

function parseShipmentRecords(headers, records) {
  const folderMap = new Map(
    db
      .prepare("SELECT id, name FROM inventory_folders")
      .all()
      .map((folder) => [String(folder.name || "").toLowerCase(), folder]),
  );

  const parsed = [];
  const seen = new Map();
  records.forEach((record) => {
    const row = record.row;
    const lineNumber = record.line;
    const folder = folderMap.get(String(row.folder || "").toLowerCase());
    const qty = Number(row.quantity || 0);
    const nonExpiring = parseNonExpiringFlag(row.non_expiring || row.is_non_expiring || row.expiry_date);
    const expiryRaw = nonExpiring ? "" : String(row.expiry_date || "").trim();
    const errors = [];
    if (!folder) errors.push(row.folder ? `Unknown folder "${row.folder}"` : "Missing folder");
    if (!String(row.item_name || "").trim()) errors.push("Missing item name");
    if (!Number.isInteger(qty) || !Number.isFinite(qty) || qty <= 0) errors.push("Quantity must be a positive whole number greater than zero");
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
    const catalogueMatch = matchCatalogueForStagingRow({
      item_name: String(row.item_name || "").trim(),
      folder_id: folder?.id || null,
    });
    if (catalogueMatch.error) {
      errors.push(catalogueMatch.error);
    }
    const catalogue = catalogueMatch.catalogue;
    const costRaw = String(row.cost_price ?? "").trim();
    if (!costRaw) errors.push("Missing cost");
    else if (!/^\d+(\.\d+)?$/.test(costRaw)) errors.push("Cost must be a number");
    const cost = costRaw ? toNumber(row.cost_price, 0) : 0;
    const minimumRaw = String(row.minimum_quantity ?? "").trim();
    const unitRaw = String(row.unit ?? "").trim();
    const sellingRaw = String(row.selling_price ?? "").trim();
    parsed.push({
      line: lineNumber,
      folder_id: folder?.id || null,
      folder_name: folder?.name || row.folder || "",
      item_name: catalogueMatch.catalogue?.item_name || String(row.item_name || "").trim(),
      catalogue_item_id: catalogueMatch.catalogue?.id || null,
      catalogue_action_required: Boolean(catalogueMatch.catalogue_action_required),
      quantity: Number.isInteger(qty) && qty > 0 ? qty : Number(row.quantity || 0),
      minimum_quantity: minimumRaw ? (Number(minimumRaw) || 0) : (Number(catalogue?.minimum_quantity || 0) || 0),
      unit: unitRaw || catalogue?.unit || "unit",
      cost_price: cost,
      selling_price: sellingRaw ? toNumber(sellingRaw, 0) : toNumber(catalogue?.selling_price, 0),
      attributes: row.attributes || "",
      moa_notes: row.moa_notes || "",
      expiry_date: nonExpiring ? null : expiryRaw || null,
      is_non_expiring: nonExpiring ? 1 : 0,
      line_value: roundCurrency((Number.isInteger(qty) && qty > 0 ? qty : 0) * cost),
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

function parseCsvShipment(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw HttpError(400, "csv_text is required.");
  const lines = text.split(/\r?\n/).filter((line) => String(line || "").trim());
  if (!lines.length) throw HttpError(400, "csv_text is required.");
  const headers = splitCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
  const missing = CSV_REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw HttpError(400, `CSV missing headers: ${missing.join(", ")}`);
  const records = lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    return {
      line: index + 2,
      row: Object.fromEntries(headers.map((header, idx) => [header, values[idx] || ""])),
    };
  }).filter((record) => !isBlankShipmentRow(record.row) && !isShipmentHintRow(record.row));
  if (!records.length) throw HttpError(400, "CSV has no product rows.");
  return parseShipmentRecords(headers, records);
}

function loadWorkbookSheets(buffer) {
  const { spawnSync } = require("child_process");
  const path = require("path");
  const result = spawnSync(process.execPath, [path.join(__dirname, "readDeliverySheet.js")], {
    input: buffer,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw HttpError(400, "This file is not an Excel workbook. Use the .xlsx template.");
  }
  try {
    return JSON.parse(result.stdout.toString("utf8"));
  } catch {
    throw HttpError(400, "This file is not an Excel workbook. Use the .xlsx template.");
  }
}

function parseWorkbookShipment(buffer) {
  const sheets = loadWorkbookSheets(buffer);
  const sheet = sheets.find((candidate) => candidate.name === "Delivery")
    || sheets.find((candidate) => candidate.state !== "hidden")
    || sheets[0];
  if (!sheet) throw HttpError(400, "The Excel file has no Delivery sheet.");
  let headerRowNumber = null;
  let headers = [];
  for (const entry of sheet.rows || []) {
    if (entry.row > 8) break;
    const values = (entry.cells || []).map((value) => String(value || "").trim().toLowerCase());
    if (values.includes("folder") && values.includes("item_name")) {
      headerRowNumber = entry.row;
      headers = values;
      break;
    }
  }
  if (!headerRowNumber) throw HttpError(400, "The Delivery sheet is missing the column headings.");
  const missing = CSV_REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw HttpError(400, `Excel missing headers: ${missing.join(", ")}`);
  const records = [];
  for (const entry of sheet.rows || []) {
    if (entry.row <= headerRowNumber) continue;
    const cells = {};
    headers.forEach((header, index) => {
      if (!header) return;
      cells[header] = String(entry.cells?.[index] || "").trim();
    });
    if (isBlankShipmentRow(cells) || isShipmentHintRow(cells)) continue;
    records.push({ line: entry.row, row: cells });
  }
  if (!records.length) throw HttpError(400, "The Delivery sheet has no product rows.");
  return parseShipmentRecords(headers, records);
}

function parseShipmentUpload(body = {}) {
  const workbook = String(body.workbook_base64 || "").replace(/\s/g, "");
  if (workbook) {
    const buffer = Buffer.from(workbook, "base64");
    if (!buffer.length) throw HttpError(400, "The Excel file is empty.");
    return parseWorkbookShipment(buffer);
  }
  return parseCsvShipment(body.csv_text);
}

function csvShipmentTemplate() {
  return [
    CSV_REQUIRED_HEADERS.concat(["non_expiring"]).join(","),
    "Consumable,Gauze 10x10,20,12,2027-01-01,",
    "Consumable,Reusable tray,4,0,,yes",
  ].join("\n");
}

function canRevealStocktakeSystem(session, { role } = {}) {
  const status = String(session?.status || "");
  if (["draft", "in_progress"].includes(status)) return false;
  if (!["submitted", "approved", "rejected", "applied", "recount_required"].includes(status)) return false;
  return role === "admin" || role === "operator";
}

function snapshotInventoryForStocktake(item) {
  return {
    expected_row_version: Number(item.row_version || 1),
    expected_quantity: Number(item.quantity || 0),
  };
}

function lastOfficialStockCount(inventoryId) {
  const row = db
    .prepare(
      `
      SELECT si.physical_quantity AS quantity, s.applied_at, s.id AS session_id, s.movement_id_watermark
      FROM inventory_stocktake_session_items si
      JOIN inventory_stocktake_sessions s ON s.id = si.session_id
      WHERE si.inventory_id = ?
        AND s.status = 'applied'
        AND si.physical_quantity IS NOT NULL
      ORDER BY datetime(COALESCE(s.applied_at, s.reviewed_at, s.submitted_at, s.created_at)) DESC, s.id DESC
      LIMIT 1
    `,
    )
    .get(Number(inventoryId));
  if (!row) return null;
  return {
    quantity: Number(row.quantity),
    applied_at: row.applied_at || null,
    session_id: Number(row.session_id),
    movement_id_watermark: row.movement_id_watermark == null ? null : Number(row.movement_id_watermark),
  };
}

function parseMovementMeta(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function timestampOnOrAfter(value, afterAt) {
  if (!afterAt) return true;
  const current = storedTimestampMs(value);
  const bound = storedTimestampMs(afterAt);
  if (current == null || bound == null) return String(value || "") >= String(afterAt || "");
  return current >= bound;
}

function timestampOnOrBefore(value, beforeAt) {
  if (!beforeAt) return true;
  const current = storedTimestampMs(value);
  const bound = storedTimestampMs(beforeAt);
  if (current == null || bound == null) return String(value || "") <= String(beforeAt || "");
  return current <= bound;
}

function signedWarehouseMovementQuantity(row) {
  const qty = Number(row.quantity || 0);
  const type = String(row.movement_type || "");
  if (type === "out") return -qty;
  if (type === "in") return qty;
  const previous = Number(row.previous_quantity);
  const next = Number(row.next_quantity);
  if (Number.isFinite(previous) && Number.isFinite(next)) return next - previous;
  return qty;
}

function describeStocktakeIntervalMovement(row) {
  const meta = parseMovementMeta(row.meta_json);
  const qty = Number(row.quantity || 0);
  const signed = signedWarehouseMovementQuantity(row);
  const doctor = String(row.doctor_name || meta.doctor_name || meta.received_by_name || "").trim();
  const requestId = meta.request_id || (row.reference_type === "restock_request" ? row.reference_id : null);
  const action = String(row.action_type || "").toLowerCase();
  let summary = "";
  if (action === "restock_out") {
    summary = doctor ? `Dispatched ${qty} to ${doctor}` : `Dispatched ${qty} to a doctor`;
    if (requestId) summary += ` (supply request #${requestId})`;
  } else if (action === "stock_in" || action === "add") {
    const supplier = String(meta.supplier || "").trim();
    summary = supplier ? `Received ${qty} from ${supplier}` : `Received ${qty}`;
  } else if (["remove", "write_off", "expired"].includes(action)) {
    summary = `Written off ${qty}`;
  } else if (action === "adjustment") {
    summary = `Count adjustment ${signed > 0 ? "+" : ""}${signed}`;
  } else {
    const label = action.replace(/_/g, " ") || "Movement";
    summary = `${label} ${signed > 0 ? "+" : ""}${signed}`;
  }
  return {
    id: Number(row.id),
    created_at: row.created_at || null,
    action_type: action,
    quantity: qty,
    signed_quantity: signed,
    doctor_name: doctor || null,
    request_id: requestId ? Number(requestId) : null,
    summary,
    note: row.note || "",
  };
}

function loadStocktakeIntervalMovements(session, lines) {
  const ids = [...new Set((lines || []).map((row) => Number(row.inventory_id)).filter(Boolean))];
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `
      SELECT
        m.id, m.item_id, m.movement_type, m.quantity, m.previous_quantity, m.next_quantity,
        m.action_type, m.note, m.created_at, m.doctor_id, m.reference_type, m.reference_id, m.meta_json,
        d.full_name AS doctor_name
      FROM inventory_movements m
      LEFT JOIN doctors d ON d.id = COALESCE(
        m.doctor_id,
        CASE WHEN m.reference_type = 'doctor' THEN m.reference_id END
      )
      WHERE m.item_id IN (${placeholders})
      ORDER BY m.id ASC
    `,
    )
    .all(...ids);
  const sessionStart = session.started_at || session.created_at;
  const previousSessionIds = [
    ...new Set((lines || []).map((row) => Number(row.previous_count_session_id)).filter(Boolean)),
  ];
  const watermarks = new Map();
  if (previousSessionIds.length) {
    const sessionPlaceholders = previousSessionIds.map(() => "?").join(",");
    db.prepare(
      `SELECT id, movement_id_watermark FROM inventory_stocktake_sessions WHERE id IN (${sessionPlaceholders})`,
    )
      .all(...previousSessionIds)
      .forEach((row) => {
        watermarks.set(Number(row.id), row.movement_id_watermark == null ? null : Number(row.movement_id_watermark));
      });
  }
  const grouped = new Map();
  const linesByItem = new Map();
  for (const line of lines) {
    grouped.set(Number(line.inventory_id), []);
    linesByItem.set(Number(line.inventory_id), line);
  }
  for (const row of rows) {
    const itemId = Number(row.item_id);
    const line = linesByItem.get(itemId);
    if (!line || line.previous_count_quantity == null) continue;
    const meta = parseMovementMeta(row.meta_json);
    const stocktakeSessionId = Number(meta.stocktake_session_id || 0);
    if (stocktakeSessionId && stocktakeSessionId === Number(line.previous_count_session_id || 0)) continue;
    if (stocktakeSessionId && stocktakeSessionId === Number(session.id)) continue;
    const watermark = watermarks.get(Number(line.previous_count_session_id || 0));
    if (watermark != null) {
      if (Number(row.id) <= watermark) continue;
    } else if (!timestampOnOrAfter(row.created_at, line.previous_count_at)) {
      continue;
    }
    if (!timestampOnOrBefore(row.created_at, sessionStart)) continue;
    grouped.get(itemId).push(describeStocktakeIntervalMovement(row));
  }
  return grouped;
}

function loadStocktakeScopeItems({ folderId = null, itemIds = [], ownerDoctorId = null } = {}) {
  const scopedIds = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];
  const doctorId = Number(ownerDoctorId || 0) || null;
  if (scopedIds.length) {
    return scopedIds
      .map((id) =>
        doctorId
          ? db
              .prepare(
                `SELECT * FROM inventory WHERE id = ? AND stock_scope = 'doctor' AND owner_doctor_id = ? AND archived_at IS NULL`,
              )
              .get(Number(id), doctorId)
          : db
              .prepare(
                `SELECT * FROM inventory WHERE id = ? AND stock_scope = 'ocs' AND owner_doctor_id IS NULL AND archived_at IS NULL`,
              )
              .get(Number(id)),
      )
      .filter(Boolean);
  }
  if (doctorId) {
    return db
      .prepare(
        `
        SELECT * FROM inventory
        WHERE stock_scope = 'doctor'
          AND owner_doctor_id = ?
          AND archived_at IS NULL
          AND (? IS NULL OR folder_id = ?)
        ORDER BY item_name ASC
      `,
      )
      .all(doctorId, folderId || null, folderId || null);
  }
  return db
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

function stocktakeScopeFingerprint(items, { folderId = null, itemIds = [], ownerDoctorId = null } = {}) {
  const payload = {
    folder_id: folderId ? Number(folderId) : null,
    owner_doctor_id: ownerDoctorId ? Number(ownerDoctorId) : null,
    requested_item_ids: (Array.isArray(itemIds) ? itemIds : [])
      .map((id) => Number(id))
      .filter(Boolean)
      .sort((a, b) => a - b),
    items: (items || [])
      .map((item) => ({
        id: Number(item.id),
        folder_id: Number(item.folder_id || 0),
        row_version: Number(item.row_version || 1),
        archived_at: item.archived_at || null,
      }))
      .sort((a, b) => a.id - b.id),
  };
  return {
    item_count: payload.items.length,
    scope_token: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    snapshot: payload,
  };
}

function previewStocktakeScope({ folderId = null, itemIds = [], ownerDoctorId = null } = {}) {
  const items = loadStocktakeScopeItems({ folderId, itemIds, ownerDoctorId });
  const fingerprint = stocktakeScopeFingerprint(items, { folderId, itemIds, ownerDoctorId });
  return {
    folder_id: folderId ? Number(folderId) : null,
    owner_doctor_id: ownerDoctorId ? Number(ownerDoctorId) : null,
    item_count: fingerprint.item_count,
    scope_token: fingerprint.scope_token,
  };
}

function createStocktakeSession({
  scope = "ocs",
  folderId = null,
  itemIds = [],
  ownerDoctorId = null,
  userId,
  notes = "",
  confirmAll = false,
  expectedItemCount = null,
  scopeToken = "",
}) {
  const scopedIds = Array.isArray(itemIds) ? itemIds.filter(Boolean) : [];
  const doctorId = Number(ownerDoctorId || 0) || null;
  const fullCatalogue = !folderId && !scopedIds.length;
  if (fullCatalogue && !confirmAll) {
    throw HttpError(
      400,
      doctorId
        ? "Starting a full bag stock count requires explicit confirmation."
        : "Starting a full-catalogue stock count requires explicit confirmation.",
    );
  }
  const items = loadStocktakeScopeItems({ folderId, itemIds: scopedIds, ownerDoctorId: doctorId });
  if (!items.length) {
    throw HttpError(
      400,
      doctorId ? "This doctor bag has no stock items to count." : "No stock items in this count scope.",
    );
  }
  const fingerprint = stocktakeScopeFingerprint(items, { folderId, itemIds: scopedIds, ownerDoctorId: doctorId });
  const providedToken = String(scopeToken || "").trim();
  if (!providedToken) {
    throw HttpError(400, "A stock count scope token is required.", {
      code: "STOCKTAKE_SCOPE_TOKEN_REQUIRED",
      item_count: fingerprint.item_count,
      scope_token: fingerprint.scope_token,
    });
  }
  if (providedToken !== fingerprint.scope_token) {
    throw HttpError(
      409,
      "Catalogue membership changed. Reload the scope and confirm again.",
      {
        code: "STOCKTAKE_SCOPE_STALE",
        item_count: fingerprint.item_count,
        scope_token: fingerprint.scope_token,
      },
    );
  }
  void expectedItemCount;
  const info = db
    .prepare(`
      INSERT INTO inventory_stocktake_sessions (
        scope, folder_id, owner_doctor_id, status, notes, created_by_user_id, assigned_counter_user_id, started_at,
        scope_token, scope_snapshot_json
      ) VALUES (?, ?, ?, 'in_progress', ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    `)
    .run(
      doctorId ? "doctor" : (scope || "ocs"),
      folderId || null,
      doctorId,
      notes,
      userId,
      userId,
      fingerprint.scope_token,
      JSON.stringify(fingerprint.snapshot),
    );
  const sessionId = Number(info.lastInsertRowid);
  const insert = db.prepare(`
    INSERT INTO inventory_stocktake_session_items (
      session_id, inventory_id, system_quantity, expected_row_version, expected_quantity,
      previous_count_quantity, previous_count_at, previous_count_session_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    const snapshot = snapshotInventoryForStocktake(item);
    const previous = lastOfficialStockCount(item.id);
    insert.run(
      sessionId,
      item.id,
      snapshot.expected_quantity,
      snapshot.expected_row_version,
      snapshot.expected_quantity,
      previous ? previous.quantity : null,
      previous ? previous.applied_at : null,
      previous ? previous.session_id : null,
    );
  }
  return getStocktakeSession(sessionId, { role: "operator" });
}

function serializeStocktakeSession(session, { role = "", revealSystem = false } = {}) {
  const allowedReveal = canRevealStocktakeSystem(session, { role });
  const showSystem = allowedReveal;
  void revealSystem;
  const itemRows = db
    .prepare(`
      SELECT si.*, i.item_name, i.unit, i.folder_id, i.cost_price, i.row_version AS live_row_version, i.quantity AS live_quantity
      FROM inventory_stocktake_session_items si
      JOIN inventory i ON i.id = si.inventory_id
      WHERE si.session_id = ?
      ORDER BY i.item_name ASC
    `)
    .all(session.id);
  const intervalMovements = showSystem ? loadStocktakeIntervalMovements(session, itemRows) : new Map();
  const pendingByItem = showSystem && !Number(session.owner_doctor_id || 0)
    ? loadPendingShipmentsByCatalogueId()
    : new Map();
  const items = itemRows
    .map((row) => {
      const leftUnchanged = Number(row.left_unchanged || 0) === 1;
      const counted = !leftUnchanged && row.physical_quantity !== null && row.physical_quantity !== undefined;
      const expectedQty = Number(row.expected_quantity ?? row.system_quantity ?? 0);
      const previousQty = row.previous_count_quantity == null ? null : Number(row.previous_count_quantity);
      const movementSince = previousQty == null ? null : expectedQty - previousQty;
      const movementsSince = showSystem ? intervalMovements.get(Number(row.inventory_id)) || [] : [];
      const explained = movementsSince.reduce((sum, entry) => sum + Number(entry.signed_quantity || 0), 0);
      const unexplained = movementSince == null ? null : movementSince - explained;
      const pending = pendingByItem.get(Number(row.inventory_id)) || { quantity: 0, shipments: [] };
      return {
        ...row,
        counted,
        left_unchanged: leftUnchanged,
        system_quantity: showSystem ? Number(row.system_quantity || 0) : null,
        expected_row_version: showSystem ? Number(row.expected_row_version || 0) : null,
        expected_quantity: showSystem ? expectedQty : null,
        previous_count_quantity: showSystem ? previousQty : null,
        previous_count_at: showSystem ? row.previous_count_at || null : null,
        previous_count_session_id: showSystem && row.previous_count_session_id
          ? Number(row.previous_count_session_id)
          : null,
        movement_since_quantity: showSystem ? movementSince : null,
        movements_since: showSystem ? movementsSince : [],
        explained_movement_quantity: showSystem ? explained : null,
        unexplained_movement_quantity: showSystem ? unexplained : null,
        variance: showSystem ? row.variance : null,
        variance_value:
          showSystem ? roundCurrency(Number(row.variance || 0) * Number(row.cost_price || 0)) : null,
        live_row_version: showSystem ? Number(row.live_row_version || 0) : null,
        live_quantity: showSystem ? Number(row.live_quantity || 0) : null,
        surplus_expiry_date: showSystem ? row.surplus_expiry_date || null : null,
        surplus_is_non_expiring: showSystem ? Number(row.surplus_is_non_expiring || 0) === 1 : false,
        surplus_unit_cost:
          showSystem && row.surplus_unit_cost != null && Number(row.surplus_unit_cost) > 0
            ? Number(row.surplus_unit_cost)
            : null,
        surplus_supplier_name: showSystem ? String(row.surplus_supplier_name || "").trim() : "",
        surplus_received_date: showSystem ? row.surplus_received_date || null : null,
        needs_new_lot: showSystem && Number(row.variance || 0) > 0,
        new_lot_quantity: showSystem && Number(row.variance || 0) > 0 ? Number(row.variance) : null,
        pending_shipment_quantity: showSystem ? pending.quantity : 0,
        pending_shipments: showSystem ? pending.shipments : [],
      };
    });
  const comparable = items.filter((row) => !row.left_unchanged);
  const counted = comparable.filter((row) => row.counted).length;
  const discrepancyItems = comparable.filter((row) => Number(row.variance || 0) !== 0);
  const openVarianceQty = discrepancyItems.reduce((sum, row) => sum + Math.abs(Number(row.variance || 0)), 0);
  const openVarianceValue = roundCurrency(
    discrepancyItems.reduce((sum, row) => sum + Number(row.variance_value || 0), 0),
  );
  return {
    ...session,
    items,
    item_count: items.length,
    counted_count: counted,
    left_unchanged_count: items.length - comparable.length,
    progress_percent: comparable.length ? Math.round((counted / comparable.length) * 100) : 0,
    last_saved_at: session.updated_at || session.started_at || session.created_at,
    discrepancy_count: discrepancyItems.length,
    conflict_count: comparable.filter((row) => row.conflict_status === "recount_required").length,
    open_variance_qty: ["submitted", "approved", "applied", "recount_required"].includes(session.status)
      ? openVarianceQty
      : null,
    open_variance_value: ["submitted", "approved", "applied", "recount_required"].includes(session.status)
      ? openVarianceValue
      : null,
    created_by_name: resolveAuditActor({ userId: session.created_by_user_id }),
    submitted_by_name: resolveAuditActor({ userId: session.submitted_by_user_id }),
    reviewed_by_name: resolveAuditActor({ userId: session.reviewed_by_user_id }),
    approved_by_user_id: session.reviewed_by_user_id || null,
    approved_at: session.reviewed_at || null,
    approved_by_name: resolveAuditActor({ userId: session.reviewed_by_user_id }),
    applied_by_name: resolveAuditActor({ userId: session.applied_by_user_id }),
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
        reviewer.full_name AS reviewed_by_name,
        applier.full_name AS applied_by_name,
        f.name AS folder_name,
        d.full_name AS doctor_name,
        (SELECT COUNT(*) FROM inventory_stocktake_session_items si WHERE si.session_id = s.id) AS item_count,
        (SELECT COUNT(*) FROM inventory_stocktake_session_items si WHERE si.session_id = s.id AND si.physical_quantity IS NOT NULL) AS counted_count,
        (SELECT COUNT(*) FROM inventory_stocktake_session_items si WHERE si.session_id = s.id AND COALESCE(si.left_unchanged, 0) = 1) AS left_unchanged_count,
        (SELECT COALESCE(SUM(ABS(si.variance)), 0) FROM inventory_stocktake_session_items si WHERE si.session_id = s.id) AS open_variance_qty,
        (SELECT COALESCE(SUM(ABS(si.variance) * COALESCE(i.cost_price, 0)), 0)
           FROM inventory_stocktake_session_items si
           JOIN inventory i ON i.id = si.inventory_id
          WHERE si.session_id = s.id) AS open_variance_value
      FROM inventory_stocktake_sessions s
      LEFT JOIN users u ON u.id = s.created_by_user_id
      LEFT JOIN users counter ON counter.id = s.assigned_counter_user_id
      LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by_user_id
      LEFT JOIN users applier ON applier.id = s.applied_by_user_id
      LEFT JOIN inventory_folders f ON f.id = s.folder_id
      LEFT JOIN doctors d ON d.id = s.owner_doctor_id
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 100
    `)
    .all()
    .map((row) => ({
      ...row,
      folder_name: row.owner_doctor_id
        ? `${String(row.doctor_name || "Doctor").trim()}'s bag`
        : row.folder_name || (row.folder_id ? "Folder" : "All OCS folders"),
      left_unchanged_count: Number(row.left_unchanged_count || 0),
      progress_percent: (Number(row.item_count || 0) - Number(row.left_unchanged_count || 0))
        ? Math.round(
            (Number(row.counted_count || 0) /
              (Number(row.item_count || 0) - Number(row.left_unchanged_count || 0))) *
              100,
          )
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

function stocktakeQueueStats(sessions = listStocktakeSessions(), { now = Date.now() } = {}) {
  const active = sessions.filter((row) => ["draft", "in_progress", "recount_required"].includes(row.status));
  const awaitingApproval = sessions.filter((row) => row.status === "submitted");
  const awaitingApplication = sessions.filter((row) => row.status === "approved");
  const completed = sessions
    .filter((row) => row.status === "applied")
    .map((row) => row.applied_at || row.updated_at || row.created_at)
    .filter(Boolean);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
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
    completed_last_7_days: completed.filter((value) => {
      const timestamp = storedTimestampMs(value);
      return timestamp !== null && timestamp >= sevenDaysAgo && timestamp <= now;
    }).length,
    last_completed_at: latestStoredTimestamp(completed),
  };
}

function parseSupplierName(value) {
  return String(value || "").trim().slice(0, 120);
}

function parseReceivedDate(value, { required = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (required) throw HttpError(400, "Enter the delivery date.");
    return null;
  }
  if (!isIsoDate(raw)) {
    throw HttpError(400, "Delivery date must be a valid calendar date (YYYY-MM-DD).");
  }
  if (raw > getTodayLocal()) {
    throw HttpError(400, "Delivery date cannot be in the future.");
  }
  return raw;
}

function shipmentReceiptIdentity(shipmentId) {
  if (!shipmentId) return { supplier_name: "", received_date: getTodayLocal() };
  const shipment = db
    .prepare("SELECT supplier, received_date, imported_at FROM inventory_shipments WHERE id = ?")
    .get(Number(shipmentId));
  const noted = String(shipment?.received_date || "").slice(0, 10);
  const imported = String(shipment?.imported_at || "").slice(0, 10);
  return {
    supplier_name: parseSupplierName(shipment?.supplier),
    received_date: isIsoDate(noted) ? noted : (isIsoDate(imported) ? imported : getTodayLocal()),
  };
}

function parseSurplusNonExpiring(value) {
  return value === true || Number(value) === 1 || parseNonExpiringFlag(value);
}

function persistStocktakeNewLots(sessionId, lines) {
  for (const line of lines || []) {
    if (!line?.id) continue;
    const current = db
      .prepare("SELECT * FROM inventory_stocktake_session_items WHERE session_id = ? AND id = ?")
      .get(sessionId, line.id);
    if (!current) continue;
    if (!(Number(current.variance || 0) > 0)) continue;
    const coverage = loadPendingShipmentsByCatalogueId().get(Number(current.inventory_id));
    if (coverage?.quantity > 0) {
      const item = db.prepare("SELECT item_name FROM inventory WHERE id = ?").get(current.inventory_id);
      throw HttpError(409, pendingShipmentHoldMessage(item || { item_name: "This item" }, coverage));
    }
    const nonExpiring = parseSurplusNonExpiring(line.surplus_is_non_expiring);
    const expiryRaw = String(line.surplus_expiry_date ?? "").trim();
    if (!nonExpiring && expiryRaw) {
      validateReceiptExpiry({ expiryDate: expiryRaw, isNonExpiring: false });
    }
    let unitCost = null;
    if (line.surplus_unit_cost !== undefined && line.surplus_unit_cost !== null && String(line.surplus_unit_cost).trim() !== "") {
      unitCost = roundCurrency(line.surplus_unit_cost);
      if (!(unitCost > 0)) {
        throw HttpError(
          400,
          "Unit cost for the new counted lot must be greater than zero, or leave it blank to copy the last known cost.",
        );
      }
    }
    const supplierName = parseSupplierName(line.surplus_supplier_name);
    const receivedDate = parseReceivedDate(line.surplus_received_date);
    db.prepare(`
      UPDATE inventory_stocktake_session_items
      SET
        surplus_expiry_date = ?,
        surplus_is_non_expiring = ?,
        surplus_unit_cost = ?,
        surplus_supplier_name = ?,
        surplus_received_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nonExpiring ? null : expiryRaw || null,
      nonExpiring ? 1 : 0,
      unitCost,
      supplierName,
      receivedDate,
      line.id,
    );
  }
}

function saveStocktakeNewLots(sessionId, lines, { role } = {}) {
  if (!["admin", "operator"].includes(String(role || ""))) {
    throw HttpError(403, "Only operators or administrators can register a new counted lot.");
  }
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw HttpError(404, "Stock count session not found.");
  if (!["submitted", "approved"].includes(session.status)) {
    throw HttpError(400, "Register the new lot after the count is submitted.");
  }
  db.transaction(() => {
    persistStocktakeNewLots(sessionId, lines);
    db.prepare("UPDATE inventory_stocktake_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
  })();
  return getStocktakeSession(sessionId, { role });
}

function loadPendingShipmentsByCatalogueId() {
  const rows = db
    .prepare(
      `
      SELECT st.item_name, st.quantity, st.shipment_id,
             sh.supplier, sh.delivery_note, sh.received_date
      FROM inventory_staging st
      INNER JOIN inventory_shipments sh ON sh.id = st.shipment_id
      WHERE st.status = 'pending' AND st.quantity > 0
    `,
    )
    .all();
  const grouped = new Map();
  for (const row of rows) {
    const catalogue = findOcsCatalogueItemByName(row.item_name);
    if (!catalogue) continue;
    const key = Number(catalogue.id);
    const entry = grouped.get(key) || { quantity: 0, shipments: [] };
    const qty = Number(row.quantity || 0);
    const shipmentId = Number(row.shipment_id);
    entry.quantity += qty;
    const existing = entry.shipments.find((shipment) => shipment.shipment_id === shipmentId);
    if (existing) {
      existing.quantity += qty;
    } else {
      entry.shipments.push({
        shipment_id: shipmentId,
        quantity: qty,
        supplier: String(row.supplier || "").trim(),
        delivery_note: String(row.delivery_note || "").trim(),
        received_date: String(row.received_date || "").slice(0, 10),
      });
    }
    grouped.set(key, entry);
  }
  return grouped;
}

function pendingShipmentHoldMessage(item, coverage) {
  const shipments = coverage?.shipments || [];
  const first = shipments[0];
  const where = shipments.length === 1 && first
    ? `Receive Delivery #${first.shipment_id}`
    : `${shipments.length} Receive Delivery records`;
  return `${item.item_name} still has ${coverage.quantity} on ${where} that is not in stock yet. Add it to stock, then recount. This extra is not a second delivery.`;
}

function countedLotRepeatingShipment(itemId, { supplierName, receivedDate, quantity }) {
  const supplier = String(supplierName || "").trim().toLowerCase();
  const date = String(receivedDate || "").slice(0, 10);
  const qty = Number(quantity || 0);
  if (supplier.length < 2 || !isIsoDate(date) || !Number.isInteger(qty) || qty <= 0) return null;
  const rows = db
    .prepare(
      `
      SELECT b.quantity_remaining, b.supplier_name, b.received_date, a.quantity AS added_quantity, m.meta_json
      FROM inventory_batches b
      JOIN inventory_movement_allocations a ON a.batch_id = b.id
      JOIN inventory_movements m ON m.id = a.movement_id
      WHERE b.item_id = ?
        AND b.quantity_remaining > 0
        AND json_extract(m.meta_json, '$.valuation_basis') = 'stocktake_surplus'
    `,
    )
    .all(Number(itemId));
  for (const row of rows) {
    if (Number(row.added_quantity) !== qty) continue;
    if (Number(row.quantity_remaining) < qty) continue;
    if (String(row.supplier_name || "").trim().toLowerCase() !== supplier) continue;
    if (String(row.received_date || "").slice(0, 10) !== date) continue;
    let meta = {};
    try {
      meta = JSON.parse(row.meta_json || "{}");
    } catch {
      meta = {};
    }
    return {
      session_id: Number(meta.stocktake_session_id || 0) || null,
      quantity: qty,
    };
  }
  return null;
}

function surplusLotForApply(line, item) {
  const variance = Number(line.variance);
  const nonExpiring = Number(line.surplus_is_non_expiring || 0) === 1;
  const expiryRaw = String(line.surplus_expiry_date || "").trim();
  if (!nonExpiring && !expiryRaw) {
    throw HttpError(
      400,
      `Enter the expiry date for the extra ${variance} counted unit(s) of ${item.item_name}. Extra counted stock is a new lot, not the previous expiry.`,
    );
  }
  const expiry = validateReceiptExpiry({ expiryDate: expiryRaw, isNonExpiring: nonExpiring });
  const supplierName = parseSupplierName(line.surplus_supplier_name);
  if (supplierName.length < 2) {
    throw HttpError(
      400,
      `Enter the supplier name for the extra ${variance} counted unit(s) of ${item.item_name}.`,
    );
  }
  const receivedDate = parseReceivedDate(line.surplus_received_date, { required: true });
  const identity = lastKnownBatchIdentity(item.id);
  const unitCost = Number(line.surplus_unit_cost) > 0 ? Number(line.surplus_unit_cost) : identity.unit_cost;
  return {
    expiry_date: expiry.expiryDate,
    is_non_expiring: expiry.isNonExpiring ? 1 : 0,
    unit_cost: unitCost,
    supplier_name: supplierName,
    received_date: receivedDate,
  };
}

function parseSubmittedPhysicalCount(value) {
  if (value === null || value === undefined) {
    return { kind: "missing" };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return { kind: "missing" };
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
  if (!session) throw HttpError(404, "Stock count session not found.");
  if (!["draft", "in_progress", "recount_required"].includes(session.status)) {
    throw HttpError(400, "This stock count session can no longer be edited.");
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
      const current = db
        .prepare("SELECT si.*, i.quantity, i.row_version FROM inventory_stocktake_session_items si JOIN inventory i ON i.id = si.inventory_id WHERE si.session_id = ? AND si.id = ?")
        .get(sessionId, line.id);
      if (!current) continue;
      if (String(current.conflict_status || "") === "recount_required") {
        throw HttpError(
          409,
          `Line #${line.id} has a detected conflict and can only be updated through an explicit recount.`,
        );
      }
      const baselineQty = Number(current.expected_quantity ?? current.system_quantity ?? 0);
      db.prepare(`
        UPDATE inventory_stocktake_session_items
        SET
          physical_quantity = ?,
          variance = ? - ?,
          counted_by_user_id = ?,
          counted_at = CURRENT_TIMESTAMP,
          reason = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND id = ?
      `).run(
        physical,
        physical,
        baselineQty,
        userId,
        String(line.reason || "").slice(0, 500),
        sessionId,
        line.id,
      );
    }
    if (session.status !== "recount_required") {
      db.prepare(`
        UPDATE inventory_stocktake_sessions
        SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sessionId);
    } else {
      db.prepare(`
        UPDATE inventory_stocktake_sessions
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sessionId);
    }
  })();
  return getStocktakeSession(sessionId, { role: "operator" });
}

function recountStocktakeLines(sessionId, lines, userId) {
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw HttpError(404, "Stock count session not found.");
  if (session.status !== "recount_required") {
    throw HttpError(400, "Only a conflicted stock count session can receive a recount.");
  }
  if (!Array.isArray(lines) || !lines.length) {
    throw HttpError(400, "Recount lines are required.");
  }
  db.transaction(() => {
    for (const line of lines) {
      const parsed = parseSubmittedPhysicalCount(line.physical_quantity);
      if (parsed.kind === "invalid") {
        throw HttpError(400, parsed.error);
      }
      if (parsed.kind === "missing") {
        throw HttpError(400, "A recounted line must include a physical count, including explicit zero.");
      }
      const current = db
        .prepare(
          `
          SELECT si.*, i.quantity, i.row_version
          FROM inventory_stocktake_session_items si
          JOIN inventory i ON i.id = si.inventory_id
          WHERE si.session_id = ? AND si.id = ?
        `,
        )
        .get(sessionId, line.id);
      if (!current) {
        throw HttpError(404, `Stock count line #${line.id} was not found.`);
      }
      if (String(current.conflict_status || "") !== "recount_required") {
        throw HttpError(409, `Line #${line.id} is not waiting for a recount.`);
      }
      const token = String(line.conflict_detected_at || line.conflict_id || "").trim();
      if (!token || token !== String(current.conflict_detected_at || "")) {
        throw HttpError(409, "This recount is stale. Reload the conflicted lines and recount again.");
      }
      const liveVersion = Number(current.row_version || 1);
      const sentVersion = Number(line.expected_row_version);
      if (!Number.isInteger(sentVersion) || sentVersion !== liveVersion) {
        throw HttpError(
          409,
          "This recount is stale. The inventory version changed. Recount against the latest quantity.",
        );
      }
      const liveQty = Number(current.quantity || 0);
      const physical = parsed.value;
      db.prepare(`
        UPDATE inventory_stocktake_session_items
        SET
          physical_quantity = ?,
          system_quantity = ?,
          expected_quantity = ?,
          expected_row_version = ?,
          variance = ? - ?,
          conflict_status = '',
          conflict_reason = '',
          conflict_live_quantity = NULL,
          conflict_detected_at = NULL,
          counted_by_user_id = ?,
          counted_at = CURRENT_TIMESTAMP,
          recounted_by_user_id = ?,
          recounted_at = CURRENT_TIMESTAMP,
          reason = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND id = ?
      `).run(
        physical,
        liveQty,
        liveQty,
        liveVersion,
        physical,
        liveQty,
        userId,
        userId,
        String(line.reason || "").slice(0, 500),
        sessionId,
        line.id,
      );
    }
    db.prepare(`
      UPDATE inventory_stocktake_sessions
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(sessionId);
  })();
  return getStocktakeSession(sessionId, { role: "operator" });
}

function lastMovementAt(itemId) {
  return (
    db
      .prepare(
        `
        SELECT created_at
        FROM inventory_movements
        WHERE item_id = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      )
      .get(Number(itemId))?.created_at || null
  );
}

function collectStocktakeConflicts(items) {
  const conflicts = [];
  for (const line of items) {
    if (line.physical_quantity === null || line.physical_quantity === undefined) {
      continue;
    }
    const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(line.inventory_id);
    if (!item) {
      conflicts.push({
        line_id: line.id,
        reason: "A counted item is no longer available.",
      });
      continue;
    }
    const expectedVersion = Number(line.expected_row_version ?? 0);
    const expectedQty = Number(line.expected_quantity ?? line.system_quantity ?? 0);
    const liveVersion = Number(item.row_version || 1);
    const liveQty = Number(item.quantity || 0);
    if ((expectedVersion && liveVersion !== expectedVersion) || liveQty !== expectedQty) {
      const movedAt = lastMovementAt(item.id);
      const reason = `Stock changed after count (expected qty ${expectedQty} v${expectedVersion || "?"}, now ${liveQty} v${liveVersion}${movedAt ? ` at ${movedAt}` : ""}). Recount required.`;
      conflicts.push({
        line_id: line.id,
        inventory_id: item.id,
        item_name: item.item_name,
        reason,
        baseline_quantity: expectedQty,
        live_quantity: liveQty,
        movement_at: movedAt,
      });
    }
  }
  return conflicts;
}

function persistRecountRequired(sessionId, conflicts) {
  db.transaction(() => {
    for (const conflict of conflicts) {
      db.prepare(`
        UPDATE inventory_stocktake_session_items
        SET
          conflict_status = 'recount_required',
          conflict_reason = ?,
          conflict_live_quantity = ?,
          conflict_detected_at = COALESCE(NULLIF(conflict_detected_at, ''), CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(conflict.reason, conflict.live_quantity ?? null, conflict.line_id);
    }
    db.prepare(`
      UPDATE inventory_stocktake_sessions
      SET
        status = 'recount_required',
        review_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      `Application blocked: ${conflicts.length} line(s) changed after they were counted.`,
      sessionId,
    );
  })();
}

function appendStocktakeNote(existing, addition) {
  const next = String(addition || "").trim();
  const base = String(existing || "").trim();
  if (!next || base.includes(next)) return base;
  return base ? `${base}\n${next}` : next;
}

const CANCELLABLE_STOCKTAKE_STATUSES = ["draft", "in_progress", "recount_required", "submitted", "approved"];

function cancelStocktakeSession(sessionId, userId) {
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw HttpError(404, "Stock count session not found.");
  if (session.status === "cancelled") return getStocktakeSession(sessionId, { role: "operator" });
  if (session.status === "applied") {
    throw HttpError(400, "This count is already the official stock count.");
  }
  if (!CANCELLABLE_STOCKTAKE_STATUSES.includes(session.status)) {
    throw HttpError(400, "This count is already closed.");
  }
  const note = "Cancelled. Saved counts were not applied to stock.";
  db.prepare(`
    UPDATE inventory_stocktake_sessions
    SET
      status = 'cancelled',
      notes = ?,
      review_reason = ?,
      reviewed_by_user_id = ?,
      reviewed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(appendStocktakeNote(session.notes, note), note, userId, sessionId);
  return getStocktakeSession(sessionId, { role: "operator" });
}

function submitStocktakeSession(sessionId, userId, { finishCounted = false } = {}) {
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw HttpError(404, "Stock count session not found.");
  if (!["draft", "in_progress", "recount_required"].includes(session.status)) {
    throw HttpError(409, "This session has already been submitted.");
  }
  let notes = session.notes;
  if (finishCounted) {
    const counted = Number(
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM inventory_stocktake_session_items
          WHERE session_id = ? AND physical_quantity IS NOT NULL AND COALESCE(left_unchanged, 0) = 0
        `)
        .get(sessionId)?.count || 0,
    );
    if (counted < 1) {
      throw HttpError(400, "Count at least one item, or cancel this count.");
    }
    const skipped = Number(
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM inventory_stocktake_session_items
          WHERE session_id = ? AND physical_quantity IS NULL AND COALESCE(left_unchanged, 0) = 0
        `)
        .get(sessionId)?.count || 0,
    );
    if (skipped > 0) {
      db.prepare(`
        UPDATE inventory_stocktake_session_items
        SET
          left_unchanged = 1,
          conflict_status = '',
          conflict_reason = '',
          updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ? AND physical_quantity IS NULL AND COALESCE(left_unchanged, 0) = 0
      `).run(sessionId);
      notes = appendStocktakeNote(
        notes,
        `Finished with ${counted} of ${counted + skipped} items. ${skipped} were not counted and were left unchanged.`,
      );
    }
  }
  const missing = Number(
    db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM inventory_stocktake_session_items
        WHERE session_id = ? AND physical_quantity IS NULL AND COALESCE(left_unchanged, 0) = 0
      `)
      .get(sessionId)?.count || 0,
  );
  if (missing > 0) {
    throw HttpError(400, "Count every line before submitting the session.");
  }
  const items = db
    .prepare("SELECT * FROM inventory_stocktake_session_items WHERE session_id = ?")
    .all(sessionId);
  const openConflicts = items.filter(
    (row) => String(row.conflict_status || "") === "recount_required" && Number(row.left_unchanged || 0) !== 1,
  );
  if (openConflicts.length) {
    const error = HttpError(
      409,
      `Stock count cannot be submitted until ${openConflicts.length} conflicted line(s) are genuinely recounted.`,
    );
    error.conflicts = openConflicts.map((row) => ({
      line_id: row.id,
      inventory_id: row.inventory_id,
      reason: row.conflict_reason || "Recount required.",
    }));
    error.session = getStocktakeSession(sessionId, { role: "operator" });
    throw error;
  }
  const conflicts = collectStocktakeConflicts(items);
  if (conflicts.length) {
    persistRecountRequired(sessionId, conflicts);
    const error = HttpError(
      409,
      `Stock count cannot be submitted because ${conflicts.length} line(s) changed after they were counted.`,
    );
    error.conflicts = conflicts;
    error.session = getStocktakeSession(sessionId, { role: "operator" });
    throw error;
  }
  db.prepare(`
    UPDATE inventory_stocktake_sessions
    SET
      status = 'submitted',
      notes = ?,
      submitted_at = CURRENT_TIMESTAMP,
      submitted_by_user_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(notes, userId, sessionId);
  return getStocktakeSession(sessionId, { role: "operator" });
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
  if (role !== "admin") throw HttpError(403, "Only an admin can review stock count variances.");
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw HttpError(404, "Stock count session not found.");
  if (session.status !== "submitted") throw HttpError(400, "Only submitted sessions can be reviewed.");
  if (Number(session.submitted_by_user_id) === Number(userId) && otherActiveAdminExists(userId)) {
    throw HttpError(403, "The person who submitted this count cannot approve it while another admin is available.");
  }
  if (decision === "rejected" && String(reason || "").trim().length < 10) {
    throw HttpError(400, "A reason is required to reject a stock count session.");
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
  if (decision === "approved") {
    const items = db.prepare("SELECT * FROM inventory_stocktake_session_items WHERE session_id = ?").all(sessionId);
    const hasVariance = items.some(
      (row) => Number(row.left_unchanged || 0) !== 1 && Number(row.variance) !== 0,
    );
    if (!hasVariance) {
      return applyStocktakeSession(sessionId, userId, { role: "admin" }).session;
    }
  }
  return getStocktakeSession(sessionId, { role: "admin" });
}

function applyStocktakeSession(sessionId, userId, actor = {}) {
  const reveal = { role: actor.role || "admin" };
  const session = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
  if (!session) throw HttpError(404, "Stock count session not found.");
  if (session.status === "applied" && session.applied_transaction_id) {
    return { session: getStocktakeSession(sessionId, reveal), idempotent: true };
  }
  if (session.status === "rejected" || session.status === "cancelled" || session.status === "recount_required") {
    throw HttpError(400, "This session cannot be applied.");
  }
  if (session.status !== "approved") {
    throw HttpError(400, "Only an approved stock count can be recorded.");
  }

  const items = db
    .prepare("SELECT * FROM inventory_stocktake_session_items WHERE session_id = ?")
    .all(sessionId);
  const conflicts = collectStocktakeConflicts(items);
  if (conflicts.length) {
    persistRecountRequired(sessionId, conflicts);
    const error = HttpError(
      409,
      `Stock count cannot be applied because ${conflicts.length} line(s) changed after they were counted.`,
    );
    error.conflicts = conflicts;
    error.session = getStocktakeSession(sessionId, reveal);
    throw error;
  }

  try {
  return db.transaction(() => {
    const locked = db.prepare("SELECT * FROM inventory_stocktake_sessions WHERE id = ?").get(Number(sessionId));
    if (locked.status === "applied" && locked.applied_transaction_id) {
      return { session: getStocktakeSession(sessionId, reveal), idempotent: true };
    }
    if (["rejected", "cancelled", "recount_required"].includes(String(locked.status))) {
      throw HttpError(400, "This session cannot be applied.");
    }
    const liveConflicts = collectStocktakeConflicts(
      db.prepare("SELECT * FROM inventory_stocktake_session_items WHERE session_id = ?").all(sessionId),
    );
    if (liveConflicts.length) {
      const error = HttpError(409, "Stock changed after count. Recount required.");
      error.conflicts = liveConflicts;
      error.persistRecount = true;
      throw error;
    }
    const transactionId = `ST-${sessionId}-${Date.now().toString(36).toUpperCase()}`;
    const pendingByItem = Number(locked.owner_doctor_id || 0) ? new Map() : loadPendingShipmentsByCatalogueId();
    const applyItems = db
      .prepare("SELECT * FROM inventory_stocktake_session_items WHERE session_id = ?")
      .all(sessionId);
    for (const line of applyItems) {
      if (Number(line.left_unchanged || 0) === 1) continue;
      const variance = Number(line.variance);
      if (!Number.isFinite(variance) || variance === 0) continue;
      const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(line.inventory_id);
      if (!item) throw HttpError(409, "A counted item is no longer available.");
      const previous = Number(item.quantity);
      const next = Number(line.physical_quantity);
      if (!Number.isInteger(next) || next < 0) {
        throw HttpError(409, `Counted quantity is missing for ${item.item_name}.`);
      }
      const reserved = reservedQuantityForItem(item.id);
      if (next < reserved) {
        throw HttpError(
          409,
          `Cannot apply counted quantity ${next} for ${item.item_name} because ${reserved} unit(s) are reserved.`,
        );
      }
      let allocations = [];
      if (variance < 0) {
        const preview = previewAllocations(item.id, Math.abs(variance), { includeExpired: true });
        if (!preview.can_fulfil) {
          throw HttpError(409, `Insufficient unreserved traceable batch quantity to apply the count for ${item.item_name}.`);
        }
        consumeAllocatedBatches(preview.allocations);
        allocations = preview.allocations;
      } else {
        const coverage = pendingByItem.get(Number(item.id));
        if (coverage?.quantity > 0) {
          throw HttpError(409, pendingShipmentHoldMessage(item, coverage));
        }
        const surplus = surplusLotForApply(line, item);
        const inserted = db.prepare(`
          INSERT INTO inventory_batches (
            item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status,
            supplier_name, received_date
          ) VALUES (?, ?, ?, ?, ?, 'usable', ?, ?)
        `).run(
          item.id,
          variance,
          surplus.is_non_expiring ? null : surplus.expiry_date,
          surplus.unit_cost,
          surplus.is_non_expiring,
          surplus.supplier_name,
          surplus.received_date,
        );
        allocations = [{
          batch_id: Number(inserted.lastInsertRowid),
          quantity: variance,
          expiry_date: surplus.is_non_expiring ? null : surplus.expiry_date,
          is_non_expiring: Boolean(surplus.is_non_expiring),
          unit_cost: surplus.unit_cost,
          supplier_name: surplus.supplier_name,
          received_date: surplus.received_date,
        }];
      }
      updateInventoryQuantity(item.id, next);
      assertBatchBalance(item.id);
      const movementId = recordOpsMovement({
        itemId: item.id,
        movementType: variance > 0 ? "in" : "out",
        quantity: Math.abs(variance),
        previousQuantity: previous,
        nextQuantity: next,
        actionType: "adjustment",
        note: line.reason || `Stock count session #${sessionId}`,
        userId,
        skipPublish: true,
        meta: {
          stocktake_session_id: sessionId,
          transaction_id: transactionId,
          previous_quantity: previous,
          counted_quantity: next,
          expected_row_version: line.expected_row_version,
          expected_quantity: line.expected_quantity,
          performed_by_user_id: userId,
          performed_by_name: actor.displayName || "",
          performed_by_role: actor.role || "",
          reference_type: "stocktake_session",
          reference_id: sessionId,
          allocations,
          valuation_basis: variance > 0 ? "stocktake_surplus" : "batch_allocation",
        },
      });
      recordMovementAllocations(movementId, allocations);
    }
    const watermark = Number(
      db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM inventory_movements").get()?.id || 0,
    );
    const applied = db.prepare(`
      UPDATE inventory_stocktake_sessions
      SET
        status = 'applied',
        applied_at = CURRENT_TIMESTAMP,
        applied_by_user_id = ?,
        applied_transaction_id = ?,
        movement_id_watermark = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND applied_transaction_id IS NULL
    `).run(userId, transactionId, watermark, sessionId);
    if (!applied.changes) {
      return { session: getStocktakeSession(sessionId, reveal), idempotent: true };
    }
    publishInventoryResyncBroadcast({ reason: "stocktake_applied" });
    return { session: getStocktakeSession(sessionId, reveal), idempotent: false, transactionId };
  })();
  } catch (error) {
    if (error?.persistRecount && Array.isArray(error.conflicts) && error.conflicts.length) {
      persistRecountRequired(sessionId, error.conflicts);
      error.session = getStocktakeSession(sessionId, reveal);
    }
    throw error;
  }
}

function doctorMayViewReceipt(transactionId, doctorId) {
  const rows = db
    .prepare(
      `
      SELECT m.doctor_id, m.meta_json, i.owner_doctor_id, i.stock_scope
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      WHERE json_extract(m.meta_json, '$.transaction_id') = ?
         OR json_extract(m.meta_json, '$.receipt_reference') LIKE ?
    `,
    )
    .all(String(transactionId), `%/inventory/receipts/${transactionId}`);
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
  canRevealStocktakeSystem,
  consumeAllocatedBatches,
  consumeFefo,
  createShipmentFromImport,
  cancelStocktakeSession,
  createStocktakeSession,
  previewStocktakeScope,
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
  parseReceivedDate,
  parseShipmentUpload,
  parseSupplierName,
  parseNonExpiringFlag,
  previewAllocations,
  releaseStagingRows,
  recountStocktakeLines,
  reviewStocktakeSession,
  saveStocktakeCounts,
  saveStocktakeNewLots,
  shipmentCumulativeSummary,
  shipmentQueueStats,
  shipmentReceipt,
  stagingRowErrors,
  stocktakeQueueStats,
  submitStocktakeSession,
  previewExceptionalCorrection,
  validateReceiptExpiry,
};
