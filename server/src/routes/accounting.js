const crypto = require("crypto");
const express = require("express");

const { db } = require("../db");
const { getTodayLocal } = require("../lib/utils");
const {
  assertOpenAccountingPeriod,
  postJournal,
  reverseJournal,
  roundCurrency,
  syncOperationalLedger,
  systemAccount,
} = require("../lib/accountingLedger");

const router = express.Router();

function actor(req) {
  return {
    id: Number(req.auth?.id || 0) || null,
    name: String(req.auth?.full_name || req.auth?.username || "Finance"),
    role: String(req.auth?.role || "accountant"),
  };
}

function adminOnly(req, res, next) {
  if (req.auth?.role !== "admin") return res.status(403).json({ error: "Administrator approval is required." });
  return next();
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requireDate(value, label) {
  if (!validDate(value)) throw Object.assign(new Error(`${label} must be a valid date.`), { status: 400 });
  if (value > getTodayLocal()) throw Object.assign(new Error(`${label} cannot be in the future.`), { status: 400 });
  assertOpenAccountingPeriod(db, value);
}

function operationId(value, prefix) {
  const result = String(value || "").trim();
  if (result.length < 8) throw Object.assign(new Error(`${prefix} requires an operation reference.`), { status: 400 });
  return result;
}

function parseAmount(value, label, { allowZero = false } = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || (allowZero ? amount < 0 : amount <= 0) || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
    throw Object.assign(new Error(`${label} must be a valid currency amount.`), { status: 400 });
  }
  return roundCurrency(amount);
}

function parseManualLines(lines, { opening = false } = {}) {
  if (!Array.isArray(lines) || !lines.length) throw Object.assign(new Error("Add at least one journal line."), { status: 400 });
  const normalized = [];
  for (const raw of lines) {
    const accountId = Number(raw.account_id || 0);
    const account = db.prepare("SELECT * FROM finance_accounts WHERE id=? AND is_active=1").get(accountId);
    if (!account || (!opening && !account.allow_manual)) {
      throw Object.assign(new Error("Select an account that permits controlled manual postings."), { status: 400 });
    }
    const debit = Number(raw.debit || 0), credit = Number(raw.credit || 0);
    if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) {
      throw Object.assign(new Error("Each journal line must contain either a debit or a credit."), { status: 400 });
    }
    normalized.push({ accountId, debit: roundCurrency(debit), credit: roundCurrency(credit), memo: String(raw.memo || "").trim() });
  }
  return normalized;
}

function journalWithLines(id) {
  const entry = db.prepare("SELECT * FROM finance_journal_entries WHERE id=?").get(id);
  if (!entry) return null;
  return {
    ...entry,
    lines: db.prepare(`SELECT line.*,account.code AS account_code,account.name AS account_name
      FROM finance_journal_lines line JOIN finance_accounts account ON account.id=line.account_id
      WHERE line.journal_entry_id=? ORDER BY line.id`).all(id),
  };
}

