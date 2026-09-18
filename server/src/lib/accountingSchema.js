const DEFAULT_ACCOUNTS = [
  ["1000", "Cash on hand", "asset", "cash", "cash", "debit", 0],
  ["1010", "Juice clearing", "asset", "cash", "juice", "debit", 0],
  ["1020", "Card clearing", "asset", "cash", "card", "debit", 0],
  ["1030", "IB / online bank", "asset", "cash", "ib", "debit", 0],
  ["1040", "Bank transfer clearing", "asset", "cash", "bank_transfer", "debit", 0],
  ["1050", "Cheques in hand", "asset", "cash", "cheque", "debit", 0],
  ["1100", "Accounts receivable", "asset", "receivable", "accounts_receivable", "debit", 0],
  ["1200", "Inventory", "asset", "inventory", "inventory", "debit", 0],
  ["1500", "Property and equipment", "asset", "fixed_asset", "fixed_assets", "debit", 0],
  ["1510", "Accumulated depreciation", "asset", "contra_asset", "accumulated_depreciation", "credit", 0],
  ["2000", "Accounts payable", "liability", "payable", "accounts_payable", "credit", 0],
  ["2100", "Payroll payable", "liability", "payroll", "payroll_payable", "credit", 0],
  ["2110", "Tax payable", "liability", "tax", "tax_payable", "credit", 0],
  ["2120", "Other payroll deductions payable", "liability", "payroll", "payroll_deductions", "credit", 0],
  ["3000", "Opening balance equity", "equity", "opening_balance", "opening_balance_equity", "credit", 0],
  ["3100", "Retained earnings", "equity", "retained_earnings", "retained_earnings", "credit", 0],
  ["4000", "Consultation revenue", "income", "sales", "consultation_revenue", "credit", 0],
  ["4010", "Supply revenue", "income", "sales", "supply_revenue", "credit", 0],
  ["4020", "Service and other revenue", "income", "sales", "other_revenue", "credit", 0],
  ["4090", "Sales returns and credits", "income", "contra_income", "sales_returns", "debit", 0],
  ["4900", "Inventory adjustment income", "income", "other_income", "inventory_adjustment_income", "credit", 0],
  ["5000", "Cost of supplies sold", "expense", "cost_of_sales", "cost_of_goods_sold", "debit", 0],
  ["5100", "Inventory wastage", "expense", "inventory_loss", "wastage_expense", "debit", 0],
  ["5110", "Inventory adjustment loss", "expense", "inventory_loss", "inventory_adjustment_expense", "debit", 0],
  ["5120", "Freight and purchasing costs", "expense", "cost_of_sales", "freight_expense", "debit", 0],
  ["6000", "Salaries", "expense", "operating_expense", "expense_salary", "debit", 0],
  ["6010", "Doctor commission", "expense", "operating_expense", "expense_doctor_commission", "debit", 0],
  ["6020", "Transport benefits", "expense", "operating_expense", "expense_transport_benefit", "debit", 0],
  ["6030", "Fuel", "expense", "operating_expense", "expense_fuel", "debit", 0],
  ["6040", "Rent", "expense", "operating_expense", "expense_rent", "debit", 0],
  ["6050", "Utilities", "expense", "operating_expense", "expense_utilities", "debit", 0],
  ["6060", "Bank and card fees", "expense", "operating_expense", "expense_bank_card_fee", "debit", 0],
  ["6070", "Marketing", "expense", "operating_expense", "expense_marketing", "debit", 0],
  ["6080", "Professional fees", "expense", "operating_expense", "expense_professional_fee", "debit", 0],
  ["6090", "Miscellaneous expense", "expense", "operating_expense", "expense_miscellaneous", "debit", 1],
  ["6100", "Depreciation expense", "expense", "depreciation", "depreciation_expense", "debit", 0],
  ["6110", "Tax expense", "expense", "tax", "tax_expense", "debit", 0],
];

