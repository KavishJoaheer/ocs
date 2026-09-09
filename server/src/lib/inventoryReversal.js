"use strict";

const { db } = require("../db");
const { publishInventoryChange } = require("./inventoryRealtime");
const { unlinkSaleMovementsForBills } = require("./saleBillingLinkage");
const { assertInventoryQuantityUpdate } = require("./inventoryQuantity");
const {
  allocationsForMovement,
  parseMetaAllocations,
  recordMovementAllocations,
} = require("./inventoryMovementAllocations");
const { resolveAuditActor } = require("./auditActor");

function HttpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, extra });
}

function reversalForMovement(movementId) {
  return db
    .prepare(
      `
      SELECT * FROM inventory_movements
      WHERE action_type = 'reversal'
        AND CAST(json_extract(meta_json, '$.reversed_movement_id') AS INTEGER) = ?
      LIMIT 1
    `,
    )
    .get(Number(movementId));
}

function restoreOriginalAllocations(itemId, allocations) {
  const restored = [];
  for (const allocation of allocations) {
    const batch = db.prepare("SELECT * FROM inventory_batches WHERE id = ?").get(Number(allocation.batch_id));
    if (!batch || Number(batch.item_id) !== Number(itemId)) {
      throw HttpError(
        409,
        "Original consumed batches are no longer available. Use an authorised exceptional correction.",
        { code: "LEGACY_REVERSAL_REQUIRES_CORRECTION", batch_id: allocation.batch_id },
      );
    }
    const qty = Number(allocation.quantity || 0);
    const updated = db
      .prepare(
        `
        UPDATE inventory_batches
        SET quantity_remaining = quantity_remaining + ?,
            row_version = COALESCE(row_version, 1) + 1
        WHERE id = ?
      `,
      )
      .run(qty, batch.id);
    if (!updated.changes) {
      throw HttpError(409, "A batch could not be restored. Retry the reversal.");
    }
    restored.push({
      batch_id: Number(batch.id),
      quantity: qty,
      expiry_date: batch.expiry_date || allocation.expiry_date || null,
      unit_cost: Number(allocation.unit_cost ?? batch.unit_cost ?? 0),
    });
  }
  return restored;
}

function createLegacyExceptionBatch(itemId, quantity, meta = {}) {
  db.prepare(
    `
    INSERT INTO inventory_batches (
      item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status,
      quarantined_reason, quarantined_at, quarantined_by_user_id
    ) VALUES (?, ?, NULL, ?, 0, 'quarantined', ?, CURRENT_TIMESTAMP, ?)
  `,
  ).run(
    itemId,
    quantity,
    Number(meta.unit_cost || 0),
    "Legacy reversal traceability exception. Exact original batch identity was not recorded.",
    meta.actorId || null,
  );
  return {
    batch_id: Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0),
    quantity,
    expiry_date: null,
    unit_cost: Number(meta.unit_cost || 0),
    legacy_traceability_exception: true,
  };
}

