"use strict";

const { db } = require("../db");
const { publishInventoryChange } = require("./inventoryRealtime");
const { unlinkSaleMovementsByIds, unlinkSaleMovementsForBills } = require("./saleBillingLinkage");
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

function reverseBillingSubmissionInventory({
  movementIds = [],
  dispensingMovementIds = [],
  consultationId,
  billingId,
  actor = {},
  reason = "",
  restoreDispensing = false,
  reversalScope = "billing_submission",
}) {
  const ids = [...new Set((movementIds || []).map(Number).filter(Boolean))];
  const linkedDispensingIds = [...new Set((dispensingMovementIds || []).map(Number).filter(Boolean))];
  if (!ids.length && !linkedDispensingIds.length) {
    throw HttpError(
      409,
      "This submission predates exact movement tracking and cannot be safely reversed automatically. Use an authorised inventory correction.",
      { code: "SUBMISSION_REVERSAL_REQUIRES_CORRECTION" },
    );
  }

  const actorName = resolveAuditActor({
    displayName: actor.full_name || actor.username,
    userId: actor.id,
    required: true,
  });
  const touchedItemIds = new Set();
  const reversalIds = [];

  const restorableMovementIds = restoreDispensing
    ? [...new Set([...ids, ...linkedDispensingIds])]
    : ids;

  for (const movementId of restorableMovementIds) {
    const movement = db.prepare("SELECT * FROM inventory_movements WHERE id = ?").get(movementId);
    let movementMeta = {};
    try {
      movementMeta = JSON.parse(movement?.meta_json || "{}");
    } catch {
      movementMeta = {};
    }
    const isInvoiceSale = movement?.movement_type === "out" && movement?.action_type === "sell";
    const isDispensedSale = movement?.movement_type === "out"
      && movement?.action_type === "stock_out"
      && String(movementMeta.stock_out_reason || "").toLowerCase() === "sale"
      && movementMeta.billing_status === "Billed";
    if (!movement || (!isInvoiceSale && !(restoreDispensing && isDispensedSale))) {
      throw HttpError(409, "A linked stock movement is missing or is not reversible.", {
        code: "SUBMISSION_MOVEMENT_INVALID",
        movement_id: movementId,
      });
    }
    if (
      Number(movementMeta.consultation_id || 0) !== Number(consultationId) ||
      Number(movementMeta.billing_id || 0) !== Number(billingId)
    ) {
      throw HttpError(409, "A linked stock movement does not belong to this bill submission.", {
        code: "SUBMISSION_MOVEMENT_MISMATCH",
        movement_id: movementId,
      });
    }
    if (reversalForMovement(movementId)) {
      continue;
    }

    const quantity = Number(movement.quantity || 0);
    const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(movement.item_id);
    if (!item || !Number.isInteger(quantity) || quantity <= 0) {
      throw HttpError(409, "The original stock movement can no longer be restored safely.", {
        code: "SUBMISSION_MOVEMENT_UNRESTORABLE",
        movement_id: movementId,
      });
    }

    const tableAllocations = allocationsForMovement(movementId);
    const metaAllocations = parseMetaAllocations(movement.meta_json);
    const sourceAllocations = tableAllocations.length ? tableAllocations : metaAllocations;
    const allocatedQuantity = sourceAllocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    if (!sourceAllocations.length || allocatedQuantity !== quantity) {
      throw HttpError(
        409,
        "The original batch allocation is incomplete. Use an authorised inventory correction.",
        { code: "SUBMISSION_REVERSAL_REQUIRES_CORRECTION", movement_id: movementId },
      );
    }

    const restoredAllocations = restoreOriginalAllocations(item.id, sourceAllocations);
    const previousQuantity = Number(item.quantity || 0);
    const nextQuantity = previousQuantity + quantity;
    assertInventoryQuantityUpdate(item.id, nextQuantity, item.row_version);

    const meta = {
      consultation_id: Number(consultationId),
      billing_id: Number(billingId),
      reversed_movement_id: movementId,
      performed_by_user_id: actor.id || null,
      performed_by_role: actor.role || "",
      performed_by_name: actorName,
      reason: String(reason || "").trim(),
      allocations: restoredAllocations,
      original_action_type: movement.action_type,
      reversal_scope: reversalScope,
      stock_out_reason: movementMeta.stock_out_reason || null,
    };

    db.prepare(`
      INSERT INTO inventory_movements (
        item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
        recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json,
        unit_cost_snapshot, unit_price_snapshot, valuation_basis
      ) VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'reversal', 'consultation', ?, ?, ?, ?, ?)
    `).run(
      item.id,
      quantity,
      previousQuantity,
      nextQuantity,
      item.owner_doctor_id || null,
      actor.id || null,
      `Reversed incorrect billing submission for consultation #${consultationId}.`,
      Number(consultationId),
      JSON.stringify(meta),
      movement.unit_cost_snapshot,
      movement.unit_price_snapshot,
      movement.valuation_basis,
    );
    const reversalId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0);
    recordMovementAllocations(reversalId, restoredAllocations);
    db.prepare(`
      INSERT INTO inventory_activity_history (
        movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type, item_name,
        quantity, direction, source_text, destination_text, batch_id, meta_json
      ) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, 'reversal', ?, ?, 'in', 'Patient Bill', 'Doctor Stock', ?, ?)
    `).run(
      reversalId,
      actor.id || null,
      actorName,
      actor.role || "",
      item.item_name || "",
      quantity,
      restoredAllocations.map((row) => row.batch_id).join(","),
      JSON.stringify(meta),
    );
    reversalIds.push(reversalId);
    touchedItemIds.add(Number(item.id));
  }

  const unlinkedDispensingIds = restoreDispensing
    ? []
    : unlinkSaleMovementsByIds(linkedDispensingIds, {
        billingId,
        consultationId,
      });

  return {
    reversed: reversalIds.length + unlinkedDispensingIds.length,
    stockMovementsReversed: reversalIds.length,
    dispensingLinksReopened: unlinkedDispensingIds.length,
    reversalIds,
    unlinkedDispensingIds,
    touchedItemIds: [...touchedItemIds],
    idempotent: reversalIds.length === 0 && unlinkedDispensingIds.length === 0,
  };
}