function ensureAccountingSchema(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS finance_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
        subtype TEXT NOT NULL DEFAULT '',
        system_key TEXT UNIQUE,
        normal_side TEXT NOT NULL CHECK (normal_side IN ('debit','credit')),
        allow_manual INTEGER NOT NULL DEFAULT 1 CHECK (allow_manual IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS finance_journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date TEXT NOT NULL,
        reference_type TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        document_number TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL,
        cash_flow_class TEXT NOT NULL DEFAULT 'operating'
          CHECK (cash_flow_class IN ('operating','investing','financing','non_cash')),
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
        operation_id TEXT NOT NULL UNIQUE,
        reversal_of_entry_id INTEGER,
        created_by_user_id INTEGER,
        created_by_name TEXT NOT NULL DEFAULT '',
        created_by_role TEXT NOT NULL DEFAULT '',
        posted_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (reference_type, reference_id),
        FOREIGN KEY (reversal_of_entry_id) REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_finance_journals_date ON finance_journal_entries(entry_date, id);
      CREATE TABLE IF NOT EXISTS finance_journal_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_entry_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        debit REAL NOT NULL DEFAULT 0,
        credit REAL NOT NULL DEFAULT 0,
        memo TEXT NOT NULL DEFAULT '',
        party_type TEXT NOT NULL DEFAULT '',
        party_id TEXT,
        party_name TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (journal_entry_id) REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
        FOREIGN KEY (account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT,
        CHECK (debit >= 0 AND credit >= 0 AND ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)))
      );
      CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_entry ON finance_journal_lines(journal_entry_id, id);
      CREATE INDEX IF NOT EXISTS idx_finance_journal_lines_account ON finance_journal_lines(account_id, journal_entry_id);
      CREATE TABLE IF NOT EXISTS finance_manual_journal_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date TEXT NOT NULL,
        description TEXT NOT NULL,
        cash_flow_class TEXT NOT NULL DEFAULT 'non_cash'
          CHECK (cash_flow_class IN ('operating','investing','financing','non_cash')),
        lines_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
        note TEXT NOT NULL DEFAULT '',
        operation_id TEXT NOT NULL UNIQUE,
        submitted_by_user_id INTEGER,
        submitted_by_name TEXT NOT NULL,
        decided_by_user_id INTEGER,
        decided_by_name TEXT NOT NULL DEFAULT '',
        decided_at TEXT,
        posted_entry_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (posted_entry_id) REFERENCES finance_journal_entries(id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS finance_bank_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        institution_name TEXT NOT NULL DEFAULT '',
        account_reference TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS finance_bank_statement_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bank_account_id INTEGER NOT NULL,
        transaction_date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount != 0),
        external_reference TEXT NOT NULL DEFAULT '',
        operation_id TEXT NOT NULL UNIQUE,
        matched_journal_line_id INTEGER UNIQUE,
        imported_by_user_id INTEGER,
        imported_by_name TEXT NOT NULL DEFAULT '',
        matched_by_user_id INTEGER,
        matched_by_name TEXT NOT NULL DEFAULT '',
        matched_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bank_account_id) REFERENCES finance_bank_accounts(id) ON DELETE RESTRICT,
        FOREIGN KEY (matched_journal_line_id) REFERENCES finance_journal_lines(id) ON DELETE RESTRICT,
        FOREIGN KEY (imported_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (matched_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_finance_bank_statement_date ON finance_bank_statement_lines(bank_account_id, transaction_date);
      CREATE TABLE IF NOT EXISTS finance_fixed_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        acquisition_date TEXT NOT NULL,
        acquisition_cost REAL NOT NULL CHECK (acquisition_cost > 0),
        residual_value REAL NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
        useful_life_months INTEGER NOT NULL CHECK (useful_life_months > 0),
        payment_account_id INTEGER,
        acquisition_entry_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disposed')),
        operation_id TEXT NOT NULL UNIQUE,
        created_by_user_id INTEGER,
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (payment_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT,
        FOREIGN KEY (acquisition_entry_id) REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS finance_asset_depreciation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fixed_asset_id INTEGER NOT NULL,
        period_month TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        journal_entry_id INTEGER NOT NULL UNIQUE,
        operation_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (fixed_asset_id, period_month),
        FOREIGN KEY (fixed_asset_id) REFERENCES finance_fixed_assets(id) ON DELETE RESTRICT,
        FOREIGN KEY (journal_entry_id) REFERENCES finance_journal_entries(id) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS finance_payroll_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_month TEXT NOT NULL,
        payee TEXT NOT NULL,
        gross_amount REAL NOT NULL CHECK (gross_amount > 0),
        tax_withheld REAL NOT NULL DEFAULT 0 CHECK (tax_withheld >= 0),
        other_deductions REAL NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
        net_payable REAL NOT NULL CHECK (net_payable >= 0),
        liability_entry_id INTEGER NOT NULL,
        payment_entry_id INTEGER,
        payment_date TEXT,
        payment_account_id INTEGER,
        operation_id TEXT NOT NULL UNIQUE,
        created_by_user_id INTEGER,
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (liability_entry_id) REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
        FOREIGN KEY (payment_entry_id) REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
        FOREIGN KEY (payment_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS finance_tax_obligations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tax_type TEXT NOT NULL,
        period_key TEXT NOT NULL,
        obligation_date TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        liability_entry_id INTEGER NOT NULL,
        payment_entry_id INTEGER,
        payment_date TEXT,
        payment_account_id INTEGER,
        operation_id TEXT NOT NULL UNIQUE,
        created_by_user_id INTEGER,
        created_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tax_type, period_key),
        FOREIGN KEY (liability_entry_id) REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
        FOREIGN KEY (payment_entry_id) REFERENCES finance_journal_entries(id) ON DELETE RESTRICT,
        FOREIGN KEY (payment_account_id) REFERENCES finance_accounts(id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS finance_accounting_period_locks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month_key TEXT NOT NULL UNIQUE,
        note TEXT NOT NULL,
        operation_id TEXT NOT NULL UNIQUE,
        locked_by_user_id INTEGER,
        locked_by_name TEXT NOT NULL,
        locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (locked_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TRIGGER IF NOT EXISTS finance_journal_entry_post_guard
      BEFORE UPDATE OF status ON finance_journal_entries
      WHEN NEW.status = 'posted' AND (
        ABS((SELECT COALESCE(SUM(debit-credit),0) FROM finance_journal_lines WHERE journal_entry_id=NEW.id)) > 0.004
        OR (SELECT COUNT(*) FROM finance_journal_lines WHERE journal_entry_id=NEW.id) < 2
      ) BEGIN SELECT RAISE(ABORT, 'Journal entries must contain at least two balanced lines'); END;
      CREATE TRIGGER IF NOT EXISTS finance_journal_entry_insert_guard
      BEFORE INSERT ON finance_journal_entries WHEN NEW.status!='draft' OR date(NEW.entry_date) IS NULL
        OR date(NEW.entry_date)!=NEW.entry_date OR trim(NEW.reference_type)='' OR trim(NEW.reference_id)=''
        OR trim(NEW.description)='' OR trim(NEW.operation_id)=''
      BEGIN SELECT RAISE(ABORT, 'Journals must begin as documented drafts with a valid date'); END;
      CREATE TRIGGER IF NOT EXISTS finance_posted_journal_no_update
      BEFORE UPDATE ON finance_journal_entries WHEN OLD.status='posted' BEGIN
        SELECT RAISE(ABORT, 'Posted journals are immutable; create a reversing journal');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_journal_no_delete
      BEFORE DELETE ON finance_journal_entries BEGIN SELECT RAISE(ABORT, 'Journal entries are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_posted_line_no_update
      BEFORE UPDATE ON finance_journal_lines WHEN (SELECT status FROM finance_journal_entries WHERE id=OLD.journal_entry_id)='posted'
      BEGIN SELECT RAISE(ABORT, 'Posted journal lines are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_posted_line_no_insert
      BEFORE INSERT ON finance_journal_lines WHEN (SELECT status FROM finance_journal_entries WHERE id=NEW.journal_entry_id)='posted'
      BEGIN SELECT RAISE(ABORT, 'Posted journal lines are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_posted_line_no_delete
      BEFORE DELETE ON finance_journal_lines WHEN (SELECT status FROM finance_journal_entries WHERE id=OLD.journal_entry_id)='posted'
      BEGIN SELECT RAISE(ABORT, 'Posted journal lines are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_statement_line_no_delete
      BEFORE DELETE ON finance_bank_statement_lines BEGIN SELECT RAISE(ABORT, 'Bank statement history is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_statement_line_update_guard
      BEFORE UPDATE ON finance_bank_statement_lines WHEN
        OLD.matched_journal_line_id IS NOT NULL
        OR NEW.bank_account_id!=OLD.bank_account_id OR NEW.transaction_date!=OLD.transaction_date
        OR NEW.description!=OLD.description OR NEW.amount!=OLD.amount
        OR NEW.external_reference!=OLD.external_reference OR NEW.operation_id!=OLD.operation_id
        OR NEW.imported_by_user_id IS NOT OLD.imported_by_user_id OR NEW.imported_by_name!=OLD.imported_by_name
      BEGIN SELECT RAISE(ABORT, 'Imported bank statement facts and completed matches are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_asset_records_no_update
      BEFORE UPDATE ON finance_fixed_assets BEGIN SELECT RAISE(ABORT, 'Fixed asset records are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_asset_records_no_delete
      BEFORE DELETE ON finance_fixed_assets BEGIN SELECT RAISE(ABORT, 'Fixed asset records are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_depreciation_no_update
      BEFORE UPDATE ON finance_asset_depreciation BEGIN SELECT RAISE(ABORT, 'Depreciation records are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_depreciation_no_delete
      BEFORE DELETE ON finance_asset_depreciation BEGIN SELECT RAISE(ABORT, 'Depreciation records are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_payroll_update_guard
      BEFORE UPDATE ON finance_payroll_runs WHEN OLD.payment_entry_id IS NOT NULL
        OR NEW.period_month!=OLD.period_month OR NEW.payee!=OLD.payee OR NEW.gross_amount!=OLD.gross_amount
        OR NEW.tax_withheld!=OLD.tax_withheld OR NEW.other_deductions!=OLD.other_deductions
        OR NEW.net_payable!=OLD.net_payable OR NEW.liability_entry_id!=OLD.liability_entry_id
        OR NEW.operation_id!=OLD.operation_id
      BEGIN SELECT RAISE(ABORT, 'Payroll facts and completed payments are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_payroll_no_delete
      BEFORE DELETE ON finance_payroll_runs BEGIN SELECT RAISE(ABORT, 'Payroll records are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_tax_update_guard
      BEFORE UPDATE ON finance_tax_obligations WHEN OLD.payment_entry_id IS NOT NULL
        OR NEW.tax_type!=OLD.tax_type OR NEW.period_key!=OLD.period_key OR NEW.obligation_date!=OLD.obligation_date
        OR NEW.amount!=OLD.amount OR NEW.liability_entry_id!=OLD.liability_entry_id OR NEW.operation_id!=OLD.operation_id
      BEGIN SELECT RAISE(ABORT, 'Tax facts and completed payments are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_tax_no_delete
      BEFORE DELETE ON finance_tax_obligations BEGIN SELECT RAISE(ABORT, 'Tax records are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_accounting_locks_no_update
      BEFORE UPDATE ON finance_accounting_period_locks BEGIN SELECT RAISE(ABORT, 'Accounting period locks are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_accounting_locks_no_delete
      BEFORE DELETE ON finance_accounting_period_locks BEGIN SELECT RAISE(ABORT, 'Accounting period locks are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS finance_manual_journal_transition_guard
      BEFORE UPDATE ON finance_manual_journal_requests WHEN
        OLD.status!='submitted' OR NEW.status NOT IN ('approved','rejected')
        OR NEW.entry_date!=OLD.entry_date OR NEW.description!=OLD.description
        OR NEW.cash_flow_class!=OLD.cash_flow_class OR NEW.lines_json!=OLD.lines_json
        OR NEW.operation_id!=OLD.operation_id OR NEW.submitted_by_user_id IS NOT OLD.submitted_by_user_id
        OR NEW.submitted_by_name!=OLD.submitted_by_name
      BEGIN SELECT RAISE(ABORT, 'Journal requests allow one documented approval or rejection only'); END;
      CREATE TRIGGER IF NOT EXISTS finance_manual_journal_no_delete
      BEFORE DELETE ON finance_manual_journal_requests BEGIN SELECT RAISE(ABORT, 'Journal requests are immutable'); END;
    `);

    const insertAccount = db.prepare(`
      INSERT INTO finance_accounts (code,name,account_type,subtype,system_key,normal_side,allow_manual)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING
    `);
    for (const account of DEFAULT_ACCOUNTS) insertAccount.run(...account);
    // Manual journals are still approval-controlled and immutable after posting.
    // Exposing system accounts here allows finance to make documented corrections
    // without editing or deleting the originating operational transaction.
    db.exec("UPDATE finance_accounts SET allow_manual=1 WHERE system_key IS NOT NULL");

    const insertBank = db.prepare(`
      INSERT OR IGNORE INTO finance_bank_accounts (account_id,display_name,institution_name,account_reference)
      SELECT id, name, '', code FROM finance_accounts WHERE system_key=?
    `);
    for (const key of ["cash", "juice", "card", "ib", "bank_transfer", "cheque"]) insertBank.run(key);
  })();
}

module.exports = { DEFAULT_ACCOUNTS, ensureAccountingSchema };
