const express = require("express");
const { db } = require("../db");
const {
  billingItemsValidationError,
  calculateBillingTotal,
  getTodayLocal,
  isValidCurrencyAmount,
  normalizeBillingItems,
  parseBillingRow,
  safeJsonParse,
} = require("../lib/utils");
const { isLinkhamInsuranceProvider } = require("../lib/insuranceProvider");
const {
  publishInventoryChange,
  publishLinkhamClaimsChange,
  publishPatientDataChange,
} = require("../lib/inventoryRealtime");
const {
  findUnbilledSaleCredit,
  markSaleMovementsBilled,
  pendingSales,
  matchesVisit,
} = require("../lib/saleBillingLinkage");
const { decorateInventoryItems } = require("../lib/inventoryStockState");
const {
  consumeAvailableBatch,
  consumeAvailableFefo,
  listAllocatableBatches,
} = require("../lib/restockFulfilment");
const { assertInventoryQuantityUpdate, InventoryVersionConflictError } = require("../lib/inventoryQuantity");
const { recordMovementAllocations } = require("../lib/inventoryMovementAllocations");
const {
  reclassifyBillingSubmissionInventoryAsWastage,
  reverseBillingSubmissionInventory,
} = require("../lib/inventoryReversal");
const { getDoctorUserId, sendPushToUser } = require("../lib/push");
const { getBillingCutoverDate } = require("../lib/billingCutover");

const { operationFor } = require("../lib/operationReceipts");
const {
  CONSULTATION_FEES,
  MAX_CONSULTATION_FEE,
  isConsultationFee,
  assertSingleVisitFee,
  assertVisitReadyForPayment,
} = require("../lib/consultationFees");
const router = express.Router();
function validPaymentDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function isValidSignedCurrencyAmount(value) {
  if (value === null || value === undefined || value === '') return false;
  const amount = Number(value);
  return Number.isFinite(amount) && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-8;
}
function assertBusinessDateOpen(value) {
  const closing = db.prepare(`
    SELECT id, closed_by_name, created_at
    FROM financial_day_closings
    WHERE business_date = ?
  `).get(value);
  if (closing) {
    throw Object.assign(
      new Error(`The finance day for ${value} is closed. Post the transaction on an open date or ask finance to document a correction.`),
      { status: 409, extra: { code: "FINANCIAL_DAY_CLOSED", closing_id: closing.id } },
    );
  }
}
function assertNotFutureBusinessDate(value, label = "Transaction") {
  if (value > getTodayLocal()) {
    throw Object.assign(
      new Error(`${label} date cannot be later than today in Mauritius.`),
      { status: 400, extra: { code: "FUTURE_FINANCIAL_DATE" } },
    );
  }
}
function paymentTransactionsForBill(billId) {
  return db.prepare(`
    SELECT ledger_id AS id, billing_id, payment_transaction_id, amount, payment_method,
      transaction_date AS payment_date, external_reference, operation_id,
      actor_user_id AS recorded_by_user_id, actor_name AS recorded_by_name,
      actor_role AS recorded_by_role, source, entry_type, reason, created_at
    FROM billing_payment_ledger
    WHERE billing_id = ?
    ORDER BY transaction_date ASC, created_at ASC, ledger_id ASC
  `).all(billId).map((payment) => ({
    ...payment,
    amount: roundCurrency(payment.amount),
  }));
}
function paymentSummaryForBill(billId, totalAmount) {
  const payments = paymentTransactionsForBill(billId);
  const receivedAmount = roundCurrency(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  const balanceAmount = roundCurrency(Math.max(0, Number(totalAmount || 0) - receivedAmount));
  const lastPayment = payments.filter((payment) => payment.entry_type === "payment").at(-1) || null;
  return {
    payments,
    payment_received_amount: receivedAmount,
    payment_balance_amount: balanceAmount,
    payment_state: receivedAmount <= 0 ? "unpaid" : balanceAmount > 0 ? "partial" : "paid",
    payment_count: payments.filter((payment) => payment.entry_type === "payment").length,
    payment_reversal_count: payments.filter((payment) => payment.entry_type === "reversal").length,
    last_payment_method: lastPayment?.payment_method || null,
    last_payment_date: lastPayment?.payment_date || null,
  };
}
function syncBillingPaymentSummary(billId, actor, changeReason = "") {
  const bill = db.prepare("SELECT id, total_amount FROM billing WHERE id = ?").get(billId);
  if (!bill) throw Object.assign(new Error("Bill not found."), { status: 404 });
  const summary = paymentSummaryForBill(billId, bill.total_amount);
  db.prepare(`
    UPDATE billing
    SET status = ?, payment_method = ?, payment_date = ?, updated_at = CURRENT_TIMESTAMP,
      updated_by_user_id = ?, change_reason = ?
    WHERE id = ?
  `).run(
    summary.payment_state === "paid" ? "paid" : "unpaid",
    summary.last_payment_method,
    summary.last_payment_date,
    actor?.id || null,
    String(changeReason || (
      summary.payment_state === "paid"
        ? "Payment completed"
        : summary.payment_state === "partial"
          ? "Partial payment recorded"
          : "Payment balance cleared"
    )),
    billId,
  );
  return summary;
}
function recordPaymentTransaction({ bill, amount, paymentMethod, paymentDate, externalReference, operationId, actor }) {
  if (!isValidCurrencyAmount(amount) || Number(amount) <= 0) {
    throw Object.assign(new Error("Enter a positive payment amount using no more than two decimal places."), { status: 400 });
  }
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw Object.assign(new Error("Select a valid payment method: cash, juice, card, or IB."), { status: 400 });
  }
  if (!validPaymentDate(paymentDate)) {
    throw Object.assign(new Error("Enter a valid payment date (YYYY-MM-DD)."), { status: 400 });
  }
  assertNotFutureBusinessDate(paymentDate, "Payment");
  assertBusinessDateOpen(paymentDate);
  const reference = normalizeSourceReference(externalReference);
  if (paymentMethod !== "cash" && reference.length < 3) {
    throw Object.assign(new Error("Enter the Juice, card, or IB transaction reference."), { status: 400 });
  }
  const key = String(operationId || "").trim();
  if (!key) throw Object.assign(new Error("A unique payment operation reference is required."), { status: 400 });
  const roundedAmount = roundCurrency(amount);
  const existing = db.prepare("SELECT * FROM billing_payment_transactions WHERE operation_id = ?").get(key);
  if (existing) {
    const same = Number(existing.billing_id) === Number(bill.id)
      && Number(existing.amount) === roundedAmount
      && existing.payment_method === paymentMethod
      && existing.payment_date === paymentDate
      && String(existing.external_reference || "") === reference;
    if (!same) throw Object.assign(new Error("That payment operation reference was already used for different details."), { status: 409 });
    return existing;
  }
  const summary = paymentSummaryForBill(bill.id, bill.total_amount);
  if (roundedAmount > summary.payment_balance_amount + 0.000001) {
    throw Object.assign(new Error(`Payment exceeds the outstanding balance of Rs ${summary.payment_balance_amount.toFixed(2)}.`), { status: 409 });
  }
  const result = db.prepare(`
    INSERT INTO billing_payment_transactions (
      billing_id, amount, payment_method, payment_date, external_reference,
      operation_id, recorded_by_user_id, recorded_by_name, recorded_by_role, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded')
  `).run(
    bill.id,
    roundedAmount,
    paymentMethod,
    paymentDate,
    reference || null,
    key,
    actor?.id || null,
    String(actor?.full_name || actor?.username || ""),
    String(actor?.role || ""),
  );
  return db.prepare("SELECT * FROM billing_payment_transactions WHERE id = ?").get(Number(result.lastInsertRowid));
}
function billingDateSql(req) {
  return req.query.dateBasis === "payment"
    ? "CASE WHEN b.status = 'paid' THEN COALESCE(NULLIF(b.payment_date, ''), date(b.created_at, '+4 hours')) ELSE date(COALESCE(NULLIF(b.consultation_date_snapshot, ''), c.consultation_date)) END"
    : "date(COALESCE(NULLIF(b.consultation_date_snapshot, ''), c.consultation_date))";
}
function isBillFinalized(bill) {
  return Boolean(bill?.finalized_at);
}
function assertBillFinalized(bill) {
  if (!isBillFinalized(bill)) {
    throw Object.assign(
      new Error("Finish Review and issue before recording payment for this draft invoice."),
      { status: 409, extra: { code: "BILLING_NOT_FINALIZED", bill_id: Number(bill?.id || 0) || null } },
    );
  }
}
function validateConsultationFeePolicy(items, { existingItems = [], reason = "" } = {}) {
  const fees = normalizeBillingItems(items).filter(isConsultationFee);
  if (fees.length > 1) {
    return "A visit can have only one consultation charge.";
  }
  if (!fees.length) return null;
  const fee = fees[0];
  const type = String(fee.description || "").trim();
  const amount = Number(fee.amount);
  if (!isValidCurrencyAmount(fee.amount) || amount <= 0 || amount > MAX_CONSULTATION_FEE) {
    return `Consultation prices must be between Rs 0.01 and Rs ${MAX_CONSULTATION_FEE.toLocaleString("en-MU")}.`;
  }
  const previous = normalizeBillingItems(existingItems).find(isConsultationFee);
  const changed = !previous || String(previous.description || "").trim() !== type || roundCurrency(previous.amount) !== roundCurrency(amount);
  const isKnownType = Object.prototype.hasOwnProperty.call(CONSULTATION_FEES, type);
  if (!isKnownType) {
    const sameLegacyType = previous && String(previous.description || "").trim() === type;
    if (!sameLegacyType) return "Select Day, Night, or Review Consultation.";
    if (changed && String(reason || "").trim().length < 8) {
      return "Explain why this historical consultation price is being adjusted (at least 8 characters).";
    }
    return null;
  }
  const differsFromTariff = roundCurrency(amount) !== roundCurrency(CONSULTATION_FEES[type]);
  if (changed && differsFromTariff && String(reason || "").trim().length < 8) {
    return "Explain why this consultation price differs from the configured tariff (at least 8 characters).";
  }
  return null;
}
function inventorySignature(items) {
  return JSON.stringify(normalizeBillingItems(items).filter(i => i.inventory_item_id).map(i =>
    [i.inventory_item_id, i.quantity, i.type, i.amount, i.description, Boolean(i.emergency_override)]
  ).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
const PAYMENT_METHODS = new Set(["cash", "juice", "card", "ib"]);
const BILLING_READ_ROLES = new Set(["admin", "doctor", "accountant", "operator"]);
const BILLING_WRITE_ROLES = new Set(["admin", "doctor", "accountant", "operator"]);

router.use((req, res, next) => {
  const role = String(req.auth?.role || "").trim().toLowerCase();
  const allowed = req.method === "GET" ? BILLING_READ_ROLES : BILLING_WRITE_ROLES;
  if (!allowed.has(role)) {
    return res.status(403).json({ error: "You do not have permission to access billing." });
  }
  return next();
});

function ensureActivityHistoryTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_activity_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movement_id INTEGER,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actor_user_id INTEGER,
      actor_name TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL DEFAULT '',
      action_type TEXT NOT NULL DEFAULT '',
      item_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT '',
      source_text TEXT NOT NULL DEFAULT '',
      destination_text TEXT NOT NULL DEFAULT '',
      batch_id TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_activity_timestamp ON inventory_activity_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_inventory_activity_action ON inventory_activity_history(action_type);
  `);
}

function notifyLinkhamBillingIfNeeded(patientId, userId) {
  if (String(process.env.LINKHAM_BILLING_ENABLED || "").trim().toLowerCase() !== "true") {
    return;
  }
  const pid = Number(patientId || 0);
  if (!pid) {
    return;
  }

  const patient = db.prepare("SELECT insurance_provider FROM patients WHERE id = ?").get(pid);
  if (!isLinkhamInsuranceProvider(patient?.insurance_provider)) {
    return;
  }

  publishLinkhamClaimsChange({
    changedByUserId: userId || null,
  });
}

function normalizePaymentMethod(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function normalizeSourceReference(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function consultationTypeFromItems(items) {
  return String(normalizeBillingItems(items).find(isConsultationFee)?.description || "").trim();
}

function assertNoManualInventoryBypass(consultation, items) {
  const normalizeName = (value) => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const compactName = (value) => normalizeName(value).replace(/\s+/g, "");
  const editDistance = (left, right) => {
    const a = compactName(left);
    const b = compactName(right);
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[b.length];
  };
  const resemblesInventory = (description, itemName) => {
    const descriptionKey = compactName(description);
    const itemKey = compactName(itemName);
    if (!descriptionKey || !itemKey) return false;
    if (descriptionKey === itemKey) return true;
    if (Math.min(descriptionKey.length, itemKey.length) >= 5 &&
        (descriptionKey.includes(itemKey) || itemKey.includes(descriptionKey))) return true;
    const threshold = Math.max(1, Math.floor(Math.max(descriptionKey.length, itemKey.length) * 0.16));
    if (editDistance(descriptionKey, itemKey) <= threshold) return true;
    const descriptionTokens = normalizeName(description).split(" ").filter((token) => token.length >= 2);
    const itemTokens = normalizeName(itemName).split(" ").filter((token) => token.length >= 2);
    return descriptionTokens.length > 0 && descriptionTokens.every((token) =>
      itemTokens.some((candidate) => candidate === token ||
        (Math.min(candidate.length, token.length) >= 3 && (candidate.startsWith(token) || token.startsWith(candidate)))),
    );
  };
  const manualSales = normalizeBillingItems(items).filter(
    (item) => !item.inventory_item_id && item.type === "Sale" && !isConsultationFee(item) && item.description,
  );
  if (!manualSales.length) return;

  const unclassified = manualSales.find((item) => item.is_service_charge !== true);
  if (unclassified) {
    throw Object.assign(
      new Error(`${unclassified.description} must be explicitly recorded as a service/non-stock charge or selected from inventory.`),
      { status: 409, extra: { code: "UNCLASSIFIED_BILLING_LINE" } },
    );
  }

  const catalogueNames =
    db.prepare(`
      SELECT item_name
      FROM inventory
      WHERE trim(COALESCE(item_name, '')) != ''
    `).all().map((row) => String(row.item_name || ""));
  const bypass = manualSales.find((item) =>
    catalogueNames.some((catalogueName) => resemblesInventory(item.description, catalogueName)),
  );
  if (bypass) {
    throw Object.assign(
      new Error(`${bypass.description} is a stocked supply. Select it from inventory so stock and cost records stay complete.`),
      { status: 409, extra: { code: "STOCK_ITEM_REQUIRES_SELECTION" } },
    );
  }
}

function getBillingIssueSnapshot(consultation, items, actor) {
  const user = actor?.id
    ? db.prepare("SELECT full_name, role FROM users WHERE id = ?").get(actor.id)
    : null;
  return {
    issuedByUserId: actor?.id || null,
    issuedByName: String(actor?.full_name || user?.full_name || actor?.username || "System"),
    issuedByRole: String(actor?.role || user?.role || "system"),
    patientIdentifier: String(consultation?.patient_identifier || ""),
    patientName: String(consultation?.patient_name || ""),
    doctorId: Number(consultation?.doctor_id || 0) || null,
    doctorName: String(consultation?.doctor_name || ""),
    consultationDate: consultation?.consultation_date || null,
    consultationType: consultationTypeFromItems(items),
    partnerCategory: String(consultation?.insurance_provider || "").trim() || "Self-pay",
  };
}

function buildDoctorAccessClause(auth) {
  if (auth?.role === "doctor") {
    const accessDoctorId = Number(auth.doctor_id || 0);
    if (!accessDoctorId) {
      return {
        clause: "AND 1 = 0",
        params: {},
      };
    }

    return {
      clause: "AND COALESCE(b.doctor_id_snapshot, c.doctor_id) = @accessDoctorId",
      params: { accessDoctorId },
    };
  }

  return {
    clause: "",
    params: {},
  };
}

function getConsultationContext(consultationId) {
  return db
    .prepare(`
      SELECT
        c.id,
        c.appointment_id,
        c.patient_id,
        c.doctor_id,
        c.consultation_date,
        c.voided_at,
        p.full_name AS patient_name,
        p.patient_identifier,
        p.insurance_provider,
        d.full_name AS doctor_name
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE c.id = ?
        AND p.deleted_at IS NULL
    `)
    .get(consultationId);
}

function assertBillingActorConsultationAccess(auth, consultation, submittedDoctorId) {
  if (auth?.role === "doctor") {
    if (!auth.doctor_id || Number(consultation?.doctor_id) !== Number(auth.doctor_id)) {
      throw Object.assign(
        new Error("You can only create billing for consultations completed by you."),
        { status: 403, extra: { code: "DOCTOR_CONSULTATION_SCOPE" } },
      );
    }
    return;
  }

  if (auth?.role === "operator") {
    const doctorId = Number(submittedDoctorId || 0);
    if (!Number.isInteger(doctorId) || doctorId <= 0) {
      throw Object.assign(
        new Error("Select the doctor whose consultation this invoice belongs to."),
        { status: 400, extra: { code: "BILLING_DOCTOR_REQUIRED" } },
      );
    }
    if (doctorId !== Number(consultation?.doctor_id)) {
      throw Object.assign(
        new Error("The selected consultation belongs to a different doctor. Select the matching doctor and visit."),
        { status: 409, extra: { code: "BILLING_DOCTOR_MISMATCH" } },
      );
    }
    return;
  }

}

function requireQuickBillingDoctor(req, res) {
  if (req.auth?.role !== "doctor" || !Number(req.auth?.doctor_id || 0)) {
    res.status(403).json({ error: "Quick billing is available to linked doctor accounts only." });
    return null;
  }
  return Number(req.auth.doctor_id);
}

function resolveQuickBillingDoctor(req, res, submittedDoctorId, { required = true } = {}) {
  if (req.auth?.role === "doctor") {
    const doctorId = Number(req.auth?.doctor_id || 0);
    if (!doctorId) {
      res.status(403).json({ error: "Your account is not linked to a doctor profile." });
      return null;
    }
    return doctorId;
  }
  if (!["operator", "admin"].includes(req.auth?.role)) {
    res.status(403).json({ error: "Only doctors and operators can issue bills." });
    return null;
  }
  const doctorId = Number(submittedDoctorId || 0);
  if (!Number.isInteger(doctorId) || doctorId <= 0) {
    if (!required) return null;
    res.status(400).json({
      error: "Select the doctor whose consultation this invoice belongs to.",
      code: "BILLING_DOCTOR_REQUIRED",
    });
    return null;
  }
  return doctorId;
}

function quickBillingDoctorOptions() {
  const cutoverDate = getBillingCutoverDate(db);
  return db.prepare(`
    SELECT DISTINCT d.id, d.full_name
    FROM doctors d
    JOIN consultations c ON c.doctor_id = d.id AND c.voided_at IS NULL
    JOIN patients p ON p.id = c.patient_id AND p.deleted_at IS NULL
    WHERE d.is_active = 1
      AND d.deleted_at IS NULL
      AND (? = '' OR date(c.consultation_date) >= date(?))
    ORDER BY d.full_name COLLATE NOCASE ASC
  `).all(cutoverDate, cutoverDate).map((doctor) => ({ id: Number(doctor.id), full_name: String(doctor.full_name || "") }));
}

function formatVisitNumber(consultationId) {
  return `V-${String(Number(consultationId || 0)).padStart(6, "0")}`;
}

function assertQuickBillingCutoverOpen(consultation) {
  const cutoverDate = getBillingCutoverDate(db);
  if (!cutoverDate) return;
  const localDate = db.prepare("SELECT date('now', '+4 hours') AS value").get().value;
  if (localDate < cutoverDate) {
    throw Object.assign(
      new Error(`Live billing begins ${cutoverDate}. Submissions cannot be posted before the cutover.`),
      { status: 409, extra: { code: "BILLING_CUTOVER_NOT_ACTIVE", cutover_date: cutoverDate, local_date: localDate } },
    );
  }
  const consultationDate = String(
    consultation?.appointment_date || consultation?.consultation_date || "",
  ).slice(0, 10);
  if (consultationDate && consultationDate < cutoverDate) {
    throw Object.assign(
      new Error(`This visit is dated before the ${cutoverDate} billing cutover and cannot receive a live invoice.`),
      { status: 409, extra: { code: "VISIT_BEFORE_BILLING_CUTOVER", cutover_date: cutoverDate } },
    );
  }
}

function maskPatientName(fullName) {
  return String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${"•".repeat(Math.max(4, Math.min(7, part.length - 1)))}`)
    .join(" ");
}

function normalizeOcsCareNumber(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^OCS-?(\d+)$/);
  return match ? `OCS-${Number(match[1])}` : "";
}

function parseVisitReference(value) {
  const compact = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^(?:V|VISIT)-?(\d+)$/);
  return match ? Number(match[1]) : null;
}

