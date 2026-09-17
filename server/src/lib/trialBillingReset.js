"use strict";

const { ensureFinancialIntegritySchema } = require("./financialIntegritySchema");
const { parseMetaAllocations, signedMovementQuantity } = require("./inventoryMovementAllocations");
const { setBillingCutoverDate } = require("./billingCutover");

const RESETTABLE_TABLES = [
  "billing",
  "billing_events",
  "billing_lite_submissions",
  "billing_quick_events",
  "billing_payment_transactions",
  "billing_payment_reversals",
  "billing_refunds",
  "billing_refund_allocations",
  "billing_supply_corrections",
  "financial_day_closings",
  "financial_day_close_settlements",
  "financial_day_close_adjustments",
  "financial_day_close_adjustment_references",
];

const DELETE_GUARD_TRIGGERS = [
  "billing_events_no_delete",
  "billing_quick_events_no_delete",
  "billing_payment_transactions_no_delete",
  "billing_payment_reversals_no_delete",
  "billing_refunds_no_delete",
  "billing_refund_allocations_no_delete",
  "billing_supply_corrections_no_delete",
  "financial_day_closings_no_delete",
  "financial_day_close_settlements_no_delete",
  "financial_day_close_adjustments_no_delete",
  "financial_day_close_adjustment_references_no_delete",
];

