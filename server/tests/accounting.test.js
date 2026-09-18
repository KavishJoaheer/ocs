const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-accounting-"));
process.env.DB_PATH = path.join(tempDir, "test.db");
process.env.NODE_ENV = "test";

const { createApp } = require("../src/app");
const { db } = require("../src/db");
const { getTodayLocal } = require("../src/lib/utils");
const { hashPassword } = require("../src/lib/security");

const app = createApp();
const today = getTodayLocal();
const from = `${today.slice(0, 7)}-01`;
const tokens = {};
let server;
let base;
let baselineIncome = 0;
let baselineExpenses = 0;
let baselineNetProfit = 0;
let baselineCashChange = 0;

async function api(method, route, role = "admin", body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[role]}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

before(async () => {
  server = await new Promise((resolve) => {
    const running = app.listen(0, "127.0.0.1", () => resolve(running));
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
  for (const role of ["admin", "accountant", "doctor"]) {
    db.prepare("INSERT INTO users(username,full_name,password_hash,role) VALUES(?,?,?,?)")
      .run(`accounting.${role}`, `Accounting ${role}`, hashPassword("AccountingTest!2026"), role);
    const login = await fetch(`${base}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `accounting.${role}`, password: "AccountingTest!2026" }),
    });
    tokens[role] = (await login.json()).token;
  }
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("accounting workspace is restricted and seeds a complete chart of accounts", async () => {
  const forbidden = await api("GET", `/accounting/workspace?from=${from}&to=${today}`, "doctor");
  assert.equal(forbidden.status, 403);
  const workspace = await api("GET", `/accounting/workspace?from=${from}&to=${today}`, "accountant");
  assert.equal(workspace.status, 200, JSON.stringify(workspace.data));
  assert.ok(workspace.data.accounts.length >= 35);
  for (const key of ["cash", "accounts_receivable", "inventory", "accounts_payable", "consultation_revenue", "cost_of_goods_sold", "retained_earnings"]) {
    assert.ok(workspace.data.accounts.some((row) => row.system_key === key), key);
  }
  assert.equal(workspace.data.statements.trial_balance.is_balanced, true);
  assert.equal(workspace.data.statements.balance_sheet.is_balanced, true);
  baselineIncome = workspace.data.statements.profit_and_loss.total_income;
  baselineExpenses = workspace.data.statements.profit_and_loss.total_expenses;
  baselineNetProfit = workspace.data.statements.profit_and_loss.net_profit;
  baselineCashChange = workspace.data.statements.cash_flow.net_cash_change;
});

test("final invoices, receipts and inventory cost post once into balanced journals", async () => {
  const doctorId = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get().id;
  const patientId = Number(db.prepare("INSERT INTO patients(full_name,first_name,last_name,patient_identifier,age,contact_number,patient_contact_number,address) VALUES('Ledger Patient','Ledger','Patient','LEDGER-1',30,'57000000','57000000','Test')").run().lastInsertRowid);
  const appointmentId = Number(db.prepare("INSERT INTO appointments(patient_id,doctor_id,appointment_date,appointment_time,status) VALUES(?,?,?,'09:00','completed')").run(patientId,doctorId,today).lastInsertRowid);
  const consultationId = Number(db.prepare("INSERT INTO consultations(appointment_id,patient_id,doctor_id,consultation_date,doctor_notes) VALUES(?,?,?,?, 'Ledger test')").run(appointmentId,patientId,doctorId,today).lastInsertRowid);
  const folderId = db.prepare("SELECT id FROM inventory_folders ORDER BY id LIMIT 1").get().id;
  const itemId = Number(db.prepare("INSERT INTO inventory(item_name,folder_id,quantity,minimum_quantity,unit,cost_price,selling_price) VALUES('Ledger Supply',?,8,1,'unit',10,25)").run(folderId).lastInsertRowid);
  const invoiceItems = [
    {description:"Day Consultation",type:"Sale",amount:2000,quantity:1,is_consultation_fee:true},
    {description:"Ledger Supply",type:"Sale",amount:50,quantity:2,inventory_item_id:itemId},
  ];
  const billId = Number(db.prepare(`INSERT INTO billing(consultation_id,patient_id,items,total_amount,status,invoice_number,patient_name_snapshot,consultation_date_snapshot,finalized_at)
    VALUES(?,?,?,2050,'paid','OCS-INV-LEDGER','Ledger Patient',?,CURRENT_TIMESTAMP)`).run(consultationId,patientId,JSON.stringify(invoiceItems),today).lastInsertRowid);
  db.prepare(`INSERT INTO inventory_movements(item_id,movement_type,action_type,quantity,previous_quantity,next_quantity,unit_cost_snapshot,unit_price_snapshot,valuation_basis,meta_json)
    VALUES(?,'out','stock_out',2,10,8,10,25,'batch_actual',?)`).run(itemId,JSON.stringify({billing_id:billId,stock_out_reason:"sale"}));
  const paymentId = Number(db.prepare(`INSERT INTO billing_payment_transactions(billing_id,amount,payment_method,payment_date,external_reference,operation_id,recorded_by_name,recorded_by_role)
    VALUES(?,2050,'cash',?,NULL,?,'Test','admin')`).run(billId,today,randomUUID()).lastInsertRowid);

  const first = await api("GET", `/accounting/workspace?from=${from}&to=${today}`, "admin");
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.statements.profit_and_loss.total_income, baselineIncome + 2050);
  assert.equal(first.data.statements.profit_and_loss.total_expenses, baselineExpenses + 20);
  assert.equal(first.data.statements.profit_and_loss.net_profit, baselineNetProfit + 2030);
  assert.equal(first.data.statements.cash_flow.net_cash_change, baselineCashChange + 2050);
  assert.equal(first.data.statements.trial_balance.is_balanced, true);
  assert.equal(first.data.statements.balance_sheet.is_balanced, true);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM finance_journal_entries
    WHERE (reference_type='billing_invoice' AND reference_id=?) OR (reference_type='billing_payment' AND reference_id=?)`).get(String(billId),String(paymentId)).count, 2);

  const retry = await api("GET", `/accounting/workspace?from=${from}&to=${today}`, "accountant");
  assert.equal(retry.status, 200);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM finance_journal_entries
    WHERE (reference_type='billing_invoice' AND reference_id=?) OR (reference_type='billing_payment' AND reference_id=?)`).get(String(billId),String(paymentId)).count, 2);
  assert.throws(() => db.prepare("UPDATE finance_journal_entries SET description='Tampered' WHERE reference_type='billing_invoice'").run(), /immutable/i);
  const postedInvoice = db.prepare("SELECT id FROM finance_journal_entries WHERE reference_type='billing_invoice' AND reference_id=?").get(String(billId));
  const receivable = db.prepare("SELECT id FROM finance_accounts WHERE system_key='accounts_receivable'").get();
  assert.throws(() => db.prepare("INSERT INTO finance_journal_lines(journal_entry_id,account_id,debit,credit) VALUES(?,?,1,0)").run(postedInvoice.id,receivable.id), /immutable/i);
});

test("manual journals require approval and preserve exact balanced ledger assertions", async () => {
  const workspace = (await api("GET", `/accounting/workspace?from=${from}&to=${today}`, "accountant")).data;
  const misc = workspace.accounts.find((row) => row.system_key === "expense_miscellaneous");
  const cash = workspace.accounts.find((row) => row.system_key === "cash");
  const submitted = await api("POST", "/accounting/manual-journals", "accountant", {
    entry_date: today,
    description: "Documented test accounting adjustment",
    cash_flow_class: "operating",
    operation_id: randomUUID(),
    lines: [
      { account_id: misc.id, debit: 50, credit: 0, memo: "Test expense" },
      { account_id: cash.id, debit: 0, credit: 50, memo: "Cash paid" },
    ],
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM finance_journal_entries WHERE reference_type='manual_journal'").get().count, 0);
  const approved = await api("POST", `/accounting/manual-journals/${submitted.data.id}/decision`, "admin", {
    action: "approved", note: "Reviewed against supporting evidence",
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const entry = db.prepare("SELECT * FROM finance_journal_entries WHERE id=?").get(approved.data.posted_entry_id);
  const totals = db.prepare("SELECT SUM(debit) AS debit,SUM(credit) AS credit FROM finance_journal_lines WHERE journal_entry_id=?").get(entry.id);
  assert.equal(totals.debit, 50);
  assert.equal(totals.credit, 50);
  const statements = (await api("GET", `/accounting/workspace?from=${from}&to=${today}`, "admin")).data.statements;
  assert.equal(statements.profit_and_loss.total_expenses, baselineExpenses + 70);
  assert.equal(statements.profit_and_loss.net_profit, baselineNetProfit + 1980);
  assert.equal(statements.trial_balance.is_balanced, true);
  assert.equal(statements.balance_sheet.is_balanced, true);
});

test("bank reconciliation only matches exact ledger movements", async () => {
  const workspace = (await api("GET", `/accounting/workspace?from=${from}&to=${today}`, "admin")).data;
  const cashBank = workspace.bank_accounts.find((row) => row.code === "1000");
  const imported = await api("POST", "/accounting/bank-statements", "accountant", {
    bank_account_id: cashBank.id,
    transaction_date: today,
    description: "Cash receipt OCS-INV-LEDGER",
    amount: 2050,
    external_reference: "CASH-DAY-1",
    operation_id: randomUUID(),
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  const reconciliation = await api("GET", `/accounting/bank-accounts/${cashBank.id}/reconciliation`, "accountant");
  const paymentLine = reconciliation.data.unmatched_book_lines.find((row) => Number(row.debit-row.credit) === 2050);
  assert.ok(paymentLine);
  const matched = await api("POST", `/accounting/bank-statements/${imported.data.id}/match`, "accountant", { journal_line_id: paymentLine.id });
  assert.equal(matched.status, 200, JSON.stringify(matched.data));
  assert.equal(matched.data.matched_journal_line_id, paymentLine.id);
});

test("assets, depreciation, payroll and tax create balanced controlled entries", async () => {
  const workspace = (await api("GET", `/accounting/workspace?from=${from}&to=${today}`, "admin")).data;
  const cash = workspace.accounts.find((row) => row.system_key === "cash");
  const asset = await api("POST", "/accounting/assets", "admin", {
    asset_code: "EQ-TEST-1", name: "Test equipment", acquisition_date: today,
    acquisition_cost: 1200, residual_value: 0, useful_life_months: 12,
    payment_account_id: cash.id, operation_id: randomUUID(),
  });
  assert.equal(asset.status, 201, JSON.stringify(asset.data));
  const journalCountBeforeDuplicate = db.prepare("SELECT COUNT(*) AS count FROM finance_journal_entries").get().count;
  const duplicateAsset = await api("POST", "/accounting/assets", "admin", {
    asset_code: "EQ-TEST-1", name: "Duplicate equipment", acquisition_date: today,
    acquisition_cost: 500, residual_value: 0, useful_life_months: 12,
    payment_account_id: cash.id, operation_id: randomUUID(),
  });
  assert.equal(duplicateAsset.status, 409);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM finance_journal_entries").get().count, journalCountBeforeDuplicate);

  const previous = new Date(`${today}T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth()-1);
  const periodMonth = previous.toISOString().slice(0,7);
  const depreciation = await api("POST", `/accounting/assets/${asset.data.id}/depreciation`, "admin", { period_month: periodMonth, operation_id: randomUUID() });
  assert.equal(depreciation.status, 201, JSON.stringify(depreciation.data));
  assert.equal(depreciation.data.amount, 100);

  const payroll = await api("POST", "/accounting/payroll", "admin", {
    period_month: today.slice(0,7), liability_date: today, payee: "Test Employee",
    gross_amount: 1000, tax_withheld: 100, other_deductions: 50, operation_id: randomUUID(),
  });
  assert.equal(payroll.status, 201, JSON.stringify(payroll.data));
  assert.equal(payroll.data.net_payable, 850);

  const tax = await api("POST", "/accounting/tax-obligations", "admin", {
    tax_type: "Corporate tax provision", period_key: today.slice(0,7),
    obligation_date: today, amount: 250, operation_id: randomUUID(),
  });
  assert.equal(tax.status, 201, JSON.stringify(tax.data));
  const finalWorkspace = await api("GET", `/accounting/workspace?from=${from}&to=${today}`, "admin");
  assert.equal(finalWorkspace.data.statements.trial_balance.is_balanced, true);
  assert.equal(finalWorkspace.data.statements.balance_sheet.is_balanced, true);
});

test("completed monthly close enables an immutable accounting period lock", async () => {
  const previous = new Date(`${today}T00:00:00Z`);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const month = previous.toISOString().slice(0, 7);
  db.prepare(`INSERT INTO finance_monthly_closings(month_key,readiness_snapshot_json,notes,operation_id,closed_by_name,closed_by_role)
    VALUES(?, '{}', 'Accounting integration close', ?, 'Accounting admin', 'admin')`).run(month, randomUUID());
  const locked = await api("POST", "/accounting/period-locks", "admin", {
    month_key: month,
    note: "Reviewed and approved accounting period",
    operation_id: randomUUID(),
  });
  assert.equal(locked.status, 201, JSON.stringify(locked.data));
  assert.throws(() => db.prepare("DELETE FROM finance_accounting_period_locks WHERE id=?").run(locked.data.id), /immutable/i);

  const workspace = (await api("GET", `/accounting/workspace?from=${month}-01&to=${today}`, "accountant")).data;
  const misc = workspace.accounts.find((row) => row.system_key === "expense_miscellaneous");
  const cash = workspace.accounts.find((row) => row.system_key === "cash");
  const blocked = await api("POST", "/accounting/manual-journals", "accountant", {
    entry_date: `${month}-15`,
    description: "Attempted entry into locked accounting period",
    operation_id: randomUUID(),
    lines: [
      { account_id: misc.id, debit: 10, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 10 },
    ],
  });
  assert.equal(blocked.status, 409);
});