function statementData(from, to) {
  const params = { from, to };
  const accounts = db.prepare(`
    SELECT account.*,
      COALESCE(SUM(CASE WHEN entry.entry_date < @from THEN line.debit-line.credit ELSE 0 END),0) AS opening_signed,
      COALESCE(SUM(CASE WHEN entry.entry_date BETWEEN @from AND @to THEN line.debit ELSE 0 END),0) AS period_debit,
      COALESCE(SUM(CASE WHEN entry.entry_date BETWEEN @from AND @to THEN line.credit ELSE 0 END),0) AS period_credit,
      COALESCE(SUM(CASE WHEN entry.entry_date <= @to THEN line.debit-line.credit ELSE 0 END),0) AS closing_signed
    FROM finance_accounts account
    LEFT JOIN finance_journal_lines line ON line.account_id=account.id
    LEFT JOIN finance_journal_entries entry ON entry.id=line.journal_entry_id AND entry.status='posted'
    WHERE account.is_active=1
    GROUP BY account.id ORDER BY account.code
  `).all(params).map((row) => ({
    ...row,
    opening_balance: roundCurrency(row.normal_side === "debit" ? row.opening_signed : -row.opening_signed),
    period_debit: roundCurrency(row.period_debit),
    period_credit: roundCurrency(row.period_credit),
    closing_balance: roundCurrency(row.normal_side === "debit" ? row.closing_signed : -row.closing_signed),
  }));
  const active = accounts.filter((row) => Math.abs(row.opening_balance) > 0.004 || row.period_debit > 0.004 || row.period_credit > 0.004 || Math.abs(row.closing_balance) > 0.004);
  const income = active.filter((row) => row.account_type === "income").map((row) => ({ ...row, amount: roundCurrency(row.period_credit - row.period_debit) }));
  const expenses = active.filter((row) => row.account_type === "expense").map((row) => ({ ...row, amount: roundCurrency(row.period_debit - row.period_credit) }));
  const totalIncome = roundCurrency(income.reduce((sum, row) => sum + row.amount, 0));
  const totalExpense = roundCurrency(expenses.reduce((sum, row) => sum + row.amount, 0));
  const assets = active.filter((row) => row.account_type === "asset").map((row) => ({ ...row, amount: roundCurrency(row.closing_signed) }));
  const liabilities = active.filter((row) => row.account_type === "liability").map((row) => ({ ...row, amount: roundCurrency(-row.closing_signed) }));
  const equity = active.filter((row) => row.account_type === "equity").map((row) => ({ ...row, amount: roundCurrency(-row.closing_signed) }));
  const cumulativeEarningsRow = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN account.account_type='income' THEN line.credit-line.debit ELSE 0 END),0)
    -COALESCE(SUM(CASE WHEN account.account_type='expense' THEN line.debit-line.credit ELSE 0 END),0) AS amount
    FROM finance_journal_lines line JOIN finance_journal_entries entry ON entry.id=line.journal_entry_id
    JOIN finance_accounts account ON account.id=line.account_id
    WHERE entry.status='posted' AND entry.entry_date<=?`).get(to);
  const cumulativeEarnings = roundCurrency(cumulativeEarningsRow.amount);
  const totalAssets = roundCurrency(assets.reduce((sum, row) => sum + row.amount, 0));
  const totalLiabilities = roundCurrency(liabilities.reduce((sum, row) => sum + row.amount, 0));
  const totalEquityBeforeEarnings = roundCurrency(equity.reduce((sum, row) => sum + row.amount, 0));
  const cashFlow = db.prepare(`
    SELECT entry.cash_flow_class,
      COALESCE(SUM(line.debit-line.credit),0) AS amount
    FROM finance_journal_lines line JOIN finance_journal_entries entry ON entry.id=line.journal_entry_id
    JOIN finance_accounts account ON account.id=line.account_id
    WHERE entry.status='posted' AND entry.entry_date BETWEEN ? AND ? AND account.subtype='cash'
    GROUP BY entry.cash_flow_class ORDER BY entry.cash_flow_class
  `).all(from, to).map((row) => ({ ...row, amount: roundCurrency(row.amount) }));
  const totalDebit = roundCurrency(active.reduce((sum, row) => sum + Number(row.period_debit || 0), 0));
  const totalCredit = roundCurrency(active.reduce((sum, row) => sum + Number(row.period_credit || 0), 0));
  return {
    from, to,
    trial_balance: { accounts: active, total_debit: totalDebit, total_credit: totalCredit, is_balanced: Math.abs(totalDebit-totalCredit) < 0.005 },
    profit_and_loss: { income, expenses, total_income: totalIncome, total_expenses: totalExpense, net_profit: roundCurrency(totalIncome-totalExpense) },
    balance_sheet: {
      assets, liabilities, equity,
      current_earnings: cumulativeEarnings,
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      total_equity: roundCurrency(totalEquityBeforeEarnings+cumulativeEarnings),
      is_balanced: Math.abs(totalAssets-totalLiabilities-totalEquityBeforeEarnings-cumulativeEarnings) < 0.005,
    },
    cash_flow: { activities: cashFlow, net_cash_change: roundCurrency(cashFlow.reduce((sum, row) => sum+row.amount,0)) },
  };
}

router.use((_req, _res, next) => {
  try { syncOperationalLedger(db); next(); }
  catch (error) { next(error); }
});

router.get("/workspace", (req, res) => {
  const to = validDate(req.query.to) ? String(req.query.to) : getTodayLocal();
  const from = validDate(req.query.from) ? String(req.query.from) : `${to.slice(0,7)}-01`;
  if (from > to) return res.status(400).json({ error: "Start date must be before end date." });
  const statements = statementData(from, to);
  const journals = db.prepare(`SELECT entry.*,
    (SELECT SUM(debit) FROM finance_journal_lines WHERE journal_entry_id=entry.id) AS amount
    FROM finance_journal_entries entry WHERE entry.status='posted' AND entry.entry_date BETWEEN ? AND ?
    ORDER BY entry.entry_date DESC,entry.id DESC LIMIT 100`).all(from,to);
  const manualRequests = db.prepare("SELECT * FROM finance_manual_journal_requests ORDER BY id DESC LIMIT 50").all();
  const bankAccounts = db.prepare(`SELECT bank.*,account.code,account.name,
    COALESCE((SELECT SUM(line.debit-line.credit) FROM finance_journal_lines line
      JOIN finance_journal_entries entry ON entry.id=line.journal_entry_id
      WHERE line.account_id=bank.account_id AND entry.status='posted' AND entry.entry_date<=?),0) AS book_balance,
    COALESCE((SELECT SUM(statement.amount) FROM finance_bank_statement_lines statement
      WHERE statement.bank_account_id=bank.id AND statement.transaction_date<=?),0) AS statement_balance,
    (SELECT COUNT(*) FROM finance_bank_statement_lines statement WHERE statement.bank_account_id=bank.id AND statement.matched_journal_line_id IS NULL) AS unmatched_count
    FROM finance_bank_accounts bank JOIN finance_accounts account ON account.id=bank.account_id
    WHERE bank.is_active=1 ORDER BY account.code`).all(to,to).map((row)=>({...row,book_balance:roundCurrency(row.book_balance),statement_balance:roundCurrency(row.statement_balance)}));
  const assets = db.prepare(`SELECT asset.*,
    COALESCE((SELECT SUM(amount) FROM finance_asset_depreciation WHERE fixed_asset_id=asset.id),0) AS accumulated_depreciation
    FROM finance_fixed_assets asset ORDER BY acquisition_date DESC,id DESC`).all().map((row)=>({...row,book_value:roundCurrency(row.acquisition_cost-row.accumulated_depreciation)}));
  const payroll = db.prepare("SELECT * FROM finance_payroll_runs ORDER BY period_month DESC,id DESC LIMIT 50").all();
  const taxes = db.prepare("SELECT * FROM finance_tax_obligations ORDER BY obligation_date DESC,id DESC LIMIT 50").all();
  const locks = db.prepare("SELECT * FROM finance_accounting_period_locks ORDER BY month_key DESC").all();
  return res.json({
    accounts: db.prepare("SELECT * FROM finance_accounts WHERE is_active=1 ORDER BY code").all(),
    statements, journals, manual_requests: manualRequests,
    bank_accounts: bankAccounts, assets, payroll_runs: payroll, tax_obligations: taxes, period_locks: locks,
  });
});

router.get("/journals/:id", (req,res) => {
  const journal = journalWithLines(Number(req.params.id));
  return journal ? res.json(journal) : res.status(404).json({ error: "Journal not found." });
});

router.post("/accounts", adminOnly, (req,res) => {
  const code=String(req.body.code||"").trim(), name=String(req.body.name||"").trim();
  const type=String(req.body.account_type||"").trim(), normal=String(req.body.normal_side||"").trim();
  if (!/^\d{3,8}$/.test(code)||name.length<3||!["asset","liability","equity","income","expense"].includes(type)||!["debit","credit"].includes(normal)) {
    return res.status(400).json({error:"Enter a valid account code, name, type and normal balance."});
  }
  try {
    const result=db.prepare("INSERT INTO finance_accounts(code,name,account_type,subtype,normal_side,allow_manual) VALUES(?,?,?,?,?,1)").run(code,name,type,String(req.body.subtype||"custom"),normal);
    return res.status(201).json(db.prepare("SELECT * FROM finance_accounts WHERE id=?").get(result.lastInsertRowid));
  } catch { return res.status(409).json({error:"That account code already exists."}); }
});

router.post("/opening-balances", adminOnly, (req,res,next) => {
  try {
    const entryDate=String(req.body.entry_date||""); requireDate(entryDate,"Opening balance date");
    const lines=parseManualLines(req.body.lines,{opening:true});
    const net=roundCurrency(lines.reduce((sum,line)=>sum+line.debit-line.credit,0));
    if (Math.abs(net)>0.004) lines.push({accountId:systemAccount(db,"opening_balance_equity").id,debit:net<0?-net:0,credit:net>0?net:0,memo:"Opening balance offset"});
    const entry=postJournal(db,{entryDate,referenceType:"opening_balance",referenceId:operationId(req.body.operation_id,"Opening balance"),description:String(req.body.description||"Opening balances"),cashFlowClass:"financing",operationId:req.body.operation_id,actor:actor(req)},lines);
    return res.status(201).json(journalWithLines(entry.id));
  } catch(error){next(error);}
});

router.post("/manual-journals", (req,res,next) => {
  try {
    const entryDate=String(req.body.entry_date||""); requireDate(entryDate,"Journal date");
    const description=String(req.body.description||"").trim(); if(description.length<10) throw Object.assign(new Error("Add a clear journal explanation."),{status:400});
    const lines=parseManualLines(req.body.lines);
    const debit=roundCurrency(lines.reduce((sum,line)=>sum+line.debit,0)),credit=roundCurrency(lines.reduce((sum,line)=>sum+line.credit,0));
    if(Math.abs(debit-credit)>0.004) throw Object.assign(new Error("Manual journal debits and credits must balance."),{status:400});
    const who=actor(req),op=operationId(req.body.operation_id,"Manual journal");
    const result=db.prepare(`INSERT INTO finance_manual_journal_requests(entry_date,description,cash_flow_class,lines_json,operation_id,submitted_by_user_id,submitted_by_name)
      VALUES(?,?,?,?,?,?,?)`).run(entryDate,description,String(req.body.cash_flow_class||"non_cash"),JSON.stringify(lines),op,who.id,who.name);
    return res.status(201).json(db.prepare("SELECT * FROM finance_manual_journal_requests WHERE id=?").get(result.lastInsertRowid));
  } catch(error){if(String(error.code||"").includes("CONSTRAINT")) return res.status(409).json({error:"This journal operation was already submitted."});next(error);}
});

router.post("/manual-journals/:id/decision", adminOnly, (req,res,next) => {
  try {
    const request=db.prepare("SELECT * FROM finance_manual_journal_requests WHERE id=?").get(Number(req.params.id));
    if(!request) return res.status(404).json({error:"Journal request not found."});
    if(request.status!=="submitted") return res.status(409).json({error:"This journal request has already been decided."});
    const action=String(req.body.action||""); const note=String(req.body.note||"").trim();
    if(!["approved","rejected"].includes(action)||note.length<8) return res.status(400).json({error:"Select approve or reject and add a meaningful note."});
    const who=actor(req);
    let posted=null;
    const decide = (postedEntry = null) => db.prepare("UPDATE finance_manual_journal_requests SET status=?,note=?,decided_by_user_id=?,decided_by_name=?,decided_at=CURRENT_TIMESTAMP,posted_entry_id=? WHERE id=?")
      .run(action,note,who.id,who.name,postedEntry?.id||null,request.id);
    if(action==="approved") posted=postJournal(db,{entryDate:request.entry_date,referenceType:"manual_journal",referenceId:request.id,description:request.description,cashFlowClass:request.cash_flow_class,operationId:`approved-${request.operation_id}`,actor:who},JSON.parse(request.lines_json),{afterPost:decide});
    else decide();
    return res.json(db.prepare("SELECT * FROM finance_manual_journal_requests WHERE id=?").get(request.id));
  } catch(error){next(error);}
});

router.post("/journals/:id/reversal", adminOnly, (req,res,next) => {
  try {
    const date=String(req.body.entry_date||"");requireDate(date,"Reversal date");
    const reason=String(req.body.reason||"").trim();if(reason.length<10) throw Object.assign(new Error("Add a meaningful reversal reason."),{status:400});
    const entry=reverseJournal(db,Number(req.params.id),{entryDate:date,reason,operationId:operationId(req.body.operation_id,"Reversal"),actor:actor(req)});
    return res.status(201).json(journalWithLines(entry.id));
  }catch(error){next(error);}
});

router.post("/bank-statements", (req,res,next) => {
  try {
    const bankId=Number(req.body.bank_account_id); const bank=db.prepare("SELECT * FROM finance_bank_accounts WHERE id=? AND is_active=1").get(bankId);
    if(!bank) return res.status(400).json({error:"Select a valid cash or bank account."});
    const date=String(req.body.transaction_date||"");requireDate(date,"Statement transaction date");
    const amount=Number(req.body.amount);if(!Number.isFinite(amount)||amount===0) return res.status(400).json({error:"Statement amount cannot be zero."});
    const description=String(req.body.description||"").trim();if(description.length<3)return res.status(400).json({error:"Add the statement description."});
    const who=actor(req);const result=db.prepare(`INSERT INTO finance_bank_statement_lines(bank_account_id,transaction_date,description,amount,external_reference,operation_id,imported_by_user_id,imported_by_name)
      VALUES(?,?,?,?,?,?,?,?)`).run(bankId,date,description,roundCurrency(amount),String(req.body.external_reference||""),operationId(req.body.operation_id,"Statement line"),who.id,who.name);
    return res.status(201).json(db.prepare("SELECT * FROM finance_bank_statement_lines WHERE id=?").get(result.lastInsertRowid));
  }catch(error){next(error);}
});

router.get("/bank-accounts/:id/reconciliation", (req,res) => {
  const bank=db.prepare(`SELECT bank.*,account.code,account.name FROM finance_bank_accounts bank JOIN finance_accounts account ON account.id=bank.account_id WHERE bank.id=?`).get(Number(req.params.id));
  if(!bank)return res.status(404).json({error:"Cash or bank account not found."});
  const statements=db.prepare("SELECT * FROM finance_bank_statement_lines WHERE bank_account_id=? ORDER BY transaction_date DESC,id DESC LIMIT 250").all(bank.id);
  const bookLines=db.prepare(`SELECT line.*,entry.entry_date,entry.document_number,entry.description AS entry_description,account.name AS account_name
    FROM finance_journal_lines line JOIN finance_journal_entries entry ON entry.id=line.journal_entry_id JOIN finance_accounts account ON account.id=line.account_id
    WHERE line.account_id=? AND entry.status='posted' AND line.id NOT IN (SELECT matched_journal_line_id FROM finance_bank_statement_lines WHERE matched_journal_line_id IS NOT NULL)
    ORDER BY entry.entry_date DESC,line.id DESC LIMIT 250`).all(bank.account_id);
  return res.json({bank,statements,unmatched_book_lines:bookLines});
});

router.post("/bank-statements/:id/match", (req,res) => {
  const statement=db.prepare("SELECT * FROM finance_bank_statement_lines WHERE id=?").get(Number(req.params.id));
  if(!statement)return res.status(404).json({error:"Statement line not found."});
  if(statement.matched_journal_line_id)return res.status(409).json({error:"Statement line is already matched."});
  const line=db.prepare(`SELECT line.*,entry.entry_date,account.id AS bank_account_ledger_id FROM finance_journal_lines line
    JOIN finance_journal_entries entry ON entry.id=line.journal_entry_id JOIN finance_bank_accounts bank ON bank.account_id=line.account_id
    JOIN finance_accounts account ON account.id=line.account_id WHERE line.id=? AND bank.id=? AND entry.status='posted'`).get(Number(req.body.journal_line_id),statement.bank_account_id);
  if(!line)return res.status(400).json({error:"Select an unmatched ledger transaction from the same account."});
  const ledgerAmount=roundCurrency(line.debit-line.credit);
  if(Math.abs(ledgerAmount-Number(statement.amount))>0.004)return res.status(409).json({error:"Statement and ledger amounts must match exactly."});
  const who=actor(req);db.prepare("UPDATE finance_bank_statement_lines SET matched_journal_line_id=?,matched_by_user_id=?,matched_by_name=?,matched_at=CURRENT_TIMESTAMP WHERE id=? AND matched_journal_line_id IS NULL")
    .run(line.id,who.id,who.name,statement.id);
  return res.json(db.prepare("SELECT * FROM finance_bank_statement_lines WHERE id=?").get(statement.id));
});

router.post("/assets", adminOnly, (req,res,next) => {
  try {
    const date=String(req.body.acquisition_date||"");requireDate(date,"Acquisition date");
    const cost=parseAmount(req.body.acquisition_cost,"Acquisition cost"),residual=parseAmount(req.body.residual_value||0,"Residual value",{allowZero:true});
    const months=Number(req.body.useful_life_months);if(!Number.isInteger(months)||months<1||residual>=cost)return res.status(400).json({error:"Useful life and residual value are invalid."});
    const paymentAccount=db.prepare("SELECT * FROM finance_accounts WHERE id=? AND is_active=1").get(Number(req.body.payment_account_id));
    if(!paymentAccount||!["cash","payable"].includes(paymentAccount.subtype))return res.status(400).json({error:"Select a cash/bank or payable account."});
    const op=operationId(req.body.operation_id,"Fixed asset");const who=actor(req);let assetId;
    postJournal(db,{entryDate:date,referenceType:"fixed_asset_acquisition",referenceId:op,documentNumber:String(req.body.asset_code||""),description:`Asset purchase: ${String(req.body.name||"")}`,cashFlowClass:paymentAccount.subtype==="cash"?"investing":"non_cash",operationId:`entry-${op}`,actor:who},[
      {accountId:systemAccount(db,"fixed_assets").id,debit:cost,memo:"Asset acquired"},{accountId:paymentAccount.id,credit:cost,memo:"Asset funding"}
    ],{afterPost:(entry)=>{assetId=Number(db.prepare(`INSERT INTO finance_fixed_assets(asset_code,name,acquisition_date,acquisition_cost,residual_value,useful_life_months,payment_account_id,acquisition_entry_id,operation_id,created_by_user_id,created_by_name)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(String(req.body.asset_code||"").trim(),String(req.body.name||"").trim(),date,cost,residual,months,paymentAccount.id,entry.id,op,who.id,who.name).lastInsertRowid)}});
    return res.status(201).json(db.prepare("SELECT * FROM finance_fixed_assets WHERE id=?").get(assetId));
  }catch(error){next(error);}
});

