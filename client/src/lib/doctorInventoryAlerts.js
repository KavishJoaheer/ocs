import { isAtOrBelowPar, isOutOfStock, isExpiredItem, isNearExpiryItem, isMissingExpiryItem, itemAvailable, itemOnHand } from "./doctorInventoryMetrics.js";

/**
 * Count bag items at or below par (minimum_quantity).
 * Matches GET /inventory doctor_metrics.at_or_below_par.
 * @param {Array} bagItems - `my_stock` rows from GET /inventory
 */
export function countDoctorBagLowStock(bagItems = []) {
  return bagItems.filter((item) => isAtOrBelowPar(item)).length;
}

export function doctorBagReadiness(bagItems = []) {
  const stock = bagItems.filter(item => !item.is_service && String(item.item_type || item.type || "").toLowerCase() !== "service");
  if (!stock.some(item => itemAvailable(item) > 0)) return { label: "No usable bag stock", attention: true };
  const low = stock.filter(isAtOrBelowPar).length;
  const out = stock.filter(isOutOfStock).length;
  if (out) return { label: `${out} item${out === 1 ? "" : "s"} out of stock`, attention: true };
  if (low) return { label: `${low} item${low === 1 ? "" : "s"} low`, attention: true };
  if (stock.some(item => isExpiredItem(item) || isNearExpiryItem(item) || isMissingExpiryItem(item) || item.has_quarantined)) return { label: "Stock needs attention", attention: true };
  const tracked = stock.filter(item => itemOnHand(item) > 0 || item.ever_stocked || Number(item.minimum_quantity || 0) > 0);
  const configured = tracked.filter(item => Number(item.minimum_quantity || 0) > 0).length;
  if (!configured) return { label: "Minimum levels not set", attention: true };
  if (configured < tracked.length) return { label: "Some minimum levels missing", attention: true };
  return { label: "Stock sufficient", attention: false };
}