function tableExists(db, name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function countRows(db, table) {
  if (!tableExists(db, table)) return 0;
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseArray(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "[]") : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addMovementReferences(target, lines) {
  for (const line of parseArray(lines)) {
    for (const key of [
      "inventory_movement_ids",
      "dispensing_movement_ids",
      "linked_sale_movement_ids",
      "reversal_movement_ids",
    ]) {
      for (const id of parseArray(line?.[key])) {
        const movementId = Number(id);
        if (Number.isInteger(movementId) && movementId > 0) target.add(movementId);
      }
    }
  }
}

function collectTrialMovementIds(db, cutoverDate) {
  const billIds = new Set(
    (tableExists(db, "billing") ? db.prepare("SELECT id FROM billing").all() : [])
      .map((row) => Number(row.id)),
  );
  const movementIds = new Set();

  if (tableExists(db, "billing")) {
    for (const row of db.prepare("SELECT items FROM billing").all()) {
      addMovementReferences(movementIds, row.items);
    }
  }
  if (tableExists(db, "billing_lite_submissions")) {
    for (const row of db.prepare("SELECT items_json FROM billing_lite_submissions").all()) {
      addMovementReferences(movementIds, row.items_json);
    }
  }
  if (tableExists(db, "billing_supply_corrections")) {
    for (const row of db.prepare(`
      SELECT original_movement_ids_json, reversal_movement_ids_json
      FROM billing_supply_corrections
    `).all()) {
      for (const value of [row.original_movement_ids_json, row.reversal_movement_ids_json]) {
        for (const id of parseArray(value)) {
          const movementId = Number(id);
          if (Number.isInteger(movementId) && movementId > 0) movementIds.add(movementId);
        }
      }
    }
  }

  if (!tableExists(db, "inventory_movements")) return movementIds;
  const movements = db.prepare("SELECT id, created_at, meta_json FROM inventory_movements").all();
  const metadata = new Map(movements.map((row) => [Number(row.id), parseObject(row.meta_json)]));
  for (const row of movements) {
    const meta = metadata.get(Number(row.id));
    const linkedBillId = Number(meta.billing_id || 0);
    const isPendingTrialSale =
      String(meta.stock_out_reason || "").toLowerCase() === "sale" &&
      meta.billing_status === "Pending Manual Entry" &&
      String(row.created_at || "").slice(0, 10) < cutoverDate;
    if ((linkedBillId && billIds.has(linkedBillId)) || isPendingTrialSale) {
      movementIds.add(Number(row.id));
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [movementId, meta] of metadata.entries()) {
      const sourceIds = [meta.reversed_movement_id, meta.reclassified_movement_id]
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0);
      if (!movementIds.has(movementId) && sourceIds.some((id) => movementIds.has(id))) {
        movementIds.add(movementId);
        changed = true;
      }
    }
  }
  return movementIds;
}

function buildInventoryRestorationPlan(db, movementIds) {
  const ids = [...movementIds].sort((a, b) => a - b);
  if (!ids.length) return { ids, itemChanges: [], batchChanges: [] };
  const placeholders = ids.map(() => "?").join(",");
  const movements = db.prepare(`
    SELECT * FROM inventory_movements WHERE id IN (${placeholders}) ORDER BY id
  `).all(...ids);
  if (movements.length !== ids.length) {
    const found = new Set(movements.map((row) => Number(row.id)));
    const missing = ids.filter((id) => !found.has(id));
    throw new Error(`Cannot reset billing because stock movement(s) ${missing.join(", ")} are missing.`);
  }

  const itemEffects = new Map();
  const batchEffects = new Map();
  const allocationQuery = tableExists(db, "inventory_movement_allocations")
    ? db.prepare(`
        SELECT batch_id, quantity
        FROM inventory_movement_allocations
        WHERE movement_id = ?
        ORDER BY id
      `)
    : null;

  for (const movement of movements) {
    const signed = signedMovementQuantity(movement);
    itemEffects.set(
      Number(movement.item_id),
      (itemEffects.get(Number(movement.item_id)) || 0) + signed,
    );
    let allocations = allocationQuery?.all(movement.id) || [];
    if (!allocations.length) allocations = parseMetaAllocations(movement.meta_json);
    const allocationQuantity = allocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    if (allocationQuantity && allocationQuantity !== Math.abs(Number(movement.quantity || 0))) {
      throw new Error(`Stock movement #${movement.id} has incomplete batch allocation evidence.`);
    }
    const direction = signed < 0 ? -1 : signed > 0 ? 1 : 0;
    for (const allocation of allocations) {
      const batchId = Number(allocation.batch_id || 0);
      if (!batchId) continue;
      batchEffects.set(batchId, (batchEffects.get(batchId) || 0) + direction * Number(allocation.quantity || 0));
    }
  }

  const itemChanges = [...itemEffects.entries()].map(([itemId, netEffect]) => {
    const item = db.prepare("SELECT id, item_name, quantity FROM inventory WHERE id = ?").get(itemId);
    if (!item) throw new Error(`Stock item #${itemId} linked to trial billing no longer exists.`);
    const nextQuantity = Number(item.quantity || 0) - netEffect;
    if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
      throw new Error(`Reset would make ${item.item_name || `stock item #${itemId}`} invalid (${nextQuantity}).`);
    }
    return {
      itemId,
      itemName: String(item.item_name || ""),
      previousQuantity: Number(item.quantity || 0),
      nextQuantity,
      restoredQuantity: -netEffect,
    };
  });

  const batchChanges = [...batchEffects.entries()].map(([batchId, netEffect]) => {
    const batch = db.prepare("SELECT id, item_id, quantity_remaining FROM inventory_batches WHERE id = ?").get(batchId);
    if (!batch) throw new Error(`Batch #${batchId} linked to trial billing no longer exists.`);
    const nextQuantity = Number(batch.quantity_remaining || 0) - netEffect;
    if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
      throw new Error(`Reset would make batch #${batchId} invalid (${nextQuantity}).`);
    }
    return {
      batchId,
      itemId: Number(batch.item_id),
      previousQuantity: Number(batch.quantity_remaining || 0),
      nextQuantity,
      restoredQuantity: -netEffect,
    };
  });

  const itemRestore = new Map(itemChanges.map((row) => [row.itemId, row.restoredQuantity]));
  const allocatedRestore = new Map();
  for (const row of batchChanges) {
    allocatedRestore.set(row.itemId, (allocatedRestore.get(row.itemId) || 0) + row.restoredQuantity);
  }
  for (const [itemId, restored] of itemRestore.entries()) {
    if (restored !== (allocatedRestore.get(itemId) || 0)) {
      throw new Error(
        `Stock item #${itemId} cannot be reset safely because its billing movements do not have complete batch allocations.`,
      );
    }
  }

  return { ids, itemChanges, batchChanges };
}

