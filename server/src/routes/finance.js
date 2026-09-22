const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

const { db, financeAttachmentsDir } = require("../db");
const { financialAction, stockFinancials } = require("../lib/inventoryFinancials");
const { getTodayLocal, isValidCurrencyAmount } = require("../lib/utils");

const router = express.Router();

const EXPENSE_CATEGORIES = new Set([
  "salary", "doctor_commission", "transport_benefit", "fuel", "rent", "utilities",
  "bank_card_fee", "marketing", "professional_fee", "wastage", "equipment", "miscellaneous",
]);
const PAYMENT_METHODS = new Set(["cash", "juice", "card", "ib", "bank_transfer", "cheque"]);
const ALLOWED_DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

function monthRange(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return {
    from: `${monthKey}-01`,
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

function actor(req) {
  return {
    id: Number(req.auth?.id || 0) || null,
    name: String(req.auth?.full_name || req.auth?.username || "Finance"),
    role: String(req.auth?.role || "accountant"),
  };
}

function financeOnly(req, res, next) {
  if (!["admin", "accountant"].includes(req.auth?.role)) {
    return res.status(403).json({ error: "Finance records are restricted to administrators and finance." });
  }
  return next();
}

function adminOnly(req, res, next) {
  if (req.auth?.role !== "admin") {
    return res.status(403).json({ error: "Final approval and month close require an administrator." });
  }
  return next();
}

function assertOpenDate(value, label = "Finance transaction", { checkDayClose = true } = {}) {
  if (!validDate(value)) throw Object.assign(new Error(`${label} requires a valid date.`), { status: 400 });
  if (value > getTodayLocal()) throw Object.assign(new Error(`${label} cannot be dated in the future.`), { status: 400 });
  const dayClose = checkDayClose
    ? db.prepare("SELECT id FROM financial_day_closings WHERE business_date = ?").get(value)
    : null;
  if (dayClose) throw Object.assign(new Error(`The cash and bank day for ${value} is closed.`), { status: 409 });
  const monthClose = db.prepare("SELECT id FROM finance_monthly_closings WHERE month_key = ?").get(value.slice(0, 7));
  if (monthClose) throw Object.assign(new Error(`The finance month ${value.slice(0, 7)} is closed.`), { status: 409 });
}

function requireReference(method, reference) {
  if (method !== "cash" && String(reference || "").trim().length < 3) {
    throw Object.assign(new Error("Non-cash payments require a provider, bank, or cheque reference."), { status: 400 });
  }
}

function sanitizeFileName(value) {
  return String(value || "document").replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120);
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, callback) {
      fs.mkdirSync(financeAttachmentsDir, { recursive: true });
      callback(null, financeAttachmentsDir);
    },
    filename(_req, file, callback) {
      const extension = path.extname(file.originalname || "").toLowerCase();
      const base = sanitizeFileName(path.basename(file.originalname || "document", extension));
      callback(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${base}${extension}`);
    },
  }),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    if (ALLOWED_DOCUMENT_TYPES.has(file.mimetype)) return callback(null, true);
    return callback(new Error("Only PDF, JPG, PNG, and WebP finance documents are allowed."));
  },
});

function removeUploadedFile(file) {
  if (!file?.path) return;
  try { fs.unlinkSync(file.path); } catch {}
}

function latestStatus(table, foreignKey, id) {
  return db.prepare(`SELECT action, note, actor_name, actor_role, created_at FROM ${table} WHERE ${foreignKey} = ? ORDER BY id DESC LIMIT 1`).get(id);
}

function expenseById(id) {
  const row = db.prepare(`
    SELECT e.*,
      COALESCE((SELECT SUM(p.amount) FROM finance_expense_payments p WHERE p.expense_id=e.id),0)
      -COALESCE((SELECT SUM(p.amount) FROM finance_expense_payments p JOIN finance_expense_payment_reversals r ON r.payment_id=p.id WHERE p.expense_id=e.id),0) AS paid_amount
    FROM finance_expenses e WHERE e.id=?
  `).get(id);
  if (!row) return null;
  const status = latestStatus("finance_expense_events", "expense_id", id);
  return {
    ...row,
    approval_status: status?.action || "submitted",
    approval_note: status?.note || "",
    approved_by_name: status?.action === "approved" ? status.actor_name : "",
    outstanding_amount: roundCurrency(Number(row.amount) - Number(row.paid_amount || 0)),
    payments: db.prepare(`SELECT payment.*,reversal.id AS reversal_id,reversal.reversal_date,reversal.reason AS reversal_reason,reversal.reversed_by_name
      FROM finance_expense_payments payment LEFT JOIN finance_expense_payment_reversals reversal ON reversal.payment_id=payment.id
      WHERE payment.expense_id=? ORDER BY payment.payment_date,payment.id`).all(id),
    history: db.prepare("SELECT * FROM finance_expense_events WHERE expense_id=? ORDER BY id").all(id),
  };
}

function supplierInvoiceById(id) {
  const row = db.prepare(`
    SELECT invoice.*,
      COALESCE((SELECT SUM(line.quantity*line.unit_cost) FROM finance_supplier_invoice_lines line WHERE line.supplier_invoice_id=invoice.id),0)+invoice.other_amount AS total_amount,
      COALESCE((SELECT SUM(payment.amount) FROM finance_supplier_payments payment WHERE payment.supplier_invoice_id=invoice.id),0)
      -COALESCE((SELECT SUM(payment.amount) FROM finance_supplier_payments payment JOIN finance_supplier_payment_reversals reversal ON reversal.payment_id=payment.id WHERE payment.supplier_invoice_id=invoice.id),0) AS paid_amount
    FROM finance_supplier_invoices invoice WHERE invoice.id=?
  `).get(id);
  if (!row) return null;
  const status = latestStatus("finance_supplier_invoice_events", "supplier_invoice_id", id);
  return {
    ...row,
    approval_status: status?.action || "submitted",
    approval_note: status?.note || "",
    approved_by_name: status?.action === "approved" ? status.actor_name : "",
    outstanding_amount: roundCurrency(Number(row.total_amount) - Number(row.paid_amount || 0)),
    lines: db.prepare(`
      SELECT line.*, inventory.item_name, batch.expiry_date
      FROM finance_supplier_invoice_lines line
      LEFT JOIN inventory ON inventory.id=line.inventory_item_id
      LEFT JOIN inventory_batches batch ON batch.id=line.batch_id
      WHERE line.supplier_invoice_id=? ORDER BY line.id
    `).all(id),
    cost_variances: db.prepare(`
      SELECT *
      FROM finance_supplier_cost_variances
      WHERE supplier_invoice_id=?
      ORDER BY id
    `).all(id),
    payments: db.prepare(`SELECT payment.*,reversal.id AS reversal_id,reversal.reversal_date,reversal.reason AS reversal_reason,reversal.reversed_by_name
      FROM finance_supplier_payments payment LEFT JOIN finance_supplier_payment_reversals reversal ON reversal.payment_id=payment.id
      WHERE payment.supplier_invoice_id=? ORDER BY payment.payment_date,payment.id`).all(id),
    history: db.prepare("SELECT * FROM finance_supplier_invoice_events WHERE supplier_invoice_id=? ORDER BY id").all(id),
  };
}

function batchCostLineage(batchId) {
  return db.prepare(`
    WITH RECURSIVE lineage(id) AS (
      SELECT id FROM inventory_batches WHERE id = ?
      UNION
      SELECT child.id
      FROM inventory_batches child
      JOIN lineage parent ON child.source_batch_id = parent.id
    )
    SELECT b.*
    FROM inventory_batches b
    JOIN lineage ON lineage.id = b.id
    ORDER BY b.id
  `).all(Number(batchId));
}

function revalueApprovedSupplierLine(invoice, line) {
  if (!line.batch_id) return null;
  const lineage = batchCostLineage(line.batch_id);
  if (!lineage.length) {
    throw Object.assign(new Error(`The stock batch for ${line.description} is no longer available.`), { status: 409 });
  }
  const previousCost = roundCurrency(line.previous_batch_cost ?? lineage[0].unit_cost);
  const approvedCost = roundCurrency(line.unit_cost);
  const costDifference = roundCurrency(approvedCost - previousCost);
  const transferredOut = Number(db.prepare(`
    SELECT COALESCE(SUM(a.quantity), 0) AS quantity
    FROM inventory_movement_allocations a
    JOIN inventory_movements m ON m.id = a.movement_id
    WHERE a.batch_id = ? AND m.action_type = 'restock_out'
  `).get(Number(line.batch_id))?.quantity || 0);
  if (costDifference !== 0 && transferredOut > 0 && lineage.length === 1) {
    throw Object.assign(new Error(
      `${line.description} was transferred before batch cost lineage was available. Reconcile that batch before approving a different supplier cost.`,
    ), { status: 409 });
  }
  const invoiceQuantity = Number(line.quantity || 0);
  const remainingQuantity = Math.min(
    invoiceQuantity,
    lineage.reduce((sum, batch) => sum + Number(batch.quantity_remaining || 0), 0),
  );
  const consumedQuantity = Math.max(0, invoiceQuantity - remainingQuantity);
  const varianceAmount = roundCurrency(consumedQuantity * costDifference);
  const batchIds = lineage.map((batch) => Number(batch.id));
  const placeholders = batchIds.map(() => "?").join(",");
  db.prepare(`
    UPDATE inventory_batches
    SET unit_cost = ?, row_version = COALESCE(row_version, 1) + 1
    WHERE id IN (${placeholders})
  `).run(approvedCost, ...batchIds);
  db.prepare(`
    UPDATE inventory
    SET cost_price = ?, row_version = row_version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id IN (
      SELECT DISTINCT item_id FROM inventory_batches WHERE id IN (${placeholders})
    )
  `).run(approvedCost, ...batchIds);
  if (Math.abs(varianceAmount) >= 0.005) {
    db.prepare(`
      INSERT INTO finance_supplier_cost_variances (
        supplier_invoice_id, supplier_invoice_line_id, batch_id,
        previous_unit_cost, approved_unit_cost, invoice_quantity,
        remaining_quantity, consumed_quantity, variance_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      invoice.id,
      line.id,
      line.batch_id,
      previousCost,
      approvedCost,
      invoiceQuantity,
      remainingQuantity,
      consumedQuantity,
      varianceAmount,
    );
  }
  return { remainingQuantity, consumedQuantity, varianceAmount };
}

function approvedIds(eventTable, foreignKey) {
  return `SELECT event.${foreignKey} FROM ${eventTable} event WHERE event.id=(SELECT MAX(latest.id) FROM ${eventTable} latest WHERE latest.${foreignKey}=event.${foreignKey}) AND event.action='approved'`;
}

function latestActionCount(table, eventTable, foreignKey, dateColumn, dateFrom, dateTo, action = "submitted") {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count FROM ${table} document
    WHERE document.${dateColumn} BETWEEN date(?) AND date(?)
      AND COALESCE((
        SELECT event.action FROM ${eventTable} event
        WHERE event.${foreignKey}=document.id ORDER BY event.id DESC LIMIT 1
      ),'submitted')=?
  `).get(dateFrom, dateTo, action).count);
}

function financeOverview({ dateFrom, dateTo, basis }) {
  const billRows = db.prepare(`
    SELECT b.id,b.total_amount,b.items,date(COALESCE(NULLIF(b.consultation_date_snapshot,''),c.consultation_date)) AS sale_date
    FROM billing b JOIN consultations c ON c.id=b.consultation_id
    WHERE b.voided_at IS NULL AND c.voided_at IS NULL AND b.finalized_at IS NOT NULL
      AND date(COALESCE(NULLIF(b.consultation_date_snapshot,''),c.consultation_date)) BETWEEN date(?) AND date(?)
  `).all(dateFrom, dateTo);
  const billIds = billRows.map((row) => Number(row.id));
  const movements = billIds.length ? db.prepare(`
    SELECT * FROM inventory_movements
    WHERE CAST(json_extract(meta_json,'$.billing_id') AS INTEGER) IN (${billIds.map(() => "?").join(",")})
  `).all(...billIds) : [];
  const costFinancials = stockFinancials(movements);
  const invoiceSales = roundCurrency(billRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0));
  const invoiceCredits = roundCurrency(db.prepare(`
    SELECT COALESCE(SUM(refund.amount),0) AS amount FROM billing_refunds refund
    JOIN billing b ON b.id=refund.billing_id JOIN consultations c ON c.id=b.consultation_id
    WHERE b.voided_at IS NULL AND c.voided_at IS NULL AND b.finalized_at IS NOT NULL
      AND date(COALESCE(NULLIF(b.consultation_date_snapshot,''),c.consultation_date)) BETWEEN date(?) AND date(?)
  `).get(dateFrom, dateTo).amount);
  const cashCollected = roundCurrency(db.prepare(`
    SELECT COALESCE(SUM(ledger.amount),0) AS amount FROM billing_payment_ledger ledger
    JOIN billing b ON b.id=ledger.billing_id JOIN consultations c ON c.id=b.consultation_id
    WHERE b.voided_at IS NULL AND c.voided_at IS NULL AND b.finalized_at IS NOT NULL
      AND ledger.transaction_date BETWEEN date(?) AND date(?)
  `).get(dateFrom, dateTo).amount);
  const cashRefunded = roundCurrency(db.prepare(`
    SELECT COALESCE(SUM(refund.amount),0) AS amount FROM billing_refunds refund
    JOIN billing b ON b.id=refund.billing_id JOIN consultations c ON c.id=b.consultation_id
    WHERE b.voided_at IS NULL AND c.voided_at IS NULL AND b.finalized_at IS NOT NULL
      AND refund.refund_date BETWEEN date(?) AND date(?)
  `).get(dateFrom, dateTo).amount);
  const receivables = roundCurrency(db.prepare(`
    SELECT COALESCE(SUM(MAX(0,b.total_amount-COALESCE((
      SELECT SUM(ledger.amount) FROM billing_payment_ledger ledger
      WHERE ledger.billing_id=b.id AND ledger.transaction_date<=date(?)
    ),0)-COALESCE((
      SELECT SUM(refund.amount) FROM billing_refunds refund
      WHERE refund.billing_id=b.id AND refund.refund_date<=date(?)
    ),0))),0) AS amount
    FROM billing b JOIN consultations c ON c.id=b.consultation_id
    WHERE b.voided_at IS NULL AND c.voided_at IS NULL AND b.finalized_at IS NOT NULL
      AND date(COALESCE(NULLIF(b.consultation_date_snapshot,''),c.consultation_date))<=date(?)
  `).get(dateTo, dateTo, dateTo).amount);
  const approvedExpenseSql = approvedIds("finance_expense_events", "expense_id");
  const accruedExpenses = roundCurrency(db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS amount FROM finance_expenses
    WHERE id IN (${approvedExpenseSql}) AND expense_date BETWEEN date(?) AND date(?)
  `).get(dateFrom, dateTo).amount);
  const cashExpenses = roundCurrency(db.prepare(`
    SELECT
      COALESCE((SELECT SUM(payment.amount) FROM finance_expense_payments payment
        JOIN finance_expenses expense ON expense.id=payment.expense_id
        WHERE expense.id IN (${approvedExpenseSql}) AND payment.payment_date BETWEEN date(?) AND date(?)),0)
      -COALESCE((SELECT SUM(payment.amount) FROM finance_expense_payment_reversals reversal
        JOIN finance_expense_payments payment ON payment.id=reversal.payment_id
        JOIN finance_expenses expense ON expense.id=payment.expense_id
        WHERE expense.id IN (${approvedExpenseSql}) AND reversal.reversal_date BETWEEN date(?) AND date(?)),0) AS amount
  `).get(dateFrom, dateTo, dateFrom, dateTo).amount);
  const approvedSupplierSql = approvedIds("finance_supplier_invoice_events", "supplier_invoice_id");
  const supplierPayments = roundCurrency(db.prepare(`
    SELECT
      COALESCE((SELECT SUM(payment.amount) FROM finance_supplier_payments payment
        WHERE payment.supplier_invoice_id IN (${approvedSupplierSql}) AND payment.payment_date BETWEEN date(?) AND date(?)),0)
      -COALESCE((SELECT SUM(payment.amount) FROM finance_supplier_payment_reversals reversal
        JOIN finance_supplier_payments payment ON payment.id=reversal.payment_id
        WHERE payment.supplier_invoice_id IN (${approvedSupplierSql}) AND reversal.reversal_date BETWEEN date(?) AND date(?)),0) AS amount
  `).get(dateFrom, dateTo, dateFrom, dateTo).amount);
  const netSales = roundCurrency(invoiceSales - invoiceCredits);
  const grossProfit = roundCurrency(netSales - Number(costFinancials.sales_cost_rs || 0));
  const netCashCollected = roundCurrency(cashCollected - cashRefunded);
  const expenseAmount = basis === "cash" ? cashExpenses : accruedExpenses;
  const revenueAmount = basis === "cash" ? netCashCollected : netSales;
  const grossResult = basis === "cash"
    ? roundCurrency(netCashCollected - supplierPayments)
    : grossProfit;
  const netResult = basis === "cash"
    ? roundCurrency(netCashCollected - cashExpenses - supplierPayments)
    : roundCurrency(grossProfit - accruedExpenses);
  const exceptions = {
    pending_expenses: latestActionCount("finance_expenses", "finance_expense_events", "expense_id", "expense_date", dateFrom, dateTo),
    pending_supplier_invoices: latestActionCount("finance_supplier_invoices", "finance_supplier_invoice_events", "supplier_invoice_id", "invoice_date", dateFrom, dateTo),
    missing_cost_sales: movements.filter((movement) => financialAction(movement) === "sell" && Number(movement.unit_cost_snapshot || 0) <= 0).length,
  };
  return {
    date_from: dateFrom, date_to: dateTo, basis,
    revenue_amount: revenueAmount,
    revenue_label: basis === "cash" ? "Net collections" : "Net sales",
    net_sales_amount: netSales,
    collected_cash_amount: netCashCollected,
    receivables_amount: receivables,
    supply_cost_amount: roundCurrency(costFinancials.sales_cost_rs),
    gross_profit_amount: grossProfit,
    gross_result_amount: grossResult,
    gross_result_label: basis === "cash" ? "Cash after supplier payments" : "Gross profit",
    expense_amount: expenseAmount,
    accrued_expense_amount: accruedExpenses,
    paid_expense_amount: cashExpenses,
    supplier_payment_amount: supplierPayments,
    net_profit_amount: netResult,
    net_result_label: basis === "cash" ? "Net cash result" : "Net profit",
    exceptions,
    exception_count: Object.values(exceptions).reduce((sum, value) => sum + Number(value || 0), 0),
  };
}