function reclassifyBillingSubmissionInventoryAsWastage({
  movementIds = [],
  consultationId,
  billingId,
  actor = {},
  reason = "",
}) {
  const ids = [...new Set((movementIds || []).map(Number).filter(Boolean))];
  if (!ids.length) {
    throw HttpError(409, "This submission has no traceable stock movements to reclassify.", {
      code: "SUBMISSION_RECLASSIFICATION_REQUIRES_CORRECTION",
    });
  }
  const actorName = resolveAuditActor({
    displayName: actor.full_name || actor.username,
    userId: actor.id,
    required: true,
  });
  const createdMovementIds = [];
  const touchedItemIds = new Set();

  for (const movementId of ids) {
    const existing = db.prepare(`
      SELECT id FROM inventory_movements
      WHERE action_type = 'wastage'
        AND CAST(json_extract(meta_json, '$.reclassified_movement_id') AS INTEGER) = ?
      LIMIT 1
    `).get(movementId);
    if (existing) continue;

    const movement = db.prepare("SELECT * FROM inventory_movements WHERE id = ?").get(movementId);
    let movementMeta = {};
    try { movementMeta = JSON.parse(movement?.meta_json || "{}"); } catch { movementMeta = {}; }
    const isInvoiceSale = movement?.movement_type === "out" && movement?.action_type === "sell";
    const isDispensedSale = movement?.movement_type === "out"
      && movement?.action_type === "stock_out"
      && String(movementMeta.stock_out_reason || "").toLowerCase() === "sale"
      && movementMeta.billing_status === "Billed";
    if (!movement || (!isInvoiceSale && !isDispensedSale)) {
      throw HttpError(409, "A linked sale movement is missing or cannot be reclassified.", {
        code: "SUBMISSION_MOVEMENT_INVALID",
        movement_id: movementId,
      });
    }
    if (
      Number(movementMeta.consultation_id || 0) !== Number(consultationId) ||
      Number(movementMeta.billing_id || 0) !== Number(billingId)
    ) {
      throw HttpError(409, "A linked sale movement does not belong to this invoice.", {
        code: "SUBMISSION_MOVEMENT_MISMATCH",
        movement_id: movementId,
      });
    }
    const item = db.prepare("SELECT * FROM inventory WHERE id = ?").get(movement.item_id);
    const quantity = Number(movement.quantity || 0);
    if (!item || !Number.isInteger(quantity) || quantity <= 0) {
      throw HttpError(409, "The linked stock movement cannot be reclassified safely.", {
        code: "SUBMISSION_MOVEMENT_UNRESTORABLE",
        movement_id: movementId,
      });
    }
    const currentQuantity = Number(item.quantity || 0);
    const sharedMeta = {
      consultation_id: Number(consultationId),
      billing_id: Number(billingId),
      reclassified_movement_id: movementId,
      performed_by_user_id: actor.id || null,
      performed_by_role: actor.role || "",
      performed_by_name: actorName,
      reason: String(reason || "").trim(),
      no_stock_quantity_change: true,
    };

    const offsetMeta = {
      ...sharedMeta,
      reversed_movement_id: movementId,
      original_action_type: movement.action_type,
      stock_out_reason: movementMeta.stock_out_reason || null,
      reclassification_scope: "paid_supply_correction",
    };
    db.prepare(`
      INSERT INTO inventory_movements (
        item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
        recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json,
        unit_cost_snapshot, unit_price_snapshot, valuation_basis
      ) VALUES (?, 'adjustment', ?, ?, ?, ?, ?, ?, 'reversal', 'consultation', ?, ?, ?, ?, ?)
    `).run(
      item.id, quantity, currentQuantity, currentQuantity, item.owner_doctor_id || null,
      actor.id || null, `Reclassified paid supply sale for consultation #${consultationId}.`,
      Number(consultationId), JSON.stringify(offsetMeta), movement.unit_cost_snapshot,
      movement.unit_price_snapshot, movement.valuation_basis,
    );
    const offsetId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0);

    const wastageMeta = {
      ...sharedMeta,
      original_action_type: movement.action_type,
      stock_out_reason: movementMeta.stock_out_reason || null,
      disposition: "consumed_or_wasted",
    };
    db.prepare(`
      INSERT INTO inventory_movements (
        item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
        recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json,
        unit_cost_snapshot, unit_price_snapshot, valuation_basis
      ) VALUES (?, 'adjustment', ?, ?, ?, ?, ?, ?, 'wastage', 'consultation', ?, ?, ?, ?, ?)
    `).run(
      item.id, quantity, currentQuantity, currentQuantity, item.owner_doctor_id || null,
      actor.id || null, `Consumed or wasted supply correction for consultation #${consultationId}.`,
      Number(consultationId), JSON.stringify(wastageMeta), movement.unit_cost_snapshot,
      0, movement.valuation_basis,
    );
    const wastageId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id || 0);

    for (const [newMovementId, actionType, note] of [
      [offsetId, "reversal", "Sale classification reversed without restoring stock"],
      [wastageId, "wastage", "Consumed or wasted after paid supply correction"],
    ]) {
      db.prepare(`
        INSERT INTO inventory_activity_history (
          movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type, item_name,
          quantity, direction, source_text, destination_text, meta_json
        ) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, 'adjustment', 'Patient Bill', 'Wastage', ?)
      `).run(
        newMovementId, actor.id || null, actorName, actor.role || "", actionType,
        item.item_name || "", quantity, JSON.stringify({ ...sharedMeta, note }),
      );
    }
    createdMovementIds.push(offsetId, wastageId);
    touchedItemIds.add(Number(item.id));
  }

  return { movementIds: createdMovementIds, touchedItemIds: [...touchedItemIds] };
}

