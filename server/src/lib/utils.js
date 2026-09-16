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

function isValidCurrencyAmount(value) {
  if (value === null || value === undefined || value === "") {
    return false;
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return false;
  }

  const cents = amount * 100;
  return Number.isSafeInteger(Math.round(cents)) && Math.abs(cents - Math.round(cents)) < 1e-8;
}

function billingItemsValidationError(items, { allowEmpty = false } = {}) {
  const parsed = Array.isArray(items) ? items : safeJsonParse(items, null);
  if (!Array.isArray(parsed)) {
    return "Billing items must be supplied as a list.";
  }
  if (!allowEmpty && parsed.length === 0) {
    return "At least one billing line item is required.";
  }

  for (let index = 0; index < parsed.length; index += 1) {
    const item = parsed[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return `Billing line ${index + 1} is invalid.`;
    }
    if (!isValidCurrencyAmount(item.amount)) {
      return `Billing line ${index + 1} amount must be zero or more and use no more than two decimal places.`;
    }
    if (item.inventory_item_id != null && item.inventory_item_id !== "") {
      const inventoryItemId = Number(item.inventory_item_id);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(inventoryItemId) || inventoryItemId <= 0) {
        return `Billing line ${index + 1} has an invalid inventory item.`;
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return `Billing line ${index + 1} inventory quantity must be a positive whole number.`;
      }
    }
    if (String(item.type || "").trim() === "Wastage") {
      if (String(item.wastage_reason || "").trim().length < 8) {
        return `Wastage line ${index + 1} needs a meaningful reason of at least 8 characters.`;
      }
      const batchId = Number(item.batch_id || 0);
      if (!Number.isInteger(batchId) || batchId <= 0) {
        return `Wastage line ${index + 1} needs the affected batch or lot.`;
      }
    }
  }

  return null;
}

function normalizeBillingItems(items) {
  const parsed = Array.isArray(items) ? items : safeJsonParse(items, []);

  return parsed
    .map((item) => {
      const amount = toNumber(item?.amount, 0);
      const quantity = Number.isInteger(Number(item?.quantity)) ? Number(item.quantity) : 0;
      const suppliedUnitPrice = isValidCurrencyAmount(item?.unit_price)
        ? Number(item.unit_price)
        : null;
      const unitPrice = suppliedUnitPrice ?? Number((quantity > 0 ? amount / quantity : amount).toFixed(2));
      return {
        description: String(item?.description ?? "").trim(),
        amount,
        unit_price: unitPrice,
        type: ["Sale", "Wastage", "Adjustment"].includes(String(item?.type || "").trim())
          ? String(item.type).trim()
          : "Sale",
        quantity,
        inventory_item_id: item?.inventory_item_id ? Number(item.inventory_item_id) : null,
        emergency_override: Boolean(item?.emergency_override),
        ...(String(item?.wastage_reason || "").trim()
          ? { wastage_reason: String(item.wastage_reason).trim().slice(0, 500) }
          : {}),
        ...(Number.isInteger(Number(item?.batch_id)) && Number(item.batch_id) > 0
          ? { batch_id: Number(item.batch_id) }
          : {}),
        ...(item?.is_consultation_fee ? {is_consultation_fee:true} : {}),
        ...(Array.isArray(item?.dispensing_movement_ids) ? {dispensing_movement_ids: item.dispensing_movement_ids.map(Number)} : {}),
        ...(Array.isArray(item?.inventory_movement_ids) ? {inventory_movement_ids: item.inventory_movement_ids.map(Number).filter(Boolean)} : {}),
        appointment_id: item?.appointment_id ? Number(item.appointment_id) : null,
      };
    })
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

function summarizeBillingItems(items) {
  const normalized = normalizeBillingItems(items);
  if (!normalized.length) {
    return "Medical service";
  }

  const descriptions = normalized.map((item) => item.description).filter(Boolean);
  return descriptions.join(", ") || "Medical service";
}

function serializePatientBillingRows(rows) {
  const bills = rows.map((row) => ({
    id: row.id,
    amount: toNumber(row.total_amount, 0),
    refunded_amount: toNumber(row.refunded_amount, 0),
    net_paid_amount: row.status === "paid"
      ? Math.max(0, toNumber(row.total_amount, 0) - toNumber(row.refunded_amount, 0))
      : 0,
    date: row.payment_date || row.consultation_date || row.created_at,
    status: row.status,
    payment_method: row.payment_method,
    items_summary: summarizeBillingItems(row.items),
    doctor_name: row.doctor_name || null,
    linkham_claim_status: row.linkham_claim_status || null,
    dispute_status: row.dispute_status || null,
    dispute_reason: row.dispute_reason || null,
  }));

  let total_billed = 0;
  let total_paid = 0;
  let total_refunded = 0;
  let outstanding = 0;

  for (const bill of bills) {
    total_billed += bill.amount;
    if (bill.status === "paid") {
      total_paid += bill.net_paid_amount;
      total_refunded += bill.refunded_amount;
    } else {
      outstanding += bill.amount;
    }
  }

  return {
    bills,
    summary: { total_billed, total_paid, total_refunded, outstanding },
    billing: bills,
  };
}

module.exports = {
  billingItemsValidationError,
  calculateBillingTotal,
  getTodayLocal,
  isValidCurrencyAmount,
  normalizeBillingItems,
  offsetLocalDate,
  parseBillingRow,
  safeJsonParse,
  serializePatientBillingRows,
  summarizeBillingItems,
  toNumber,
  toPagination,
};