function monthlyReadiness(monthKey) {
  const { from, to } = monthRange(monthKey);
  const unresolvedInvoices = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM billing b JOIN consultations c ON c.id=b.consultation_id
    WHERE b.voided_at IS NULL AND c.voided_at IS NULL AND b.finalized_at IS NOT NULL
      AND date(COALESCE(NULLIF(b.consultation_date_snapshot,''),c.consultation_date))<=date(?)
      AND b.total_amount
        -COALESCE((SELECT SUM(ledger.amount) FROM billing_payment_ledger ledger WHERE ledger.billing_id=b.id AND ledger.transaction_date<=date(?)),0)
        -COALESCE((SELECT SUM(refund.amount) FROM billing_refunds refund WHERE refund.billing_id=b.id AND refund.refund_date<=date(?)),0)>0.004
  `).get(to, to, to).count);
  const pendingExpenses = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM finance_expenses expense
    WHERE expense.expense_date BETWEEN date(?) AND date(?)
      AND COALESCE((SELECT action FROM finance_expense_events event WHERE event.expense_id=expense.id ORDER BY id DESC LIMIT 1),'submitted')='submitted'
  `).get(from, to).count);
  const pendingSuppliers = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM finance_supplier_invoices invoice
    WHERE invoice.invoice_date BETWEEN date(?) AND date(?)
      AND COALESCE((SELECT action FROM finance_supplier_invoice_events event WHERE event.supplier_invoice_id=invoice.id ORDER BY id DESC LIMIT 1),'submitted')='submitted'
  `).get(from, to).count);
  const missingCosts = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM inventory_movements movement
    JOIN billing b ON b.id=CAST(json_extract(movement.meta_json,'$.billing_id') AS INTEGER)
    JOIN consultations c ON c.id=b.consultation_id
    WHERE b.voided_at IS NULL AND c.voided_at IS NULL AND b.finalized_at IS NOT NULL
      AND date(COALESCE(NULLIF(b.consultation_date_snapshot,''),c.consultation_date)) BETWEEN date(?) AND date(?)
      AND movement.quantity>0 AND movement.action_type='Sale' AND COALESCE(movement.unit_cost_snapshot,0)<=0
  `).get(from, to).count);
  const activityDates = db.prepare(`
    SELECT activity_date FROM (
      SELECT transaction_date AS activity_date FROM billing_payment_ledger
      UNION SELECT refund_date FROM billing_refunds
      UNION SELECT payment_date FROM finance_expense_payments
      UNION SELECT payment_date FROM finance_supplier_payments
      UNION SELECT reversal_date FROM finance_expense_payment_reversals
      UNION SELECT reversal_date FROM finance_supplier_payment_reversals
    ) WHERE activity_date BETWEEN date(?) AND date(?) AND activity_date<date('now','+4 hours')
  `).all(from, to).map((row) => row.activity_date);
  const missingDayCloses = activityDates.filter((date) => !db.prepare("SELECT id FROM financial_day_closings WHERE business_date=?").get(date));
  const blockers = [];
  if (unresolvedInvoices) blockers.push(`${unresolvedInvoices} unresolved invoice(s)`);
  if (pendingExpenses) blockers.push(`${pendingExpenses} unapproved expense(s)`);
  if (pendingSuppliers) blockers.push(`${pendingSuppliers} unapproved supplier invoice(s)`);
  if (missingCosts) blockers.push(`${missingCosts} sale movement(s) without cost`);
  if (missingDayCloses.length) blockers.push(`${missingDayCloses.length} financial activity day(s) not closed`);
  return {
    month_key: monthKey, date_from: from, date_to: to, unresolved_invoice_count: unresolvedInvoices,
    unapproved_expense_count: pendingExpenses, unapproved_supplier_invoice_count: pendingSuppliers,
    missing_cost_count: missingCosts, missing_day_close_dates: missingDayCloses,
    blockers, ready: blockers.length === 0,
  };
}

