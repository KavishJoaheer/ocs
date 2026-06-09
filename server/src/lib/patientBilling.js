const { normalizeBillingItems, toNumber } = require("./utils");

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
    date: row.payment_date || row.consultation_date || row.created_at,
    status: row.status,
    payment_method: row.payment_method,
    items_summary: summarizeBillingItems(row.items),
    doctor_name: row.doctor_name || null,
  }));

  let total_billed = 0;
  let total_paid = 0;
  let outstanding = 0;

  for (const bill of bills) {
    total_billed += bill.amount;
    if (bill.status === "paid") {
      total_paid += bill.amount;
    } else {
      outstanding += bill.amount;
    }
  }

  return {
    bills,
    summary: { total_billed, total_paid, outstanding },
    // Kept for any callers that still read `billing`.
    billing: bills,
  };
}

module.exports = {
  serializePatientBillingRows,
  summarizeBillingItems,
};