function quickVisitBaseRows(doctorId, {
  consultationId = null,
  patientIdentifier = "",
  todayOnly = false,
  search = "",
  billableRole = "",
  limit = 100,
  offset = 0,
} = {}) {
  const safeLimit = Math.min(250, Math.max(1, Number.parseInt(limit, 10) || 100));
  const safeOffset = Math.max(0, Number.parseInt(offset, 10) || 0);
  const normalizedSearch = String(search || "").trim().toLowerCase().slice(0, 100);
  const cutoverDate = getBillingCutoverDate(db);
  return db
    .prepare(`
      SELECT
        c.id AS consultation_id,
        c.appointment_id,
        c.patient_id,
        c.doctor_id,
        c.consultation_date,
        a.appointment_date,
        a.appointment_time,
        a.status AS appointment_status,
        p.full_name AS patient_name,
        p.patient_identifier,
        d.full_name AS doctor_name
      FROM consultations c
      JOIN appointments a ON a.id = c.appointment_id
      JOIN patients p ON p.id = c.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE c.doctor_id = @doctorId
        AND c.voided_at IS NULL
        AND p.deleted_at IS NULL
        AND (@consultationId IS NULL OR c.id = @consultationId)
        AND (@patientIdentifier = '' OR UPPER(p.patient_identifier) = @patientIdentifier)
        AND (
          @cutoverDate = ''
          OR date(COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date)) >= date(@cutoverDate)
        )
        AND (
          @search = ''
          OR lower(p.full_name) LIKE @searchPattern
          OR lower(p.patient_identifier) LIKE @searchPattern
          OR lower(printf('V-%06d', c.id)) LIKE @searchPattern
          OR lower(COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date)) LIKE @searchPattern
          OR lower(d.full_name) LIKE @searchPattern
        )
        AND (
          @todayOnly = 0
          OR date(COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date)) = date('now', '+4 hours')
        )
        AND (
          @billableRole = ''
          OR (
            EXISTS (
              SELECT 1
              FROM billing billable_bill
              WHERE billable_bill.consultation_id = c.id
                AND billable_bill.status = 'unpaid'
                AND billable_bill.voided_at IS NULL
            )
            AND (
              (
                @billableRole = 'doctor'
                AND (
                  NOT EXISTS (
                    SELECT 1
                    FROM billing_lite_submissions active_submission
                    WHERE active_submission.consultation_id = c.id
                      AND active_submission.reversed_at IS NULL
                  )
                  OR (
                    SELECT latest_submission.workflow_status
                    FROM billing_lite_submissions latest_submission
                    WHERE latest_submission.consultation_id = c.id
                      AND latest_submission.reversed_at IS NULL
                    ORDER BY latest_submission.id DESC
                    LIMIT 1
                  ) = 'needs_doctor'
                )
              )
              OR (
                @billableRole != 'doctor'
                AND NOT EXISTS (
                  SELECT 1
                  FROM billing_lite_submissions active_submission
                  WHERE active_submission.consultation_id = c.id
                    AND active_submission.reversed_at IS NULL
                )
              )
            )
          )
        )
      ORDER BY
        CASE WHEN date(COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date)) = date('now', '+4 hours') THEN 0 ELSE 1 END,
        COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date || ' ' || a.appointment_time) DESC,
        c.id DESC
      LIMIT @limit OFFSET @offset
    `)
    .all({
      doctorId,
      consultationId,
      patientIdentifier,
      todayOnly: todayOnly ? 1 : 0,
      search: normalizedSearch,
      searchPattern: `%${normalizedSearch}%`,
      billableRole: String(billableRole || ""),
      cutoverDate,
      limit: safeLimit,
      offset: safeOffset,
    });
}

function serializeQuickVisit(row) {
  const bills = db
    .prepare(`
      SELECT *
      FROM billing
      WHERE consultation_id = ?
        AND voided_at IS NULL
      ORDER BY id ASC
    `)
    .all(row.consultation_id)
    .map(parseBillingRow)
    .map((bill) => ({ ...bill, ...paymentSummaryForBill(bill.id, bill.total_amount) }));
  const submissions = db
    .prepare(`
      SELECT id, item_count, items_json, amount_added, workflow_status, workflow_note, workflow_updated_at, created_at
      FROM billing_lite_submissions
      WHERE consultation_id = ?
        AND reversed_at IS NULL
      ORDER BY id DESC
    `)
    .all(row.consultation_id);
  const allItems = bills.flatMap((bill) => bill.items || []);
  const consultationFee = allItems.find(isConsultationFee) || null;
  const inventoryItemCount = allItems
    .filter((item) => item.inventory_item_id)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const activeBill = bills.find((bill) => bill.status === "unpaid") || bills[0] || null;
  const completed = bills.length > 0 && bills.every((bill) => bill.status === "paid");
  const submitted = submissions.length > 0 || inventoryItemCount > 0;
  const latestWorkflowStatus = submissions[0]?.workflow_status || "awaiting_operator";
  const submissionStatus = completed ? "completed" : submitted ? latestWorkflowStatus : "ready";
  const correctionRequested = latestWorkflowStatus === "needs_doctor";

  return {
    consultation_id: Number(row.consultation_id),
    patient_id: Number(row.patient_id),
    doctor_id: Number(row.doctor_id),
    doctor_name: String(row.doctor_name || ""),
    visit_number: formatVisitNumber(row.consultation_id),
    patient_identifier: String(row.patient_identifier || ""),
    patient_name: String(row.patient_name || ""),
    patient_masked_name: maskPatientName(row.patient_name),
    visit_date: row.appointment_date || String(row.consultation_date || "").slice(0, 10),
    visit_time: row.appointment_time || "",
    appointment_status: row.appointment_status,
    consultation_fee: consultationFee
      ? {
          type: consultationFee.description,
          amount: roundCurrency(consultationFee.amount),
          requires_review: bills.some((bill) => Boolean(bill.fee_review_required)),
        }
      : null,
    bill_id: activeBill ? Number(activeBill.id) : null,
    bill_status: activeBill?.status || null,
    bill_total: roundCurrency(bills.reduce((sum, bill) => sum + Number(bill.total_amount || 0), 0)),
    inventory_item_count: inventoryItemCount,
    submission_count: submissions.length,
    submission_status: submissionStatus,
    workflow_note: submissions[0]?.workflow_note || "",
    clarification_items: correctionRequested
      ? normalizeBillingItems(submissions[0]?.items_json).map((item) => ({
          inventory_item_id: Number(item.inventory_item_id || 0),
          quantity: Number(item.quantity || 0),
          unit_price: roundCurrency(item.unit_price),
        })).filter((item) => item.inventory_item_id > 0 && item.quantity > 0)
      : [],
    workflow_updated_at: submissions[0]?.workflow_updated_at || null,
    last_submitted_at: submissions[0]?.created_at || null,
    can_submit: Boolean(
      activeBill &&
      activeBill.status === "unpaid" &&
      (!submissions.length || correctionRequested)
    ),
  };
}

function canActorSubmitQuickVisit(visit, role) {
  if (!visit?.can_submit) return false;
  return role === "doctor" || visit.submission_status === "ready";
}

function getQuickVisit(consultationId, doctorId) {
  const row = quickVisitBaseRows(doctorId, { consultationId: Number(consultationId || 0) })[0];
  return row ? serializeQuickVisit(row) : null;
}

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

function recordQuickBillingEvent({
  submissionId,
  consultationId,
  billingId,
  actor = {},
  eventType,
  previousStatus = null,
  nextStatus = null,
  reason = "",
  details = {},
}) {
  db.prepare(`
    INSERT INTO billing_quick_events (
      submission_id, consultation_id, billing_id, actor_user_id, actor_name, actor_role,
      event_type, previous_status, next_status, reason, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    submissionId || null,
    consultationId,
    billingId || null,
    actor.id || null,
    String(actor.full_name || actor.username || ""),
    String(actor.role || ""),
    eventType,
    previousStatus,
    nextStatus,
    String(reason || "").trim(),
    JSON.stringify(details || {}),
  );
}

function validateOperatorInvoice(items, status) {
  if (status !== "unpaid") {
    return "Operators must issue the invoice as unpaid, then record payment through the confirmed payment action.";
  }

  const tariffRows = db
    .prepare("SELECT type_name, default_amount FROM consultation_fee_types")
    .all();
  const tariffs = new Map(
    tariffRows.map((row) => [String(row.type_name), roundCurrency(row.default_amount)]),
  );

  for (const item of items) {
    if (isConsultationFee(item)) {
      const knownType = tariffs.has(String(item.description || "").trim());
      const amount = Number(item.amount);
      if (!knownType || Number(item.quantity) !== 1 || !Number.isFinite(amount) || amount <= 0 || amount > MAX_CONSULTATION_FEE) {
        return `Operators must select Day, Night, or Review Consultation and enter a price between Rs 0.01 and Rs ${MAX_CONSULTATION_FEE.toLocaleString("en-MU")}.`;
      }
      continue;
    }

    if (item.type !== "Sale" || item.emergency_override === true) {
      return "Operators can bill sale lines only. Wastage, adjustments, and emergency stock overrides require an authorised clinician or admin.";
    }
    if (!item.inventory_item_id && !String(item.description || "").trim()) {
      return "Every line copied from the paper invoice needs a description.";
    }
  }

  return null;
}

function calculateAppointmentLossRevenue(items) {
  const normalized = normalizeBillingItems(items);
  const totals = normalized.reduce(
    (acc, item) => {
      const amount = roundCurrency(item.amount);
      if (item.type === "Wastage") {
        acc.loss_rs += amount;
      } else if (item.type === "Adjustment") {
        acc.adjustment_rs += amount;
      } else if (item.type === "Sale") {
        acc.revenue_rs += amount;
      }
      return acc;
    },
    { revenue_rs: 0, loss_rs: 0, adjustment_rs: 0 },
  );

  return {
    revenue_rs: roundCurrency(totals.revenue_rs),
    loss_rs: roundCurrency(totals.loss_rs),
    adjustment_rs: roundCurrency(totals.adjustment_rs),
  };
}

function consumeDoctorBatches(itemId, quantity) {
  return consumeAvailableFefo(itemId, quantity);
}

function insertInventoryMovement({
  itemId,
  quantity,
  previousQuantity,
  nextQuantity,
  actionType,
  note,
  userId,
  appointmentId,
  consultationId,
  meta = {},
}) {
  ensureActivityHistoryTable();
  const fullMeta = {
    consultation_id: consultationId,
    appointment_id: appointmentId,
    transaction_type:
      actionType === "wastage"
        ? "Wastage"
        : actionType === "adjustment"
          ? "Adjustment"
          : "Sale",
    ...meta,
  };
  const activityActionType = fullMeta.emergency_override ? "override" : actionType;

  db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
      recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
    )
    VALUES (?, 'out', ?, ?, ?, NULL, ?, ?, ?, 'appointment', ?, ?)
  `).run(
    itemId,
    quantity,
    previousQuantity,
    nextQuantity,
    userId || null,
    note,
    actionType,
    appointmentId || null,
    JSON.stringify(fullMeta),
  );

  const inserted = db.prepare("SELECT last_insert_rowid() AS id").get();
  const movementId = Number(inserted?.id || 0);
  db.prepare(`
    INSERT INTO inventory_activity_history (
      movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type, item_name,
      quantity, direction, source_text, destination_text, batch_id, meta_json
    )
    VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movementId || null,
    userId || null,
    String(fullMeta.performed_by_name || ""),
    String(fullMeta.performed_by_role || ""),
    String(activityActionType || ""),
    String(fullMeta.item_name || ""),
    Number(quantity || 0),
    "out",
    String(fullMeta.source_text || "Doctor Stock"),
    String(fullMeta.destination_text || "Patient Bill"),
    String(fullMeta.batch_id || (fullMeta.allocations || []).map((row) => row.batch_id).join(",") || ""),
    JSON.stringify(fullMeta),
  );
  return movementId;
}

function applyInventoryTransactions({
  consultation,
  items,
  userId,
  actor,
  billingId = null,
}) {
  const normalized = normalizeBillingItems(items);
  const inventoryLines = normalized.filter((item) => item.inventory_item_id && Number(item.quantity) > 0);
  const processed = [];
  const touchedItemIds = new Set();

  for (const line of inventoryLines) {
    const stockItem = db
      .prepare(`
        SELECT *
        FROM inventory
        WHERE id = ?
          AND stock_scope = 'doctor'
          AND owner_doctor_id = ?
          AND archived_at IS NULL
      `)
      .get(Number(line.inventory_item_id), Number(consultation.doctor_id));

    if (!stockItem) {
      throw new Error(
        `Inventory item not found for doctor (${line.description || "line item"}). It may have been removed from the medical bag — update or remove this billing line.`,
      );
    }

    const qty = Number(line.quantity || 0);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error("Inventory quantity must be a positive whole number.");
    }

    const isSellLine = line.type !== "Wastage" && line.type !== "Adjustment";
    if (!isSellLine && line.dispensing_movement_ids?.length) throw Object.assign(new Error("A recorded sale must be reconciled as a sale, not a new wastage or adjustment."),{status:409});
    if (isSellLine && Number(stockItem.selling_price || 0) <= 0) {
      throw Object.assign(
        new Error(`${stockItem.item_name} has no selling price. Finance or inventory must price it before it can be billed.`),
        { status: 409, extra: { code: "SUPPLY_PRICE_REQUIRED", inventory_item_id: Number(stockItem.id) } },
      );
    }

    // For Sale-style lines, see if the doctor already deducted this exact
    // patient/item combo from the bag while in the field. If so we credit
    // those movements against the bill instead of deducting again — which
    // is how the bag was getting double-decremented before.
    let linkedSaleMovementIds = [];
    let qtyToDecrement = qty;
    let recordedSaleAmount = 0;
    if (isSellLine && billingId) {
      const { matched, consumedQty, recordedAmount } = findUnbilledSaleCredit({
        itemId: stockItem.id,
        patientId: Number(consultation.patient_id),
        doctorId: Number(consultation.doctor_id),
        maxQty: qty,
        consultationId: consultation.id,
        movementIds: line.dispensing_movement_ids || [],
      });

      recordedSaleAmount = recordedAmount;
      if (matched.length > 0) {
        linkedSaleMovementIds = markSaleMovementsBilled(matched, billingId);
        qtyToDecrement = qty - consumedQty;
      }
    }

    if (isSellLine && qtyToDecrement > 0 && Number(stockItem.cost_price || 0) <= 0) {
      throw Object.assign(
        new Error(`${stockItem.item_name} has no cost price. Finance or inventory must record its supplier cost before it can be billed.`),
        { status: 409, extra: { code: "SUPPLY_COST_REQUIRED", inventory_item_id: Number(stockItem.id) } },
      );
    }

    const decorated = decorateInventoryItems([stockItem])[0] || stockItem;
    const atp = Number(decorated.available_to_promise ?? decorated.available_to_use ?? 0);
    if (qtyToDecrement > atp) {
      const error = new Error(
        `Insufficient usable stock for ${stockItem.item_name}. ${atp} unit(s) available to promise; ${qtyToDecrement} requested.`,
      );
      error.status = 409;
      error.extra = {
        code: "INSUFFICIENT_ATP",
        available_to_promise: atp,
        requested: qtyToDecrement,
      };
      throw error;
    }

    const locked = db.prepare("SELECT * FROM inventory WHERE id = ?").get(stockItem.id);
    const previousQuantity = Number(locked?.quantity || 0);
    const expectedVersion = Number(locked?.row_version || 1);
    let allocations = [];
    let nextQuantity = previousQuantity;
    const inventoryMovementIds = [];
    if (qtyToDecrement > 0) {
      const consumed = line.type === "Wastage"
        ? consumeAvailableBatch(stockItem.id, line.batch_id, qtyToDecrement)
        : consumeDoctorBatches(stockItem.id, qtyToDecrement);
      allocations = consumed.allocations || [];
      const allocated = allocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      if (allocated !== qtyToDecrement) {
        const error = new Error(
          `Eligible batches could not cover the billed quantity for ${stockItem.item_name}.`,
        );
        error.status = 409;
        error.extra = { code: "INSUFFICIENT_ELIGIBLE_BATCHES" };
        throw error;
      }
      nextQuantity = previousQuantity - allocated;
      if (nextQuantity < 0) {
        const error = new Error("Inventory quantity cannot become negative.");
        error.status = 409;
        throw error;
      }
      try {
        assertInventoryQuantityUpdate(stockItem.id, nextQuantity, expectedVersion);
      } catch (error) {
        if (error instanceof InventoryVersionConflictError || error.code === "INVENTORY_VERSION_CONFLICT") {
          error.status = 409;
        }
        throw error;
      }
    }

    const actionType =
      line.type === "Wastage"
        ? "wastage"
        : line.type === "Adjustment"
          ? "adjustment"
          : "sell";

    if (qtyToDecrement > 0) {
      const movementId = insertInventoryMovement({
        itemId: stockItem.id,
        quantity: qtyToDecrement,
        previousQuantity,
        nextQuantity,
        actionType,
        note:
          actionType === "wastage"
            ? `Clinical wastage: ${line.wastage_reason}`
            : actionType === "adjustment"
              ? "Inventory adjustment recorded from billing."
            : "Billed to patient.",
        userId,
        appointmentId: consultation.appointment_id,
        consultationId: consultation.id,
        meta: {
          item_name: stockItem.item_name,
          emergency_override: Boolean(line.emergency_override),
          dispensed_quantity: qtyToDecrement,
          billed_quantity: qty,
          batch_shortfall: 0,
          allocations,
          performed_by_user_id: actor?.id || userId || null,
          performed_by_role: actor?.role || "",
          performed_by_name: actor?.full_name || actor?.username || "",
          source_text: actor?.full_name ? `${actor.full_name} (${actor.role || ""})` : "Doctor Stock",
          destination_text: "Patient Bill",
          billing_id: billingId,
          billing_line_description: line.description || stockItem.item_name,
          wastage_reason: actionType === "wastage" ? line.wastage_reason : null,
          selected_batch_id: actionType === "wastage" ? Number(line.batch_id) : null,
          linked_sale_movement_ids: linkedSaleMovementIds,
          linked_sale_credit_qty: qty - qtyToDecrement,
        },
      });
      recordMovementAllocations(movementId, allocations);
      inventoryMovementIds.push(movementId);
    }

    touchedItemIds.add(Number(stockItem.id));

    const computedAmount =
      line.type === "Wastage"
        ? roundCurrency(allocations.reduce(
            (sum, allocation) => sum + Number(allocation.quantity || 0) * Number(allocation.unit_cost || 0),
            0,
          ))
        : line.type === "Adjustment"
          ? roundCurrency(Number(stockItem.cost_price || 0) * qty)
          : roundCurrency(recordedSaleAmount + Number(stockItem.selling_price || 0) * qtyToDecrement);

    processed.push({
      ...line,
      description: line.description || stockItem.item_name,
      amount: computedAmount,
      unit_price: qty > 0 ? roundCurrency(computedAmount / qty) : computedAmount,
      inventory_item_id: Number(stockItem.id),
      linked_sale_movement_ids: linkedSaleMovementIds,
      dispensing_movement_ids: linkedSaleMovementIds,
      inventory_movement_ids: inventoryMovementIds,
    });
  }

  const passthrough = normalized.filter((item) => !(item.inventory_item_id && Number(item.quantity) > 0));
  return { items: [...passthrough, ...processed], touchedItemIds: [...touchedItemIds] };
}

function withPaymentReview(bills) {
  const visits = new Map();
  return bills.map(rawBill => {
    const bill = {
      ...rawBill,
      ...paymentSummaryForBill(rawBill.id, rawBill.total_amount),
      billing_state: rawBill.finalized_at ? undefined : "draft",
    };
    bill.billing_state = bill.finalized_at
      ? bill.payment_state === "paid" ? "paid" : bill.payment_state === "partial" ? "partial" : "ready_for_payment"
      : "draft";
    if (bill.status !== 'unpaid' || bill.voided_at || bill.consultation_voided_at) return bill;
    const visitKey = `${bill.consultation_id}:${bill.id}`;
    if (!visits.has(visitKey)) {
      try { assertVisitReadyForPayment(db, bill.consultation_id, bill.id); visits.set(visitKey, null); }
      catch (error) {
        if (error.status !== 409) throw error;
        visits.set(visitKey, {reason:error.message, ...error.extra});
      }
    }
    return {...bill, payment_block:visits.get(visitKey)};
  });
}

function getJoinedBillById(billId) {
  const bill = db
    .prepare(`
      SELECT
        b.*,
        COALESCE(NULLIF(b.patient_name_snapshot, ''), p.full_name) AS patient_name,
        COALESCE(NULLIF(b.patient_identifier_snapshot, ''), p.patient_identifier) AS patient_identifier,
        p.deleted_at AS patient_archived_at,
        c.voided_at AS consultation_voided_at,
        COALESCE(NULLIF(b.consultation_date_snapshot, ''), c.consultation_date) AS consultation_date,
        c.appointment_id,
        COALESCE(b.doctor_id_snapshot, c.doctor_id) AS doctor_id,
        COALESCE(NULLIF(b.doctor_name_snapshot, ''), d.full_name) AS doctor_name,
        u.full_name AS updated_by_name
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      LEFT JOIN users u ON u.id = b.updated_by_user_id
      WHERE b.id = ?
    `)
    .get(billId);

  if (!bill) return null;
  const parsed = withPaymentReview([parseBillingRow(bill)])[0];
  const refunds = db.prepare(`
    SELECT refund.*, correction.disposition, allocation.allocation_type, allocation.submission_id
    FROM billing_refunds refund
    LEFT JOIN billing_supply_corrections correction ON correction.refund_id = refund.id
    LEFT JOIN billing_refund_allocations allocation ON allocation.refund_id = refund.id
    WHERE refund.billing_id = ?
    ORDER BY refund.id DESC
  `).all(billId).map((refund) => ({ ...refund, amount: roundCurrency(refund.amount) }));
  const refundedAmount = roundCurrency(refunds.reduce((sum, refund) => sum + refund.amount, 0));
  const paymentSummary = paymentSummaryForBill(billId, parsed.total_amount);
  const quickSubmissions = db.prepare(`
    SELECT id, consultation_id, billing_id, item_count, items_json, amount_added,
      workflow_status, workflow_note, reversed_at, reversal_reason, created_at
    FROM billing_lite_submissions
    WHERE billing_id = ?
    ORDER BY id DESC
  `).all(billId).map((submission) => ({
    ...submission,
    item_count: Number(submission.item_count || 0),
    amount_added: roundCurrency(submission.amount_added),
    items: normalizeBillingItems(submission.items_json),
    workflow_status: parsed.status === "paid"
      && !submission.reversed_at
      && !["corrected", "reversed", "superseded"].includes(submission.workflow_status)
      ? "completed"
      : submission.workflow_status,
  }));
  const supplyCorrections = db.prepare(`
    SELECT correction.*, refund.credit_note_number, refund.refund_method, refund.refund_date,
      refund.external_reference
    FROM billing_supply_corrections correction
    JOIN billing_refunds refund ON refund.id = correction.refund_id
    WHERE correction.billing_id = ?
    ORDER BY correction.id DESC
  `).all(billId).map((correction) => ({
    ...correction,
    amount: roundCurrency(correction.amount),
    original_movement_ids: safeJsonParse(correction.original_movement_ids_json, []),
    reversal_movement_ids: safeJsonParse(correction.reversal_movement_ids_json, []),
  }));
  return {
    ...parsed,
    ...paymentSummary,
    refunds,
    quick_submissions: quickSubmissions,
    supply_corrections: supplyCorrections,
    refunded_amount: refundedAmount,
    refundable_amount: roundCurrency(Math.max(0, paymentSummary.payment_received_amount - refundedAmount)),
    net_paid_amount: roundCurrency(Math.max(0, paymentSummary.payment_received_amount - refundedAmount)),
    history: db.prepare(`SELECT e.*, COALESCE(NULLIF(e.actor_name, ''), u.full_name) AS actor_name FROM billing_events e
      LEFT JOIN users u ON u.id=e.actor_id WHERE e.bill_id=? ORDER BY e.id DESC`).all(billId),
    appointment_financials: calculateAppointmentLossRevenue(parsed.items),
  };
}

function ensureBillAccess(req, bill, { write = false } = {}) {
  if (!bill) {
    return { status: 404, error: "Bill not found." };
  }

  if (write && (bill.voided_at || bill.consultation_voided_at)) {
    return { status: 409, error: "This bill is voided and cannot be changed or paid." };
  }
  if (req.auth?.role !== "doctor") {
    return null;
  }

  if (write) {
    if (!req.auth.doctor_id || Number(bill.doctor_id) !== Number(req.auth.doctor_id)) {
      return { status: 403, error: "You can only manage billing linked to your own consultations." };
    }
    return null;
  }

  if (!req.auth.doctor_id || Number(bill.doctor_id) !== Number(req.auth.doctor_id)) {
    return { status: 403, error: "You can only view billing linked to your own consultations." };
  }

  return null;
}

router.get("/patient-summary", (req, res) => {
  const doctorAccess = buildDoctorAccessClause(req.auth);
  const dateFrom = String(req.query.dateFrom ?? "").trim();
  const dateTo = String(req.query.dateTo ?? "").trim();
  const dateBasis = req.query.dateBasis === "payment" ? "payment" : "visit";
  const paginated = String(req.query.paginated || "") === "1";
  const search = String(req.query.search || "").trim().toLowerCase().slice(0, 100);
  const limit = Math.min(100, Math.max(10, Number.parseInt(req.query.limit, 10) || 40));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const respond = (rows) => {
    if (!paginated) return res.json(rows);
    const filtered = search
      ? rows.filter((row) => String(row.patient_name || "").toLowerCase().includes(search))
      : rows;
    const totals = filtered.reduce((acc, row) => ({
      total_billed: roundCurrency(acc.total_billed + Number(row.total_billed || 0)),
      paid_amount: roundCurrency(acc.paid_amount + Number(row.paid_amount || 0)),
      unpaid_amount: roundCurrency(acc.unpaid_amount + Number(row.unpaid_amount || 0)),
      refunded_amount: roundCurrency(acc.refunded_amount + Number(row.refunded_amount || 0)),
    }), { total_billed: 0, paid_amount: 0, unpaid_amount: 0, refunded_amount: 0 });
    return res.json({ patients: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset, totals });
  };

  if (dateBasis === "payment") {
    const summary = db.prepare(`
      WITH scoped_bills AS (
        SELECT
          b.id,
          b.patient_id,
          b.total_amount,
          b.patient_name_snapshot,
          p.full_name AS current_patient_name
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        JOIN consultations c ON c.id = b.consultation_id
        WHERE b.voided_at IS NULL
          AND c.voided_at IS NULL
          AND b.finalized_at IS NOT NULL
          AND (@reportDoctorId IS NULL OR c.doctor_id = @reportDoctorId)
          ${doctorAccess.clause}
      ),
      period_ledger AS (
        SELECT
          ledger.billing_id,
          SUM(CASE WHEN ledger.amount > 0 THEN ledger.amount ELSE 0 END) AS gross_collected_amount,
          SUM(ledger.amount) AS signed_collected_amount
        FROM billing_payment_ledger ledger
        JOIN scoped_bills scoped ON scoped.id = ledger.billing_id
        WHERE (@dateFrom = '' OR ledger.transaction_date >= date(@dateFrom))
          AND (@dateTo = '' OR ledger.transaction_date <= date(@dateTo))
        GROUP BY ledger.billing_id
      ),
      period_refunds AS (
        SELECT refund.billing_id, SUM(refund.amount) AS refunded_amount
        FROM billing_refunds refund
        JOIN scoped_bills scoped ON scoped.id = refund.billing_id
        WHERE (@dateFrom = '' OR refund.refund_date >= date(@dateFrom))
          AND (@dateTo = '' OR refund.refund_date <= date(@dateTo))
        GROUP BY refund.billing_id
      ),
      current_receipts AS (
        SELECT ledger.billing_id, SUM(ledger.amount) AS received_amount
        FROM billing_payment_ledger ledger
        JOIN scoped_bills scoped ON scoped.id = ledger.billing_id
        GROUP BY ledger.billing_id
      )
      SELECT
        scoped.patient_id,
        COALESCE(NULLIF(MAX(scoped.patient_name_snapshot), ''), MAX(scoped.current_patient_name)) AS patient_name,
        COUNT(DISTINCT scoped.id) AS bill_count,
        COALESCE(SUM(scoped.total_amount), 0) AS total_billed,
        COALESCE(SUM(COALESCE(period_ledger.signed_collected_amount, 0) - COALESCE(period_refunds.refunded_amount, 0)), 0) AS paid_amount,
        COALESCE(SUM(period_refunds.refunded_amount), 0) AS refunded_amount,
        COALESCE(SUM(MAX(0, scoped.total_amount - COALESCE(current_receipts.received_amount, 0))), 0) AS unpaid_amount,
        COALESCE(SUM(period_ledger.gross_collected_amount), 0) AS gross_collected_amount,
        COALESCE(SUM(period_ledger.signed_collected_amount), 0) AS signed_collected_amount,
        COALESCE(SUM(MAX(0, scoped.total_amount - COALESCE(current_receipts.received_amount, 0))), 0) AS outstanding_snapshot_amount,
        'payment' AS summary_basis
      FROM scoped_bills scoped
      LEFT JOIN period_ledger ON period_ledger.billing_id = scoped.id
      LEFT JOIN period_refunds ON period_refunds.billing_id = scoped.id
      LEFT JOIN current_receipts ON current_receipts.billing_id = scoped.id
      WHERE period_ledger.billing_id IS NOT NULL OR period_refunds.billing_id IS NOT NULL
      GROUP BY scoped.patient_id
      ORDER BY unpaid_amount DESC, paid_amount DESC, patient_name ASC
    `).all({
      dateFrom,
      dateTo,
      reportDoctorId: req.query.doctorId ? Number(req.query.doctorId) : null,
      ...doctorAccess.params,
    });
    return respond(summary);
  }

  const summary = db
    .prepare(`
      SELECT
        b.patient_id AS patient_id,
        COALESCE(NULLIF(MAX(b.patient_name_snapshot), ''), MAX(p.full_name)) AS patient_name,
        COUNT(b.id) AS bill_count,
        COALESCE(SUM(b.total_amount), 0) AS total_billed,
        COALESCE(SUM(COALESCE((
          SELECT SUM(payment.amount) FROM billing_payment_ledger payment WHERE payment.billing_id = b.id
        ), 0) - COALESCE((
          SELECT SUM(r.amount) FROM billing_refunds r WHERE r.billing_id = b.id
        ), 0)), 0) AS paid_amount,
        COALESCE(SUM(COALESCE((
          SELECT SUM(r.amount) FROM billing_refunds r WHERE r.billing_id = b.id
        ), 0)), 0) AS refunded_amount,
        COALESCE(SUM(MAX(0, b.total_amount - COALESCE((
          SELECT SUM(payment.amount) FROM billing_payment_ledger payment WHERE payment.billing_id = b.id
        ), 0))), 0) AS unpaid_amount,
        'visit' AS summary_basis
      FROM patients p
      JOIN billing b ON b.patient_id = p.id
      JOIN consultations c ON c.id = b.consultation_id
      WHERE b.voided_at IS NULL AND c.voided_at IS NULL AND b.finalized_at IS NOT NULL
        AND (@dateFrom = '' OR ${billingDateSql(req)} >= date(@dateFrom))
        AND (@dateTo = '' OR ${billingDateSql(req)} <= date(@dateTo))
        AND (@reportDoctorId IS NULL OR c.doctor_id = @reportDoctorId)
        ${doctorAccess.clause}
      GROUP BY b.patient_id
      ORDER BY unpaid_amount DESC, total_billed DESC, patient_name ASC
    `)
    .all({
      dateFrom,
      dateTo,
      reportDoctorId: req.query.doctorId ? Number(req.query.doctorId) : null,
      ...doctorAccess.params,
    });

  return respond(summary);
});

router.get("/", (req, res) => {
  const status = String(req.query.status ?? "").trim();
  const patientId = String(req.query.patientId ?? "").trim();
  const dateFrom = String(req.query.dateFrom ?? "").trim();
  const dateTo = String(req.query.dateTo ?? "").trim();
  const dateBasis = req.query.dateBasis === "payment" ? "payment" : "visit";
  const paginated = String(req.query.paginated || "") === "1";
  const search = String(req.query.search || "").trim().toLowerCase().replace(/^#/, "").slice(0, 100);
  const limit = Math.min(100, Math.max(10, Number.parseInt(req.query.limit, 10) || 40));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const doctorAccess = buildDoctorAccessClause(req.auth);

  const bills = db
    .prepare(`
      SELECT
        b.*,
        COALESCE(NULLIF(b.patient_name_snapshot, ''), p.full_name) AS patient_name,
        COALESCE(NULLIF(b.patient_identifier_snapshot, ''), p.patient_identifier) AS patient_identifier,
        p.deleted_at AS patient_archived_at,
        c.voided_at AS consultation_voided_at,
        COALESCE(NULLIF(b.consultation_date_snapshot, ''), c.consultation_date) AS consultation_date,
        COALESCE(b.doctor_id_snapshot, c.doctor_id) AS doctor_id,
        COALESCE(NULLIF(b.doctor_name_snapshot, ''), d.full_name) AS doctor_name,
        COALESCE((SELECT SUM(r.amount) FROM billing_refunds r WHERE r.billing_id = b.id), 0) AS refunded_amount,
        COALESCE((
          SELECT SUM(payment.amount) FROM billing_payment_ledger payment WHERE payment.billing_id = b.id
        ), 0) AS payment_received_amount,
        MAX(0, b.total_amount - COALESCE((
          SELECT SUM(payment.amount) FROM billing_payment_ledger payment WHERE payment.billing_id = b.id
        ), 0)) AS payment_balance_amount,
        MAX(0, COALESCE((
          SELECT SUM(payment.amount) FROM billing_payment_ledger payment WHERE payment.billing_id = b.id
        ), 0) - COALESCE((
          SELECT SUM(r.amount) FROM billing_refunds r WHERE r.billing_id = b.id
        ), 0)) AS net_paid_amount,
        u.full_name AS updated_by_name,
        COUNT(*) OVER() AS total_count
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      LEFT JOIN users u ON u.id = b.updated_by_user_id
      WHERE ((@status = 'voided' AND (b.voided_at IS NOT NULL OR c.voided_at IS NOT NULL))
        OR (@status != 'voided' AND b.voided_at IS NULL AND c.voided_at IS NULL
          AND b.finalized_at IS NOT NULL AND (@status = '' OR b.status = @status)))
        AND (@patientId = '' OR CAST(b.patient_id AS TEXT) = @patientId)
        AND (
          (@dateBasis = 'payment' AND EXISTS (
            SELECT 1 FROM billing_payment_ledger period_ledger
            WHERE period_ledger.billing_id = b.id
              AND (@dateFrom = '' OR period_ledger.transaction_date >= date(@dateFrom))
              AND (@dateTo = '' OR period_ledger.transaction_date <= date(@dateTo))
          ))
          OR (@dateBasis != 'payment'
            AND (@dateFrom = '' OR date(COALESCE(NULLIF(b.consultation_date_snapshot, ''), c.consultation_date)) >= date(@dateFrom))
            AND (@dateTo = '' OR date(COALESCE(NULLIF(b.consultation_date_snapshot, ''), c.consultation_date)) <= date(@dateTo)))
        )
        AND (@reportDoctorId IS NULL OR c.doctor_id = @reportDoctorId)
        AND (
          @search = ''
          OR lower(COALESCE(NULLIF(b.patient_name_snapshot, ''), p.full_name)) LIKE @searchPattern
          OR lower(COALESCE(NULLIF(b.patient_identifier_snapshot, ''), p.patient_identifier)) LIKE @searchPattern
          OR lower(COALESCE(b.invoice_number, '')) LIKE @searchPattern
          OR lower(COALESCE(b.source_reference, '')) LIKE @searchPattern
          OR CAST(b.id AS TEXT) LIKE @searchPattern
        )
        ${doctorAccess.clause}
      ORDER BY c.consultation_date DESC, b.created_at DESC
      LIMIT @limit OFFSET @offset
    `)
    .all({
      status,
      patientId,
      dateFrom,
      dateTo,
      dateBasis,
      reportDoctorId: req.query.doctorId ? Number(req.query.doctorId) : null,
      search,
      searchPattern: `%${search}%`,
      limit: paginated ? limit : -1,
      offset: paginated ? offset : 0,
      ...doctorAccess.params,
    })
    .map(parseBillingRow);

  const reviewed = withPaymentReview(bills);
  if (!paginated) return res.json(reviewed);
  return res.json({
    bills: reviewed,
    total: Number(reviewed[0]?.total_count || 0),
    limit,
    offset,
  });
});

router.get("/consultation-fees", (req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT type_name, default_amount
        FROM consultation_fee_types
        ORDER BY id ASC
      `)
      .all();

    const fees = rows.reduce((acc, row) => {
      acc[row.type_name] = roundCurrency(row.default_amount);
      return acc;
    }, {});

    res.json(fees);
  } catch (error) {
    console.error("[billing][GET /consultation-fees]", error);
    return res.status(500).json({
      error: error?.message || "Failed to load consultation fees.",
    });
  }
});