router.use(financeOnly);

router.get("/summary", (req, res) => {
  const dateFrom = String(req.query.dateFrom || "");
  const dateTo = String(req.query.dateTo || "");
  const basis = req.query.basis === "cash" ? "cash" : "accrual";
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) return res.status(400).json({ error: "Select a valid finance date range." });
  return res.json(financeOverview({ dateFrom, dateTo, basis }));
});

router.get("/expenses", (req, res) => {
  const dateFrom = String(req.query.dateFrom || "0001-01-01");
  const dateTo = String(req.query.dateTo || "9999-12-31");
  const basis = req.query.basis === "cash" ? "cash" : "accrual";
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) return res.status(400).json({ error: "Select a valid date range." });
  const ids = db.prepare(`
    SELECT DISTINCT expense.id FROM finance_expenses expense
    LEFT JOIN finance_expense_payments payment ON payment.expense_id=expense.id
    WHERE ((?='accrual' AND expense.expense_date BETWEEN date(?) AND date(?))
      OR (?='cash' AND (payment.payment_date BETWEEN date(?) AND date(?) OR EXISTS (
        SELECT 1 FROM finance_expense_payment_reversals reversal
        WHERE reversal.payment_id=payment.id AND reversal.reversal_date BETWEEN date(?) AND date(?)
      ))))
    ORDER BY expense.expense_date DESC,expense.id DESC
  `).all(basis, dateFrom, dateTo, basis, dateFrom, dateTo, dateFrom, dateTo).map((row) => row.id);
  return res.json({ expenses: ids.map(expenseById), categories: [...EXPENSE_CATEGORIES], payment_methods: [...PAYMENT_METHODS] });
});