function reverseWriteOffMovement(movementId, actor = {}, { reason = "", confirm = false } = {}) {
  const id = Number(movementId || 0);
  const explanation = String(reason || "").trim();
  if (!confirm) throw HttpError(400, "Confirm the compensating write-off reversal.");
  if (explanation.length < 10) throw HttpError(400, "Enter a reversal reason of at least 10 characters.");

  return db.transaction(() => {
    const movement = db.prepare(`
      SELECT m.*, i.item_name, i.owner_doctor_id, i.row_version AS item_row_version,
        i.quantity AS item_quantity
      FROM inventory_movements m
      JOIN inventory i ON i.id = m.item_id
      WHERE m.id = ?
    `).get(id);
    if (!movement || movement.movement_type !== "out" || !["remove", "wastage"].includes(movement.action_type)) {
      throw HttpError(404, "Eligible write-off movement not found.");
    }
    const existing = reversalForMovement(id);
    if (existing) return { idempotent: true, reversal_id: Number(existing.id), movement };

    const allocations = allocationsForMovement(id);
    const quantity = Number(movement.quantity || 0);
    const allocated = allocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    if (!allocations.length || allocated !== quantity) {
      throw HttpError(409, "This write-off has no complete batch evidence and cannot be automatically reversed. Use an authorised exceptional correction.");
    }

    const restored = restoreOriginalAllocations(movement.item_id, allocations);
    const previousQuantity = Number(movement.item_quantity || 0);
    const nextQuantity = previousQuantity + quantity;
    assertInventoryQuantityUpdate(movement.item_id, nextQuantity, movement.item_row_version);
    const actorName = resolveAuditActor({
      displayName: actor.full_name || actor.username,
      userId: actor.id,
      required: true,
    });
    const meta = {
      reversed_movement_id: id,
      original_action_type: movement.action_type,
      reason: explanation,
      allocations: restored,
      performed_by_user_id: actor.id || null,
      performed_by_role: actor.role || "",
      performed_by_name: actorName,
      source_location: "Write-off correction",
      destination_location: movement.owner_doctor_id ? "Doctor bag" : "Master Stock",
    };
    const inserted = db.prepare(`
      INSERT INTO inventory_movements (
        item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
        recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json,
        unit_cost_snapshot, unit_price_snapshot, valuation_basis
      ) VALUES (?, 'in', ?, ?, ?, ?, ?, ?, 'reversal', 'inventory_movement', ?, ?, ?, ?, ?)
    `).run(
      movement.item_id,
      quantity,
      previousQuantity,
      nextQuantity,
      movement.owner_doctor_id || null,
      actor.id || null,
      `Compensating reversal of write-off #${id}: ${explanation}`,
      id,
      JSON.stringify(meta),
      movement.unit_cost_snapshot,
      movement.unit_price_snapshot,
      movement.valuation_basis,
    );
    const reversalId = Number(inserted.lastInsertRowid);
    recordMovementAllocations(reversalId, restored);
    db.prepare(`
      INSERT INTO inventory_activity_history (
        movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type,
        item_name, quantity, direction, source_text, destination_text, batch_id, meta_json
      ) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, 'reversal', ?, ?, 'in', ?, ?, ?, ?)
    `).run(
      reversalId,
      actor.id || null,
      actorName,
      actor.role || "",
      movement.item_name || "",
      quantity,
      meta.source_location,
      meta.destination_location,
      restored.map((row) => row.batch_id).join(","),
      JSON.stringify(meta),
    );
    publishInventoryChange({ itemId: Number(movement.item_id), changedByUserId: actor.id || null });
    return { idempotent: false, reversal_id: reversalId, movement, restored_allocations: restored };
  }).immediate();
}

module.exports = {
  reclassifyBillingSubmissionInventoryAsWastage,
  reverseBillingSubmissionInventory,
  reverseInventoryForConsultation,
  reverseWriteOffMovement,
};