function resetTrialBilling(db, { cutoverDate, reason = "Trial billing reset before go-live", dryRun = false } = {}) {
  const normalizedCutoverDate = String(cutoverDate || "").trim();
  const before = Object.fromEntries(RESETTABLE_TABLES.map((table) => [table, countRows(db, table)]));
  const movementIds = collectTrialMovementIds(db, normalizedCutoverDate);
  const inventoryPlan = buildInventoryRestorationPlan(db, movementIds);
  const billingReceiptCount = tableExists(db, "operation_receipts")
    ? Number(db.prepare("SELECT COUNT(*) AS count FROM operation_receipts WHERE scope LIKE 'billing:%'").get()?.count || 0)
    : 0;
  const plan = {
    cutoverDate: normalizedCutoverDate,
    before,
    billingReceiptCount,
    inventoryMovementsRemoved: inventoryPlan.ids.length,
    inventoryItemsRestored: inventoryPlan.itemChanges,
    inventoryBatchesRestored: inventoryPlan.batchChanges,
  };
  if (dryRun) return { dryRun: true, ...plan };

  let after;
  db.transaction(() => {
    for (const trigger of DELETE_GUARD_TRIGGERS) {
      db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    }

    for (const row of inventoryPlan.batchChanges) {
      db.prepare("UPDATE inventory_batches SET quantity_remaining = ? WHERE id = ?")
        .run(row.nextQuantity, row.batchId);
    }
    for (const row of inventoryPlan.itemChanges) {
      db.prepare(`
        UPDATE inventory
        SET quantity = ?, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(row.nextQuantity, row.itemId);
    }

    if (inventoryPlan.ids.length) {
      const placeholders = inventoryPlan.ids.map(() => "?").join(",");
      if (tableExists(db, "inventory_activity_history")) {
        db.prepare(`DELETE FROM inventory_activity_history WHERE movement_id IN (${placeholders})`)
          .run(...inventoryPlan.ids);
      }
      if (tableExists(db, "inventory_movement_allocations")) {
        db.prepare(`DELETE FROM inventory_movement_allocations WHERE movement_id IN (${placeholders})`)
          .run(...inventoryPlan.ids);
      }
      db.prepare(`DELETE FROM inventory_movements WHERE id IN (${placeholders})`).run(...inventoryPlan.ids);
    }

    const orderedDeletes = [
      "financial_day_close_adjustment_references",
      "financial_day_close_adjustments",
      "financial_day_close_settlements",
      "financial_day_closings",
      "billing_supply_corrections",
      "billing_refund_allocations",
      "billing_quick_events",
      "billing_payment_reversals",
      "billing_payment_transactions",
      "billing_refunds",
      "billing_lite_submissions",
      "billing_events",
      "billing",
    ];
    for (const table of orderedDeletes) {
      if (tableExists(db, table)) db.prepare(`DELETE FROM ${table}`).run();
    }
    if (tableExists(db, "operation_receipts")) {
      db.prepare("DELETE FROM operation_receipts WHERE scope LIKE 'billing:%'").run();
    }
    if (tableExists(db, "sqlite_sequence")) {
      const sequenceTables = orderedDeletes.filter((table) => table !== "billing_events");
      const placeholders = sequenceTables.map(() => "?").join(",");
      db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`).run(...sequenceTables);
    }
    setBillingCutoverDate(db, normalizedCutoverDate, reason);
    ensureFinancialIntegritySchema(db);
    after = Object.fromEntries(RESETTABLE_TABLES.map((table) => [table, countRows(db, table)]));
    const nonEmpty = Object.entries(after).filter(([, count]) => count !== 0);
    if (nonEmpty.length) {
      throw new Error(`Billing reset verification failed: ${nonEmpty.map(([name, count]) => `${name}=${count}`).join(", ")}`);
    }
    const missingGuards = DELETE_GUARD_TRIGGERS.filter((trigger) => !db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?",
    ).get(trigger));
    if (missingGuards.length) {
      throw new Error(`Billing reset guard verification failed: ${missingGuards.join(", ")}`);
    }
  }).immediate();
  return { dryRun: false, ...plan, after };
}

module.exports = {
  buildInventoryRestorationPlan,
  collectTrialMovementIds,
  resetTrialBilling,
};