router.post("/expenses", upload.single("receipt"), (req, res) => {
  try {
    const expenseDate = String(req.body.expense_date || "");
    const category = String(req.body.category || "");
    const payee = String(req.body.payee || "").trim();
    const description = String(req.body.description || "").trim();
    const amount = Number(req.body.amount);
    const reference = String(req.body.external_reference || "").trim() || null;
    const operationId = String(req.body.operation_id || "").trim();
    assertOpenDate(expenseDate, "Expense", { checkDayClose: false });
    if (!req.file) throw Object.assign(new Error("Attach the receipt or supporting expense document."), { status: 400 });
    if (!EXPENSE_CATEGORIES.has(category)) throw Object.assign(new Error("Select a valid expense category."), { status: 400 });
    if (!payee) throw Object.assign(new Error("Supplier or payee is required."), { status: 400 });
    if (!isValidCurrencyAmount(amount) || amount <= 0) throw Object.assign(new Error("Enter a positive expense amount."), { status: 400 });
    if (!operationId) throw Object.assign(new Error("Expense operation reference is required."), { status: 400 });
    const who = actor(req);
    const id = db.transaction(() => {
      const result = db.prepare(`INSERT INTO finance_expenses (
        expense_date,category,payee,description,amount,external_reference,
        receipt_stored_name,receipt_original_name,receipt_mime_type,receipt_size,
        operation_id,created_by_user_id,created_by_name,created_by_role
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        expenseDate, category, payee, description, roundCurrency(amount), reference,
        req.file?.filename || null, req.file?.originalname || null, req.file?.mimetype || null, req.file?.size || null,
        operationId, who.id, who.name, who.role,
      ).lastInsertRowid;
      const expenseId = Number(result);
      db.prepare(`INSERT INTO finance_expense_events (expense_id,action,note,operation_id,actor_user_id,actor_name,actor_role) VALUES (?,'submitted',?,?,?,?,?)`)
        .run(expenseId, "Submitted for approval", operationId, who.id, who.name, who.role);
      return expenseId;
    })();
    return res.status(201).json(expenseById(id));
  } catch (error) {
    removeUploadedFile(req.file);
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "This expense was already recorded." });
    return res.status(error.status || 400).json({ error: error.message });
  }
});

router.post("/expenses/:id/decision", adminOnly, (req, res) => {
  const expense = expenseById(Number(req.params.id));
  if (!expense) return res.status(404).json({ error: "Expense not found." });
  const action = String(req.body.action || "");
  const note = String(req.body.note || "").trim();
  const operationId = String(req.body.operation_id || "").trim();
  if (!["approved", "rejected"].includes(action)) return res.status(400).json({ error: "Choose approve or reject." });
  if (expense.approval_status !== "submitted") return res.status(409).json({ error: "This expense already has a final decision." });
  if (note.length < 5) return res.status(400).json({ error: "Add a short approval or rejection note." });
  if (!operationId) return res.status(400).json({ error: "Approval operation reference is required." });
  try {
    assertOpenDate(expense.expense_date, "Expense approval", { checkDayClose: false });
    const who = actor(req);
    db.prepare(`INSERT INTO finance_expense_events (expense_id,action,note,operation_id,actor_user_id,actor_name,actor_role) VALUES (?,?,?,?,?,?,?)`)
      .run(expense.id, action, note, operationId, who.id, who.name, who.role);
    return res.json(expenseById(expense.id));
  } catch (error) {
    return res.status(String(error.message).includes("UNIQUE") ? 409 : (error.status || 400)).json({ error: error.message });
  }
});

router.post("/expenses/:id/payments", (req, res) => {
  const expense = expenseById(Number(req.params.id));
  if (!expense) return res.status(404).json({ error: "Expense not found." });
  try {
    if (expense.approval_status !== "approved") throw Object.assign(new Error("Approve the expense before recording payment."), { status: 409 });
    const amount = Number(req.body.amount);
    const paymentDate = String(req.body.payment_date || "");
    const method = String(req.body.payment_method || "");
    const reference = String(req.body.external_reference || "").trim() || null;
    const operationId = String(req.body.operation_id || "").trim();
    assertOpenDate(paymentDate, "Expense payment");
    if (!PAYMENT_METHODS.has(method)) throw Object.assign(new Error("Select a valid payment method."), { status: 400 });
    if (!operationId) throw Object.assign(new Error("Expense payment operation reference is required."), { status: 400 });
    requireReference(method, reference);
    if (!isValidCurrencyAmount(amount) || amount <= 0 || amount > expense.outstanding_amount + 0.004) throw Object.assign(new Error("Payment must be positive and cannot exceed the outstanding expense."), { status: 400 });
    const who = actor(req);
    db.prepare(`INSERT INTO finance_expense_payments (expense_id,amount,payment_date,payment_method,external_reference,operation_id,recorded_by_user_id,recorded_by_name,recorded_by_role) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(expense.id, roundCurrency(amount), paymentDate, method, reference, operationId, who.id, who.name, who.role);
    return res.status(201).json(expenseById(expense.id));
  } catch (error) {
    return res.status(String(error.message).includes("UNIQUE") ? 409 : (error.status || 400)).json({ error: error.message });
  }
});

router.post("/expenses/:id/payments/:paymentId/reversal", adminOnly, (req, res) => {
  const expense = expenseById(Number(req.params.id));
  const paymentId = Number(req.params.paymentId);
  const payment = expense?.payments?.find((entry) => Number(entry.id) === paymentId);
  if (!expense || !payment) return res.status(404).json({ error: "Expense payment not found." });
  if (payment.reversal_id) return res.status(409).json({ error: "This expense payment is already reversed." });
  const reversalDate = String(req.body.reversal_date || "");
  const reason = String(req.body.reason || "").trim();
  const operationId = String(req.body.operation_id || "").trim();
  try {
    assertOpenDate(reversalDate, "Expense payment reversal");
    if (reason.length < 10) throw Object.assign(new Error("Explain the payment reversal in at least 10 characters."), { status: 400 });
    if (!operationId) throw Object.assign(new Error("Payment reversal operation reference is required."), { status: 400 });
    const who = actor(req);
    db.prepare(`INSERT INTO finance_expense_payment_reversals (payment_id,reversal_date,reason,operation_id,reversed_by_user_id,reversed_by_name,reversed_by_role) VALUES (?,?,?,?,?,?,?)`)
      .run(paymentId, reversalDate, reason, operationId, who.id, who.name, who.role);
    return res.status(201).json(expenseById(expense.id));
  } catch (error) {
    return res.status(String(error.message).includes("UNIQUE") ? 409 : (error.status || 400)).json({ error: error.message });
  }
});

router.get("/expenses/:id/receipt", (req, res) => {
  const expense = expenseById(Number(req.params.id));
  if (!expense?.receipt_stored_name) return res.status(404).json({ error: "Receipt not found." });
  const filePath = path.join(financeAttachmentsDir, path.basename(expense.receipt_stored_name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Receipt file is unavailable." });
  res.type(expense.receipt_mime_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${sanitizeFileName(expense.receipt_original_name)}"`);
  return res.sendFile(filePath);
});

router.get("/supplier-shipments/:id", (req, res) => {
  const shipment = db.prepare(`
    SELECT id, supplier, delivery_note, received_date, status
    FROM inventory_shipments WHERE id = ?
  `).get(Number(req.params.id));
  if (!shipment) return res.status(404).json({ error: "Receive Delivery record not found." });
  const lines = db.prepare(`
    SELECT item_name, quantity, cost_price, status, released_inventory_id, released_batch_id
    FROM inventory_staging WHERE shipment_id = ? ORDER BY id
  `).all(shipment.id);
  return res.json({ shipment: { ...shipment, lines } });
});

router.get("/supplier-catalogue", (_req, res) => {
  const items = db.prepare(`
    SELECT inventory.id,inventory.item_name,inventory.unit,inventory.cost_price,
      batch.id AS batch_id,batch.quantity_remaining,batch.expiry_date,batch.unit_cost
    FROM inventory LEFT JOIN inventory_batches batch ON batch.item_id=inventory.id AND batch.quantity_remaining>0
    WHERE inventory.archived_at IS NULL ORDER BY inventory.item_name COLLATE NOCASE,batch.expiry_date,batch.id
  `).all();
  const shipments = db.prepare("SELECT id,supplier,delivery_note,status,imported_at FROM inventory_shipments ORDER BY id DESC LIMIT 100").all();
  return res.json({ items, shipments });
});

router.get("/supplier-invoices", (req, res) => {
  const dateFrom = String(req.query.dateFrom || "0001-01-01");
  const dateTo = String(req.query.dateTo || "9999-12-31");
  const basis = req.query.basis === "cash" ? "cash" : "accrual";
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) return res.status(400).json({ error: "Select a valid date range." });
  const ids = db.prepare(`
    SELECT DISTINCT invoice.id FROM finance_supplier_invoices invoice
    LEFT JOIN finance_supplier_payments payment ON payment.supplier_invoice_id=invoice.id
    WHERE ((?='accrual' AND invoice.invoice_date BETWEEN date(?) AND date(?))
      OR (?='cash' AND (payment.payment_date BETWEEN date(?) AND date(?) OR EXISTS (
        SELECT 1 FROM finance_supplier_payment_reversals reversal
        WHERE reversal.payment_id=payment.id AND reversal.reversal_date BETWEEN date(?) AND date(?)
      ))))
    ORDER BY invoice.invoice_date DESC,invoice.id DESC
  `).all(basis, dateFrom, dateTo, basis, dateFrom, dateTo, dateFrom, dateTo).map((row) => row.id);
  return res.json({ invoices: ids.map(supplierInvoiceById), payment_methods: [...PAYMENT_METHODS] });
});

router.post("/supplier-invoices", upload.single("document"), (req, res) => {
  try {
    const supplier = String(req.body.supplier_name || "").trim();
    const invoiceNumber = String(req.body.invoice_number || "").trim();
    const invoiceDate = String(req.body.invoice_date || "");
    const dueDate = String(req.body.due_date || "").trim() || null;
    const deliveryNote = String(req.body.delivery_note || "").trim();
    const shipmentId = Number(req.body.shipment_id || 0) || null;
    const otherAmount = Number(req.body.other_amount || 0);
    const operationId = String(req.body.operation_id || "").trim();
    const lines = Array.isArray(req.body.lines)
      ? req.body.lines
      : JSON.parse(String(req.body.lines || "[]"));
    assertOpenDate(invoiceDate, "Supplier invoice", { checkDayClose: false });
    if (!req.file && !deliveryNote) throw Object.assign(new Error("Attach the supplier invoice or enter its delivery note reference."), { status: 400 });
    if (dueDate && !validDate(dueDate)) throw Object.assign(new Error("Enter a valid due date."), { status: 400 });
    if (!supplier || !invoiceNumber) throw Object.assign(new Error("Supplier and invoice number are required."), { status: 400 });
    if (!isValidCurrencyAmount(otherAmount)) throw Object.assign(new Error("Other charges must be a valid amount."), { status: 400 });
    if (!operationId) throw Object.assign(new Error("Supplier invoice operation reference is required."), { status: 400 });
    if (!Array.isArray(lines) || !lines.length) throw Object.assign(new Error("Add at least one supplier invoice line."), { status: 400 });
    const normalized = lines.map((line) => ({
      inventory_item_id: Number(line.inventory_item_id || 0) || null,
      batch_id: Number(line.batch_id || 0) || null,
      description: String(line.description || "").trim(),
      quantity: Number(line.quantity), unit_cost: Number(line.unit_cost),
    }));
    for (const line of normalized) {
      if (!line.description || !Number.isFinite(line.quantity) || line.quantity <= 0 || !isValidCurrencyAmount(line.unit_cost)) throw Object.assign(new Error("Every supplier line needs a description, positive quantity, and valid unit cost."), { status: 400 });
      if (line.inventory_item_id) {
        const inventory = db.prepare("SELECT cost_price FROM inventory WHERE id=? AND archived_at IS NULL").get(line.inventory_item_id);
        if (!inventory) throw Object.assign(new Error("A selected inventory item is unavailable."), { status: 400 });
        line.previous_inventory_cost = Number(inventory.cost_price || 0);
      }
      if (line.batch_id) {
        const batch = db.prepare("SELECT item_id,unit_cost FROM inventory_batches WHERE id=?").get(line.batch_id);
        if (!batch || !line.inventory_item_id || Number(batch.item_id) !== line.inventory_item_id) throw Object.assign(new Error("A selected stock batch does not match its inventory item."), { status: 400 });
        line.previous_batch_cost = Number(batch.unit_cost || 0);
      }
    }
    const who = actor(req);
    const id = db.transaction(() => {
      const result = db.prepare(`INSERT INTO finance_supplier_invoices (
        supplier_name,invoice_number,invoice_date,due_date,delivery_note,shipment_id,other_amount,
        document_stored_name,document_original_name,document_mime_type,document_size,
        operation_id,created_by_user_id,created_by_name,created_by_role
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        supplier, invoiceNumber, invoiceDate, dueDate, deliveryNote, shipmentId, roundCurrency(otherAmount),
        req.file?.filename || null, req.file?.originalname || null, req.file?.mimetype || null, req.file?.size || null,
        operationId, who.id, who.name, who.role,
      ).lastInsertRowid;
      const supplierInvoiceId = Number(result);
      const insertLine = db.prepare("INSERT INTO finance_supplier_invoice_lines (supplier_invoice_id,inventory_item_id,batch_id,description,quantity,unit_cost,previous_inventory_cost,previous_batch_cost) VALUES (?,?,?,?,?,?,?,?)");
      for (const line of normalized) insertLine.run(supplierInvoiceId, line.inventory_item_id, line.batch_id, line.description, line.quantity, roundCurrency(line.unit_cost), line.previous_inventory_cost ?? null, line.previous_batch_cost ?? null);
      db.prepare(`INSERT INTO finance_supplier_invoice_events (supplier_invoice_id,action,note,operation_id,actor_user_id,actor_name,actor_role) VALUES (?,'submitted',?,?,?,?,?)`)
        .run(supplierInvoiceId, "Submitted for approval", operationId, who.id, who.name, who.role);
      return supplierInvoiceId;
    })();
    return res.status(201).json(supplierInvoiceById(id));
  } catch (error) {
    removeUploadedFile(req.file);
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "That supplier invoice or operation reference already exists." });
    return res.status(error.status || 400).json({ error: error.message });
  }
});

router.post("/supplier-invoices/:id/decision", adminOnly, (req, res) => {
  const invoice = supplierInvoiceById(Number(req.params.id));
  if (!invoice) return res.status(404).json({ error: "Supplier invoice not found." });
  const action = String(req.body.action || "");
  const note = String(req.body.note || "").trim();
  const operationId = String(req.body.operation_id || "").trim();
  if (!["approved", "rejected"].includes(action)) return res.status(400).json({ error: "Choose approve or reject." });
  if (invoice.approval_status !== "submitted") return res.status(409).json({ error: "This supplier invoice already has a final decision." });
  if (note.length < 5) return res.status(400).json({ error: "Add a short approval or rejection note." });
  if (!operationId) return res.status(400).json({ error: "Approval operation reference is required." });
  try {
    assertOpenDate(invoice.invoice_date, "Supplier invoice approval", { checkDayClose: false });
    const who = actor(req);
    db.transaction(() => {
      db.prepare(`INSERT INTO finance_supplier_invoice_events (supplier_invoice_id,action,note,operation_id,actor_user_id,actor_name,actor_role) VALUES (?,?,?,?,?,?,?)`)
        .run(invoice.id, action, note, operationId, who.id, who.name, who.role);
      if (action === "approved") {
        for (const line of invoice.lines) {
          if (line.batch_id) revalueApprovedSupplierLine(invoice, line);
          else if (line.inventory_item_id) db.prepare("UPDATE inventory SET cost_price=?,row_version=row_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(roundCurrency(line.unit_cost), line.inventory_item_id);
        }
      }
    })();
    return res.json(supplierInvoiceById(invoice.id));
  } catch (error) {
    return res.status(String(error.message).includes("UNIQUE") ? 409 : (error.status || 400)).json({ error: error.message });
  }
});

router.post("/supplier-invoices/:id/payments", (req, res) => {
  const invoice = supplierInvoiceById(Number(req.params.id));
  if (!invoice) return res.status(404).json({ error: "Supplier invoice not found." });
  try {
    if (invoice.approval_status !== "approved") throw Object.assign(new Error("Approve the supplier invoice before recording payment."), { status: 409 });
    const amount = Number(req.body.amount);
    const paymentDate = String(req.body.payment_date || "");
    const method = String(req.body.payment_method || "");
    const reference = String(req.body.external_reference || "").trim() || null;
    const operationId = String(req.body.operation_id || "").trim();
    assertOpenDate(paymentDate, "Supplier payment");
    if (!PAYMENT_METHODS.has(method)) throw Object.assign(new Error("Select a valid payment method."), { status: 400 });
    if (!operationId) throw Object.assign(new Error("Supplier payment operation reference is required."), { status: 400 });
    requireReference(method, reference);
    if (!isValidCurrencyAmount(amount) || amount <= 0 || amount > invoice.outstanding_amount + 0.004) throw Object.assign(new Error("Payment must be positive and cannot exceed the supplier balance."), { status: 400 });
    const who = actor(req);
    db.prepare(`INSERT INTO finance_supplier_payments (supplier_invoice_id,amount,payment_date,payment_method,external_reference,operation_id,recorded_by_user_id,recorded_by_name,recorded_by_role) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(invoice.id, roundCurrency(amount), paymentDate, method, reference, operationId, who.id, who.name, who.role);
    return res.status(201).json(supplierInvoiceById(invoice.id));
  } catch (error) {
    return res.status(String(error.message).includes("UNIQUE") ? 409 : (error.status || 400)).json({ error: error.message });
  }
});

router.post("/supplier-invoices/:id/payments/:paymentId/reversal", adminOnly, (req, res) => {
  const invoice = supplierInvoiceById(Number(req.params.id));
  const paymentId = Number(req.params.paymentId);
  const payment = invoice?.payments?.find((entry) => Number(entry.id) === paymentId);
  if (!invoice || !payment) return res.status(404).json({ error: "Supplier payment not found." });
  if (payment.reversal_id) return res.status(409).json({ error: "This supplier payment is already reversed." });
  const reversalDate = String(req.body.reversal_date || "");
  const reason = String(req.body.reason || "").trim();
  const operationId = String(req.body.operation_id || "").trim();
  try {
    assertOpenDate(reversalDate, "Supplier payment reversal");
    if (reason.length < 10) throw Object.assign(new Error("Explain the payment reversal in at least 10 characters."), { status: 400 });
    if (!operationId) throw Object.assign(new Error("Payment reversal operation reference is required."), { status: 400 });
    const who = actor(req);
    db.prepare(`INSERT INTO finance_supplier_payment_reversals (payment_id,reversal_date,reason,operation_id,reversed_by_user_id,reversed_by_name,reversed_by_role) VALUES (?,?,?,?,?,?,?)`)
      .run(paymentId, reversalDate, reason, operationId, who.id, who.name, who.role);
    return res.status(201).json(supplierInvoiceById(invoice.id));
  } catch (error) {
    return res.status(String(error.message).includes("UNIQUE") ? 409 : (error.status || 400)).json({ error: error.message });
  }
});

router.get("/supplier-invoices/:id/document", (req, res) => {
  const invoice = supplierInvoiceById(Number(req.params.id));
  if (!invoice?.document_stored_name) return res.status(404).json({ error: "Supplier document not found." });
  const filePath = path.join(financeAttachmentsDir, path.basename(invoice.document_stored_name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Supplier document file is unavailable." });
  res.type(invoice.document_mime_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${sanitizeFileName(invoice.document_original_name)}"`);
  return res.sendFile(filePath);
});

router.get("/monthly-close", (req, res) => {
  const monthKey = String(req.query.month || "");
  if (!validMonth(monthKey)) return res.status(400).json({ error: "Select a valid month." });
  const closing = db.prepare("SELECT * FROM finance_monthly_closings WHERE month_key=?").get(monthKey) || null;
  return res.json({ readiness: monthlyReadiness(monthKey), closing });
});

router.post("/monthly-close", adminOnly, (req, res) => {
  const monthKey = String(req.body.month || "");
  const notes = String(req.body.notes || "").trim();
  const operationId = String(req.body.operation_id || "").trim();
  if (!validMonth(monthKey)) return res.status(400).json({ error: "Select a valid month." });
  if (monthKey >= getTodayLocal().slice(0, 7)) return res.status(400).json({ error: "Only a completed month can be signed off." });
  if (notes.length < 10) return res.status(400).json({ error: "Add a meaningful month-close note." });
  if (!operationId) return res.status(400).json({ error: "Month-close operation reference is required." });
  const readiness = monthlyReadiness(monthKey);
  if (!readiness.ready) return res.status(409).json({ error: "Resolve every monthly-close blocker first.", readiness });
  try {
    const who = actor(req);
    const result = db.prepare(`INSERT INTO finance_monthly_closings (month_key,readiness_snapshot_json,notes,operation_id,closed_by_user_id,closed_by_name,closed_by_role) VALUES (?,?,?,?,?,?,?)`)
      .run(monthKey, JSON.stringify(readiness), notes, operationId, who.id, who.name, who.role);
    return res.status(201).json(db.prepare("SELECT * FROM finance_monthly_closings WHERE id=?").get(result.lastInsertRowid));
  } catch (error) {
    return res.status(409).json({ error: "This month or operation was already closed." });
  }
});

router.get("/statement.csv", (req, res) => {
  const dateFrom = String(req.query.dateFrom || "");
  const dateTo = String(req.query.dateTo || "");
  const basis = req.query.basis === "cash" ? "cash" : "accrual";
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) return res.status(400).json({ error: "Select a valid date range." });
  const summary = financeOverview({ dateFrom, dateTo, basis });
  const rows = [
    ["Basis", basis], ["From", dateFrom], ["To", dateTo],
    [summary.revenue_label, summary.revenue_amount], ["Collected cash", summary.collected_cash_amount],
    ["Receivables", summary.receivables_amount], ["Cost of supplies sold", summary.supply_cost_amount],
    [summary.gross_result_label, summary.gross_result_amount], ["Expenses", summary.expense_amount],
    [summary.net_result_label, summary.net_profit_amount], ["Supplier payments", summary.supplier_payment_amount],
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const filename = `ocs-financial-statement-${basis}-${dateFrom}-to-${dateTo}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-File-Name", filename);
  return res.send(`\ufeff${csv}`);
});

module.exports = router;
