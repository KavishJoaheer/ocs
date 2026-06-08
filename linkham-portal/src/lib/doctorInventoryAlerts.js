/**
 * Count bag items at or below par (minimum_quantity).
 * @param {Array} bagItems - `my_stock` rows from GET /inventory?context=my
 */
export function countDoctorBagLowStock(bagItems = []) {
  return bagItems.filter((item) => {
    const parLevel = Number(item.minimum_quantity || 0);
    const currentQuantity = Number(item.quantity || 0);
    return parLevel > 0 && currentQuantity <= parLevel;
  }).length;
}