router.get("/consultation-options", (req, res) => {
  const requestedDoctorId = Number(req.query.doctorId || 0);
  const doctorId = req.auth.role === "doctor"
    ? Number(req.auth.doctor_id || 0) || -1
    : Number.isInteger(requestedDoctorId) && requestedDoctorId > 0
      ? requestedDoctorId
      : null;
  const rows = db
    .prepare(`
      SELECT
        c.id,
        c.patient_id,
        c.doctor_id,
        c.consultation_date,
        p.full_name AS patient_name,
        d.full_name AS doctor_name,
        COUNT(b.id) AS bill_count
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      LEFT JOIN billing b ON b.consultation_id = c.id AND b.voided_at IS NULL
      WHERE p.deleted_at IS NULL
        AND c.voided_at IS NULL
        AND (@doctorId IS NULL OR c.doctor_id = @doctorId)
        AND (
          @cutoverDate = ''
          OR date(c.consultation_date) >= date(@cutoverDate)
        )
      GROUP BY c.id, p.full_name, d.full_name
      ORDER BY c.consultation_date DESC, c.created_at DESC
    `)
    .all({
      doctorId:
        doctorId,
      cutoverDate: getBillingCutoverDate(db),
    })
    .map((row) => ({ ...row, bill_count: Number(row.bill_count || 0) }));

  res.json(rows);
});

router.get("/quick/visits", (req, res) => {
  const doctorId = requireQuickBillingDoctor(req, res);
  if (!doctorId) return;

  const visits = quickVisitBaseRows(doctorId, { todayOnly: true }).map(serializeQuickVisit);
  res.json({
    visits,
    tariffs: CONSULTATION_FEES,
    local_date: db.prepare("SELECT date('now', '+4 hours') AS value").get().value,
  });
});

router.get("/quick/picker-options", (req, res) => {
  const doctorId = resolveQuickBillingDoctor(req, res, req.query.doctorId, { required: false });
  if (!doctorId && res.headersSent) return;
  const doctors = ["operator", "admin"].includes(req.auth?.role) ? quickBillingDoctorOptions() : [];
  const cutoverDate = getBillingCutoverDate(db);
  const localDate = db.prepare("SELECT date('now', '+4 hours') AS value").get().value;
  const billingActive = !cutoverDate || localDate >= cutoverDate;
  if (!doctorId) return res.json({
    doctors,
    patients: [],
    cutover_date: cutoverDate || null,
    local_date: localDate,
    billing_active: billingActive,
    next_offset: 0,
    has_more: false,
  });
  if (!billingActive) return res.json({
    doctors,
    patients: [],
    search: String(req.query.search || "").trim().slice(0, 100),
    limit: Math.min(200, Math.max(20, Number.parseInt(req.query.limit, 10) || 100)),
    offset: Math.max(0, Number.parseInt(req.query.offset, 10) || 0),
    next_offset: 0,
    has_more: false,
    cutover_date: cutoverDate,
    local_date: localDate,
    billing_active: false,
  });

  const search = String(req.query.search || "").trim().slice(0, 100);
  const limit = Math.min(200, Math.max(20, Number.parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const patientMap = new Map();
  const visitRows = quickVisitBaseRows(doctorId, {
    search,
    billableRole: req.auth?.role,
    limit: limit + 1,
    offset,
  });
  const hasMore = visitRows.length > limit;
  const visits = visitRows.slice(0, limit)
    .map((row) => ({ row, visit: serializeQuickVisit(row) }));

  for (const { row, visit } of visits) {
    const patientId = Number(row.patient_id);
    if (!patientMap.has(patientId)) {
      patientMap.set(patientId, {
        patient_id: patientId,
        patient_name: String(row.patient_name || ""),
        patient_identifier: String(row.patient_identifier || ""),
        visits: [],
      });
    }
    patientMap.get(patientId).visits.push(visit);
  }

  const patients = [...patientMap.values()].sort((a, b) =>
    a.patient_name.localeCompare(b.patient_name, undefined, { sensitivity: "base" }),
  );

  res.json({
    doctors,
    patients,
    search,
    limit,
    offset,
    next_offset: offset + visits.length,
    has_more: hasMore,
    cutover_date: cutoverDate || null,
    local_date: localDate,
    billing_active: billingActive,
  });
});

router.get("/quick/lookup", (req, res) => {
  const doctorId = resolveQuickBillingDoctor(req, res, req.query.doctorId);
  if (!doctorId) return;

  const reference = String(req.query.reference || "").trim();
  if (!reference) {
    return res.status(400).json({ error: "Enter an OCS care number or visit number." });
  }

  const consultationId = parseVisitReference(reference);
  const patientIdentifier = consultationId ? "" : normalizeOcsCareNumber(reference);
  if (!consultationId && !patientIdentifier) {
    return res.status(400).json({ error: "Use an OCS care number such as OCS-212 or a visit number such as V-000184." });
  }

  const matches = quickVisitBaseRows(doctorId, {
    consultationId,
    patientIdentifier,
  })
    .map(serializeQuickVisit)
    .filter((visit) => canActorSubmitQuickVisit(visit, req.auth?.role))
    .slice(0, 6);

  if (!matches.length) {
    return res.status(404).json({
      error: "No visit belonging to your doctor account was found for that reference.",
    });
  }

  res.json({ visits: matches });
});

router.get("/quick/catalog/:consultationId", (req, res) => {
  const consultation = getConsultationContext(Number(req.params.consultationId));
  if (!consultation || consultation.voided_at) {
    return res.status(404).json({ error: "This visit was not found." });
  }
  try {
    assertBillingActorConsultationAccess(req.auth, consultation, req.query.doctorId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message, ...(error.extra || {}) });
  }
  const doctorId = Number(consultation.doctor_id);

  const visit = getQuickVisit(Number(req.params.consultationId), doctorId);
  if (!visit) {
    return res.status(404).json({ error: "This visit was not found in your doctor workspace." });
  }
  if (!canActorSubmitQuickVisit(visit, req.auth?.role)) {
    return res.status(409).json({ error: "This visit no longer has an unpaid bill that can receive supplies." });
  }

  const rows = db
    .prepare(`
      SELECT
        i.*,
        COALESCE(f.name, 'Other supplies') AS folder_name,
        f.parent_id,
        COALESCE(parent.name, '') AS parent_folder_name
      FROM inventory i
      LEFT JOIN inventory_folders f ON f.id = i.folder_id
      LEFT JOIN inventory_folders parent ON parent.id = f.parent_id
      WHERE i.stock_scope = 'doctor'
        AND i.owner_doctor_id = ?
        AND i.archived_at IS NULL
      ORDER BY COALESCE(parent.name, f.name, ''), f.name, i.item_name
    `)
    .all(doctorId);

  const decorated = decorateInventoryItems(rows);
  const items = decorated.map((item) => ({
    id: Number(item.id),
    item_name: String(item.item_name || ""),
    folder_id: item.folder_id ? Number(item.folder_id) : null,
    category: String(item.parent_folder_name || item.folder_name || "Other supplies"),
    subcategory: String(item.parent_folder_name ? item.folder_name : ""),
    unit: String(item.unit || "unit"),
    cost_price_ready: Number(item.cost_price || 0) > 0,
    selling_price: roundCurrency(item.selling_price),
    available_to_use: Number(item.available_to_promise ?? item.available_to_use ?? 0),
  }));

  res.json({ visit, items });
});

router.get("/quick/unbilled-report", (req, res) => {
  if (!["admin", "operator", "accountant", "doctor"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "You do not have permission to view missing billing." });
  }
  if (req.auth.role === "doctor" && !Number(req.auth.doctor_id || 0)) {
    return res.status(403).json({ error: "Your account is not linked to a doctor profile." });
  }

  const sqlDates = db.prepare(`
    SELECT
      date('now', '+4 hours', '-14 days') AS default_from,
      date('now', '+4 hours', '-1 day') AS default_to,
      date('now', '+4 hours') AS today
  `).get();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const requestedDateFrom = datePattern.test(String(req.query.dateFrom || "")) ? String(req.query.dateFrom) : sqlDates.default_from;
  const cutoverDate = getBillingCutoverDate(db);
  const dateFrom = cutoverDate && requestedDateFrom < cutoverDate ? cutoverDate : requestedDateFrom;
  const dateTo = datePattern.test(String(req.query.dateTo || "")) ? String(req.query.dateTo) : sqlDates.default_to;
  if (dateFrom > dateTo) {
    return res.json({ date_from: dateFrom, date_to: dateTo, count: 0, visits: [] });
  }
  if (dateTo >= sqlDates.today) {
    return res.status(400).json({ error: "Missing-billing reports must cover completed days before today." });
  }

  const requestedDoctorId = Number(req.query.doctorId || 0);
  const doctorId = req.auth.role === "doctor"
    ? Number(req.auth.doctor_id)
    : Number.isInteger(requestedDoctorId) && requestedDoctorId > 0
      ? requestedDoctorId
      : null;
  const visits = db.prepare(`
    SELECT
      c.id AS consultation_id,
      c.consultation_date,
      a.appointment_date,
      a.appointment_time,
      p.id AS patient_id,
      p.full_name AS patient_name,
      p.patient_identifier,
      d.id AS doctor_id,
      d.full_name AS doctor_name
    FROM consultations c
    JOIN appointments a ON a.id = c.appointment_id
    JOIN patients p ON p.id = c.patient_id
    JOIN doctors d ON d.id = c.doctor_id
    WHERE c.voided_at IS NULL
      AND p.deleted_at IS NULL
      AND date(COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date)) BETWEEN ? AND ?
      AND (? IS NULL OR c.doctor_id = ?)
    ORDER BY date(COALESCE(NULLIF(c.consultation_date, ''), a.appointment_date)) DESC,
      a.appointment_time DESC, c.id DESC
    LIMIT 500
  `).all(dateFrom, dateTo, doctorId, doctorId);

  const missing = visits.filter((visit) => {
    const bills = db.prepare(`
      SELECT * FROM billing
      WHERE consultation_id = ? AND voided_at IS NULL
      ORDER BY id ASC
    `).all(visit.consultation_id).map(parseBillingRow);
    const hasActiveSubmission = Boolean(db.prepare(`
      SELECT 1 FROM billing_lite_submissions
      WHERE consultation_id = ? AND reversed_at IS NULL
      LIMIT 1
    `).get(visit.consultation_id));
    const hasDocumentedEdit = bills.some((bill) => db.prepare(`
      SELECT 1 FROM billing_events
      WHERE bill_id = ? AND event_type NOT IN ('created', 'migration_baseline')
      LIMIT 1
    `).get(bill.id));
    const hasNonConsultationCharge = bills.some((bill) =>
      (bill.items || []).some((item) => !isConsultationFee(item)),
    );
    const hasFinalBilling = hasActiveSubmission
      || hasDocumentedEdit
      || hasNonConsultationCharge
      || bills.length > 1
      || bills.some((bill) => bill.status === "paid");
    visit.bill_count = bills.length;
    visit.bill_id = bills[0]?.id ? Number(bills[0].id) : null;
    visit.bill_total = roundCurrency(bills.reduce((sum, bill) => sum + Number(bill.total_amount || 0), 0));
    return !hasFinalBilling;
  }).map((visit) => ({
    consultation_id: Number(visit.consultation_id),
    visit_number: formatVisitNumber(visit.consultation_id),
    visit_date: visit.appointment_date || String(visit.consultation_date || "").slice(0, 10),
    visit_time: visit.appointment_time || "",
    patient_name: visit.patient_name,
    patient_id: Number(visit.patient_id),
    patient_identifier: visit.patient_identifier,
    doctor_id: Number(visit.doctor_id),
    doctor_name: visit.doctor_name,
    bill_count: Number(visit.bill_count || 0),
    bill_id: visit.bill_id,
    bill_total: roundCurrency(visit.bill_total),
    status: "missing_final_billing",
  }));

  res.json({ date_from: dateFrom, date_to: dateTo, count: missing.length, visits: missing });
});

