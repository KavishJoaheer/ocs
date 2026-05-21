import dayjs from "dayjs";

/**
 * @typedef {'rose' | 'amber'} InventoryAlertTone
 * @typedef {{ id: string, tone: InventoryAlertTone, title: string, detail: string, itemId: number }} DoctorInventoryAlert
 */

function formatExpiryLabel(expiryDate) {
  const parsed = dayjs(expiryDate);
  return parsed.isValid() ? parsed.format("MMM DD, YYYY") : String(expiryDate || "").trim();
}

function buildLowStockTitle(itemName, quantity) {
  if (quantity <= 0) {
    return `${itemName} Out of Stock`;
  }
  if (quantity === 1) {
    return `${itemName} Critically Low`;
  }
  return `${itemName} Low Stock`;
}

function buildLowStockDetail(quantity, parLevel) {
  const unitLabel = quantity === 1 ? "unit" : "units";
  const parHint = parLevel > 0 ? ` (Par ${parLevel})` : "";
  return `Only ${quantity} ${unitLabel} remaining in your mobile field kit bag${parHint}.`;
}

function buildExpiryDetail(item) {
  const expiryLabel = formatExpiryLabel(item.expiry_date);
  const batchRef = item.id ? `batch-${String(item.id).padStart(3, "0")}` : "batch";
  return `Batch ${batchRef} expires soon (${expiryLabel}).`;
}

/**
 * Build live inventory notifications from the doctor medical bag list.
 * Low stock: current quantity at or below par (minimum_quantity).
 * Near expiry: server-flagged batches within the near-expiry window.
 *
 * @param {Array} bagItems - `my_stock` rows from GET /inventory?context=my
 * @returns {DoctorInventoryAlert[]}
 */
export function buildDoctorInventoryNotifications(bagItems = []) {
  const notifications = [];

  bagItems.forEach((item) => {
    const itemId = Number(item.id);
    const itemName = String(item.item_name || "Item").trim();
    const currentQuantity = Number(item.quantity || 0);
    const parLevel = Number(item.minimum_quantity || 0);

    if (parLevel > 0 && currentQuantity <= parLevel) {
      notifications.push({
        id: `low-${itemId}`,
        tone: "rose",
        title: buildLowStockTitle(itemName, currentQuantity),
        detail: buildLowStockDetail(currentQuantity, parLevel),
        itemId,
      });
    }

    if (item.is_near_expiry && item.expiry_date) {
      notifications.push({
        id: `expiry-${itemId}`,
        tone: "amber",
        title: `${itemName} Near Expiry`,
        detail: buildExpiryDetail(item),
        itemId,
      });
    }
  });

  const toneRank = { rose: 0, amber: 1 };
  return notifications.sort((a, b) => {
    const toneDelta = (toneRank[a.tone] ?? 2) - (toneRank[b.tone] ?? 2);
    if (toneDelta !== 0) return toneDelta;
    return a.title.localeCompare(b.title);
  });
}

export function countNewInventoryAlerts(notifications = []) {
  return notifications.length;
}
