export function doctorBagHeading(name) {
  const trimmed = String(name || "").trim() || "Doctor";
  return `${trimmed}'s bag`;
}

export function formatExpiryDate(value) {
  const raw = String(value || "").trim().slice(0, 10);
  if (!raw) return "";
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatStockExpiryLabel(itemOrBatch = {}) {
  if (
    itemOrBatch.is_non_expiring
    || itemOrBatch.stock_state === "non_expiring"
    || itemOrBatch.expiry_label === "Non-expiring"
    || itemOrBatch.is_non_expiring_only
  ) {
    return "Non-expiring";
  }
  if (
    itemOrBatch.expired
    || itemOrBatch.stock_state === "expired"
    || itemOrBatch.expiry_label === "Expired"
    || (itemOrBatch.has_expired && !itemOrBatch.nearest_usable_expiry)
  ) {
    return "Expired";
  }
  if (
    itemOrBatch.missing_expiry
    || itemOrBatch.stock_state === "missing_expiry"
    || itemOrBatch.expiry_label === "Expiry missing"
  ) {
    return "Expiry missing";
  }
  const dated = itemOrBatch.nearest_usable_expiry || itemOrBatch.expiry_date || itemOrBatch.expiry_label;
  if (dated && dated !== "Expired" && dated !== "Expiry missing" && dated !== "Non-expiring") {
    return formatExpiryDate(dated) || dated;
  }
  return "Expiry missing";
}

export function itemHasExpiredStock(item) {
  return Boolean(item?.has_expired) || Number(item?.expired_quantity || 0) > 0;
}

export const ATP_HELP_TEXT =
  "Available to promise (ATP) is usable on-hand stock minus active reservations, expired units and quarantined units. It is never negative.";

export function inventoryQuantityBreakdown(item = {}) {
  const onHand = Number(item.on_hand_quantity ?? item.quantity ?? 0);
  const reserved = Number(item.reserved_quantity || 0);
  const expired = Number(item.expired_quantity || 0);
  const atp = Math.max(
    0,
    Number(item.available_to_promise ?? item.available_to_use ?? Math.max(0, onHand - reserved - expired)),
  );
  const minimum = Number(item.minimum_quantity || 0);
  return { onHand, reserved, expired, atp, minimum };
}