router.get("/quick/operator-queue", (req, res) => {
  if (!["admin", "operator"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "The doctor billing review queue is restricted to operators and administrators." });
  }

  const search = String(req.query.search || "").trim().toLowerCase().slice(0, 100);
  const status = String(req.query.status || "").trim();
  const allowedStatuses = new Set(["", "actionable", "awaiting_operator", "needs_doctor", "ready_for_payment", "completed"]);
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Select a valid operator queue status." });
  }
  const limit = Math.min(100, Math.max(10, Number.parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const rows = db
    .prepare(`
      WITH queue_rows AS (
        SELECT
          s.consultation_id,
          s.billing_id,
          b.invoice_number,
          p.full_name AS patient_name,
          p.patient_identifier,
          d.full_name AS doctor_name,
          a.appointment_date,
          a.appointment_time,
          b.total_amount,
          b.status AS bill_status,
          b.fee_review_required,
          SUM(CASE WHEN s.reversed_at IS NULL THEN s.item_count ELSE 0 END) AS supply_item_count,
          SUM(CASE WHEN s.reversed_at IS NULL THEN s.amount_added ELSE 0 END) AS supply_amount,
          MAX(s.created_at) AS submitted_at,
          COUNT(s.id) AS submission_count,
          (
            SELECT latest.id
            FROM billing_lite_submissions latest
            WHERE latest.consultation_id = s.consultation_id
              AND latest.reversed_at IS NULL
            ORDER BY latest.id DESC
            LIMIT 1
          ) AS latest_submission_id,
          (
            SELECT latest.workflow_status
            FROM billing_lite_submissions latest
            WHERE latest.consultation_id = s.consultation_id
              AND latest.reversed_at IS NULL
            ORDER BY latest.id DESC
            LIMIT 1
          ) AS workflow_status,
          (
            SELECT latest.workflow_note
            FROM billing_lite_submissions latest
            WHERE latest.consultation_id = s.consultation_id
              AND latest.reversed_at IS NULL
            ORDER BY latest.id DESC
            LIMIT 1
          ) AS workflow_note
        FROM billing_lite_submissions s
        JOIN consultations c ON c.id = s.consultation_id
        JOIN appointments a ON a.id = c.appointment_id
        JOIN patients p ON p.id = c.patient_id
        JOIN doctors d ON d.id = c.doctor_id
        JOIN billing b ON b.id = s.billing_id
        WHERE c.voided_at IS NULL
          AND b.voided_at IS NULL
          AND s.reversed_at IS NULL
        GROUP BY
          s.consultation_id, s.billing_id, b.invoice_number, p.full_name, p.patient_identifier,
          d.full_name, a.appointment_date, a.appointment_time,
          b.total_amount, b.status, b.fee_review_required
      ), filtered_queue AS (
        SELECT *,
          CASE WHEN bill_status = 'paid' THEN 'completed' ELSE COALESCE(workflow_status, 'awaiting_operator') END AS effective_status
        FROM queue_rows
        WHERE (
          @search = ''
          OR lower(patient_name) LIKE @pattern
          OR lower(patient_identifier) LIKE @pattern
          OR lower(doctor_name) LIKE @pattern
          OR lower(COALESCE(invoice_number, '')) LIKE @pattern
          OR lower(printf('V-%06d', consultation_id)) LIKE @pattern
        )
      )
      SELECT *, COUNT(*) OVER() AS total_count
      FROM filtered_queue
      WHERE (
        @status = ''
        OR (@status = 'actionable' AND effective_status IN ('awaiting_operator', 'needs_doctor', 'ready_for_payment'))
        OR effective_status = @status
      )
      ORDER BY
        CASE effective_status
          WHEN 'needs_doctor' THEN 0
          WHEN 'awaiting_operator' THEN 1
          WHEN 'ready_for_payment' THEN 2
          ELSE 3
        END,
        submitted_at ASC
      LIMIT @limit OFFSET @offset
    `)
    .all({ search, pattern: `%${search}%`, status, limit, offset })
    .map((row) => ({
      consultation_id: Number(row.consultation_id),
      submission_id: Number(row.latest_submission_id),
      visit_number: formatVisitNumber(row.consultation_id),
      bill_id: Number(row.billing_id),
      invoice_number: row.invoice_number || "",
      patient_name: row.patient_name,
      patient_identifier: row.patient_identifier,
      doctor_name: row.doctor_name,
      visit_date: row.appointment_date,
      visit_time: row.appointment_time,
      bill_total: roundCurrency(row.total_amount),
      bill_status: row.bill_status,
      fee_review_required: Boolean(row.fee_review_required),
      supply_item_count: Number(row.supply_item_count || 0),
      supply_amount: roundCurrency(row.supply_amount),
      submission_count: Number(row.submission_count || 0),
      submitted_at: row.submitted_at,
      workflow_status: row.bill_status === "paid" ? "completed" : row.workflow_status || "awaiting_operator",
      workflow_note: row.workflow_note || "",
      total_count: Number(row.total_count || 0),
    }));

  const total = Number(rows[0]?.total_count || 0);
  res.json({ submissions: rows, total, limit, offset, has_more: offset + rows.length < total });
});

