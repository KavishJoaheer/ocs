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
    }))
    .filter((item) => item.description || item.amount);
}

function calculateBillingTotal(items) {
  return Number(
    normalizeBillingItems(items)
      .reduce((sum, item) => sum + item.amount, 0)
      .toFixed(2),
  );
}

function toPagination(queryPage, queryLimit, fallbackLimit = 8) {
  const page = Math.max(1, parseInt(queryPage || "1", 10));
  const limit = Math.max(1, Math.min(100, parseInt(queryLimit || String(fallbackLimit), 10)));
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
