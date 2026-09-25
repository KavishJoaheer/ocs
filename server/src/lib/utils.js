const MAURITIUS_OFFSET_MS = 4 * 60 * 60 * 1000;

function getTodayLocal(now = new Date()) {
  return new Date(now.getTime() + MAURITIUS_OFFSET_MS).toISOString().slice(0, 10);
}

function offsetLocalDate(days) {
  const [year, month, day] = getTodayLocal().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + Number(days || 0))).toISOString().slice(0, 10);
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
        ...(item?.is_service_charge ? {is_service_charge:true} : {}),
        ...(Number(item?.service_catalog_item_id) > 0
          ? { service_catalog_item_id: Number(item.service_catalog_item_id) }
          : {}),
        ...(String(item?.mask_size || "").trim()
          ? { mask_size: String(item.mask_size).trim().toLowerCase() }
          : {}),
        ...(String(item?.enema_size || "").trim()
          ? { enema_size: String(item.enema_size).trim().toLowerCase() }
          : {}),
        ...(String(item?.cannula_size || "").trim()
          ? { cannula_size: String(item.cannula_size).trim().toLowerCase() }
          : {}),
        ...(String(item?.catheter_size || "").trim()
          ? { catheter_size: String(item.catheter_size).trim() }
          : {}),
        ...(String(item?.ngt_size || "").trim()
          ? { ngt_size: String(item.ngt_size).trim() }
          : {}),
        ...(isValidCurrencyAmount(item?.catalog_unit_price)
          ? {catalog_unit_price:Number(item.catalog_unit_price)}
          : {}),
        ...(String(item?.price_adjustment_reason || "").trim()
          ? {price_adjustment_reason:String(item.price_adjustment_reason).trim().slice(0,500)}
          : {}),
        ...(item?.price_adjusted_by_user_id ? {price_adjusted_by_user_id:Number(item.price_adjusted_by_user_id)} : {}),
        ...(String(item?.price_adjusted_by_name || "").trim()
          ? {price_adjusted_by_name:String(item.price_adjusted_by_name).trim().slice(0,200)}
          : {}),
        ...(String(item?.price_adjusted_by_role || "").trim()
          ? {price_adjusted_by_role:String(item.price_adjusted_by_role).trim().slice(0,50)}
          : {}),
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

function patientChargeableBillingItems(items) {
  return normalizeBillingItems(items).filter((item) => item.type === "Sale");
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
  const normalized = patientChargeableBillingItems(items);
  if (!normalized.length) {
    return "Medical service";
  }

  const descriptions = normalized.map((item) => item.description).filter(Boolean);
  return descriptions.join(", ") || "Medical service";
}

function serializePatientBillingRows(rows) {
  const bills = rows.map((row) => {
    const amount = toNumber(row.total_amount, 0);
    const ledgerReceivedAmount = toNumber(row.payment_received_amount, 0);
    const receivedAmount = ledgerReceivedAmount > 0
      ? ledgerReceivedAmount
      : row.status === "paid" ? amount : 0;
    const refundedAmount = toNumber(row.refunded_amount, 0);
    const outstandingAmount = Math.max(
      0,
      row.status === "paid" && ledgerReceivedAmount <= 0
        ? 0
        : toNumber(row.payment_balance_amount, amount - receivedAmount),
    );
    const paymentState = outstandingAmount <= 0.000001
      ? "paid"
      : receivedAmount > 0.000001
        ? "partial"
        : "unpaid";
    return {
      id: row.id,
      amount,
      payment_received_amount: receivedAmount,
      payment_balance_amount: outstandingAmount,
      refunded_amount: refundedAmount,
      net_paid_amount: Math.max(0, receivedAmount - refundedAmount),
      invoice_date: row.issued_at || row.created_at,
      consultation_date: row.consultation_date || null,
      last_payment_date: row.payment_date || null,
      date: row.issued_at || row.created_at || row.consultation_date,
      status: paymentState,
      payment_method: row.payment_method,
      items_summary: summarizeBillingItems(row.items),
      doctor_name: row.doctor_name || null,
      linkham_claim_status: row.linkham_claim_status || null,
      dispute_status: row.dispute_status || null,
      dispute_reason: row.dispute_reason || null,
    };
  });

  let total_billed = 0;
  let total_paid = 0;
  let total_refunded = 0;
  let outstanding = 0;

  for (const bill of bills) {
    total_billed += bill.amount;
    total_paid += bill.net_paid_amount;
    total_refunded += bill.refunded_amount;
    outstanding += bill.payment_balance_amount;
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
  patientChargeableBillingItems,
  safeJsonParse,
  serializePatientBillingRows,
  summarizeBillingItems,
  toNumber,
  toPagination,
};