router.patch("/quick/operator-queue/:consultationId/status", (req, res) => {
  if (!["admin", "operator"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "Only operators and administrators can update doctor submission status." });
  }

  const consultationId = Number(req.params.consultationId || 0);
  const submissionId = Number(req.body?.submission_id || 0);
  const expectedWorkflowStatus = String(req.body?.expected_workflow_status || "").trim();
  const status = String(req.body?.status || "").trim();
  const note = String(req.body?.note || "").trim().slice(0, 500);
  const allowed = new Set(["awaiting_operator", "needs_doctor", "ready_for_payment"]);
  if (
    !Number.isInteger(consultationId) || consultationId <= 0
    || !Number.isInteger(submissionId) || submissionId <= 0
    || !allowed.has(status) || !allowed.has(expectedWorkflowStatus)
  ) {
    return res.status(400).json({ error: "Select a valid doctor billing workflow status." });
  }
  if (status === "needs_doctor" && note.length < 3) {
    return res.status(400).json({ error: "Add a short note explaining what the doctor should clarify." });
  }

  let submission;
  try {
    db.transaction(() => {
      const latest = db.prepare(`
        SELECT *
        FROM billing_lite_submissions
        WHERE consultation_id = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(consultationId);
      if (!latest) {
        throw Object.assign(new Error("Doctor billing submission not found."), { status: 404 });
      }
      if (Number(latest.id) !== submissionId || latest.workflow_status !== expectedWorkflowStatus) {
        throw Object.assign(
          new Error("This billing submission was updated elsewhere. Reload the queue before reviewing it."),
          { status: 409, extra: { code: "STALE_BILLING_SUBMISSION", latest_submission_id: Number(latest.id), latest_workflow_status: latest.workflow_status } },
        );
      }
      if (latest.reversed_at) {
        throw Object.assign(new Error("This submission has already been reversed."), { status: 409 });
      }
      submission = latest;
      const updated = db.prepare(`
      UPDATE billing_lite_submissions
      SET workflow_status = ?,
          workflow_note = ?,
          workflow_updated_by_user_id = ?,
          workflow_updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND workflow_status = ? AND reversed_at IS NULL
      `).run(status, note, req.auth.id, submission.id, expectedWorkflowStatus);
      if (updated.changes !== 1) {
        throw Object.assign(
          new Error("This billing submission was updated elsewhere. Reload the queue before reviewing it."),
          { status: 409, extra: { code: "STALE_BILLING_SUBMISSION" } },
        );
      }
      recordQuickBillingEvent({
        submissionId: submission.id,
        consultationId,
        billingId: submission.billing_id,
        actor: req.auth,
        eventType: status === "needs_doctor" ? "clarification_requested" : "workflow_status_changed",
        previousStatus: submission.workflow_status,
        nextStatus: status,
        reason: note,
      });
    }).immediate();
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  if (status === "needs_doctor") {
    const doctorUserId = getDoctorUserId(submission.doctor_id);
    if (doctorUserId) {
      void sendPushToUser(doctorUserId, {
        title: "Billing clarification needed",
        body: `${formatVisitNumber(consultationId)}: ${note}`,
        url: "/billing",
        icon: "/icon-192.png",
        tag: `billing-clarification-${consultationId}`,
        requireInteraction: true,
      }).catch((error) => {
        console.warn("[quick-billing] doctor clarification push failed:", error?.message || error);
      });
    }
  }

  res.json({ submission_id: submissionId, consultation_id: consultationId, workflow_status: status, workflow_note: note });
});

router.get("/quick/submissions", (req, res) => {
  const doctorId = req.auth?.role === "doctor" ? requireQuickBillingDoctor(req, res) : null;
  if (req.auth?.role === "doctor" && !doctorId) return;
  if (!["doctor", "operator", "admin"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "You do not have access to billing submissions." });
  }

  const search = String(req.query.search || "").trim().slice(0, 100);
  const status = String(req.query.status || "").trim();
  const allowedStatuses = new Set(["", "awaiting_operator", "needs_doctor", "ready_for_payment", "completed", "reversed", "superseded"]);
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Select a valid billing update status." });
  }
  const limit = Math.min(50, Math.max(10, Number.parseInt(req.query.limit, 10) || 20));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const params = {
    doctorId,
    search,
    pattern: `%${search.toLowerCase()}%`,
    status,
    limit,
    offset,
  };
  const where = `
      WHERE (@doctorId IS NULL OR s.doctor_id = @doctorId)
        AND (
          @search = ''
          OR lower(p.full_name) LIKE @pattern
          OR lower(p.patient_identifier) LIKE @pattern
          OR lower(printf('V-%06d', s.consultation_id)) LIKE @pattern
        )
        AND (
          @status = ''
          OR CASE
            WHEN b.status = 'paid' THEN 'completed'
            WHEN s.reversed_at IS NOT NULL THEN 'reversed'
            ELSE COALESCE(s.workflow_status, 'awaiting_operator')
          END = @status
        )
  `;
  const total = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM billing_lite_submissions s
    JOIN consultations c ON c.id = s.consultation_id
    JOIN appointments a ON a.id = c.appointment_id
    JOIN patients p ON p.id = c.patient_id
    JOIN billing b ON b.id = s.billing_id
    ${where}
  `).get(params)?.count || 0);
  const rows = db
    .prepare(`
      SELECT
        s.*,
        p.full_name AS patient_name,
        p.patient_identifier,
        a.appointment_date,
        a.appointment_time,
        b.status AS bill_status
      FROM billing_lite_submissions s
      JOIN consultations c ON c.id = s.consultation_id
      JOIN appointments a ON a.id = c.appointment_id
      JOIN patients p ON p.id = c.patient_id
      JOIN billing b ON b.id = s.billing_id
      ${where}
      ORDER BY s.id DESC
      LIMIT @limit OFFSET @offset
    `)
    .all(params)
    .map((row) => ({
      id: Number(row.id),
      consultation_id: Number(row.consultation_id),
      visit_number: formatVisitNumber(row.consultation_id),
      patient_identifier: String(row.patient_identifier || ""),
      patient_name: String(row.patient_name || ""),
      patient_masked_name: maskPatientName(row.patient_name),
      visit_date: row.appointment_date,
      visit_time: row.appointment_time,
      item_count: Number(row.item_count || 0),
      amount_added: roundCurrency(row.amount_added),
      items: normalizeBillingItems(row.items_json).map((item) => ({
        description: item.description,
        quantity: item.quantity,
        amount: item.amount,
      })),
      submitted_at: row.created_at,
      status: row.bill_status === "paid" ? "completed" : row.workflow_status || "awaiting_operator",
      workflow_note: row.workflow_note || "",
      reversed_at: row.reversed_at || null,
      reversal_reason: row.reversal_reason || "",
    }));

  res.json({ submissions: rows, total, limit, offset });
});

router.post("/quick/visits/:consultationId/capture", (req, res) => {
  if (!["doctor", "operator"].includes(req.auth?.role)) {
    return res.status(403).json({
      error: "Quick billing can only be issued by the consultation doctor or an operator acting for that doctor.",
      code: "QUICK_BILLING_ROLE_FORBIDDEN",
    });
  }
  const consultationId = Number(req.params.consultationId || 0);
  const requestedConsultation = getConsultationContext(consultationId);
  if (!requestedConsultation || requestedConsultation.voided_at) {
    return res.status(404).json({ error: "This visit was not found." });
  }
  try {
    assertBillingActorConsultationAccess(req.auth, requestedConsultation, req.body?.doctor_id);
    assertQuickBillingCutoverOpen(requestedConsultation);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message, ...(error.extra || {}) });
  }
  const doctorId = Number(requestedConsultation.doctor_id);
  const operationId = String(req.body?.operation_id || "").trim();
  if (!operationId) {
    return res.status(400).json({ error: "A unique submission reference is required." });
  }
  const sourceReference = normalizeSourceReference(req.body?.source_reference);
  if (req.auth?.role === "operator" && sourceReference.length < 3) {
    return res.status(400).json({
      error: "Enter the OCS paper invoice number or photo reference before issuing this invoice.",
    });
  }

  const hasRequestedFee = Boolean(req.body?.consultation_fee && typeof req.body.consultation_fee === "object");
  const requestedFeeType = String(req.body?.consultation_fee?.type || "").trim();
  const requestedFeeAmount = Number(req.body?.consultation_fee?.amount);
  const requestedFeeReason = String(req.body?.consultation_fee?.adjustment_reason || "").trim().slice(0, 500);
  if (hasRequestedFee && !Object.prototype.hasOwnProperty.call(CONSULTATION_FEES, requestedFeeType)) {
    return res.status(400).json({ error: "Select Day, Night, or Review Consultation." });
  }
  if (hasRequestedFee && (!isValidCurrencyAmount(req.body?.consultation_fee?.amount) || requestedFeeAmount <= 0 || requestedFeeAmount > MAX_CONSULTATION_FEE)) {
    return res.status(400).json({ error: `Enter a consultation price between Rs 0.01 and Rs ${MAX_CONSULTATION_FEE.toLocaleString("en-MU")} using no more than two decimal places.` });
  }
  const configuredFee = hasRequestedFee ? roundCurrency(CONSULTATION_FEES[requestedFeeType]) : null;
  const requestedFeeDiffers = hasRequestedFee && roundCurrency(requestedFeeAmount) !== configuredFee;
  if (requestedFeeDiffers && requestedFeeReason.length < 8) {
    return res.status(400).json({
      error: "Explain why this consultation price differs from the configured tariff (at least 8 characters).",
      code: "CONSULTATION_FEE_REASON_REQUIRED",
    });
  }

  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (rawItems.length > 40) {
    return res.status(400).json({ error: "A quick billing submission can contain up to 40 different supplies." });
  }

  const mergedQuantities = new Map();
  const reviewedUnitPrices = new Map();
  for (const item of rawItems) {
    const itemId = Number(item?.inventory_item_id || 0);
    const quantity = Number(item?.quantity || 0);
    if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "Every selected supply needs a valid whole-number quantity." });
    }
    if (item?.unit_price !== undefined && item?.unit_price !== null && item?.unit_price !== "") {
      if (!isValidCurrencyAmount(item.unit_price) || Number(item.unit_price) <= 0) {
        return res.status(400).json({ error: "Every reviewed supply price must be a positive currency amount." });
      }
      const reviewedPrice = roundCurrency(item.unit_price);
      if (reviewedUnitPrices.has(itemId) && reviewedUnitPrices.get(itemId) !== reviewedPrice) {
        return res.status(400).json({ error: "A supply cannot contain conflicting reviewed prices." });
      }
      reviewedUnitPrices.set(itemId, reviewedPrice);
    }
    mergedQuantities.set(itemId, (mergedQuantities.get(itemId) || 0) + quantity);
  }

  let operation;
  try {
    operation = operationFor(req, `billing:quick-capture:${consultationId}`);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  let result = null;
  let touchedItemIds = [];
  let patientId = null;
  try {
    db.transaction(() => {
      const replay = operation.read();
      if (replay) {
        result = replay;
        return;
      }

      const consultation = getConsultationContext(consultationId);
      if (!consultation || consultation.voided_at || Number(consultation.doctor_id) !== doctorId) {
        throw Object.assign(new Error("This visit does not belong to your doctor account."), { status: 403 });
      }
      assertQuickBillingCutoverOpen(consultation);
      patientId = Number(consultation.patient_id);

      const billRow = db
        .prepare(`
          SELECT *
          FROM billing
          WHERE consultation_id = ?
            AND status = 'unpaid'
            AND voided_at IS NULL
          ORDER BY id ASC
          LIMIT 1
        `)
        .get(consultationId);
      if (!billRow) {
        throw Object.assign(new Error("This visit no longer has an unpaid bill that can receive supplies."), { status: 409 });
      }
      const bill = parseBillingRow(billRow);
      const latestSubmission = db.prepare(`
        SELECT *
        FROM billing_lite_submissions
        WHERE consultation_id = ? AND reversed_at IS NULL
        ORDER BY id DESC
        LIMIT 1
      `).get(consultationId);
      if (latestSubmission) {
        const isDoctorCorrection = req.auth?.role === "doctor" && latestSubmission.workflow_status === "needs_doctor";
        if (!isDoctorCorrection) {
          throw Object.assign(
            new Error("This billing submission has already been issued or is awaiting review. Use the audited correction or reversal action instead of submitting it again."),
            { status: 409, extra: { code: "QUICK_BILLING_ALREADY_SUBMITTED", submission_id: latestSubmission.id } },
          );
        }
      }
      if (sourceReference) {
        const existingReference = normalizeSourceReference(bill.source_reference);
        if (existingReference && existingReference.toLowerCase() !== sourceReference.toLowerCase()) {
          throw Object.assign(
            new Error(`This invoice is already linked to source reference ${existingReference}.`),
            { status: 409, extra: { code: "SOURCE_REFERENCE_LOCKED", bill_id: bill.id } },
          );
        }
        const duplicate = db.prepare(`
          SELECT id, invoice_number
          FROM billing
          WHERE lower(trim(source_reference)) = lower(trim(?))
            AND id != ?
          LIMIT 1
        `).get(sourceReference, bill.id);
        if (duplicate) {
          throw Object.assign(
            new Error(`Source reference ${sourceReference} is already attached to ${duplicate.invoice_number || `bill #${duplicate.id}`}.`),
            { status: 409, extra: { code: "DUPLICATE_SOURCE_REFERENCE", bill_id: duplicate.id } },
          );
        }
      }
      if (hasRequestedFee && bill.legacy_fee_review_required) {
        throw Object.assign(new Error("An admin must verify this historical consultation fee before it can be changed."), { status: 409 });
      }
      const existingFeeIndexes = (bill.items || [])
        .map((item, index) => (isConsultationFee(item) ? index : -1))
        .filter((index) => index >= 0);
      if (existingFeeIndexes.length !== 1) {
        throw Object.assign(new Error("This visit needs one valid consultation fee before quick billing can continue."), { status: 409 });
      }
      const feeIndex = existingFeeIndexes[0];
      const previousFee = bill.items[feeIndex];
      const consultationFeeType = hasRequestedFee ? requestedFeeType : String(previousFee.description || "");
      const consultationFeeAmount = hasRequestedFee
        ? roundCurrency(requestedFeeAmount)
        : roundCurrency(previousFee.amount);
      const feeChanged =
        String(previousFee.description || "") !== consultationFeeType ||
        roundCurrency(previousFee.amount) !== consultationFeeAmount;
      const feeConfirmed = hasRequestedFee && Boolean(bill.fee_review_required);
      let correctionReversal = { reversalIds: [], touchedItemIds: [] };
      let correctionMovementIds = [];
      if (latestSubmission?.workflow_status === "needs_doctor") {
        const priorItems = normalizeBillingItems(latestSubmission.items_json);
        const stockMovementIds = priorItems.flatMap((item) => item.inventory_movement_ids || []).map(Number).filter(Boolean);
        const dispensingMovementIds = priorItems.flatMap((item) => item.dispensing_movement_ids || []).map(Number).filter(Boolean);
        correctionMovementIds = [...new Set([...stockMovementIds, ...dispensingMovementIds])];
        if (Number(latestSubmission.item_count || 0) > 0 && correctionMovementIds.length === 0) {
          throw Object.assign(
            new Error("The earlier submission predates exact stock tracking and cannot be replaced automatically. Ask an operator to use the audited reversal workflow."),
            { status: 409, extra: { code: "CLARIFICATION_REPLACEMENT_REQUIRES_REVERSAL" } },
          );
        }
        if (correctionMovementIds.length) {
          correctionReversal = reverseBillingSubmissionInventory({
            movementIds: stockMovementIds,
            dispensingMovementIds,
            consultationId,
            billingId: bill.id,
            actor: req.auth,
            reason: `Replaced after billing clarification: ${String(latestSubmission.workflow_note || "corrected submission")}`,
          });
        }
      }
      const correctionMovementIdSet = new Set(correctionMovementIds);
      const billItemsForReplacement = latestSubmission?.workflow_status === "needs_doctor"
        ? (bill.items || []).filter((item) => ![
            ...(item.inventory_movement_ids || []),
            ...(item.dispensing_movement_ids || []),
          ].some((id) => correctionMovementIdSet.has(Number(id))))
        : (bill.items || []);
      const replacementFeeIndex = billItemsForReplacement.findIndex(isConsultationFee);
      if (replacementFeeIndex < 0) {
        throw Object.assign(new Error("The consultation fee could not be preserved while replacing the clarified supplies."), { status: 409 });
      }
      const baseItems = billItemsForReplacement.map((item, index) =>
        index === replacementFeeIndex
          ? {
              ...item,
              description: consultationFeeType,
              amount: consultationFeeAmount,
              type: "Sale",
              quantity: 1,
              inventory_item_id: null,
              is_consultation_fee: true,
            }
          : item,
      );

      const requestedIds = [...mergedQuantities.keys()];
      let chargeLines = [];
      if (requestedIds.length) {
        const placeholders = requestedIds.map(() => "?").join(",");
        const stockRows = db
          .prepare(`
            SELECT id, item_name, selling_price
            FROM inventory
            WHERE id IN (${placeholders})
              AND stock_scope = 'doctor'
              AND owner_doctor_id = ?
              AND archived_at IS NULL
          `)
          .all(...requestedIds, doctorId);
        if (stockRows.length !== requestedIds.length) {
          throw Object.assign(new Error("One or more selected supplies are no longer available in your bag."), { status: 409 });
        }
        const stockById = new Map(stockRows.map((item) => [Number(item.id), item]));
        const changedPrices = requestedIds.flatMap((itemId) => {
          const reviewedPrice = reviewedUnitPrices.get(itemId);
          const currentPrice = roundCurrency(stockById.get(itemId)?.selling_price);
          return reviewedPrice !== undefined && Math.abs(reviewedPrice - currentPrice) >= 0.005
            ? [{ inventory_item_id: itemId, item_name: stockById.get(itemId)?.item_name || "Supply", reviewed_price: reviewedPrice, current_price: currentPrice }]
            : [];
        });
        if (changedPrices.length) {
          throw Object.assign(
            new Error("One or more supply prices changed after this bill was reviewed. Reopen the saved bill and confirm the updated total."),
            { status: 409, extra: { code: "BILLING_PRICE_CHANGED", changed_prices: changedPrices } },
          );
        }
        chargeLines = requestedIds.map((itemId) => {
          const item = stockById.get(itemId);
          const quantity = mergedQuantities.get(itemId);
          return {
            description: item.item_name,
            amount: roundCurrency(Number(item.selling_price || 0) * quantity),
            type: "Sale",
            quantity,
            inventory_item_id: itemId,
          };
        });
      }

      const applied = applyInventoryTransactions({
        consultation,
        items: chargeLines,
        userId: req.auth.id,
        actor: req.auth,
        billingId: bill.id,
      });
      touchedItemIds = [...new Set([
        ...(correctionReversal.touchedItemIds || []),
        ...(applied.touchedItemIds || []),
      ])];
      const addedItems = normalizeBillingItems(applied.items);

      if (addedItems.length || feeChanged || feeConfirmed || sourceReference || latestSubmission?.workflow_status === "needs_doctor") {
        const nextItems = normalizeBillingItems([...baseItems, ...addedItems]);
        const updated = db
          .prepare(`
            UPDATE billing
            SET items = ?,
                total_amount = ?,
                consultation_type_snapshot = ?,
                updated_at = CURRENT_TIMESTAMP,
                updated_by_user_id = ?,
                change_reason = ?,
                source_reference = CASE WHEN ? != '' THEN ? ELSE source_reference END,
                issued_at = CASE WHEN ? != '' THEN COALESCE(issued_at, CURRENT_TIMESTAMP) ELSE issued_at END,
                issued_by_user_id = CASE WHEN ? != '' AND COALESCE(NULLIF(issued_by_role, ''), 'system') = 'system' THEN ? ELSE issued_by_user_id END,
                issued_by_name = CASE WHEN ? != '' AND COALESCE(NULLIF(issued_by_role, ''), 'system') = 'system' THEN ? ELSE issued_by_name END,
                issued_by_role = CASE WHEN ? != '' AND COALESCE(NULLIF(issued_by_role, ''), 'system') = 'system' THEN ? ELSE issued_by_role END,
                fee_review_required = CASE WHEN ? = 1 THEN 0 ELSE fee_review_required END
            WHERE id = ?
              AND row_version = ?
              AND status = 'unpaid'
              AND voided_at IS NULL
          `)
          .run(
            JSON.stringify(nextItems),
            calculateBillingTotal(nextItems),
            consultationTypeFromItems(nextItems),
            req.auth.id,
            feeChanged && addedItems.length
              ? `Consultation fee adjusted and supplies captured in quick billing: ${requestedFeeReason || "configured tariff selected"}`
              : feeChanged
                ? `Consultation fee adjusted in quick billing: ${requestedFeeReason || "configured tariff selected"}`
                : feeConfirmed
                  ? "Consultation fee confirmed in quick billing"
                  : "Supplies captured in quick billing",
            sourceReference,
            sourceReference,
            sourceReference,
            sourceReference,
            req.auth.id,
            sourceReference,
            String(req.auth.full_name || req.auth.username || ""),
            sourceReference,
            String(req.auth.role || ""),
            feeConfirmed ? 1 : 0,
            bill.id,
            bill.row_version,
          );
        if (updated.changes !== 1) {
          throw Object.assign(new Error("This bill changed on another device. Reload the visit before submitting again."), { status: 409 });
        }
      }

      const amountAdded = roundCurrency(
        addedItems.reduce((sum, item) => sum + (item.type === "Sale" ? Number(item.amount || 0) : 0), 0),
      );
      const inserted = db
        .prepare(`
          INSERT INTO billing_lite_submissions (
            consultation_id, billing_id, doctor_id, submitted_by_user_id,
            operation_id, item_count, items_json, amount_added, workflow_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          consultationId,
          bill.id,
          doctorId,
          req.auth.id,
          operationId,
          addedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          JSON.stringify(addedItems),
          amountAdded,
          req.auth?.role === "operator" ? "ready_for_payment" : "awaiting_operator",
        );

      db.prepare(`
        UPDATE billing
        SET finalized_at = COALESCE(finalized_at, CURRENT_TIMESTAMP),
            finalized_by_user_id = COALESCE(finalized_by_user_id, ?),
            finalized_by_name = CASE WHEN trim(COALESCE(finalized_by_name, '')) = '' THEN ? ELSE finalized_by_name END,
            finalized_by_role = CASE WHEN trim(COALESCE(finalized_by_role, '')) = '' THEN ? ELSE finalized_by_role END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND voided_at IS NULL
      `).run(
        req.auth.id || null,
        String(req.auth.full_name || req.auth.username || ""),
        String(req.auth.role || ""),
        bill.id,
      );

      const supersededClarifications = db.prepare(`
        SELECT id, workflow_note
        FROM billing_lite_submissions
        WHERE consultation_id = ?
          AND id != ?
          AND workflow_status = 'needs_doctor'
          AND reversed_at IS NULL
      `).all(consultationId, Number(inserted.lastInsertRowid));
      if (supersededClarifications.length) {
        db.prepare(`
          UPDATE billing_lite_submissions
          SET workflow_status = 'superseded', workflow_note = '',
              reversed_at = CURRENT_TIMESTAMP, reversed_by_user_id = ?,
              reversal_reason = ?, reversal_operation_id = ?,
              workflow_updated_by_user_id = ?, workflow_updated_at = CURRENT_TIMESTAMP
          WHERE consultation_id = ?
            AND id != ?
            AND workflow_status = 'needs_doctor'
            AND reversed_at IS NULL
        `).run(
          req.auth.id,
          "Replaced after operator clarification",
          operationId,
          req.auth.id,
          consultationId,
          Number(inserted.lastInsertRowid),
        );
        for (const previous of supersededClarifications) {
          recordQuickBillingEvent({
            submissionId: previous.id,
            consultationId,
            billingId: bill.id,
            actor: req.auth,
            eventType: "clarification_superseded",
            previousStatus: "needs_doctor",
            nextStatus: "superseded",
            reason: "Doctor submitted a corrected billing entry.",
            details: {
              replacement_submission_id: Number(inserted.lastInsertRowid),
              reversal_movement_ids: correctionReversal.reversalIds || [],
            },
          });
        }
      }

      recordQuickBillingEvent({
        submissionId: Number(inserted.lastInsertRowid),
        consultationId,
        billingId: bill.id,
        actor: req.auth,
        eventType: "submitted",
        nextStatus: req.auth?.role === "operator" ? "ready_for_payment" : "awaiting_operator",
        details: {
          item_count: addedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          amount_added: amountAdded,
          consultation_fee: {
            previous_type: String(previousFee.description || ""),
            previous_amount: roundCurrency(previousFee.amount),
            type: consultationFeeType,
            amount: consultationFeeAmount,
            changed: feeChanged,
            confirmed: feeConfirmed,
            adjustment_reason: feeChanged ? requestedFeeReason : "",
          },
        },
      });

      result = {
        submission_id: Number(inserted.lastInsertRowid),
        bill_id: Number(bill.id),
        amount_added: amountAdded,
        item_count: addedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        consultation_fee: { type: consultationFeeType, amount: consultationFeeAmount, changed: feeChanged },
      };
      operation.save(result);
    }).immediate();
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  for (const itemId of touchedItemIds) {
    try {
      publishInventoryChange({ itemId, changedByUserId: req.auth.id });
    } catch (error) {
      console.warn("[billing-lite] inventory publish failed:", error?.message || error);
    }
  }
  if (patientId) {
    publishPatientDataChange(patientId, { reason: "billing" });
    notifyLinkhamBillingIfNeeded(patientId, req.auth.id);
  }

  res.status(201).json({
    submission: result,
    visit: getQuickVisit(consultationId, doctorId),
  });
});

router.post("/quick/submissions/:submissionId/reverse", (req, res) => {
  const submissionId = Number(req.params.submissionId || 0);
  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return res.status(400).json({ error: "Select a valid billing submission." });
  }
  if (reason.length < 5) {
    return res.status(400).json({ error: "Enter a clear reason for reversing the submitted supplies." });
  }

  const submission = db.prepare(`
    SELECT s.*, c.patient_id, c.doctor_id AS consultation_doctor_id,
      b.status AS bill_status, b.total_amount, b.row_version
    FROM billing_lite_submissions s
    JOIN consultations c ON c.id = s.consultation_id
    JOIN billing b ON b.id = s.billing_id
    WHERE s.id = ? AND c.voided_at IS NULL AND b.voided_at IS NULL
  `).get(submissionId);
  if (!submission) {
    return res.status(404).json({ error: "Billing submission not found." });
  }
  const isOwnerDoctor = req.auth?.role === "doctor"
    && Number(req.auth?.doctor_id || 0) === Number(submission.doctor_id);
  if (!["admin", "operator"].includes(req.auth?.role) && !isOwnerDoctor) {
    return res.status(403).json({ error: "You cannot reverse this doctor billing submission." });
  }
  if (submission.bill_status === "paid") {
    return res.status(409).json({ error: "A paid bill requires the documented admin correction process before stock can be reversed." });
  }
  const activePayment = paymentSummaryForBill(submission.billing_id, submission.total_amount);
  if (activePayment.payment_received_amount > 0.000001) {
    return res.status(409).json({
      error: "Finance must reverse the active receipt before supplies on a partially paid invoice can be corrected. Retry this reversal after the receipt balance is zero, then re-record the correct payment.",
      code: "PARTIAL_PAYMENT_REVERSAL_REQUIRED",
      payment_received_amount: activePayment.payment_received_amount,
    });
  }

  let operation;
  try {
    operation = operationFor(req, `billing:quick-reverse:${submissionId}`);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  let result;
  let touchedItemIds = [];
  try {
    db.transaction(() => {
      const replay = operation.read();
      if (replay) {
        result = replay;
        return;
      }
      const fresh = db.prepare("SELECT * FROM billing_lite_submissions WHERE id = ?").get(submissionId);
      if (fresh.reversed_at) {
        result = { submission_id: submissionId, reversed: 0, already_reversed: true };
        operation.save(result);
        return;
      }

      const submittedItems = normalizeBillingItems(fresh.items_json);
      const movementIds = submittedItems.flatMap((item) => item.inventory_movement_ids || []);
      const dispensingMovementIds = submittedItems.flatMap((item) => item.dispensing_movement_ids || []);
      if (!movementIds.length && !dispensingMovementIds.length) {
        throw Object.assign(new Error("This submission has no automatically reversible supply movements."), {
          status: 409,
          extra: { code: "SUBMISSION_REVERSAL_REQUIRES_CORRECTION" },
        });
      }
      const reversed = reverseBillingSubmissionInventory({
        movementIds,
        dispensingMovementIds,
        consultationId: fresh.consultation_id,
        billingId: fresh.billing_id,
        actor: req.auth,
        reason,
      });
      touchedItemIds = reversed.touchedItemIds;

      const bill = parseBillingRow(db.prepare("SELECT * FROM billing WHERE id = ?").get(fresh.billing_id));
      const movementIdSet = new Set([...movementIds, ...dispensingMovementIds].map(Number));
      const nextItems = (bill.items || []).filter(
        (item) => ![
          ...(item.inventory_movement_ids || []),
          ...(item.dispensing_movement_ids || []),
        ].some((id) => movementIdSet.has(Number(id))),
      );
      if (nextItems.length === (bill.items || []).length) {
        throw Object.assign(new Error("The submitted supply lines no longer match the unpaid bill. Reopen the bill and use an authorised correction."), {
          status: 409,
          extra: { code: "SUBMISSION_BILL_LINES_CHANGED" },
        });
      }
      const billUpdated = db.prepare(`
        UPDATE billing
        SET items = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP,
            updated_by_user_id = ?, change_reason = ?,
            finalized_at = NULL, finalized_by_user_id = NULL,
            finalized_by_name = '', finalized_by_role = ''
        WHERE id = ? AND row_version = ? AND status = 'unpaid' AND voided_at IS NULL
      `).run(
        JSON.stringify(nextItems),
        calculateBillingTotal(nextItems),
        req.auth.id,
        `Reversed quick billing submission #${submissionId}: ${reason}`,
        bill.id,
        bill.row_version,
      );
      if (billUpdated.changes !== 1) {
        throw Object.assign(new Error("The bill changed on another device. Reopen it before reversing supplies."), { status: 409 });
      }

      db.prepare(`
        UPDATE billing_lite_submissions
        SET workflow_status = 'reversed', workflow_note = '',
            reversed_at = CURRENT_TIMESTAMP, reversed_by_user_id = ?, reversal_reason = ?,
            reversal_operation_id = ?, workflow_updated_by_user_id = ?, workflow_updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND reversed_at IS NULL
      `).run(req.auth.id, reason, String(req.body?.operation_id || ""), req.auth.id, submissionId);
      recordQuickBillingEvent({
        submissionId,
        consultationId: fresh.consultation_id,
        billingId: fresh.billing_id,
        actor: req.auth,
        eventType: "supplies_reversed",
        previousStatus: fresh.workflow_status,
        nextStatus: "reversed",
        reason,
        details: {
          movement_ids: movementIds,
          dispensing_movement_ids: dispensingMovementIds,
          reversal_movement_ids: reversed.reversalIds,
          reopened_dispensing_movement_ids: reversed.unlinkedDispensingIds,
        },
      });
      result = {
        submission_id: submissionId,
        reversed: reversed.reversed,
        stock_movements_reversed: reversed.stockMovementsReversed,
        dispensing_links_reopened: reversed.dispensingLinksReopened,
        already_reversed: false,
      };
      operation.save(result);
    }).immediate();
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  for (const itemId of touchedItemIds) {
    try {
      publishInventoryChange({ itemId, changedByUserId: req.auth.id });
    } catch (error) {
      console.warn("[quick-billing] reversal inventory publish failed:", error?.message || error);
    }
  }
  publishPatientDataChange(submission.patient_id, { reason: "billing" });
  res.json(result);
});

router.post("/quick/submissions/:submissionId/paid-correction", (req, res) => {
  if (!["admin", "accountant"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "Paid supply corrections are restricted to administrators and finance." });
  }
  const submissionId = Number(req.params.submissionId || 0);
  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  const disposition = String(req.body?.disposition || "").trim();
  const refundMethod = normalizePaymentMethod(req.body?.refund_method);
  const refundDate = String(req.body?.refund_date || "").trim();
  const externalReference = normalizeSourceReference(req.body?.external_reference);
  if (!Number.isInteger(submissionId) || submissionId <= 0) return res.status(400).json({ error: "Select a valid billing submission." });
  if (reason.length < 8) return res.status(400).json({ error: "Document why the paid supply charge is being corrected." });
  if (!["returned_to_stock", "consumed_or_wasted"].includes(disposition)) {
    return res.status(400).json({ error: "Confirm whether the supplies were returned to stock or consumed/wasted." });
  }
  if (!PAYMENT_METHODS.has(refundMethod)) return res.status(400).json({ error: "Select the method used to return the money." });
  if (!validPaymentDate(refundDate)) return res.status(400).json({ error: "Enter a valid refund date (YYYY-MM-DD)." });
  if (refundMethod !== "cash" && externalReference.length < 3) {
    return res.status(400).json({ error: "Enter the provider reference for this non-cash correction." });
  }
  let operation;
  try {
    operation = operationFor(req, `billing:paid-supply-correction:${submissionId}`);
    const replay = operation.read();
    if (replay) return res.status(201).json(replay);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  try {
    assertNotFutureBusinessDate(refundDate, "Refund");
    assertBusinessDateOpen(refundDate);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }
  const submission = db.prepare(`
    SELECT s.*, b.status AS bill_status, b.total_amount, b.voided_at,
      c.patient_id, c.voided_at AS consultation_voided_at
    FROM billing_lite_submissions s
    JOIN billing b ON b.id = s.billing_id
    JOIN consultations c ON c.id = s.consultation_id
    WHERE s.id = ?
  `).get(submissionId);
  if (!submission) return res.status(404).json({ error: "Billing submission not found." });
  if (submission.bill_status !== "paid" || submission.voided_at || submission.consultation_voided_at) {
    return res.status(409).json({ error: "This workflow is only for active paid invoices." });
  }
  const effectiveWorkflowStatus = submission.bill_status === "paid"
    && !submission.reversed_at
    && !["corrected", "reversed", "superseded"].includes(submission.workflow_status)
    ? "completed"
    : submission.workflow_status;
  if (submission.reversed_at || effectiveWorkflowStatus !== "completed") {
    return res.status(409).json({
      error: "Only the active completed supply submission can receive a paid correction.",
      code: "SUBMISSION_NOT_ACTIVE",
    });
  }
  const newerActiveSubmission = db.prepare(`
    SELECT id
    FROM billing_lite_submissions
    WHERE billing_id = ? AND id > ? AND reversed_at IS NULL
    ORDER BY id DESC
    LIMIT 1
  `).get(submission.billing_id, submissionId);
  if (newerActiveSubmission) {
    return res.status(409).json({
      error: "A newer active billing submission replaced this one. Correct the current submission instead.",
      code: "SUBMISSION_NOT_ACTIVE",
      active_submission_id: Number(newerActiveSubmission.id),
    });
  }
  const amount = roundCurrency(submission.amount_added || 0);
  if (amount <= 0) return res.status(409).json({ error: "This submission has no supply charge to correct." });
  let result;
  let touchedItemIds = [];
  try {
    db.transaction(() => {
      const replay = operation.read();
      if (replay) { result = replay; return; }
      if (db.prepare("SELECT id FROM billing_supply_corrections WHERE submission_id = ?").get(submissionId)) {
        throw Object.assign(new Error("This paid supply submission has already been corrected."), { status: 409, extra: { code: "SUPPLY_ALREADY_CORRECTED" } });
      }
      const unallocatedCredit = db.prepare(`
        SELECT COUNT(*) AS count, COALESCE(SUM(refund.amount), 0) AS amount
        FROM billing_refunds refund
        WHERE refund.billing_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM billing_refund_allocations allocation
            WHERE allocation.refund_id = refund.id
          )
      `).get(submission.billing_id);
      if (Number(unallocatedCredit?.count || 0) > 0) {
        throw Object.assign(
          new Error("This invoice has an older unallocated credit note. Finance must reconcile that credit before correcting a paid supply."),
          { status: 409, extra: { code: "REFUND_ALLOCATION_REQUIRED", unallocated_amount: roundCurrency(unallocatedCredit.amount) } },
        );
      }
      const alreadySupplyRefunded = roundCurrency(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount
        FROM billing_refund_allocations
        WHERE billing_id = ?
          AND allocation_type = 'supply_submission'
          AND submission_id = ?
      `).get(submission.billing_id, submissionId)?.amount || 0);
      const invoiceRefundState = db.prepare(`
        SELECT bill.total_amount, COALESCE(SUM(refund.amount), 0) AS refunded_amount
        FROM billing bill
        LEFT JOIN billing_refunds refund ON refund.billing_id = bill.id
        WHERE bill.id = ?
        GROUP BY bill.id
      `).get(submission.billing_id);
      const submissionRefundable = roundCurrency(Number(submission.total_amount || 0) - alreadySupplyRefunded);
      const invoiceRefundable = roundCurrency(Number(invoiceRefundState?.total_amount || 0) - Number(invoiceRefundState?.refunded_amount || 0));
      const refundable = Math.max(0, Math.min(submissionRefundable, invoiceRefundable));
      if (amount > refundable + 0.000001) {
        throw Object.assign(new Error(`Only Rs ${refundable.toFixed(2)} remains refundable on this invoice.`), { status: 409, extra: { code: "REFUND_EXCEEDS_BALANCE" } });
      }
      if (externalReference) {
        const duplicate = db.prepare("SELECT id FROM billing_refunds WHERE lower(trim(external_reference)) = lower(trim(?)) LIMIT 1").get(externalReference);
        if (duplicate) throw Object.assign(new Error("That external refund reference has already been used."), { status: 409 });
      }
      const submittedItems = normalizeBillingItems(submission.items_json);
      const movementIds = submittedItems.flatMap((item) => item.inventory_movement_ids || []).map(Number).filter(Boolean);
      const dispensingMovementIds = submittedItems.flatMap((item) => item.dispensing_movement_ids || []).map(Number).filter(Boolean);
      const submissionMovementIds = [...new Set([...movementIds, ...dispensingMovementIds])];
      const currentBill = parseBillingRow(db.prepare("SELECT * FROM billing WHERE id = ?").get(submission.billing_id));
      const currentBillMovementIds = new Set((currentBill.items || []).flatMap((item) => [
        ...(item.inventory_movement_ids || []),
        ...(item.dispensing_movement_ids || []),
      ]).map(Number).filter(Boolean));
      if (!submissionMovementIds.length || submissionMovementIds.some((id) => !currentBillMovementIds.has(id))) {
        throw Object.assign(
          new Error("This supply submission is no longer part of the active invoice and cannot be credited again."),
          { status: 409, extra: { code: "SUBMISSION_NOT_ACTIVE" } },
        );
      }
      let reversal = { reversalIds: [], touchedItemIds: [] };
      if (disposition === "returned_to_stock") {
        reversal = reverseBillingSubmissionInventory({
          movementIds,
          dispensingMovementIds,
          consultationId: submission.consultation_id,
          billingId: submission.billing_id,
          actor: req.auth,
          reason,
          restoreDispensing: true,
          reversalScope: "paid_supply_correction",
        });
        touchedItemIds = reversal.touchedItemIds || [];
      } else {
        const reclassified = reclassifyBillingSubmissionInventoryAsWastage({
          movementIds: [...new Set([...movementIds, ...dispensingMovementIds])],
          consultationId: submission.consultation_id,
          billingId: submission.billing_id,
          actor: req.auth,
          reason,
        });
        reversal = { reversalIds: reclassified.movementIds || [], touchedItemIds: reclassified.touchedItemIds || [] };
        touchedItemIds = reversal.touchedItemIds;
      }
      const nextRefundId = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM billing_refunds").get().id);
      const creditNoteNumber = `OCS-CN-${String(nextRefundId).padStart(8, "0")}`;
      db.prepare(`
        INSERT INTO billing_refunds (
          id, credit_note_number, billing_id, amount, refund_method, refund_date,
          reason, external_reference, issued_by_user_id, issued_by_name,
          issued_by_role, operation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nextRefundId, creditNoteNumber, submission.billing_id, amount, refundMethod,
        refundDate, reason, externalReference || null, req.auth.id || null,
        String(req.auth.full_name || req.auth.username || ""), String(req.auth.role || ""),
        String(req.body?.operation_id || ""),
      );
      db.prepare(`
        INSERT INTO billing_refund_allocations (
          refund_id, billing_id, allocation_type, submission_id, amount
        ) VALUES (?, ?, 'supply_submission', ?, ?)
      `).run(nextRefundId, submission.billing_id, submissionId, amount);
      const correction = db.prepare(`
        INSERT INTO billing_supply_corrections (
          billing_id, submission_id, refund_id, amount, disposition,
          original_movement_ids_json, reversal_movement_ids_json, reason,
          operation_id, corrected_by_user_id, corrected_by_name, corrected_by_role
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        submission.billing_id, submissionId, nextRefundId, amount, disposition,
        JSON.stringify([...new Set([...movementIds, ...dispensingMovementIds])]),
        JSON.stringify(reversal.reversalIds || []), reason, String(req.body?.operation_id || ""),
        req.auth.id || null, String(req.auth.full_name || req.auth.username || ""), String(req.auth.role || ""),
      );
      db.prepare(`
        UPDATE billing_lite_submissions
        SET workflow_status = 'corrected', workflow_note = ?, reversed_at = CURRENT_TIMESTAMP,
            reversed_by_user_id = ?, reversal_reason = ?, reversal_operation_id = ?,
            workflow_updated_by_user_id = ?, workflow_updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND reversed_at IS NULL
      `).run(reason, req.auth.id || null, reason, String(req.body?.operation_id || ""), req.auth.id || null, submissionId);
      recordQuickBillingEvent({
        submissionId,
        consultationId: submission.consultation_id,
        billingId: submission.billing_id,
        actor: req.auth,
        eventType: "paid_supply_corrected",
        previousStatus: submission.workflow_status,
        nextStatus: "corrected",
        reason,
        details: {
          correction_id: Number(correction.lastInsertRowid), credit_note_id: nextRefundId,
          disposition, original_movement_ids: submissionMovementIds,
          reversal_movement_ids: reversal.reversalIds || [],
        },
      });
      result = {
        correction_id: Number(correction.lastInsertRowid),
        credit_note: db.prepare(`
          SELECT refund.*, allocation.allocation_type, allocation.submission_id
          FROM billing_refunds refund
          JOIN billing_refund_allocations allocation ON allocation.refund_id = refund.id
          WHERE refund.id = ?
        `).get(nextRefundId),
        disposition,
        stock_restored: disposition === "returned_to_stock"
          && reversal.reversalIds.length === submissionMovementIds.length,
        bill: getJoinedBillById(submission.billing_id),
      };
      operation.save(result);
    }).immediate();
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }
  for (const itemId of touchedItemIds) publishInventoryChange({ itemId, changedByUserId: req.auth.id });
  publishPatientDataChange(submission.patient_id, { reason: "billing" });
  return res.status(201).json(result);
});

router.post("/:id/refunds", (req, res) => {
  if (!["admin", "accountant"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "Only administrators and accountants can issue credit notes." });
  }
  const billId = Number(req.params.id || 0);
  const amount = Number(req.body?.amount);
  const refundMethod = normalizePaymentMethod(req.body?.refund_method);
  const refundDate = String(req.body?.refund_date || "").trim();
  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  const externalReference = normalizeSourceReference(req.body?.external_reference);
  if (!Number.isInteger(billId) || billId <= 0) {
    return res.status(400).json({ error: "Select a valid paid invoice." });
  }
  if (!isValidCurrencyAmount(req.body?.amount) || amount <= 0) {
    return res.status(400).json({ error: "Enter a positive refund amount using no more than two decimal places." });
  }
  if (!PAYMENT_METHODS.has(refundMethod)) {
    return res.status(400).json({ error: "Select the method used to return the money." });
  }
  if (!validPaymentDate(refundDate)) {
    return res.status(400).json({ error: "Enter a valid refund date (YYYY-MM-DD)." });
  }
  try { assertNotFutureBusinessDate(refundDate, "Refund"); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) }); }
  if (reason.length < 8) {
    return res.status(400).json({ error: "Document why this refund is being issued." });
  }
  if (externalReference && externalReference.length < 3) {
    return res.status(400).json({ error: "External refund references must contain at least 3 characters." });
  }
  if (refundMethod !== "cash" && externalReference.length < 3) {
    return res.status(400).json({ error: "Enter the provider transaction reference for this non-cash refund." });
  }

  let operation;
  try {
    operation = operationFor(req, `billing:refund:${billId}`);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  let creditNote;
  try {
    db.transaction(() => {
      const replay = operation.read();
      if (replay) {
        creditNote = replay;
        return;
      }
      assertBusinessDateOpen(refundDate);
      const bill = db.prepare(`
        SELECT b.*, c.voided_at AS consultation_voided_at
        FROM billing b
        JOIN consultations c ON c.id = b.consultation_id
        WHERE b.id = ?
      `).get(billId);
      if (!bill) throw Object.assign(new Error("Invoice not found."), { status: 404 });
      if (bill.status !== "paid" || bill.voided_at || bill.consultation_voided_at) {
        throw Object.assign(new Error("Credit notes can only be issued against an active paid invoice."), { status: 409 });
      }
      const alreadyRefunded = roundCurrency(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount
        FROM billing_refunds
        WHERE billing_id = ?
      `).get(billId)?.amount || 0);
      const refundable = roundCurrency(Number(bill.total_amount || 0) - alreadyRefunded);
      if (amount > refundable) {
        throw Object.assign(
          new Error(`Only Rs ${refundable.toFixed(2)} remains refundable on this invoice.`),
          { status: 409, extra: { code: "REFUND_EXCEEDS_BALANCE", refundable_amount: refundable } },
        );
      }
      const parsedBill = parseBillingRow(bill);
      const serviceChargeTotal = roundCurrency((parsedBill.items || []).reduce((sum, item) => {
        if (Number(item.inventory_item_id || 0) > 0 || item.type === "Wastage") return sum;
        return sum + Number(item.amount || 0);
      }, 0));
      const allocatedService = roundCurrency(db.prepare(`
        SELECT
          COALESCE((
            SELECT SUM(allocation.amount)
            FROM billing_refund_allocations allocation
            WHERE allocation.billing_id = ?
              AND allocation.allocation_type = 'service_non_stock'
          ), 0)
          + COALESCE((
            SELECT SUM(refund.amount)
            FROM billing_refunds refund
            WHERE refund.billing_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM billing_refund_allocations allocation
                WHERE allocation.refund_id = refund.id
              )
          ), 0) AS amount
      `).get(billId, billId)?.amount || 0);
      const serviceRefundable = roundCurrency(Math.max(0, serviceChargeTotal - allocatedService));
      if (amount > serviceRefundable + 0.000001) {
        throw Object.assign(
          new Error(`Only Rs ${serviceRefundable.toFixed(2)} remains refundable for consultation and non-stock charges. Use the paid-supply correction workflow for medicines or consumables.`),
          { status: 409, extra: { code: "REFUND_REQUIRES_SUPPLY_CORRECTION", refundable_service_amount: serviceRefundable } },
        );
      }
      if (externalReference) {
        const duplicate = db.prepare(`
          SELECT id, credit_note_number
          FROM billing_refunds
          WHERE lower(trim(external_reference)) = lower(trim(?))
          LIMIT 1
        `).get(externalReference);
        if (duplicate) {
          throw Object.assign(
            new Error(`Refund reference ${externalReference} is already attached to ${duplicate.credit_note_number}.`),
            { status: 409, extra: { code: "DUPLICATE_REFUND_REFERENCE" } },
          );
        }
      }
      const nextId = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM billing_refunds").get().id);
      const creditNoteNumber = `OCS-CN-${String(nextId).padStart(8, "0")}`;
      db.prepare(`
        INSERT INTO billing_refunds (
          id, credit_note_number, billing_id, amount, refund_method, refund_date,
          reason, external_reference, issued_by_user_id, issued_by_name,
          issued_by_role, operation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        nextId,
        creditNoteNumber,
        billId,
        roundCurrency(amount),
        refundMethod,
        refundDate,
        reason,
        externalReference || null,
        req.auth.id || null,
        String(req.auth.full_name || req.auth.username || ""),
        String(req.auth.role || ""),
        String(req.body.operation_id || ""),
      );
      db.prepare(`
        INSERT INTO billing_refund_allocations (
          refund_id, billing_id, allocation_type, submission_id, amount
        ) VALUES (?, ?, 'service_non_stock', NULL, ?)
      `).run(nextId, billId, roundCurrency(amount));
      creditNote = db.prepare("SELECT * FROM billing_refunds WHERE id = ?").get(nextId);
      creditNote = {
        ...creditNote,
        amount: roundCurrency(creditNote.amount),
        allocation_type: "service_non_stock",
        inventory_restored: false,
        accounting_note: "This credit note applies only to consultation or non-stock charges and changes net collections. Medicines and consumables must use the paid-supply correction workflow.",
      };
      operation.save(creditNote);
    }).immediate();
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("idx_billing_refunds_external_reference")) {
      return res.status(409).json({ error: "That external refund reference has already been used.", code: "DUPLICATE_REFUND_REFERENCE" });
    }
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  const bill = getJoinedBillById(billId);
  publishPatientDataChange(bill.patient_id, { reason: "billing" });
  notifyLinkhamBillingIfNeeded(bill.patient_id, req.auth?.id);
  return res.status(201).json({ credit_note: creditNote, bill });
});

router.post("/refunds/:refundId/allocation", (req, res) => {
  if (!["admin", "accountant"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "Only administrators and accountants can reconcile historical credit notes." });
  }
  const refundId = Number(req.params.refundId || 0);
  const allocationType = String(req.body?.allocation_type || "").trim();
  const submissionId = Number(req.body?.submission_id || 0);
  const disposition = String(req.body?.disposition || "").trim();
  const operationId = String(req.body?.operation_id || "").trim();
  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  if (!Number.isInteger(refundId) || refundId <= 0) {
    return res.status(400).json({ error: "Select a valid credit note." });
  }
  if (!["service_non_stock", "supply_submission"].includes(allocationType)) {
    return res.status(400).json({ error: "Classify the credit as a consultation/service refund or a supply refund." });
  }
  if (allocationType === "supply_submission" && (!Number.isInteger(submissionId) || submissionId <= 0)) {
    return res.status(400).json({ error: "Select the supply submission covered by this credit note." });
  }
  if (allocationType === "supply_submission" && !["returned_to_stock", "consumed_or_wasted"].includes(disposition)) {
    return res.status(400).json({ error: "Confirm whether the credited supplies were returned to stock or consumed/wasted." });
  }
  if (allocationType === "supply_submission" && !operationId) {
    return res.status(400).json({ error: "A unique stock-correction reference is required." });
  }
  if (reason.length < 8) {
    return res.status(400).json({ error: "Document how the historical credit note was verified." });
  }

  let allocation;
  let billId;
  let patientId;
  let correction = null;
  let touchedItemIds = [];
  try {
    db.transaction(() => {
      const refund = db.prepare(`
        SELECT refund.*, bill.items, bill.status AS bill_status, bill.voided_at,
          consultation.id AS consultation_id, consultation.patient_id,
          consultation.voided_at AS consultation_voided_at
        FROM billing_refunds refund
        JOIN billing bill ON bill.id = refund.billing_id
        JOIN consultations consultation ON consultation.id = bill.consultation_id
        WHERE refund.id = ?
      `).get(refundId);
      if (!refund) throw Object.assign(new Error("Credit note not found."), { status: 404 });
      billId = Number(refund.billing_id);
      patientId = Number(refund.patient_id);
      if (db.prepare("SELECT id FROM billing_refund_allocations WHERE refund_id = ?").get(refundId)) {
        throw Object.assign(new Error("This credit note has already been classified."), { status: 409, extra: { code: "REFUND_ALREADY_ALLOCATED" } });
      }

      let verifiedSubmissionId = null;
      if (allocationType === "service_non_stock") {
        const items = normalizeBillingItems(refund.items);
        const serviceTotal = roundCurrency(items.reduce((sum, item) => {
          if (Number(item.inventory_item_id || 0) > 0 || item.type === "Wastage") return sum;
          return sum + Number(item.amount || 0);
        }, 0));
        const alreadyAllocated = roundCurrency(db.prepare(`
          SELECT COALESCE(SUM(amount), 0) AS amount
          FROM billing_refund_allocations
          WHERE billing_id = ? AND allocation_type = 'service_non_stock'
        `).get(billId)?.amount || 0);
        if (alreadyAllocated + Number(refund.amount || 0) > serviceTotal + 0.000001) {
          throw Object.assign(
            new Error("This credit exceeds the remaining consultation and service charges. Classify it against the matching supply submission."),
            { status: 409, extra: { code: "REFUND_SERVICE_ALLOCATION_EXCEEDS_CHARGES" } },
          );
        }
      } else {
        const submission = db.prepare(`
          SELECT *
          FROM billing_lite_submissions
          WHERE id = ? AND billing_id = ?
        `).get(submissionId, billId);
        if (!submission) {
          throw Object.assign(new Error("That supply submission does not belong to this invoice."), { status: 409 });
        }
        if (refund.bill_status !== "paid" || refund.voided_at || refund.consultation_voided_at) {
          throw Object.assign(new Error("A supply credit can only be reconciled against an active paid invoice."), { status: 409 });
        }
        if (submission.reversed_at || ["corrected", "reversed", "superseded"].includes(submission.workflow_status)) {
          throw Object.assign(new Error("Select the active supply submission. Reversed or superseded submissions cannot receive a historical credit."), { status: 409, extra: { code: "SUBMISSION_NOT_ACTIVE" } });
        }
        const newerActive = db.prepare(`
          SELECT id FROM billing_lite_submissions
          WHERE billing_id = ? AND id > ? AND reversed_at IS NULL
          ORDER BY id DESC LIMIT 1
        `).get(billId, submissionId);
        if (newerActive) {
          throw Object.assign(new Error("A newer active supply submission exists for this invoice."), { status: 409, extra: { code: "SUBMISSION_NOT_ACTIVE", active_submission_id: Number(newerActive.id) } });
        }
        if (db.prepare("SELECT id FROM billing_supply_corrections WHERE submission_id = ?").get(submissionId)) {
          throw Object.assign(new Error("This supply submission already has a documented stock correction."), { status: 409, extra: { code: "SUPPLY_ALREADY_CORRECTED" } });
        }
        if (Math.abs(Number(refund.amount || 0) - Number(submission.amount_added || 0)) >= 0.005) {
          throw Object.assign(
            new Error("Historical supply reconciliation requires a single active submission whose value exactly matches the credit note."),
            { status: 409, extra: { code: "REFUND_SUPPLY_ALLOCATION_AMOUNT_MISMATCH" } },
          );
        }
        const submittedItems = normalizeBillingItems(submission.items_json);
        const movementIds = submittedItems.flatMap((item) => item.inventory_movement_ids || []).map(Number).filter(Boolean);
        const dispensingMovementIds = submittedItems.flatMap((item) => item.dispensing_movement_ids || []).map(Number).filter(Boolean);
        const originalMovementIds = [...new Set([...movementIds, ...dispensingMovementIds])];
        const billMovementIds = new Set(normalizeBillingItems(refund.items).flatMap((item) => [
          ...(item.inventory_movement_ids || []),
          ...(item.dispensing_movement_ids || []),
        ]).map(Number).filter(Boolean));
        if (!originalMovementIds.length || originalMovementIds.some((id) => !billMovementIds.has(id))) {
          throw Object.assign(new Error("The selected submission no longer matches the active invoice stock lines."), { status: 409, extra: { code: "SUBMISSION_NOT_ACTIVE" } });
        }
        let inventoryResolution;
        if (disposition === "returned_to_stock") {
          inventoryResolution = reverseBillingSubmissionInventory({
            movementIds,
            dispensingMovementIds,
            consultationId: refund.consultation_id,
            billingId: billId,
            actor: req.auth,
            reason,
            restoreDispensing: true,
            reversalScope: "historical_paid_supply_correction",
          });
        } else {
          const reclassified = reclassifyBillingSubmissionInventoryAsWastage({
            movementIds: originalMovementIds,
            consultationId: refund.consultation_id,
            billingId: billId,
            actor: req.auth,
            reason,
          });
          inventoryResolution = { reversalIds: reclassified.movementIds || [], touchedItemIds: reclassified.touchedItemIds || [] };
        }
        touchedItemIds = inventoryResolution.touchedItemIds || [];
        verifiedSubmissionId = Number(submission.id);

        const correctionInsert = db.prepare(`
          INSERT INTO billing_supply_corrections (
            billing_id, submission_id, refund_id, amount, disposition,
            original_movement_ids_json, reversal_movement_ids_json, reason,
            operation_id, corrected_by_user_id, corrected_by_name, corrected_by_role
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          billId, verifiedSubmissionId, refundId, roundCurrency(refund.amount), disposition,
          JSON.stringify(originalMovementIds), JSON.stringify(inventoryResolution.reversalIds || []), reason,
          operationId, req.auth.id || null, String(req.auth.full_name || req.auth.username || ""), String(req.auth.role || ""),
        );
        correction = db.prepare("SELECT * FROM billing_supply_corrections WHERE id = ?").get(correctionInsert.lastInsertRowid);
        db.prepare(`
          UPDATE billing_lite_submissions
          SET workflow_status = 'corrected', workflow_note = ?, reversed_at = CURRENT_TIMESTAMP,
              reversed_by_user_id = ?, reversal_reason = ?, reversal_operation_id = ?,
              workflow_updated_by_user_id = ?, workflow_updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND reversed_at IS NULL
        `).run(reason, req.auth.id || null, reason, operationId, req.auth.id || null, verifiedSubmissionId);
        recordQuickBillingEvent({
          submissionId: verifiedSubmissionId,
          consultationId: refund.consultation_id,
          billingId: billId,
          actor: req.auth,
          eventType: "historical_supply_credit_reconciled",
          previousStatus: submission.workflow_status,
          nextStatus: "corrected",
          reason,
          details: {
            refund_id: refundId,
            correction_id: Number(correctionInsert.lastInsertRowid),
            disposition,
            original_movement_ids: originalMovementIds,
            reversal_movement_ids: inventoryResolution.reversalIds || [],
          },
        });
      }

      const inserted = db.prepare(`
        INSERT INTO billing_refund_allocations (
          refund_id, billing_id, allocation_type, submission_id, amount
        ) VALUES (?, ?, ?, ?, ?)
      `).run(refundId, billId, allocationType, verifiedSubmissionId, roundCurrency(refund.amount));
      allocation = db.prepare("SELECT * FROM billing_refund_allocations WHERE id = ?").get(inserted.lastInsertRowid);
      db.prepare(`
        INSERT INTO billing_events (
          bill_id, actor_id, actor_name, actor_role, event_type, after_json, reason
        ) VALUES (?, ?, ?, ?, 'refund_allocation_reconciled', ?, ?)
      `).run(
        billId,
        req.auth.id || null,
        String(req.auth.full_name || req.auth.username || ""),
        String(req.auth.role || ""),
        JSON.stringify({ refund_id: refundId, allocation_type: allocationType, submission_id: verifiedSubmissionId, disposition: allocationType === "supply_submission" ? disposition : null, amount: roundCurrency(refund.amount) }),
        reason,
      );
    }).immediate();
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  for (const itemId of touchedItemIds) publishInventoryChange({ itemId, changedByUserId: req.auth.id });
  if (patientId) publishPatientDataChange(patientId, { reason: "billing" });
  return res.status(201).json({ allocation, correction, bill: getJoinedBillById(billId) });
});

router.get('/reconciliation', (req,res) => {
  if (req.auth.role === 'operator') {
    return res.status(403).json({error:'Financial reconciliation is restricted to finance and clinical users.'});
  }
  const doctorId = req.auth.role==='doctor' ? Number(req.auth.doctor_id || 0) : Number(req.query.doctorId || 0) || null;
  if (req.auth.role==='doctor' && !doctorId) return res.status(403).json({error:'Doctor account is not linked.'});
  const result=require('../lib/financialReconciliation').financialReconciliation(db,{doctorId,from:req.query.dateFrom,to:req.query.dateTo});
  if (req.auth.role==='doctor') delete result.stock;
  res.json(result);
});

function paymentTotalsForDate(businessDate) {
  const rows = db.prepare(`
    WITH methods(method) AS (VALUES ('cash'), ('juice'), ('card'), ('ib')),
    payments AS (
      SELECT payment.payment_method AS method, SUM(payment.amount) AS amount
      FROM billing_payment_ledger payment
      JOIN billing b ON b.id = payment.billing_id
      JOIN consultations c ON c.id = b.consultation_id
      WHERE b.voided_at IS NULL
        AND c.voided_at IS NULL
        AND payment.transaction_date = ?
      GROUP BY payment.payment_method
    ),
    refunds AS (
      SELECT r.refund_method AS method, SUM(r.amount) AS amount
      FROM billing_refunds r
      WHERE r.refund_date = ?
      GROUP BY r.refund_method
    )
    SELECT methods.method,
      COALESCE(payments.amount, 0) AS collected,
      COALESCE(refunds.amount, 0) AS refunded,
      COALESCE(payments.amount, 0) - COALESCE(refunds.amount, 0) AS expected
    FROM methods
    LEFT JOIN payments ON payments.method = methods.method
    LEFT JOIN refunds ON refunds.method = methods.method
  `).all(businessDate, businessDate);
  return Object.fromEntries(rows.map((row) => [row.method, {
    collected: roundCurrency(row.collected),
    refunded: roundCurrency(row.refunded),
    expected: roundCurrency(row.expected),
  }]));
}

function serializeDayClosing(row) {
  if (!row) return null;
  const settlements = db.prepare(`
    SELECT payment_method, expected_amount, settled_amount, external_reference
    FROM financial_day_close_settlements
    WHERE closing_id = ?
    ORDER BY payment_method
  `).all(row.id).map((entry) => ({
    ...entry,
    expected_amount: roundCurrency(entry.expected_amount),
    settled_amount: roundCurrency(entry.settled_amount),
  }));
  const adjustments = db.prepare(`
    SELECT *
    FROM financial_day_close_adjustments
    WHERE closing_id = ?
    ORDER BY id ASC
  `).all(row.id).map((entry) => ({
    ...entry,
    cash_delta: roundCurrency(entry.cash_delta),
    settlement_deltas: safeJsonParse(entry.settlement_deltas_json, {}),
    settlement_references: safeJsonParse(entry.settlement_references_json, {}),
  }));
  const cashAdjustment = roundCurrency(adjustments.reduce((sum, entry) => sum + Number(entry.cash_delta || 0), 0));
  const settlementAdjustments = Object.fromEntries(['juice', 'card', 'ib'].map((method) => [
    method,
    roundCurrency(adjustments.reduce((sum, entry) => sum + Number(entry.settlement_deltas?.[method] || 0), 0)),
  ]));
  const effectiveSettlementTotals = Object.fromEntries(settlements.map((entry) => [
    entry.payment_method,
    roundCurrency(entry.settled_amount + Number(settlementAdjustments[entry.payment_method] || 0)),
  ]));
  return {
    ...row,
    counted_cash: roundCurrency(row.counted_cash),
    variance_total: roundCurrency(row.variance_total),
    expected_totals: safeJsonParse(row.expected_totals_json, {}),
    settlement_totals: safeJsonParse(row.settlement_totals_json, {}),
    settlement_references: safeJsonParse(row.settlement_references_json, {}),
    settlements,
    adjustments,
    effective_counted_cash: roundCurrency(row.counted_cash + cashAdjustment),
    effective_settlement_totals: effectiveSettlementTotals,
    effective_variance_total: roundCurrency(
      row.variance_total + cashAdjustment + Object.values(settlementAdjustments).reduce((sum, value) => sum + Number(value || 0), 0),
    ),
  };
}

router.get('/day-close/outstanding', (req, res) => {
  if (!['admin', 'accountant'].includes(req.auth?.role)) {
    return res.status(403).json({ error: 'Day-close reminders are restricted to administrators and finance.' });
  }
  const dates = db.prepare(`
    WITH financial_activity(business_date) AS (
      SELECT transaction_date
      FROM billing_payment_ledger
      WHERE transaction_date < date('now', '+4 hours')
      UNION
      SELECT refund_date
      FROM billing_refunds
      WHERE refund_date < date('now', '+4 hours')
    )
    SELECT activity.business_date
    FROM financial_activity activity
    LEFT JOIN financial_day_closings closing
      ON closing.business_date = activity.business_date
    WHERE closing.id IS NULL
    ORDER BY activity.business_date ASC
    LIMIT 3660
  `).all();
  const outstanding = dates.map(({ business_date: businessDate }) => {
    const totals = paymentTotalsForDate(businessDate);
    return {
      business_date: businessDate,
      expected_total: roundCurrency(Object.values(totals).reduce(
        (sum, entry) => sum + Number(entry.expected || 0),
        0,
      )),
      expected_totals: totals,
    };
  });
  return res.json({ count: outstanding.length, dates: outstanding });
});

router.get('/day-close', (req, res) => {
  if (!['admin', 'accountant'].includes(req.auth?.role)) {
    return res.status(403).json({ error: 'Day closing is restricted to administrators and finance.' });
  }
  const businessDate = String(req.query.date || getTodayLocal()).trim();
  if (!validPaymentDate(businessDate)) {
    return res.status(400).json({ error: 'Enter a valid business date (YYYY-MM-DD).' });
  }
  try { assertNotFutureBusinessDate(businessDate, "Day close"); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) }); }
  const closing = serializeDayClosing(
    db.prepare('SELECT * FROM financial_day_closings WHERE business_date = ?').get(businessDate),
  );
  return res.json({ business_date: businessDate, expected_totals: paymentTotalsForDate(businessDate), closing });
});

