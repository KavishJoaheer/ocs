"use strict";

const { db } = require("../db");
const { getTodayLocal, toNumber } = require("./utils");

const NEAR_EXPIRY_DAYS = 90;
const IN_QUERY_CHUNK = 400;

function roundCurrency(value) {
  return Number(toNumber(value, 0).toFixed(2));
}

function chunkIds(ids) {
  const unique = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  const chunks = [];
  for (let i = 0; i < unique.length; i += IN_QUERY_CHUNK) {
    chunks.push(unique.slice(i, i + IN_QUERY_CHUNK));
  }
  return chunks;
}

function queryKeyedMap(sql, ids, keyName, valueName) {
  const map = new Map();
  for (const chunk of chunkIds(ids)) {
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db.prepare(sql.replace("__IN__", placeholders)).all(...chunk);
    for (const row of rows) {
      map.set(Number(row[keyName]), Number(row[valueName] || 0));
    }
  }
  return map;
}

function isNonExpiringBatch(batch) {
  return Number(batch?.is_non_expiring || 0) === 1;
}

function expiryDateValue(batch) {
  const raw = String(batch?.expiry_date || "").trim().slice(0, 10);
  return raw || null;
}

function isExpiredBatch(batch, today = getTodayLocal()) {
  if (isNonExpiringBatch(batch)) return false;
  const expiry = expiryDateValue(batch);
  if (!expiry) return false;
  return expiry < today;
}

function isMissingExpiryBatch(batch) {
  if (isNonExpiringBatch(batch)) return false;
  return !expiryDateValue(batch);
}

