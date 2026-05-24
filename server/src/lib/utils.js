function getTodayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function offsetLocalDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeBillingItems(items) {
  const parsed = Array.isArray(items) ? items : safeJsonParse(items, []);

  return parsed
    .map((item) => ({
      description: String(item?.description ?? "").trim(),
      amount: toNumber(item?.amount, 0),
      type: ["Sale", "Wastage", "Adjustment"].includes(String(item?.type || "").trim())
        ? String(item.type).trim()
        : "Sale",
      quantity: Number.isInteger(Number(item?.quantity)) ? Number(item.quantity) : 0,
      inventory_item_id: item?.inventory_item_id ? Number(item.inventory_item_id) : null,
      emergency_override: Boolean(item?.emergency_override),
      appointment_id: item?.appointment_id ? Number(item.appointment_id) : null,
    }))
    .filter((item) => item.description || item.amount);
}

function calculateBillingTotal(items) {
  return Number(
    normalizeBillingItems(items)
      .reduce((sum, item) => sum + (item.type === "Sale" ? item.amount : 0), 0)
      .toFixed(2),
  );
}

function toPagination(queryPage, queryLimit, fallbackLimit = 8, maxLimit = 100) {
  const ceiling = Math.max(1, Math.floor(Number(maxLimit) || 100));
  const page = Math.max(1, parseInt(queryPage || "1", 10));
  const limit = Math.max(1, Math.min(ceiling, parseInt(queryLimit || String(fallbackLimit), 10)));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

function parseBillingRow(row) {
  return {
    ...row,
    items: normalizeBillingItems(row.items),
    total_amount: toNumber(row.total_amount, 0),
    payment_method: row.payment_method ? String(row.payment_method).trim().toLowerCase() : null,
  };
}

module.exports = {
  calculateBillingTotal,
  getTodayLocal,
  normalizeBillingItems,
  offsetLocalDate,
  parseBillingRow,
  safeJsonParse,
  toNumber,
  toPagination,
};
