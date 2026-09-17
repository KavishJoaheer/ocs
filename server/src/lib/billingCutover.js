"use strict";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getBillingCutoverDate(db) {
  const table = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'billing_system_settings'")
    .get();
  if (!table) return "";
  const value = String(
    db.prepare("SELECT cutover_date FROM billing_system_settings WHERE id = 1").get()?.cutover_date || "",
  ).trim();
  return DATE_PATTERN.test(value) ? value : "";
}

function assertValidBillingCutoverDate(value) {
  const normalized = String(value || "").trim();
  if (!DATE_PATTERN.test(normalized)) {
    throw new Error("Billing cutover date must use YYYY-MM-DD format.");
  }
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error("Billing cutover date is not a valid calendar date.");
  }
  return normalized;
}

function setBillingCutoverDate(db, value, reason = "") {
  const cutoverDate = assertValidBillingCutoverDate(value);
  db.prepare(`
    INSERT INTO billing_system_settings (id, cutover_date, reset_at, reset_reason)
    VALUES (1, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(id) DO UPDATE SET
      cutover_date = excluded.cutover_date,
      reset_at = excluded.reset_at,
      reset_reason = excluded.reset_reason
  `).run(cutoverDate, String(reason || "").trim());
  return cutoverDate;
}

module.exports = {
  assertValidBillingCutoverDate,
  getBillingCutoverDate,
  setBillingCutoverDate,
};