router.post('/day-close', (req, res) => {
  if (!['admin', 'accountant'].includes(req.auth?.role)) {
    return res.status(403).json({ error: 'Day closing is restricted to administrators and finance.' });
  }
  const businessDate = String(req.body?.business_date || '').trim();
  if (!validPaymentDate(businessDate)) {
    return res.status(400).json({ error: 'Enter a valid business date (YYYY-MM-DD).' });
  }
  try { assertNotFutureBusinessDate(businessDate, "Day close"); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) }); }
  if (!isValidCurrencyAmount(req.body?.counted_cash)) {
    return res.status(400).json({ error: 'Enter the non-negative cash amount physically counted.' });
  }
  const countedCash = roundCurrency(req.body.counted_cash);
  const requestedSettlements = req.body?.settlements && typeof req.body.settlements === 'object'
    ? req.body.settlements
    : {};
  const expectedTotals = paymentTotalsForDate(businessDate);
  const settlements = [];
  for (const method of ['juice', 'card', 'ib']) {
    const requested = requestedSettlements[method] || {};
    if (!isValidSignedCurrencyAmount(requested.amount)) {
      return res.status(400).json({ error: `Enter the settled ${method.toUpperCase()} amount using no more than two decimal places.` });
    }
    const settledAmount = roundCurrency(requested.amount);
    const externalReference = normalizeSourceReference(requested.reference);
    if ((Math.abs(Number(expectedTotals[method]?.expected || 0)) >= 0.005 || Math.abs(settledAmount) >= 0.005) && externalReference.length < 3) {
      return res.status(400).json({ error: `Enter the ${method.toUpperCase()} settlement or deposit reference.` });
    }
    settlements.push({
      payment_method: method,
      expected_amount: roundCurrency(expectedTotals[method]?.expected || 0),
      settled_amount: settledAmount,
      external_reference: externalReference,
    });
  }
  const cashVariance = roundCurrency(countedCash - Number(expectedTotals.cash?.expected || 0));
  const settlementVariance = roundCurrency(settlements.reduce(
    (sum, entry) => sum + entry.settled_amount - entry.expected_amount,
    0,
  ));
  const varianceTotal = roundCurrency(cashVariance + settlementVariance);
  const notes = String(req.body?.notes || '').trim().slice(0, 1000);
  if (Math.abs(varianceTotal) >= 0.005 && notes.length < 8) {
    return res.status(400).json({ error: 'Explain the day-close variance before confirming.' });
  }

  let operation;
  try {
    operation = operationFor(req, `billing:day-close:${businessDate}`);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  let result;
  try {
    db.transaction(() => {
      const replay = operation.read();
      if (replay) {
        result = replay;
        return;
      }
      if (db.prepare('SELECT 1 FROM financial_day_closings WHERE business_date = ?').get(businessDate)) {
        throw Object.assign(new Error('This business date has already been closed.'), { status: 409 });
      }
      const settlementTotals = Object.fromEntries(settlements.map((entry) => [entry.payment_method, entry.settled_amount]));
      const settlementReferences = Object.fromEntries(settlements.map((entry) => [entry.payment_method, entry.external_reference]));
      const inserted = db.prepare(`
        INSERT INTO financial_day_closings (
          business_date, expected_totals_json, counted_cash, settlement_totals_json,
          settlement_references_json, variance_total, notes, operation_id,
          closed_by_user_id, closed_by_name, closed_by_role
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        businessDate,
        JSON.stringify(expectedTotals),
        countedCash,
        JSON.stringify(settlementTotals),
        JSON.stringify(settlementReferences),
        varianceTotal,
        notes,
        String(req.body.operation_id || ''),
        req.auth.id || null,
        String(req.auth.full_name || req.auth.username || ''),
        String(req.auth.role || ''),
      );
      for (const settlement of settlements) {
        db.prepare(`
          INSERT INTO financial_day_close_settlements (
            closing_id, payment_method, expected_amount, settled_amount, external_reference
          ) VALUES (?, ?, ?, ?, ?)
        `).run(
          Number(inserted.lastInsertRowid),
          settlement.payment_method,
          settlement.expected_amount,
          settlement.settled_amount,
          settlement.external_reference || null,
        );
      }
      result = serializeDayClosing(
        db.prepare('SELECT * FROM financial_day_closings WHERE id = ?').get(Number(inserted.lastInsertRowid)),
      );
      operation.save(result);
    }).immediate();
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('idx_day_close_settlement_reference') ||
        message.includes('financial_day_close_settlements.payment_method, financial_day_close_settlements.external_reference')) {
      return res.status(409).json({ error: 'That settlement reference has already been used for this payment method.' });
    }
    return res.status(error.status || 400).json({ error: error.message });
  }
  return res.status(201).json(result);
});

router.post('/day-close/:id/adjustments', (req, res) => {
  if (!['admin', 'accountant'].includes(req.auth?.role)) {
    return res.status(403).json({ error: 'Day-close corrections are restricted to administrators and finance.' });
  }
  const closingId = Number(req.params.id || 0);
  const closing = db.prepare('SELECT * FROM financial_day_closings WHERE id = ?').get(closingId);
  if (!closing) return res.status(404).json({ error: 'Day closing not found.' });
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (reason.length < 8) return res.status(400).json({ error: 'Document why this day-close correction is required.' });
  if (!isValidSignedCurrencyAmount(req.body?.cash_delta ?? 0)) {
    return res.status(400).json({ error: 'Enter a valid signed cash correction using no more than two decimal places.' });
  }
  const cashDelta = roundCurrency(req.body?.cash_delta || 0);
  const requestedDeltas = req.body?.settlement_deltas && typeof req.body.settlement_deltas === 'object'
    ? req.body.settlement_deltas
    : {};
  const requestedReferences = req.body?.settlement_references && typeof req.body.settlement_references === 'object'
    ? req.body.settlement_references
    : {};
  const settlementDeltas = {};
  const settlementReferences = {};
  for (const method of ['juice', 'card', 'ib']) {
    if (!isValidSignedCurrencyAmount(requestedDeltas[method] ?? 0)) {
      return res.status(400).json({ error: `Enter a valid signed ${method.toUpperCase()} correction.` });
    }
    settlementDeltas[method] = roundCurrency(requestedDeltas[method] || 0);
    settlementReferences[method] = normalizeSourceReference(requestedReferences[method]);
    if (Math.abs(settlementDeltas[method]) >= 0.005 && settlementReferences[method].length < 3) {
      return res.status(400).json({ error: `Enter the corrected ${method.toUpperCase()} settlement reference.` });
    }
  }
  const totalDelta = roundCurrency(cashDelta + Object.values(settlementDeltas).reduce((sum, value) => sum + value, 0));
  if (Math.abs(totalDelta) < 0.005 && Math.abs(cashDelta) < 0.005 &&
      Object.values(settlementDeltas).every((value) => Math.abs(value) < 0.005)) {
    return res.status(400).json({ error: 'Enter at least one non-zero correction.' });
  }
  let operation;
  try { operation = operationFor(req, `billing:day-close-adjustment:${closingId}`); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  let result;
  try {
    db.transaction(() => {
      const replay = operation.read();
      if (replay) { result = replay; return; }
      const inserted = db.prepare(`
        INSERT INTO financial_day_close_adjustments (
          closing_id, cash_delta, settlement_deltas_json, settlement_references_json,
          reason, operation_id, adjusted_by_user_id, adjusted_by_name, adjusted_by_role
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        closingId,
        cashDelta,
        JSON.stringify(settlementDeltas),
        JSON.stringify(settlementReferences),
        reason,
        String(req.body.operation_id || ''),
        req.auth.id || null,
        String(req.auth.full_name || req.auth.username || ''),
        String(req.auth.role || ''),
      );
      for (const method of ['juice', 'card', 'ib']) {
        const reference = settlementReferences[method];
        if (!reference) continue;
        db.prepare(`
          INSERT INTO financial_day_close_adjustment_references (
            adjustment_id, payment_method, external_reference
          ) VALUES (?, ?, ?)
        `).run(Number(inserted.lastInsertRowid), method, reference);
      }
      result = serializeDayClosing(closing);
      operation.save(result);
    }).immediate();
  } catch (error) {
    if (String(error?.message || '').includes('idx_day_close_adjustment_reference') ||
        String(error?.message || '').includes('financial_day_close_adjustment_references.payment_method')) {
      return res.status(409).json({ error: 'That corrected settlement reference has already been used for this payment method.' });
    }
    return res.status(error.status || 400).json({ error: error.message });
  }
  return res.status(201).json(result);
});

