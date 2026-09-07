import { isAtOrBelowPar } from "./doctorInventoryMetrics.js";

/**
 * Count bag items at or below par (minimum_quantity).
 * Matches GET /inventory doctor_metrics.at_or_below_par.
 * @param {Array} bagItems - `my_stock` rows from GET /inventory
 */
export function countDoctorBagLowStock(bagItems = []) {
  return bagItems.filter((item) => isAtOrBelowPar(item)).length;
}
