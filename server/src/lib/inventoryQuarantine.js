"use strict";

const { db } = require("../db");
const { resolveAuditActor } = require("./auditActor");
const { publishInventoryChange } = require("./inventoryRealtime");

function HttpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, extra });
}

function isQuarantinedStatus(value) {
  return String(value || "usable").trim().toLowerCase() === "quarantined";
}

function lockBatch(batchId) {
  return db.prepare("SELECT * FROM inventory_batches WHERE id = ?").get(Number(batchId));
}

function recordQuarantineEvent({
  batch,
  actionType,
  reason,
  actor = {},
  previousStatus,
  newStatus,
  meta = {},
}) {
  db.prepare(`
    INSERT INTO inventory_batch_quarantine_events (
      batch_id, item_id, action_type, reason, actor_user_id, actor_role, actor_name,
      previous_status, new_status, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(batch.id),
    Number(batch.item_id || 0) || null,
    actionType,
    reason,
    actor.userId || actor.id || null,
    actor.role || "",
    resolveAuditActor({
      displayName: actor.displayName || actor.full_name || actor.username,
      userId: actor.userId || actor.id,
      required: true,
    }),
    previousStatus,
    newStatus,
    JSON.stringify(meta),
  );
  db.prepare(`
    INSERT INTO inventory_audit_logs (
      action_type, item_id, item_name, quantity, reason, performed_by_user_id,
      performed_by_role, performed_by_name, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actionType === "release" ? "batch_quarantine_release" : "batch_quarantine",
    Number(batch.item_id || 0) || null,
    db.prepare("SELECT item_name FROM inventory WHERE id = ?").get(batch.item_id)?.item_name || "",
    Number(batch.quantity_remaining || 0),
    reason,
    actor.userId || actor.id || null,
    actor.role || "",
    resolveAuditActor({
      displayName: actor.displayName || actor.full_name || actor.username,
      userId: actor.userId || actor.id,
      required: true,
    }),
    JSON.stringify({
      batch_id: Number(batch.id),
      previous_status: previousStatus,
      new_status: newStatus,
      ...meta,
    }),
  );
}

function quarantineBatch({
  batchId,
  reason,
  confirm,
  expectedRowVersion = null,
  userId,
  actor = {},
}) {
  if (confirm !== true && confirm !== "true") {
    throw HttpError(400, "Confirm batch quarantine before applying it.");
  }
  const trimmedReason = String(reason || "").trim();
  if (trimmedReason.length < 10) {
    throw HttpError(400, "A quarantine reason of at least 10 characters is required.");
  }
  const batch = lockBatch(batchId);
  if (!batch) throw HttpError(404, "Batch not found.");
  if (
    expectedRowVersion != null &&
    expectedRowVersion !== "" &&
    Number(batch.row_version || 1) !== Number(expectedRowVersion)
  ) {
    throw HttpError(409, "This batch was updated on another device. Refresh and try again.", {
      code: "BATCH_VERSION_CONFLICT",
    });
  }
  if (isQuarantinedStatus(batch.status)) {
    return { batch, idempotent: true };
  }
  const updated = db
    .prepare(
      `
      UPDATE inventory_batches
      SET
        status = 'quarantined',
        quarantined_reason = ?,
        quarantined_at = CURRENT_TIMESTAMP,
        quarantined_by_user_id = ?,
        row_version = COALESCE(row_version, 1) + 1
      WHERE id = ? AND COALESCE(status, 'usable') != 'quarantined'
    `,
    )
    .run(trimmedReason, userId || actor.userId || actor.id || null, Number(batch.id));
  if (!updated.changes) {
    throw HttpError(409, "This batch was updated concurrently. Refresh and try again.", {
      code: "BATCH_VERSION_CONFLICT",
    });
  }
  recordQuarantineEvent({
    batch,
    actionType: "quarantine",
    reason: trimmedReason,
    actor: { ...actor, userId: userId || actor.userId || actor.id },
    previousStatus: String(batch.status || "usable"),
    newStatus: "quarantined",
  });
  publishInventoryChange({ itemId: batch.item_id, changedByUserId: userId || null });
  return { batch: lockBatch(batch.id), idempotent: false };
}

function releaseBatchQuarantine({
  batchId,
  reason,
  confirm,
  expectedRowVersion = null,
  userId,
  actor = {},
}) {
  if (confirm !== true && confirm !== "true") {
    throw HttpError(400, "Confirm releasing this batch from quarantine before applying it.");
  }
  const trimmedReason = String(reason || "").trim();
  if (trimmedReason.length < 10) {
    throw HttpError(400, "A release reason of at least 10 characters is required.");
  }
  const batch = lockBatch(batchId);
  if (!batch) throw HttpError(404, "Batch not found.");
  if (
    expectedRowVersion != null &&
    expectedRowVersion !== "" &&
    Number(batch.row_version || 1) !== Number(expectedRowVersion)
  ) {
    throw HttpError(409, "This batch was updated on another device. Refresh and try again.", {
      code: "BATCH_VERSION_CONFLICT",
    });
  }
  if (!isQuarantinedStatus(batch.status)) {
    return { batch, idempotent: true };
  }
  const updated = db
    .prepare(
      `
      UPDATE inventory_batches
      SET
        status = 'usable',
        released_reason = ?,
        released_at = CURRENT_TIMESTAMP,
        released_by_user_id = ?,
        row_version = COALESCE(row_version, 1) + 1
      WHERE id = ? AND COALESCE(status, 'usable') = 'quarantined'
    `,
    )
    .run(trimmedReason, userId || actor.userId || actor.id || null, Number(batch.id));
  if (!updated.changes) {
    throw HttpError(409, "This batch was updated concurrently. Refresh and try again.", {
      code: "BATCH_VERSION_CONFLICT",
    });
  }
  recordQuarantineEvent({
    batch,
    actionType: "release",
    reason: trimmedReason,
    actor: { ...actor, userId: userId || actor.userId || actor.id },
    previousStatus: "quarantined",
    newStatus: "usable",
  });
  publishInventoryChange({ itemId: batch.item_id, changedByUserId: userId || null });
  return { batch: lockBatch(batch.id), idempotent: false };
}

module.exports = {
  isQuarantinedStatus,
  quarantineBatch,
  releaseBatchQuarantine,
};