// Void a duplicate unpaid service bill without voiding the clinical visit or restoring stock.
router.post('/:id/void', (req,res) => {
  if (req.auth.role!=='admin') return res.status(403).json({error:'Only an admin can void a duplicate bill.'});
  const bill=getJoinedBillById(Number(req.params.id));
  if (!bill) return res.status(404).json({error:'Bill not found.'});
  const reason=String(req.body.reason || '').trim();
  if (reason.length<8) return res.status(400).json({error:'Enter a meaningful reason for voiding this bill.'});
  if (bill.voided_at) return res.json(bill);
  if (bill.status!=='unpaid' || bill.items.some(i=>i.inventory_item_id)) return res.status(409).json({error:'Only unpaid service-only bills can be voided here. Review payments or stock-linked lines separately.'});
  if (Number(req.body.expected_version)!==Number(bill.row_version)) return res.status(409).json({error:'This bill changed. Reopen its details.'});
  const result=db.prepare("UPDATE billing SET voided_at=CURRENT_TIMESTAMP,voided_by_user_id=?,void_reason=?,updated_by_user_id=? WHERE id=? AND row_version=? AND voided_at IS NULL").run(req.auth.id,reason,req.auth.id,bill.id,bill.row_version);
  if (result.changes!==1) return res.status(409).json({error:'This bill changed. Reopen its details.'});
  publishPatientDataChange(bill.patient_id,{reason:'billing'});
  res.json(getJoinedBillById(bill.id));
});

router.get('/visit/:consultationId', (req,res) => {
  const consultation = getConsultationContext(Number(req.params.consultationId));
  if (!consultation || consultation.voided_at) return res.status(404).json({error:'Visit not found.'});
  if (req.auth.role==='doctor' && Number(req.auth.doctor_id || 0)!==Number(consultation.doctor_id)) return res.status(403).json({error:'You can only bill your own visits.'});
  const bills = db.prepare('SELECT id FROM billing WHERE consultation_id=? AND voided_at IS NULL ORDER BY id').all(consultation.id).map(b=>getJoinedBillById(b.id));
  const pending = pendingSales({patientId:consultation.patient_id,doctorId:consultation.doctor_id})
    .filter(m => {
      const meta = JSON.parse(m.meta_json || '{}');
      return (!meta.consultation_id && !meta.appointment_id) || matchesVisit(m, consultation);
    })
    .map(m=>({id:m.id,item_id:m.item_id,item_name:m.item_name,quantity:m.quantity,unit_price:m.unit_price_snapshot,created_at:m.created_at,valuation_basis:m.valuation_basis,matches_visit:matchesVisit(m,consultation)}));
  res.json({bills,pending_sales:pending});
});

router.get("/:id", (req, res) => {
  const billId = Number(req.params.id);
  const bill = getJoinedBillById(billId);
  const accessError = ensureBillAccess(req, bill);

  if (accessError) {
    return res.status(accessError.status).json({ error: accessError.error });
  }

  res.json(bill);
});

router.get("/inventory-options/by-consultation/:consultationId", (req, res) => {
  try {
    const consultationId = Number(req.params.consultationId || 0);
    const consultation = getConsultationContext(consultationId);
    if (!consultation) {
      return res.status(404).json({ error: "Consultation not found." });
    }
    if (
      req.auth?.role === "doctor" &&
      (!req.auth.doctor_id || Number(consultation.doctor_id) !== Number(req.auth.doctor_id))
    ) {
      return res.status(403).json({
        error: "You can only access inventory linked to your own consultations.",
      });
    }

    const rows = db
      .prepare(`
        SELECT
          i.id,
          i.item_name,
          i.quantity,
          i.minimum_quantity,
          i.selling_price,
          i.cost_price,
          COALESCE(f.name, '') AS folder_name
        FROM inventory i
        LEFT JOIN inventory_folders f ON f.id = i.folder_id
        WHERE i.stock_scope = 'doctor'
          AND i.owner_doctor_id = ?
          AND i.archived_at IS NULL
        ORDER BY i.item_name ASC
      `)
      .all(Number(consultation.doctor_id));
  const decorated = decorateInventoryItems(rows).map((row) => {
    const batches = listAllocatableBatches(row.id).map((batch) => ({
      id: Number(batch.id),
      available: Number(batch.available || 0),
      expiry_date: batch.expiry_date || null,
      is_non_expiring: Boolean(batch.is_non_expiring),
      missing_expiry: Boolean(batch.missing_expiry),
    }));
    return {
      ...row,
      batches,
      quantity: Number(row.on_hand_quantity ?? row.quantity ?? 0),
      available_to_promise: Number(row.available_to_promise ?? row.available_to_use ?? 0),
      expired_quantity: Number(row.expired_quantity || 0),
      quarantined_quantity: Number(row.quarantined_quantity || 0),
      minimum_quantity: Number(row.minimum_quantity || 0),
      selling_price: roundCurrency(row.selling_price),
      cost_price: roundCurrency(row.cost_price),
    };
  });

    res.json(decorated);
  } catch (error) {
    console.error("[billing][GET /inventory-options]", error);
    return res.status(500).json({
      error: error?.message || "Failed to load inventory suggestions.",
    });
  }
});