function daysUntilExpiry(expiry, today = getTodayLocal()) {
  const date = String(expiry || "").trim().slice(0, 10);
  if (!date) return null;
  const start = Date.parse(`${today}T00:00:00`);
  const end = Date.parse(`${date}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86400000);
}

function isNearExpiryDate(expiry, today = getTodayLocal()) {
  const days = daysUntilExpiry(expiry, today);
  return days != null && days >= 0 && days <= NEAR_EXPIRY_DAYS;
}

function batchStockState(batch, today = getTodayLocal()) {
  if (isNonExpiringBatch(batch)) return "non_expiring";
  if (isMissingExpiryBatch(batch)) return "missing_expiry";
  if (isExpiredBatch(batch, today)) return "expired";
  if (isNearExpiryDate(expiryDateValue(batch), today)) return "near_expiry";
  return "dated";
}

function batchExpiryLabel(batch, today = getTodayLocal()) {
  const state = batchStockState(batch, today);
  if (state === "non_expiring") return "Non-expiring";
  if (state === "missing_expiry") return "Expiry missing";
  if (state === "expired") return "Expired";
  return expiryDateValue(batch);
}

function loadLiveBatches(itemIds) {
  const batches = [];
  for (const chunk of chunkIds(itemIds)) {
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `
        SELECT id, item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, created_at
        FROM inventory_batches
        WHERE item_id IN (${placeholders})
          AND quantity_remaining > 0
      `,
      )
      .all(...chunk);
    batches.push(...rows);
  }
  return batches;
}

function decorateBatches(batches, { today = getTodayLocal(), reservedByBatch = new Map() } = {}) {
  return (Array.isArray(batches) ? batches : []).map((batch) => {
    const remaining = Number(batch.quantity_remaining || 0);
    const reserved = Math.max(0, Number(reservedByBatch.get(Number(batch.id)) || 0));
    const expired = remaining > 0 && isExpiredBatch(batch, today);
    const missingExpiry = remaining > 0 && isMissingExpiryBatch(batch);
    const nonExpiring = isNonExpiringBatch(batch);
    const nearExpiry = remaining > 0 && !expired && !missingExpiry && !nonExpiring && isNearExpiryDate(expiryDateValue(batch), today);
    const available = expired ? 0 : Math.max(0, remaining - reserved);
    return {
      ...batch,
      quantity_remaining: remaining,
      reserved_quantity: reserved,
      available_quantity: available,
      expired,
      missing_expiry: missingExpiry,
      is_near_expiry: nearExpiry,
      is_non_expiring: nonExpiring,
      stock_state: batchStockState(batch, today),
      expiry_label: batchExpiryLabel(batch, today),
    };
  });
}

function decorateInventoryItems(items, { today = getTodayLocal() } = {}) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return rows;
  const itemIds = rows.map((row) => Number(row.id));
  const liveBatches = loadLiveBatches(itemIds);
  const reservedByBatch = queryKeyedMap(
    `
      SELECT rb.batch_id AS batch_id, COALESCE(SUM(rb.quantity), 0) AS total
      FROM inventory_reservation_batches rb
      JOIN inventory_reservations r ON r.id = rb.reservation_id
      WHERE r.status = 'active' AND rb.batch_id IN (__IN__)
      GROUP BY rb.batch_id
    `,
    liveBatches.map((batch) => batch.id),
    "batch_id",
    "total",
  );
  const reservedByItem = queryKeyedMap(
    `
      SELECT inventory_id, COALESCE(SUM(quantity), 0) AS total
      FROM inventory_reservations
      WHERE status = 'active' AND inventory_id IN (__IN__)
      GROUP BY inventory_id
    `,
    itemIds,
    "inventory_id",
    "total",
  );
  const decoratedBatches = decorateBatches(liveBatches, { today, reservedByBatch });
  const batchesByItem = new Map();
  for (const batch of decoratedBatches) {
    const itemId = Number(batch.item_id);
    if (!batchesByItem.has(itemId)) batchesByItem.set(itemId, []);
    batchesByItem.get(itemId).push(batch);
  }

  return rows.map((item) => {
    const itemId = Number(item.id);
    const onHand = Number(item.quantity || 0);
    const batches = batchesByItem.get(itemId) || [];
    const reservedQuantity = Number(reservedByItem.get(itemId) || 0);
    const expiredQuantity = batches.reduce((sum, batch) => sum + (batch.expired ? batch.quantity_remaining : 0), 0);
    const reservedOnUsable = batches.reduce((sum, batch) => sum + (batch.expired ? 0 : batch.reserved_quantity), 0);
    const reservedOnExpired = batches.reduce((sum, batch) => sum + (batch.expired ? batch.reserved_quantity : 0), 0);
    const batchReservedTotal = reservedOnUsable + reservedOnExpired;
    const unallocatedReserved = Math.max(0, reservedQuantity - batchReservedTotal);
    const usableOnHand = Math.max(0, onHand - expiredQuantity);
    const availableToUse = Math.max(0, usableOnHand - reservedOnUsable - unallocatedReserved);
    const nearestUsableExpiry = batches
      .filter((batch) => !batch.expired && !batch.missing_expiry && !batch.is_non_expiring && expiryDateValue(batch))
      .map((batch) => expiryDateValue(batch))
      .sort()[0] || null;
    const nearestDatedExpiry = batches
      .filter((batch) => expiryDateValue(batch) && !batch.is_non_expiring)
      .map((batch) => expiryDateValue(batch))
      .sort()[0] || null;
    const hasExpired = expiredQuantity > 0;
    const batchOnHand = batches.reduce((sum, batch) => sum + Number(batch.quantity_remaining || 0), 0);
    const unbatchedQuantity = Math.max(0, onHand - batchOnHand);
    const missingExpiry =
      onHand > 0 && (batches.some((batch) => batch.missing_expiry) || unbatchedQuantity > 0);
    const hasNonExpiring = batches.some((batch) => batch.is_non_expiring);
    const isNearExpiry = batches.some((batch) => batch.is_near_expiry);
    return {
      ...item,
      quantity: onHand,
      on_hand_quantity: onHand,
      reserved_quantity: reservedQuantity,
      expired_quantity: expiredQuantity,
      available_to_use: availableToUse,
      available_to_transfer: availableToUse,
      available_to_fulfil: availableToUse,
      nearest_usable_expiry: nearestUsableExpiry,
      expiry_date: nearestUsableExpiry || (hasExpired ? nearestDatedExpiry : null),
      nearest_expiry_date: nearestDatedExpiry,
      has_expired: hasExpired,
      missing_expiry: missingExpiry,
      has_non_expiring: hasNonExpiring,
      is_near_expiry: isNearExpiry,
      is_non_expiring_only: hasNonExpiring && !missingExpiry && !hasExpired && !nearestUsableExpiry,
      unbatched_quantity: unbatchedQuantity,
      lots: String(item.stock_scope || "") === "doctor" ? batches : undefined,
    };
  });
}

function itemOnHand(item) {
  return Number(item?.on_hand_quantity ?? item?.quantity ?? 0);
}

function catalogueKey(item) {
  return `${Number(item?.folder_id || 0)}::${String(item?.item_name || "").trim().toLowerCase()}`;
}

function isAtOrBelowPar(item) {
  const par = Number(item?.minimum_quantity || 0);
  return par > 0 && itemOnHand(item) <= par;
}

function isMissingExpiryItem(item) {
  return itemOnHand(item) > 0 && Boolean(item?.missing_expiry);
}

function isNearExpiryItem(item) {
  return itemOnHand(item) > 0 && Boolean(item?.is_near_expiry);
}

function isExpiredItem(item) {
  return Number(item?.expired_quantity || 0) > 0 || Boolean(item?.has_expired);
}

function computeDoctorInventoryMetrics(bagItems, ocsItems = []) {
  const bag = Array.isArray(bagItems) ? bagItems : [];
  const ocsMap = new Map();
  for (const item of ocsItems || []) {
    ocsMap.set(catalogueKey(item), item);
  }
  const atOrBelowPar = bag.filter(isAtOrBelowPar);
  const missingExpiry = bag.filter(isMissingExpiryItem);
  const nearExpiry = bag.filter(isNearExpiryItem);
  const expired = bag.filter(isExpiredItem);
  const ocsCanFill = atOrBelowPar.filter((item) => {
    const ocs = ocsMap.get(catalogueKey(item));
    const need = Math.max(0, Number(item.minimum_quantity || 0) - itemOnHand(item));
    const atp = Number(ocs?.available_to_use || 0);
    return need > 0 && atp >= need;
  });
  return {
    at_or_below_par: atOrBelowPar.length,
    missing_expiry: missingExpiry.length,
    near_expiry: nearExpiry.length,
    expired: expired.length,
    ocs_can_fill: ocsCanFill.length,
    item_ids: {
      at_or_below_par: atOrBelowPar.map((row) => Number(row.id)),
      missing_expiry: missingExpiry.map((row) => Number(row.id)),
      near_expiry: nearExpiry.map((row) => Number(row.id)),
      expired: expired.map((row) => Number(row.id)),
      ocs_can_fill: ocsCanFill.map((row) => Number(row.id)),
    },
  };
}

function summarizeLocationValuation(items) {
  let knownValue = 0;
  let unpricedCount = 0;
  for (const item of items || []) {
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;
    const cost = toNumber(item.cost_price, 0);
    if (!(cost > 0)) {
      unpricedCount += 1;
      continue;
    }
    knownValue += qty * cost;
  }
  return {
    known_value: roundCurrency(knownValue),
    unpriced_count: unpricedCount,
    valuation_complete: unpricedCount === 0,
  };
}

function doctorBagLabel(name) {
  const trimmed = String(name || "").trim() || "Doctor";
  return `${trimmed}'s bag`;
}

function locationDisplayMeta({ isBag, doctorName }) {
  if (isBag) {
    const heading = doctorBagLabel(doctorName);
    return {
      location_kind: "bag",
      location_label: heading,
      location_heading: heading,
      value_title: "Bag value",
      low_stock_title: "Bag low stock",
      near_expiry_title: "Bag near expiry",
      missing_expiry_title: "Bag missing expiry",
      expired_title: "Bag expired stock",
      reconciliation_title: "Bag reconciliation warnings",
    };
  }
  return {
    location_kind: "warehouse",
    location_label: "OCS warehouse",
    location_heading: "OCS warehouse",
    value_title: "Warehouse value",
    low_stock_title: "Warehouse low stock",
    near_expiry_title: "Warehouse near expiry",
    missing_expiry_title: "Warehouse missing expiry",
    expired_title: "Warehouse expired stock",
    reconciliation_title: "Warehouse reconciliation warnings",
  };
}

function countReconciliationRequired(doctorId = null) {
  const scoped = Number(doctorId || 0) || null;
  return Number(
    db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM restock_requests r
        WHERE r.status IN ('accepted', 'ready')
          AND (? IS NULL OR r.doctor_id = ?)
          AND (
            NOT EXISTS (
              SELECT 1 FROM restock_request_fulfillments f
              WHERE f.request_id = r.id AND f.status IN ('open', 'picking', 'packed', 'posted')
            )
            OR EXISTS (
              SELECT 1 FROM restock_request_fulfillment_items fi
              JOIN restock_request_fulfillments f2 ON f2.id = fi.fulfilment_id
              WHERE f2.request_id = r.id
                AND fi.inventory_id IS NULL
                AND fi.requested_quantity > 0
            )
          )
      `,
      )
      .get(scoped, scoped)?.count || 0,
  );
}

function normalizeHistoryFolderOptions(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const byIdentity = new Map();
  for (const row of source) {
    const name = String(row?.name || "").trim();
    if (!name) continue;
    const parentId = row.parent_id == null || row.parent_id === "" ? "root" : String(row.parent_id);
    const key = `${parentId}::${name.toLowerCase()}`;
    const existing = byIdentity.get(key);
    if (!existing || Number(row.id) < Number(existing.id)) {
      byIdentity.set(key, row);
    }
  }
  const unique = [...byIdentity.values()];
  const leafCounts = new Map();
  for (const row of unique) {
    const leaf = String(row.name || "").trim().toLowerCase();
    leafCounts.set(leaf, (leafCounts.get(leaf) || 0) + 1);
  }
  return unique
    .map((row) => {
      const name = String(row.name || "").trim();
      const parentName = String(row.parent_name || "").trim();
      const needsPath = Boolean(parentName) && (leafCounts.get(name.toLowerCase()) || 0) > 1;
      return {
        id: row.id,
        name,
        parent_id: row.parent_id || null,
        parent_name: parentName || null,
        label: needsPath ? `${parentName} / ${name}` : name,
      };
    })
    .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base" }));
}

module.exports = {
  NEAR_EXPIRY_DAYS,
  batchExpiryLabel,
  batchStockState,
  catalogueKey,
  computeDoctorInventoryMetrics,
  countReconciliationRequired,
  decorateBatches,
  decorateInventoryItems,
  doctorBagLabel,
  isAtOrBelowPar,
  isExpiredBatch,
  isExpiredItem,
  isMissingExpiryBatch,
  isMissingExpiryItem,
  isNearExpiryDate,
  isNearExpiryItem,
  locationDisplayMeta,
  normalizeHistoryFolderOptions,
  summarizeLocationValuation,
};