router.post("/assets/:id/depreciation", adminOnly, (req,res,next) => {
  try {
    const asset=db.prepare("SELECT * FROM finance_fixed_assets WHERE id=? AND status='active'").get(Number(req.params.id));if(!asset)return res.status(404).json({error:"Active asset not found."});
    const month=String(req.body.period_month||"");if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({error:"Select a valid depreciation month."});
    const existing=Number(db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM finance_asset_depreciation WHERE fixed_asset_id=?").get(asset.id).total);
    const remaining=roundCurrency(asset.acquisition_cost-asset.residual_value-existing);if(remaining<=0)return res.status(409).json({error:"This asset is fully depreciated."});
    const amount=Math.min(remaining,roundCurrency((asset.acquisition_cost-asset.residual_value)/asset.useful_life_months));
    const date=`${month}-${new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()}`;requireDate(date,"Depreciation date");
    const op=operationId(req.body.operation_id,"Depreciation");let depreciationId;postJournal(db,{entryDate:date,referenceType:"asset_depreciation",referenceId:`${asset.id}:${month}`,description:`Depreciation: ${asset.name} (${month})`,cashFlowClass:"non_cash",operationId:`entry-${op}`,actor:actor(req)},[
      {accountId:systemAccount(db,"depreciation_expense").id,debit:amount,memo:asset.name},{accountId:systemAccount(db,"accumulated_depreciation").id,credit:amount,memo:asset.name}
    ],{afterPost:(entry)=>{depreciationId=Number(db.prepare("INSERT INTO finance_asset_depreciation(fixed_asset_id,period_month,amount,journal_entry_id,operation_id) VALUES(?,?,?,?,?)").run(asset.id,month,amount,entry.id,op).lastInsertRowid)}});
    return res.status(201).json(db.prepare("SELECT * FROM finance_asset_depreciation WHERE id=?").get(depreciationId));
  }catch(error){next(error);}
});

router.post("/payroll", adminOnly, (req,res,next) => {
  try {
    const month=String(req.body.period_month||"");if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({error:"Select a valid payroll month."});
    const date=String(req.body.liability_date||`${month}-01`);requireDate(date,"Payroll liability date");
    const gross=parseAmount(req.body.gross_amount,"Gross payroll"),tax=parseAmount(req.body.tax_withheld||0,"Tax withheld",{allowZero:true}),deductions=parseAmount(req.body.other_deductions||0,"Other deductions",{allowZero:true});
    const net=roundCurrency(gross-tax-deductions);if(net<0)return res.status(400).json({error:"Payroll deductions cannot exceed gross payroll."});
    const payee=String(req.body.payee||"").trim();if(payee.length<2)return res.status(400).json({error:"Enter the employee or payroll payee."});
    const op=operationId(req.body.operation_id,"Payroll");const who=actor(req);const credits=[{accountId:systemAccount(db,"payroll_payable").id,credit:net,memo:`Net pay: ${payee}`}];
    if(tax>0)credits.push({accountId:systemAccount(db,"tax_payable").id,credit:tax,memo:`Payroll tax: ${payee}`});
    if(deductions>0)credits.push({accountId:systemAccount(db,"payroll_deductions").id,credit:deductions,memo:`Payroll deductions: ${payee}`});
    let payrollId;postJournal(db,{entryDate:date,referenceType:"payroll_liability",referenceId:op,description:`Payroll ${month}: ${payee}`,cashFlowClass:"non_cash",operationId:`entry-${op}`,actor:who},[{accountId:systemAccount(db,"expense_salary").id,debit:gross,memo:`Gross payroll: ${payee}`},...credits],{afterPost:(entry)=>{payrollId=Number(db.prepare(`INSERT INTO finance_payroll_runs(period_month,payee,gross_amount,tax_withheld,other_deductions,net_payable,liability_entry_id,operation_id,created_by_user_id,created_by_name)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(month,payee,gross,tax,deductions,net,entry.id,op,who.id,who.name).lastInsertRowid)}});
    return res.status(201).json(db.prepare("SELECT * FROM finance_payroll_runs WHERE id=?").get(payrollId));
  }catch(error){next(error);}
});

router.post("/payroll/:id/payment", adminOnly, (req,res,next) => {
  try {
    const run=db.prepare("SELECT * FROM finance_payroll_runs WHERE id=?").get(Number(req.params.id));if(!run)return res.status(404).json({error:"Payroll run not found."});if(run.payment_entry_id)return res.status(409).json({error:"Payroll is already paid."});
    const date=String(req.body.payment_date||"");requireDate(date,"Payroll payment date");const account=db.prepare("SELECT * FROM finance_accounts WHERE id=? AND subtype='cash'").get(Number(req.body.payment_account_id));if(!account)return res.status(400).json({error:"Select a cash or bank account."});
    const op=operationId(req.body.operation_id,"Payroll payment");postJournal(db,{entryDate:date,referenceType:"payroll_payment",referenceId:run.id,description:`Payroll payment: ${run.payee}`,cashFlowClass:"operating",operationId:op,actor:actor(req)},[{accountId:systemAccount(db,"payroll_payable").id,debit:run.net_payable,memo:run.payee},{accountId:account.id,credit:run.net_payable,memo:"Payroll paid"}],{afterPost:(entry)=>db.prepare("UPDATE finance_payroll_runs SET payment_entry_id=?,payment_date=?,payment_account_id=? WHERE id=?").run(entry.id,date,account.id,run.id)});return res.json(db.prepare("SELECT * FROM finance_payroll_runs WHERE id=?").get(run.id));
  }catch(error){next(error);}
});

router.post("/tax-obligations", adminOnly, (req,res,next) => {
  try {
    const date=String(req.body.obligation_date||"");requireDate(date,"Tax obligation date");const amount=parseAmount(req.body.amount,"Tax amount");
    const type=String(req.body.tax_type||"").trim(),period=String(req.body.period_key||"").trim();if(type.length<2||period.length<4)return res.status(400).json({error:"Enter the tax type and applicable period."});
    const op=operationId(req.body.operation_id,"Tax obligation");const who=actor(req);let taxId;postJournal(db,{entryDate:date,referenceType:"tax_obligation",referenceId:op,description:`${type} tax obligation for ${period}`,cashFlowClass:"non_cash",operationId:`entry-${op}`,actor:who},[{accountId:systemAccount(db,"tax_expense").id,debit:amount,memo:type},{accountId:systemAccount(db,"tax_payable").id,credit:amount,memo:type}],{afterPost:(entry)=>{taxId=Number(db.prepare(`INSERT INTO finance_tax_obligations(tax_type,period_key,obligation_date,amount,liability_entry_id,operation_id,created_by_user_id,created_by_name)
      VALUES(?,?,?,?,?,?,?,?)`).run(type,period,date,amount,entry.id,op,who.id,who.name).lastInsertRowid)}});return res.status(201).json(db.prepare("SELECT * FROM finance_tax_obligations WHERE id=?").get(taxId));
  }catch(error){next(error);}
});

router.post("/tax-obligations/:id/payment", adminOnly, (req,res,next) => {
  try {
    const tax=db.prepare("SELECT * FROM finance_tax_obligations WHERE id=?").get(Number(req.params.id));if(!tax)return res.status(404).json({error:"Tax obligation not found."});if(tax.payment_entry_id)return res.status(409).json({error:"Tax obligation is already paid."});
    const date=String(req.body.payment_date||"");requireDate(date,"Tax payment date");const account=db.prepare("SELECT * FROM finance_accounts WHERE id=? AND subtype='cash'").get(Number(req.body.payment_account_id));if(!account)return res.status(400).json({error:"Select a cash or bank account."});
    const op=operationId(req.body.operation_id,"Tax payment");postJournal(db,{entryDate:date,referenceType:"tax_payment",referenceId:tax.id,description:`${tax.tax_type} tax payment`,cashFlowClass:"operating",operationId:op,actor:actor(req)},[{accountId:systemAccount(db,"tax_payable").id,debit:tax.amount,memo:tax.tax_type},{accountId:account.id,credit:tax.amount,memo:"Tax paid"}],{afterPost:(entry)=>db.prepare("UPDATE finance_tax_obligations SET payment_entry_id=?,payment_date=?,payment_account_id=? WHERE id=?").run(entry.id,date,account.id,tax.id)});return res.json(db.prepare("SELECT * FROM finance_tax_obligations WHERE id=?").get(tax.id));
  }catch(error){next(error);}
});

router.post("/period-locks", adminOnly, (req,res,next) => {
  try {
    const month=String(req.body.month_key||"");if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month>=getTodayLocal().slice(0,7))return res.status(400).json({error:"Only a completed month can be locked."});
    const note=String(req.body.note||"").trim();if(note.length<10)return res.status(400).json({error:"Add a meaningful period-lock note."});
    const financeClose=db.prepare("SELECT id FROM finance_monthly_closings WHERE month_key=?").get(month);if(!financeClose)return res.status(409).json({error:"Complete the Finance monthly close before locking the accounting period."});
    const pending=db.prepare("SELECT COUNT(*) AS count FROM finance_manual_journal_requests WHERE status='submitted' AND substr(entry_date,1,7)=?").get(month).count;if(pending)return res.status(409).json({error:"Resolve all manual journal requests for this period first."});
    syncOperationalLedger(db);const who=actor(req);const result=db.prepare("INSERT INTO finance_accounting_period_locks(month_key,note,operation_id,locked_by_user_id,locked_by_name) VALUES(?,?,?,?,?)")
      .run(month,note,operationId(req.body.operation_id,"Period lock"),who.id,who.name);return res.status(201).json(db.prepare("SELECT * FROM finance_accounting_period_locks WHERE id=?").get(result.lastInsertRowid));
  }catch(error){next(error);}
});

router.use((error, _req, res, _next) => {
  const constraint = String(error?.code || "").startsWith("SQLITE_CONSTRAINT");
  const status = Number(error?.status || (constraint ? 409 : 500));
  const message = String(error?.message || "Unexpected accounting error.");
  return res.status(status).json({ error: status >= 500 ? `Accounting error: ${message}` : message });
});

module.exports = router;