function createBillingFixtureForTests(req, res) {
  try {
  if (req.auth?.role === "accountant") {
    return res.status(403).json({ error: "Accountants can reconcile payments and issue credit notes, but invoices must be issued by a doctor, operator, or administrator." });
  }
  const consultationId = Number(req.body.consultation_id);
  const patientId = Number(req.body.patient_id);
  const consultation = getConsultationContext(consultationId);

  if (!consultation) {
    return res.status(400).json({ error: "Select a valid consultation." });
  }
  if (consultation.voided_at) {
    return res.status(409).json({ error: "This consultation has been voided and cannot be billed." });
  }

  if (!Number.isInteger(patientId) || patientId <= 0) {
    return res.status(400).json({ error: "Select a valid patient." });
  }

  if (Number(consultation.patient_id) !== patientId) {
    return res.status(400).json({
      error: "The selected consultation does not belong to the selected patient.",
    });
  }

  try {
    assertBillingActorConsultationAccess(req.auth, consultation, req.body.doctor_id);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.message, ...(error.extra || {}) });
  }

  const itemValidationError = billingItemsValidationError(req.body.items);
  if (itemValidationError) return res.status(400).json({ error: itemValidationError });
  const items = normalizeBillingItems(req.body.items);
  try {
    assertNoManualInventoryBypass(consultation, items);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  const status = String(req.body.status ?? "unpaid")
    .trim()
    .toLowerCase();
  if (!["paid", "unpaid"].includes(status)) {
    return res.status(400).json({ error: "Billing status is invalid." });
  }

  const sourceReference = normalizeSourceReference(req.body.source_reference);
  if (sourceReference && sourceReference.length < 3) {
    return res.status(400).json({ error: "Enter a source reference with at least 3 characters." });
  }

  if (req.auth.role === "operator") {
    if (sourceReference.length < 3) {
      return res.status(400).json({
        error: "Enter the OCS paper invoice number or photo reference before issuing this invoice.",
      });
    }
    const operatorIssueError = validateOperatorInvoice(items, status);
    if (operatorIssueError) {
      return res.status(403).json({ error: operatorIssueError });
    }
  }

  const paymentMethod =
    status === "paid" ? normalizePaymentMethod(req.body.payment_method) : null;

  if (status === "paid" && !PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({
      error: "Select a valid payment method: cash, juice, card, or IB.",
    });
  }

  const paymentDate =
    status === "paid"
      ? String(req.body.payment_date ?? getTodayLocal()).trim() || getTodayLocal()
      : null;

  if (status === "paid" && !validPaymentDate(paymentDate)) {
    return res.status(400).json({ error: "Enter a valid payment date (YYYY-MM-DD)." });
  }
  const operation = operationFor(req, "billing:create", { legacyWindow: true });
  let createdId = null;
  let touchedItemIds = [];
  try {
    db.transaction(() => {
      const current = getConsultationContext(consultationId);
      if (!current || current.voided_at) throw Object.assign(new Error("This consultation is no longer available for billing."), {status:409});
      assertBillingActorConsultationAccess(req.auth, current, req.body.doctor_id);
      const replay = operation.read();
      if (replay) { createdId = replay.billId; return; }
      if (status === "paid") assertBusinessDateOpen(paymentDate);
      if (sourceReference) {
        const duplicate = db.prepare(`
          SELECT id, invoice_number
          FROM billing
          WHERE lower(trim(source_reference)) = lower(trim(?))
          LIMIT 1
        `).get(sourceReference);
        if (duplicate) {
          throw Object.assign(
            new Error(`Source reference ${sourceReference} is already attached to ${duplicate.invoice_number || `bill #${duplicate.id}`}.`),
            { status: 409, extra: { code: "DUPLICATE_SOURCE_REFERENCE", bill_id: duplicate.id } },
          );
        }
      }
      assertSingleVisitFee(db, consultationId, items);
      // Insert a placeholder bill first so the linkage helper has a billing
      // id to stamp onto any matched Sale movements. Items + total are
      // computed inside the same transaction below so callers never observe
      // the empty row.
      const snapshot = getBillingIssueSnapshot(current, items, req.auth);
      const inserted = db.prepare(`
        INSERT INTO billing (
          consultation_id,
          patient_id,
          items,
          total_amount,
          status,
          payment_method,
          payment_date,
          updated_by_user_id,
          change_reason,
          source_reference,
          issued_at,
          finalized_at,
          finalized_by_user_id,
          finalized_by_name,
          finalized_by_role,
          issued_by_user_id,
          issued_by_name,
          issued_by_role,
          patient_identifier_snapshot,
          patient_name_snapshot,
          doctor_id_snapshot,
          doctor_name_snapshot,
          consultation_date_snapshot,
          consultation_type_snapshot,
          partner_category_snapshot
        )
        VALUES (?, ?, '[]', 0, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        consultationId,
        patientId,
        "unpaid",
        null,
        null,
        req.auth.id,
        req.auth.role === "operator"
          ? `Paper invoice: ${sourceReference}`
          : "",
        sourceReference || null,
        snapshot.issuedByUserId,
        snapshot.issuedByName,
        snapshot.issuedByRole,
        snapshot.issuedByUserId,
        snapshot.issuedByName,
        snapshot.issuedByRole,
        snapshot.patientIdentifier,
        snapshot.patientName,
        snapshot.doctorId,
        snapshot.doctorName,
        snapshot.consultationDate,
        snapshot.consultationType,
        snapshot.partnerCategory,
      );
      createdId = Number(inserted.lastInsertRowid);

      const { items: computedItems, touchedItemIds: itemIds } = applyInventoryTransactions({
        consultation,
        items,
        userId: req.auth?.id || null,
        actor: req.auth || {},
        billingId: createdId,
      });
      touchedItemIds = itemIds;

      if (status === "paid") assertVisitReadyForPayment(db, consultationId, createdId);
      db.prepare(`
        UPDATE billing
        SET items = ?, total_amount = ?, status = ?, payment_method = ?, payment_date = ?
        WHERE id = ?
      `).run(
        JSON.stringify(computedItems),
        calculateBillingTotal(computedItems),
        "unpaid",
        null,
        null,
        createdId,
      );
      if (status === "paid") {
        const createdBill = db.prepare("SELECT * FROM billing WHERE id = ?").get(createdId);
        recordPaymentTransaction({
          bill: createdBill,
          amount: createdBill.total_amount,
          paymentMethod,
          paymentDate,
          externalReference: req.body.payment_reference,
          operationId: String(req.body.payment_operation_id || `${req.body.operation_id || `bill-${createdId}`}:payment`),
          actor: req.auth,
        });
        syncBillingPaymentSummary(createdId, req.auth);
      }
      operation.save({ billId: createdId });
    }).immediate();
  } catch (error) {
    if (String(error?.message || "").includes("idx_billing_source_reference_unique")) {
      return res.status(409).json({
        error: "That paper invoice or source reference has already been used.",
        code: "DUPLICATE_SOURCE_REFERENCE",
      });
    }
    const status = Number(error?.status || 400);
    return res.status(status).json({
      error: error?.message || "Failed to create billing entry.",
      ...(error?.extra || {}),
    });
  }

  // Fan stock-level changes out to every other connected tab/device so the
  // doctor's bag and OCS views stay in sync after a billing run.
  for (const itemId of touchedItemIds) {
    try {
      publishInventoryChange({ itemId, changedByUserId: req.auth?.id || null });
    } catch (publishError) {
      console.warn("[billing] publishInventoryChange failed:", publishError?.message || publishError);
    }
  }

  publishPatientDataChange(patientId, { reason: "billing" });
  notifyLinkhamBillingIfNeeded(patientId, req.auth?.id);

  res.status(201).json(getJoinedBillById(createdId));
  } catch (error) {
    console.error("[billing][test fixture create]", error);
    return res.status(error.status || 500).json({
      error: error?.message || "Failed to create billing entry.",
    });
  }
}

// Routine invoice creation is deliberately restricted to the audited quick
// workflow. Keep the former handler available only to integration tests that
// exercise historical accounting migrations and corrections; it is never
// registered in a deployed runtime.
if (process.env.NODE_ENV === "test") {
  router.post("/test-support/create", createBillingFixtureForTests);
}

router.post("/", (_req, res) => {
  return res.status(410).json({
    error: "This invoice-creation route has been retired. Use the visit-based quick billing workflow.",
    code: "LEGACY_BILLING_CREATE_RETIRED",
  });
});

router.put("/:id", (req, res) => {
  const billId = Number(req.params.id);
  const existing = getJoinedBillById(billId);
  const accessError = ensureBillAccess(req, existing, { write: true });

  if (accessError) {
    return res.status(accessError.status).json({ error: accessError.error });
  }
  if (req.auth?.role === "accountant") {
    return res.status(403).json({ error: "Accountants can record payments and issue credit notes, but cannot change invoice lines or consultation fees." });
  }

  const itemValidationError = billingItemsValidationError(req.body.items);
  if (itemValidationError) return res.status(400).json({ error: itemValidationError });
  const items = normalizeBillingItems(req.body.items);
  const correctionReason = String(req.body.correction_reason || "").trim();
  const feePolicyError = validateConsultationFeePolicy(items, {
    existingItems: existing.items,
    reason: correctionReason,
  });
  if (feePolicyError) {
    return res.status(400).json({ error: feePolicyError, code: "CONSULTATION_FEE_POLICY" });
  }
  if (req.auth.role === "operator") {
    const requestedStatus = String(req.body.status ?? existing.status).trim().toLowerCase();
    if (requestedStatus !== existing.status) {
      return res.status(403).json({ error: "Use the confirmed payment action to record payment." });
    }
    const operatorEditError = validateOperatorInvoice(items, existing.status);
    if (operatorEditError) {
      return res.status(403).json({ error: operatorEditError });
    }
    if (String(req.body.correction_reason || "").trim().length < 8) {
      return res.status(400).json({ error: "Document the paper invoice reference or reason for this correction." });
    }
  }
  if (inventorySignature(items) !== inventorySignature(existing.items)) {
    return res.status(400).json({
      error:
        "Inventory-linked lines must remain unchanged. Use an explicit stock reversal or a separate adjustment bill.",
    });
  }

  try { assertSingleVisitFee(db, existing.consultation_id, items, billId); }
  catch (error) { return res.status(error.status || 409).json({error:error.message,...error.extra}); }
  if (existing.fee_review_required && req.body.confirm_consultation_fee !== true && String(req.body.status || existing.status) === 'paid') return res.status(409).json({error:'Review and confirm the consultation fee before recording payment.'});
  if (existing.fee_review_required && req.body.confirm_consultation_fee === true && !items.some(isConsultationFee)) return res.status(400).json({error:'Select the consultation charge before confirming the fee.'});
  const expectedVersion = req.body.expected_version;
  if (expectedVersion != null && Number(expectedVersion) !== Number(existing.row_version)) {
    return res.status(409).json({ error: "This bill changed elsewhere. Reopen it before saving." });
  }
  if (existing.legacy_fee_review_required && req.body.confirm_consultation_fee === true && (req.auth.role !== 'admin' || correctionReason.length < 8)) {
    return res.status(403).json({error:'An admin must verify this historical fee against the source record and document the reason before confirming it.'});
  }
  if (existing.status === "paid" && (req.auth.role !== "admin" || correctionReason.length < 8)) {
    return res.status(409).json({ error: "Paid bills require an admin correction with a meaningful reason." });
  }
  const requestedStatus = String(req.body.status ?? existing.status).trim().toLowerCase();
  if (Number(existing.payment_received_amount || 0) > 0 &&
      JSON.stringify(normalizeBillingItems(items)) !== JSON.stringify(normalizeBillingItems(existing.items))) {
    return res.status(409).json({ error: "Invoice lines are locked after the first payment transaction. Use a credit note or adjustment invoice." });
  }
  if (Number(existing.payment_received_amount || 0) > 0 && (
    (req.body.payment_method != null && normalizePaymentMethod(req.body.payment_method) !== existing.last_payment_method) ||
    (req.body.payment_date != null && String(req.body.payment_date || "").trim() !== existing.last_payment_date)
  )) {
    return res.status(409).json({ error: "Payment transactions are immutable. Add a compensating financial transaction instead of rewriting the method or date." });
  }
  if (requestedStatus !== existing.status) {
    return res.status(409).json({ error: "Use Record payment to add an immutable payment transaction." });
  }
  if (existing.status === "paid") {
    if (requestedStatus !== "paid") {
      return res.status(409).json({ error: "A paid invoice cannot be changed back to unpaid. Issue a credit note for money returned." });
    }
    if (JSON.stringify(normalizeBillingItems(items)) !== JSON.stringify(normalizeBillingItems(existing.items))) {
      return res.status(409).json({ error: "Paid invoice lines are immutable. Use a credit note and a separate adjustment invoice." });
    }
  }
  try {
    assertNoManualInventoryBypass(existing, items);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }
  const preservedItems = items.filter(i => !i.inventory_item_id).concat(existing.items.filter(i => i.inventory_item_id));
  const status = requestedStatus;
  if (!["paid", "unpaid"].includes(status)) {
    return res.status(400).json({ error: "Billing status is invalid." });
  }

  const paymentMethod =
    status === "paid"
      ? normalizePaymentMethod(req.body.payment_method ?? existing.payment_method)
      : null;

  if (status === "paid" && !PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({
      error: "Select a valid payment method: cash, juice, card, or IB.",
    });
  }

  const paymentDate =
    status === "paid"
      ? String(req.body.payment_date ?? existing.payment_date ?? getTodayLocal()).trim()
      : null;

  if (status === "paid" && !validPaymentDate(paymentDate)) {
    return res.status(400).json({ error: "Enter a valid payment date (YYYY-MM-DD)." });
  }
  let updated;
  try {
    updated = db.transaction(() => {
      if (status === 'paid') assertBusinessDateOpen(paymentDate);
      assertSingleVisitFee(db, existing.consultation_id, preservedItems, billId);
      const result = db.prepare(`
    UPDATE billing
    SET
      items = ?,
      total_amount = ?,
      consultation_type_snapshot = ?,
      status = ?,
      payment_method = ?,
      payment_date = ?,
      updated_at = CURRENT_TIMESTAMP,
      updated_by_user_id = ?,
      change_reason = ?,
      fee_review_required = ?,
      legacy_fee_review_required = ?
    WHERE id = ? AND row_version = ? AND voided_at IS NULL
  `).run(
    JSON.stringify(preservedItems),
    calculateBillingTotal(preservedItems),
    consultationTypeFromItems(preservedItems),
    status,
    paymentMethod,
    paymentDate || null,
    req.auth?.id || null,
    correctionReason || (existing.fee_review_required && req.body.confirm_consultation_fee ? "Consultation fee reviewed" : ""),
    req.body.confirm_consultation_fee === true ? 0 : existing.fee_review_required,
    req.body.confirm_consultation_fee === true ? 0 : existing.legacy_fee_review_required,
    billId,
    existing.row_version,
      );
      if (status === 'paid') assertVisitReadyForPayment(db, existing.consultation_id, billId);
      return result;
    }).immediate();
  } catch (error) { return res.status(error.status || 400).json({error:error.message,...error.extra}); }
  if (updated.changes !== 1) return res.status(409).json({ error: "This bill changed elsewhere. Reopen it before saving." });

  if (existing?.patient_id) {
    publishPatientDataChange(existing.patient_id, { reason: "billing" });
    notifyLinkhamBillingIfNeeded(existing.patient_id, req.auth?.id);
  }

  res.json(getJoinedBillById(billId));
});

router.patch("/:id/pay", (req, res) => {
  const billId = Number(req.params.id);
  const existing = getJoinedBillById(billId);
  const accessError = ensureBillAccess(req, existing, { write: true });

  if (accessError) {
    return res.status(accessError.status).json({ error: accessError.error });
  }

  const requestedOperationId = String(req.body.operation_id || "").trim();
  try { assertBillFinalized(existing); }
  catch (error) { return res.status(error.status || 409).json({ error: error.message, ...(error.extra || {}) }); }
  if (existing.fee_review_required) return res.status(409).json({error:'Open bill details to confirm Day, Night or Review Consultation before recording payment.', code:'FEE_REVIEW_REQUIRED'});
  const paymentMethod = normalizePaymentMethod(req.body.payment_method);

  if (!PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({
      error: "Select a valid payment method: cash, juice, card, or IB.",
    });
  }

  const paymentDate = String(req.body.payment_date || "").trim();
  if (!validPaymentDate(paymentDate)) {
    return res.status(400).json({ error: "Enter a valid payment date (YYYY-MM-DD)." });
  }
  const replay = requestedOperationId
    ? db.prepare("SELECT * FROM billing_payment_transactions WHERE operation_id = ?").get(requestedOperationId)
    : null;
  const requestedAmount = req.body.amount == null || req.body.amount === ""
    ? replay ? Number(replay.amount) : existing.payment_balance_amount
    : Number(req.body.amount);
  const requestedReference = normalizeSourceReference(req.body.external_reference);
  if (replay) {
    const same = Number(replay.billing_id) === billId
      && roundCurrency(replay.amount) === roundCurrency(requestedAmount)
      && replay.payment_method === paymentMethod
      && replay.payment_date === paymentDate
      && String(replay.external_reference || "") === requestedReference;
    if (!same) {
      return res.status(409).json({
        error: Number(replay.billing_id) !== billId
          ? "That payment operation reference belongs to another invoice."
          : "That payment operation reference was already used for different payment details.",
        code: "PAYMENT_OPERATION_MISMATCH",
      });
    }
    return res.json(getJoinedBillById(billId));
  }
  if (existing.payment_state === "paid" || existing.status === "paid") {
    if (!requestedOperationId && existing.payments?.length === 1 &&
        existing.payments[0].payment_method === paymentMethod &&
        existing.payments[0].payment_date === paymentDate) {
      return res.json(existing);
    }
    return res.status(409).json({ error: "This invoice is already paid in full." });
  }
  if (Number(req.body.expected_version) !== Number(existing.row_version)) {
    return res.status(409).json({ error: "This bill changed elsewhere. Refresh before recording payment." });
  }

  const amount = requestedAmount;
  const operationId = String(req.body.operation_id ||
    `legacy-payment-${req.auth?.id || 0}-${billId}-${existing.row_version}-${amount}`).trim();
  let summary;
  try {
    db.transaction(() => {
      assertVisitReadyForPayment(db, existing.consultation_id, billId);
      const current = db.prepare("SELECT * FROM billing WHERE id = ? AND row_version = ? AND voided_at IS NULL").get(billId, existing.row_version);
      if (!current) throw Object.assign(new Error("This bill changed elsewhere. Refresh before recording payment."), { status: 409 });
      recordPaymentTransaction({
        bill: current,
        amount,
        paymentMethod,
        paymentDate,
        externalReference: req.body.external_reference,
        operationId,
        actor: req.auth,
      });
      summary = syncBillingPaymentSummary(billId, req.auth);
      if (summary.payment_state === "paid") {
        const quickSubmission = db.prepare(`
          SELECT * FROM billing_lite_submissions
          WHERE consultation_id = ? AND reversed_at IS NULL
          ORDER BY id DESC LIMIT 1
        `).get(existing.consultation_id);
        db.prepare(`
          UPDATE billing_lite_submissions
          SET workflow_status = 'completed',
              workflow_note = '',
              workflow_updated_by_user_id = ?,
              workflow_updated_at = CURRENT_TIMESTAMP
          WHERE id = (
            SELECT id
            FROM billing_lite_submissions
            WHERE consultation_id = ?
            ORDER BY id DESC
            LIMIT 1
          )
        `).run(req.auth?.id || null, existing.consultation_id);
        if (quickSubmission) {
          recordQuickBillingEvent({
            submissionId: quickSubmission.id,
            consultationId: existing.consultation_id,
            billingId: billId,
            actor: req.auth,
            eventType: "payment_completed",
            previousStatus: quickSubmission.workflow_status,
            nextStatus: "completed",
            reason: "Payment recorded",
          });
        }
      }
    }).immediate();
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("idx_billing_payments_external_reference")) {
      return res.status(409).json({ error: "That payment reference has already been recorded for this method." });
    }
    return res.status(error.status || 400).json({error:error.message,...error.extra});
  }

  if (existing?.patient_id) {
    publishPatientDataChange(existing.patient_id, { reason: "billing" });
    notifyLinkhamBillingIfNeeded(existing.patient_id, req.auth?.id);
  }

  res.json(getJoinedBillById(billId));
});

router.post("/:id/payments/:paymentId/reverse", (req, res) => {
  if (!["admin", "accountant", "operator"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "Only operators, administrators and finance can reverse a payment transaction." });
  }
  const billId = Number(req.params.id || 0);
  const paymentId = Number(req.params.paymentId || 0);
  const bill = getJoinedBillById(billId);
  const accessError = ensureBillAccess(req, bill, { write: true });
  if (accessError) return res.status(accessError.status).json({ error: accessError.error });
  const reason = String(req.body?.reason || "").trim().slice(0, 500);
  const reversalDate = String(req.body?.reversal_date || "").trim();
  const externalReference = normalizeSourceReference(req.body?.external_reference);
  if (reason.length < 8) return res.status(400).json({ error: "Document why this payment transaction is being reversed." });
  if (!validPaymentDate(reversalDate)) return res.status(400).json({ error: "Enter a valid reversal date (YYYY-MM-DD)." });
  try {
    assertNotFutureBusinessDate(reversalDate, "Payment reversal");
    assertBusinessDateOpen(reversalDate);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }
  const payment = db.prepare("SELECT * FROM billing_payment_transactions WHERE id = ? AND billing_id = ?").get(paymentId, billId);
  if (!payment) return res.status(404).json({ error: "Payment transaction not found for this invoice." });
  if (payment.payment_method !== "cash" && externalReference.length < 3) {
    return res.status(400).json({ error: "Enter the provider reversal reference for this non-cash payment." });
  }
  let operation;
  try { operation = operationFor(req, `billing:payment-reversal:${billId}:${paymentId}`); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }

  let result;
  try {
    db.transaction(() => {
      const replay = operation.read();
      if (replay) { result = replay; return; }
      const existing = db.prepare("SELECT * FROM billing_payment_reversals WHERE payment_transaction_id = ?").get(paymentId);
      if (existing) {
        throw Object.assign(new Error("This payment transaction has already been reversed."), { status: 409, extra: { code: "PAYMENT_ALREADY_REVERSED" } });
      }
      const refunded = roundCurrency(db.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM billing_refunds WHERE billing_id = ?").get(billId)?.amount || 0);
      const effectiveReceived = roundCurrency(db.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM billing_payment_ledger WHERE billing_id = ?").get(billId)?.amount || 0);
      if (roundCurrency(effectiveReceived - Number(payment.amount || 0)) + 0.000001 < refunded) {
        throw Object.assign(new Error("Reverse or correct the linked credit note before reversing this payment."), { status: 409, extra: { code: "PAYMENT_REVERSAL_BELOW_REFUNDS" } });
      }
      const inserted = db.prepare(`
        INSERT INTO billing_payment_reversals (
          payment_transaction_id, billing_id, amount, payment_method, reversal_date,
          reason, external_reference, operation_id, reversed_by_user_id,
          reversed_by_name, reversed_by_role
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        paymentId,
        billId,
        roundCurrency(payment.amount),
        payment.payment_method,
        reversalDate,
        reason,
        externalReference || null,
        String(req.body?.operation_id || ""),
        req.auth.id || null,
        String(req.auth.full_name || req.auth.username || ""),
        String(req.auth.role || ""),
      );
      const summary = syncBillingPaymentSummary(billId, req.auth, "Payment transaction reversed");
      const submission = db.prepare(`
        SELECT * FROM billing_lite_submissions
        WHERE billing_id = ? AND reversed_at IS NULL
        ORDER BY id DESC LIMIT 1
      `).get(billId);
      if (submission && summary.payment_state !== "paid") {
        db.prepare(`
          UPDATE billing_lite_submissions
          SET workflow_status = 'ready_for_payment', workflow_note = ?,
              workflow_updated_by_user_id = ?, workflow_updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run("Payment corrected; outstanding balance remains.", req.auth.id || null, submission.id);
        recordQuickBillingEvent({
          submissionId: submission.id,
          consultationId: submission.consultation_id,
          billingId: billId,
          actor: req.auth,
          eventType: "payment_reversed",
          previousStatus: submission.workflow_status,
          nextStatus: "ready_for_payment",
          reason,
          details: { payment_transaction_id: paymentId, reversal_id: Number(inserted.lastInsertRowid) },
        });
      }
      result = { reversal_id: Number(inserted.lastInsertRowid), bill: getJoinedBillById(billId) };
      operation.save(result);
    }).immediate();
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("idx_billing_payment_reversals_external_reference")) {
      return res.status(409).json({ error: "That provider reversal reference has already been used." });
    }
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }
  publishPatientDataChange(bill.patient_id, { reason: "billing" });
  return res.status(201).json(result);
});

module.exports = router;