function reverseInventoryForConsultation(
  consultationId,
  actor = {},
  { reason = "", confirmLegacyException = false } = {},
) {
  const consultation = db
    .prepare("SELECT id, appointment_id FROM consultations WHERE id = ?")
    .get(consultationId);
  if (!consultation) {
    return { reversed: 0, idempotent: true };
  }

  const billIds = db
    .prepare("SELECT id FROM billing WHERE consultation_id = ?")
    .all(consultationId)
    .map((row) => Number(row.id))
    .filter(Boolean);
  if (billIds.length > 0) {
    unlinkSaleMovementsForBills(billIds);
  }

  const movements = db
    .prepare(
      `
      SELECT m.*
      FROM inventory_movements m
      WHERE m.movement_type = 'out'
        AND m.action_type != 'reversal'
        AND NOT (m.action_type='stock_out' AND json_extract(m.meta_json,'$.stock_out_reason')='Sale')
        AND (
          CAST(json_extract(m.meta_json, '$.consultation_id') AS INTEGER) = ?
          OR (
            m.reference_type = 'appointment'
            AND ? > 0
            AND m.reference_id = ?
          )
        )
    `,
    )
    .all(consultationId, Number(consultation.appointment_id || 0), Number(consultation.appointment_id || 0));

  if (!movements.length) {
    return { reversed: 0 };
  }

  let reversed = 0;
  let skipped = 0;
  const touchedItemIds = new Set();
  const actorName = resolveAuditActor({
    displayName: actor.full_name || actor.username,
    userId: actor.id,
    required: true,
  });

  for (const movement of movements) {
    if (reversalForMovement(movement.id)) {
      skipped += 1;
      continue;
    }

    const qty = Number(movement.quantity || 0);
    if (qty <= 0) continue;

    const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(movement.item_id);
    if (!item) continue;

    const tableAllocations = allocationsForMovement(movement.id);
    const metaAllocations = parseMetaAllocations(movement.meta_json);
    const sourceAllocations = tableAllocations.length ? tableAllocations : metaAllocations;
    const hasExactBatches = sourceAllocations.length > 0
      && sourceAllocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0) === qty;

    let restoredAllocations;
    if (hasExactBatches) {
      restoredAllocations = restoreOriginalAllocations(item.id, sourceAllocations);
    } else if (confirmLegacyException) {
      restoredAllocations = [
        createLegacyExceptionBatch(item.id, qty, {
          unit_cost: item.cost_price,
          actorId: actor.id,
        }),
      ];
    } else {
      throw HttpError(
        409,
        "Original batch allocations are missing for this consultation. Confirm an authorised legacy traceability exception or apply an exceptional correction.",
        { code: "LEGACY_REVERSAL_REQUIRES_CORRECTION", movement_id: movement.id },
      );
    }

    const previousQuantity = Number(item.quantity || 0);
    const nextQuantity = previousQuantity + qty;
    assertInventoryQuantityUpdate(item.id, nextQuantity, item.row_version);
    touchedItemIds.add(Number(item.id));

    const meta = {
      consultation_id: consultationId,
      reversed_movement_id: movement.id,
      billing_id: (() => {
        try {
          return JSON.parse(movement.meta_json || "{}")?.billing_id || null;
        } catch {
          return null;
        }
      })(),
      performed_by_user_id: actor.id || null,
      performed_by_role: actor.role || "",
      performed_by_name: actorName,
      reason: String(reason || "").trim(),
      allocations: restoredAllocations,
      legacy_traceability_exception: !hasExactBatches,
      original_action_type: movement.action_type,
    };

    db.prepare(
      `
      INSERT INTO inventory_movements (
        item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
        recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
      )
      VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'reversal', 'consultation', ?, ?)
    `,
    ).run(
      item.id,
      qty,
      previousQuantity,
      nextQuantity,
      item.owner_doctor_id || null,
      actor.id || null,
      `Compensating reversal for consultation #${consultationId}.`,
      consultationId,
      JSON.stringify(meta),
    );
    const reversalId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0);
    recordMovementAllocations(reversalId, restoredAllocations);
    db.prepare(`UPDATE inventory_movements SET unit_cost_snapshot=?, unit_price_snapshot=?, valuation_basis=? WHERE id=?`)
      .run(movement.unit_cost_snapshot, movement.unit_price_snapshot, movement.valuation_basis, reversalId);
    db.prepare(
      `
      INSERT INTO inventory_activity_history (
        movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type, item_name,
        quantity, direction, source_text, destination_text, batch_id, meta_json
      ) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, 'reversal', ?, ?, 'in', ?, ?, ?, ?)
    `,
    ).run(
      reversalId,
      actor.id || null,
      actorName,
      actor.role || "",
      item.item_name || "",
      qty,
      "Patient Bill",
      "Doctor Stock",
      restoredAllocations.map((row) => row.batch_id).join(","),
      JSON.stringify(meta),
    );
    reversed += 1;
  }

  for (const itemId of touchedItemIds) {
    try {
      publishInventoryChange({ itemId, changedByUserId: actor?.id || null });
    } catch (error) {
      console.warn("[inventoryReversal] publishInventoryChange failed:", error?.message || error);
    }
  }

  return { reversed, skipped, idempotent: reversed === 0 && skipped > 0 };
}

module.exports = {
  reverseInventoryForConsultation,
};
