const crypto = require("crypto");

const { financialAction } = require("./inventoryFinancials");
const { isConsultationFee } = require("./consultationFees");
const { normalizeBillingItems } = require("./utils");

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function systemAccount(db, key) {
  const account = db.prepare("SELECT * FROM finance_accounts WHERE system_key=? AND is_active=1").get(key);
  if (!account) throw new Error(`Accounting system account is missing: ${key}`);
  return account;
}

function paymentAccountKey(method) {
  const normalized = String(method || "").trim().toLowerCase();
  return ["cash", "juice", "card", "ib", "bank_transfer", "cheque"].includes(normalized)
    ? normalized
    : "cash";
}

function assertOpenAccountingPeriod(db, entryDate) {
  const monthKey = String(entryDate || "").slice(0, 7);
  if (db.prepare("SELECT id FROM finance_accounting_period_locks WHERE month_key=?").get(monthKey)) {
    throw Object.assign(new Error(`Accounting period ${monthKey} is locked.`), { status: 409 });
  }
}

function postJournal(db, entry, lines, { allowLockedPeriod = false, afterPost = null } = {}) {
  const normalizedLines = (lines || [])
    .map((line) => ({
      accountId: Number(line.accountId || line.account_id || 0),
      debit: roundCurrency(line.debit),
      credit: roundCurrency(line.credit),
      memo: String(line.memo || "").trim(),
      partyType: String(line.partyType || line.party_type || "").trim(),
      partyId: line.partyId ?? line.party_id ?? null,
      partyName: String(line.partyName || line.party_name || "").trim(),
    }))
    .filter((line) => line.accountId && (line.debit > 0 || line.credit > 0));
  const debit = roundCurrency(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
  const credit = roundCurrency(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
  if (normalizedLines.length < 2 || Math.abs(debit - credit) > 0.004 || debit <= 0) {
    throw Object.assign(new Error("Journal must contain at least two balanced lines."), { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.entryDate || ""))) {
    throw Object.assign(new Error("Journal date is invalid."), { status: 400 });
  }
  if (!allowLockedPeriod) assertOpenAccountingPeriod(db, entry.entryDate);

  const existing = db.prepare("SELECT * FROM finance_journal_entries WHERE reference_type=? AND reference_id=?")
    .get(entry.referenceType, String(entry.referenceId));
  if (existing) return existing;

  return db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO finance_journal_entries (
        entry_date,reference_type,reference_id,document_number,description,cash_flow_class,
        status,operation_id,reversal_of_entry_id,created_by_user_id,created_by_name,created_by_role
      ) VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?)
    `).run(
      entry.entryDate,
      entry.referenceType,
      String(entry.referenceId),
      String(entry.documentNumber || ""),
      String(entry.description || "Journal entry"),
      String(entry.cashFlowClass || "operating"),
      String(entry.operationId || crypto.randomUUID()),
      entry.reversalOfEntryId || null,
      entry.actor?.id || null,
      String(entry.actor?.name || "System"),
      String(entry.actor?.role || "system"),
    );
    const id = Number(result.lastInsertRowid);
    const insertLine = db.prepare(`
      INSERT INTO finance_journal_lines (
        journal_entry_id,account_id,debit,credit,memo,party_type,party_id,party_name
      ) VALUES (?,?,?,?,?,?,?,?)
    `);
    for (const line of normalizedLines) {
      insertLine.run(
        id, line.accountId, line.debit, line.credit, line.memo,
        line.partyType, line.partyId === null ? null : String(line.partyId), line.partyName,
      );
    }
    db.prepare("UPDATE finance_journal_entries SET status='posted',posted_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    const posted = db.prepare("SELECT * FROM finance_journal_entries WHERE id=?").get(id);
    if (afterPost) afterPost(posted);
    return posted;
  })();
}

function reverseJournal(db, entryId, { entryDate, reason, operationId, actor }) {
  const original = db.prepare("SELECT * FROM finance_journal_entries WHERE id=? AND status='posted'").get(entryId);
  if (!original) throw Object.assign(new Error("Posted journal not found."), { status: 404 });
  const lines = db.prepare("SELECT * FROM finance_journal_lines WHERE journal_entry_id=? ORDER BY id").all(entryId);
  return postJournal(db, {
    entryDate,
    referenceType: "journal_reversal",
    referenceId: String(entryId),
    documentNumber: `REV-${original.document_number || original.id}`,
    description: `Reversal: ${reason}`,
    cashFlowClass: original.cash_flow_class,
    operationId,
    reversalOfEntryId: original.id,
    actor,
  }, lines.map((line) => ({
    accountId: line.account_id,
    debit: line.credit,
    credit: line.debit,
    memo: `Reversal of journal ${original.id}: ${line.memo}`,
    partyType: line.party_type,
    partyId: line.party_id,
    partyName: line.party_name,
  })));
}

function expenseAccountKey(category) {
  const key = String(category || "miscellaneous").trim();
  if (key === "equipment") return "fixed_assets";
  if (key === "wastage") return "wastage_expense";
  return `expense_${key}`;
}

function latestApprovedIds(db, table, eventTable, foreignKey) {
  return db.prepare(`
    SELECT source.id
    FROM ${table} source
    WHERE (
      SELECT event.action FROM ${eventTable} event
      WHERE event.${foreignKey}=source.id ORDER BY event.id DESC LIMIT 1
    )='approved'
  `).all().map((row) => Number(row.id));
}

function syncOperationalLedger(db) {
  const countBefore = Number(db.prepare("SELECT COUNT(*) AS count FROM finance_journal_entries").get().count || 0);
  const account = (key) => systemAccount(db, key).id;
  const systemActor = { name: "OCS automatic posting", role: "system" };

  const invoices = db.prepare(`
    SELECT b.*,c.doctor_id
    FROM billing b JOIN consultations c ON c.id=b.consultation_id
    WHERE b.finalized_at IS NOT NULL AND b.voided_at IS NULL AND c.voided_at IS NULL
    ORDER BY b.id
  `).all();
  for (const bill of invoices) {
    let consultation = 0, supply = 0, other = 0;
    for (const item of normalizeBillingItems(bill.items)) {
      if (String(item.type || "Sale") !== "Sale") continue;
      const amount = roundCurrency(item.amount);
      if (isConsultationFee(item)) consultation += amount;
      else if (Number(item.inventory_item_id || 0) > 0) supply += amount;
      else other += amount;
    }
    const total = roundCurrency(bill.total_amount);
    const classified = roundCurrency(consultation + supply + other);
    other = roundCurrency(other + (total - classified));
    const party = { partyType: "patient", partyId: bill.patient_id, partyName: bill.patient_name_snapshot || "Patient" };
    const credits = [
      ["consultation_revenue", consultation, "Consultation revenue"],
      ["supply_revenue", supply, "Supply revenue"],
      ["other_revenue", other, "Other service revenue"],
    ].filter(([, amount]) => amount > 0.004).map(([key, amount, memo]) => ({ accountId: account(key), credit: amount, memo, ...party }));
    if (!credits.length || total <= 0) continue;
    postJournal(db, {
      entryDate: bill.consultation_date_snapshot || String(bill.finalized_at).slice(0, 10),
      referenceType: "billing_invoice", referenceId: bill.id,
      documentNumber: bill.invoice_number, description: `Invoice ${bill.invoice_number}`,
      cashFlowClass: "operating", actor: systemActor,
    }, [{ accountId: account("accounts_receivable"), debit: total, memo: "Patient receivable", ...party }, ...credits], { allowLockedPeriod: true });
  }

  const payments = db.prepare(`
    SELECT p.*,b.invoice_number,b.patient_id,b.patient_name_snapshot
    FROM billing_payment_transactions p JOIN billing b ON b.id=p.billing_id
    WHERE b.finalized_at IS NOT NULL AND b.voided_at IS NULL ORDER BY p.id
  `).all();
  for (const payment of payments) {
    const party = { partyType: "patient", partyId: payment.patient_id, partyName: payment.patient_name_snapshot || "Patient" };
    postJournal(db, {
      entryDate: payment.payment_date, referenceType: "billing_payment", referenceId: payment.id,
      documentNumber: payment.external_reference || payment.invoice_number,
      description: `Payment received for ${payment.invoice_number}`,
      cashFlowClass: "operating", actor: systemActor,
    }, [
      { accountId: account(paymentAccountKey(payment.payment_method)), debit: payment.amount, memo: "Payment received", ...party },
      { accountId: account("accounts_receivable"), credit: payment.amount, memo: "Receivable settled", ...party },
    ], { allowLockedPeriod: true });
  }

  const paymentReversals = db.prepare(`
    SELECT r.*,b.invoice_number,b.patient_id,b.patient_name_snapshot
    FROM billing_payment_reversals r JOIN billing b ON b.id=r.billing_id ORDER BY r.id
  `).all();
  for (const reversal of paymentReversals) {
    const party = { partyType: "patient", partyId: reversal.patient_id, partyName: reversal.patient_name_snapshot || "Patient" };
    postJournal(db, {
      entryDate: reversal.reversal_date, referenceType: "billing_payment_reversal", referenceId: reversal.id,
      documentNumber: reversal.external_reference || reversal.invoice_number,
      description: `Payment reversal for ${reversal.invoice_number}: ${reversal.reason}`,
      cashFlowClass: "operating", actor: systemActor,
    }, [
      { accountId: account("accounts_receivable"), debit: reversal.amount, memo: "Receivable reinstated", ...party },
      { accountId: account(paymentAccountKey(reversal.payment_method)), credit: reversal.amount, memo: "Payment reversed", ...party },
    ], { allowLockedPeriod: true });
  }

  const refunds = db.prepare(`
    SELECT r.*,b.invoice_number,b.patient_id,b.patient_name_snapshot
    FROM billing_refunds r JOIN billing b ON b.id=r.billing_id ORDER BY r.id
  `).all();
  for (const refund of refunds) {
    const party = { partyType: "patient", partyId: refund.patient_id, partyName: refund.patient_name_snapshot || "Patient" };
    postJournal(db, {
      entryDate: refund.refund_date, referenceType: "billing_refund", referenceId: refund.id,
      documentNumber: refund.credit_note_number,
      description: `Credit note ${refund.credit_note_number}: ${refund.reason}`,
      cashFlowClass: "operating", actor: systemActor,
    }, [
      { accountId: account("sales_returns"), debit: refund.amount, memo: "Sales credit", ...party },
      { accountId: account(paymentAccountKey(refund.refund_method)), credit: refund.amount, memo: "Refund paid", ...party },
    ], { allowLockedPeriod: true });
  }

  const approvedExpenses = latestApprovedIds(db, "finance_expenses", "finance_expense_events", "expense_id");
  for (const id of approvedExpenses) {
    const expense = db.prepare("SELECT * FROM finance_expenses WHERE id=?").get(id);
    const party = { partyType: "payee", partyId: null, partyName: expense.payee };
    postJournal(db, {
      entryDate: expense.expense_date, referenceType: "finance_expense", referenceId: id,
      documentNumber: expense.external_reference, description: `${expense.category}: ${expense.description || expense.payee}`,
      cashFlowClass: expense.category === "equipment" ? "investing" : "operating", actor: systemActor,
    }, [
      { accountId: account(expenseAccountKey(expense.category)), debit: expense.amount, memo: expense.description, ...party },
      { accountId: account("accounts_payable"), credit: expense.amount, memo: "Expense payable", ...party },
    ], { allowLockedPeriod: true });
  }

  const expensePayments = db.prepare(`
    SELECT p.*,e.payee,e.external_reference AS expense_reference
    FROM finance_expense_payments p JOIN finance_expenses e ON e.id=p.expense_id ORDER BY p.id
  `).all();
  for (const payment of expensePayments) {
    const party = { partyType: "payee", partyId: null, partyName: payment.payee };
    postJournal(db, {
      entryDate: payment.payment_date, referenceType: "finance_expense_payment", referenceId: payment.id,
      documentNumber: payment.external_reference || payment.expense_reference,
      description: `Expense payment to ${payment.payee}`, cashFlowClass: "operating", actor: systemActor,
    }, [
      { accountId: account("accounts_payable"), debit: payment.amount, memo: "Expense payable settled", ...party },
      { accountId: account(paymentAccountKey(payment.payment_method)), credit: payment.amount, memo: "Payment made", ...party },
    ], { allowLockedPeriod: true });
  }

  const expenseReversals = db.prepare(`
    SELECT r.*,p.amount,p.payment_method,p.expense_id,e.payee
    FROM finance_expense_payment_reversals r
    JOIN finance_expense_payments p ON p.id=r.payment_id JOIN finance_expenses e ON e.id=p.expense_id ORDER BY r.id
  `).all();
  for (const reversal of expenseReversals) {
    const party = { partyType: "payee", partyId: null, partyName: reversal.payee };
    postJournal(db, {
      entryDate: reversal.reversal_date, referenceType: "finance_expense_payment_reversal", referenceId: reversal.id,
      description: `Expense payment reversal: ${reversal.reason}`, cashFlowClass: "operating", actor: systemActor,
    }, [
      { accountId: account(paymentAccountKey(reversal.payment_method)), debit: reversal.amount, memo: "Cash restored", ...party },
      { accountId: account("accounts_payable"), credit: reversal.amount, memo: "Expense payable reinstated", ...party },
    ], { allowLockedPeriod: true });
  }

  const approvedSuppliers = latestApprovedIds(db, "finance_supplier_invoices", "finance_supplier_invoice_events", "supplier_invoice_id");
  for (const id of approvedSuppliers) {
    const invoice = db.prepare(`SELECT i.*,
      COALESCE((SELECT SUM(quantity*unit_cost) FROM finance_supplier_invoice_lines WHERE supplier_invoice_id=i.id),0) AS stock_amount
      FROM finance_supplier_invoices i WHERE i.id=?`).get(id);
    const stockAmount = roundCurrency(invoice.stock_amount);
    const otherAmount = roundCurrency(invoice.other_amount);
    const total = roundCurrency(stockAmount + otherAmount);
    if (total <= 0) continue;
    const party = { partyType: "supplier", partyId: null, partyName: invoice.supplier_name };
    const debits = [];
    if (stockAmount > 0) debits.push({ accountId: account("inventory"), debit: stockAmount, memo: "Inventory purchased", ...party });
    if (otherAmount > 0) debits.push({ accountId: account("freight_expense"), debit: otherAmount, memo: "Freight and other purchase costs", ...party });
    postJournal(db, {
      entryDate: invoice.invoice_date, referenceType: "supplier_invoice", referenceId: id,
      documentNumber: invoice.invoice_number, description: `Supplier invoice ${invoice.invoice_number}`,
      cashFlowClass: "operating", actor: systemActor,
    }, [...debits, { accountId: account("accounts_payable"), credit: total, memo: "Supplier payable", ...party }], { allowLockedPeriod: true });
  }

  const supplierPayments = db.prepare(`
    SELECT p.*,i.supplier_name,i.invoice_number FROM finance_supplier_payments p
    JOIN finance_supplier_invoices i ON i.id=p.supplier_invoice_id ORDER BY p.id
  `).all();
  for (const payment of supplierPayments) {
    const party = { partyType: "supplier", partyId: null, partyName: payment.supplier_name };
    postJournal(db, {
      entryDate: payment.payment_date, referenceType: "supplier_payment", referenceId: payment.id,
      documentNumber: payment.external_reference || payment.invoice_number,
      description: `Supplier payment to ${payment.supplier_name}`, cashFlowClass: "operating", actor: systemActor,
    }, [
      { accountId: account("accounts_payable"), debit: payment.amount, memo: "Supplier payable settled", ...party },
      { accountId: account(paymentAccountKey(payment.payment_method)), credit: payment.amount, memo: "Payment made", ...party },
    ], { allowLockedPeriod: true });
  }

  const supplierReversals = db.prepare(`
    SELECT r.*,p.amount,p.payment_method,i.supplier_name FROM finance_supplier_payment_reversals r
    JOIN finance_supplier_payments p ON p.id=r.payment_id
    JOIN finance_supplier_invoices i ON i.id=p.supplier_invoice_id ORDER BY r.id
  `).all();
  for (const reversal of supplierReversals) {
    const party = { partyType: "supplier", partyId: null, partyName: reversal.supplier_name };
    postJournal(db, {
      entryDate: reversal.reversal_date, referenceType: "supplier_payment_reversal", referenceId: reversal.id,
      description: `Supplier payment reversal: ${reversal.reason}`, cashFlowClass: "operating", actor: systemActor,
    }, [
      { accountId: account(paymentAccountKey(reversal.payment_method)), debit: reversal.amount, memo: "Cash restored", ...party },
      { accountId: account("accounts_payable"), credit: reversal.amount, memo: "Supplier payable reinstated", ...party },
    ], { allowLockedPeriod: true });
  }

  const movements = db.prepare(`
    SELECT m.*,i.item_name,date(m.created_at,'+4 hours') AS business_date
    FROM inventory_movements m JOIN inventory i ON i.id=m.item_id
    WHERE m.unit_cost_snapshot IS NOT NULL AND m.unit_cost_snapshot > 0 ORDER BY m.id
  `).all();
  for (const movement of movements) {
    const action = financialAction(movement);
    if (!["sell", "wastage", "adjustment", "correction", "exceptional_correction", "override"].includes(action)) continue;
    let meta = {};
    try { meta = JSON.parse(movement.meta_json || "{}"); } catch { meta = {}; }
    if (action === "sell") {
      const billingId = Number(meta.billing_id || 0);
      if (!billingId || !db.prepare("SELECT id FROM billing WHERE id=? AND finalized_at IS NOT NULL AND voided_at IS NULL").get(billingId)) continue;
    }
    const amount = roundCurrency(Math.abs(Number(movement.quantity || 0)) * Number(movement.unit_cost_snapshot || 0));
    if (amount <= 0) continue;
    const isReversal = String(movement.action_type || "") === "reversal";
    let debitKey, creditKey, description;
    if (action === "sell") {
      debitKey = isReversal ? "inventory" : "cost_of_goods_sold";
      creditKey = isReversal ? "cost_of_goods_sold" : "inventory";
      description = isReversal ? "Supply cost reversal" : "Cost of supplies sold";
    } else if (action === "wastage") {
      debitKey = isReversal ? "inventory" : "wastage_expense";
      creditKey = isReversal ? "wastage_expense" : "inventory";
      description = isReversal ? "Wastage reversal" : "Inventory wastage";
    } else {
      const directionOut = Number(movement.next_quantity) < Number(movement.previous_quantity);
      const increase = isReversal ? directionOut : !directionOut;
      debitKey = increase ? "inventory" : "inventory_adjustment_expense";
      creditKey = increase ? "inventory_adjustment_income" : "inventory";
      description = increase ? "Inventory adjustment increase" : "Inventory adjustment loss";
    }
    postJournal(db, {
      entryDate: movement.business_date, referenceType: "inventory_movement", referenceId: movement.id,
      documentNumber: String(meta.receipt_reference || ""), description: `${description}: ${movement.item_name}`,
      cashFlowClass: "non_cash", actor: systemActor,
    }, [
      { accountId: account(debitKey), debit: amount, memo: movement.item_name },
      { accountId: account(creditKey), credit: amount, memo: movement.item_name },
    ], { allowLockedPeriod: true });
  }

  const countAfter = Number(db.prepare("SELECT COUNT(*) AS count FROM finance_journal_entries").get().count || 0);
  return { posted: countAfter - countBefore, total: countAfter };
}

module.exports = {
  assertOpenAccountingPeriod,
  paymentAccountKey,
  postJournal,
  reverseJournal,
  roundCurrency,
  syncOperationalLedger,
  systemAccount,
};
