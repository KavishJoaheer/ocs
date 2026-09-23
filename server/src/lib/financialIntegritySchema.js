// Additive migration: retain financial history and freeze movement valuations.
function ensureFinancialIntegritySchema(db) {
  const {
    DOCTOR_COMMISSION_RATE,
    OCS_COMMISSION_RATE,
    TRANSPORT_BENEFIT_PER_PATIENT,
  } = require('../config/revenueShare');
  const add = (table, name, type) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  };
  db.transaction(() => {
    add('billing', 'row_version', 'INTEGER NOT NULL DEFAULT 1');
    add('billing', 'fee_review_required', 'INTEGER NOT NULL DEFAULT 0');
    add('billing', 'legacy_fee_review_required', 'INTEGER NOT NULL DEFAULT 0');
    add('billing', 'change_reason', "TEXT NOT NULL DEFAULT ''");
    add('billing', 'invoice_number', "TEXT NOT NULL DEFAULT ''");
    add('billing', 'source_reference', 'TEXT');
    add('billing', 'issued_at', 'TEXT');
    add('billing', 'issued_by_user_id', 'INTEGER');
    add('billing', 'issued_by_name', "TEXT NOT NULL DEFAULT ''");
    add('billing', 'issued_by_role', "TEXT NOT NULL DEFAULT ''");
    add('billing', 'patient_identifier_snapshot', "TEXT NOT NULL DEFAULT ''");
    add('billing', 'patient_name_snapshot', "TEXT NOT NULL DEFAULT ''");
    add('billing', 'doctor_id_snapshot', 'INTEGER');
    add('billing', 'doctor_name_snapshot', "TEXT NOT NULL DEFAULT ''");
    add('billing', 'consultation_date_snapshot', 'TEXT');
    add('billing', 'consultation_type_snapshot', "TEXT NOT NULL DEFAULT ''");
    add('billing', 'partner_category_snapshot', "TEXT NOT NULL DEFAULT ''");
    add('billing', 'doctor_commission_rate_snapshot', 'REAL');
    add('billing', 'ocs_commission_rate_snapshot', 'REAL');
    add('billing', 'finalized_at', 'TEXT');
    add('billing', 'finalized_by_user_id', 'INTEGER');
    add('billing', 'finalized_by_name', "TEXT NOT NULL DEFAULT ''");
    add('billing', 'finalized_by_role', "TEXT NOT NULL DEFAULT ''");
    add('consultations', 'transport_benefit_snapshot', 'REAL');
    add('inventory_movements', 'unit_cost_snapshot', 'REAL');
    add('inventory_movements', 'unit_price_snapshot', 'REAL');
    add('inventory_movements', 'valuation_basis', 'TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS financial_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS billing_system_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cutover_date TEXT,
        reset_at TEXT,
        reset_reason TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS billing_follow_ups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        billing_id INTEGER NOT NULL,
        assigned_to_user_id INTEGER,
        assigned_to_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
        note TEXT NOT NULL,
        last_contact_date TEXT,
        next_follow_up_date TEXT,
        created_by_user_id INTEGER,
        created_by_name TEXT NOT NULL DEFAULT '',
        created_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (billing_id) REFERENCES billing(id) ON DELETE RESTRICT,
        FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_billing_follow_ups_bill
        ON billing_follow_ups(billing_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_billing_follow_ups_due
        ON billing_follow_ups(status, next_follow_up_date, assigned_to_user_id);
      CREATE TRIGGER IF NOT EXISTS billing_follow_ups_no_update
      BEFORE UPDATE ON billing_follow_ups BEGIN
        SELECT RAISE(ABORT, 'Billing follow-up history is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_follow_ups_no_delete
      BEFORE DELETE ON billing_follow_ups BEGIN
        SELECT RAISE(ABORT, 'Billing follow-up history is append-only');
      END;
      CREATE TABLE IF NOT EXISTS finance_expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_date TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN (
          'salary', 'doctor_commission', 'transport_benefit', 'fuel', 'rent',
          'utilities', 'bank_card_fee', 'marketing', 'professional_fee',
          'wastage', 'equipment', 'miscellaneous'
        )),
        payee TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL CHECK (amount > 0),
        external_reference TEXT,
        receipt_stored_name TEXT,
        receipt_original_name TEXT,
        receipt_mime_type TEXT,
        receipt_size INTEGER,
        operation_id TEXT NOT NULL UNIQUE,
        created_by_user_id INTEGER,
        created_by_name TEXT NOT NULL DEFAULT '',
        created_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_finance_expenses_date ON finance_expenses(expense_date, category);
      CREATE TABLE IF NOT EXISTS finance_expense_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_id INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected')),
        note TEXT NOT NULL DEFAULT '',
        operation_id TEXT NOT NULL UNIQUE,
        actor_user_id INTEGER,
        actor_name TEXT NOT NULL DEFAULT '',
        actor_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (expense_id) REFERENCES finance_expenses(id) ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_finance_expense_events_expense ON finance_expense_events(expense_id, id DESC);
      CREATE TABLE IF NOT EXISTS finance_expense_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_id INTEGER NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        payment_date TEXT NOT NULL,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'juice', 'card', 'ib', 'bank_transfer', 'cheque')),
        external_reference TEXT,
        operation_id TEXT NOT NULL UNIQUE,
        recorded_by_user_id INTEGER,
        recorded_by_name TEXT NOT NULL DEFAULT '',
        recorded_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (expense_id) REFERENCES finance_expenses(id) ON DELETE RESTRICT,
        FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_finance_expense_payments_date ON finance_expense_payments(payment_date, payment_method);
      CREATE TABLE IF NOT EXISTS finance_expense_payment_reversals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL UNIQUE,
        reversal_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        operation_id TEXT NOT NULL UNIQUE,
        reversed_by_user_id INTEGER,
        reversed_by_name TEXT NOT NULL DEFAULT '',
        reversed_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (payment_id) REFERENCES finance_expense_payments(id) ON DELETE RESTRICT,
        FOREIGN KEY (reversed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS finance_supplier_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_name TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        invoice_date TEXT NOT NULL,
        due_date TEXT,
        delivery_note TEXT NOT NULL DEFAULT '',
        shipment_id INTEGER,
        other_amount REAL NOT NULL DEFAULT 0 CHECK (other_amount >= 0),
        document_stored_name TEXT,
        document_original_name TEXT,
        document_mime_type TEXT,
        document_size INTEGER,
        operation_id TEXT NOT NULL UNIQUE,
        created_by_user_id INTEGER,
        created_by_name TEXT NOT NULL DEFAULT '',
        created_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shipment_id) REFERENCES inventory_shipments(id) ON DELETE RESTRICT,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (supplier_name, invoice_number)
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_invoices_date ON finance_supplier_invoices(invoice_date, due_date);
      CREATE TABLE IF NOT EXISTS finance_supplier_invoice_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_invoice_id INTEGER NOT NULL,
        inventory_item_id INTEGER,
        batch_id INTEGER,
        description TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
        previous_inventory_cost REAL,
        previous_batch_cost REAL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_invoice_id) REFERENCES finance_supplier_invoices(id) ON DELETE RESTRICT,
        FOREIGN KEY (inventory_item_id) REFERENCES inventory(id) ON DELETE RESTRICT,
        FOREIGN KEY (batch_id) REFERENCES inventory_batches(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_invoice ON finance_supplier_invoice_lines(supplier_invoice_id, id);
      CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_batch ON finance_supplier_invoice_lines(batch_id, supplier_invoice_id);
      CREATE INDEX IF NOT EXISTS idx_supplier_invoices_shipment ON finance_supplier_invoices(shipment_id, id);
      CREATE TABLE IF NOT EXISTS finance_supplier_cost_variances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_invoice_id INTEGER NOT NULL,
        supplier_invoice_line_id INTEGER NOT NULL UNIQUE,
        batch_id INTEGER NOT NULL,
        previous_unit_cost REAL NOT NULL CHECK (previous_unit_cost >= 0),
        approved_unit_cost REAL NOT NULL CHECK (approved_unit_cost >= 0),
        invoice_quantity REAL NOT NULL CHECK (invoice_quantity > 0),
        remaining_quantity REAL NOT NULL CHECK (remaining_quantity >= 0),
        consumed_quantity REAL NOT NULL CHECK (consumed_quantity >= 0),
        variance_amount REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_invoice_id) REFERENCES finance_supplier_invoices(id) ON DELETE RESTRICT,
        FOREIGN KEY (supplier_invoice_line_id) REFERENCES finance_supplier_invoice_lines(id) ON DELETE RESTRICT,
        FOREIGN KEY (batch_id) REFERENCES inventory_batches(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_cost_variances_invoice
        ON finance_supplier_cost_variances(supplier_invoice_id, id);
      CREATE TABLE IF NOT EXISTS finance_supplier_invoice_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_invoice_id INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected')),
        note TEXT NOT NULL DEFAULT '',
        operation_id TEXT NOT NULL UNIQUE,
        actor_user_id INTEGER,
        actor_name TEXT NOT NULL DEFAULT '',
        actor_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_invoice_id) REFERENCES finance_supplier_invoices(id) ON DELETE RESTRICT,
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_invoice_events_invoice ON finance_supplier_invoice_events(supplier_invoice_id, id DESC);
      CREATE TABLE IF NOT EXISTS finance_supplier_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_invoice_id INTEGER NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        payment_date TEXT NOT NULL,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'juice', 'card', 'ib', 'bank_transfer', 'cheque')),
        external_reference TEXT,
        operation_id TEXT NOT NULL UNIQUE,
        recorded_by_user_id INTEGER,
        recorded_by_name TEXT NOT NULL DEFAULT '',
        recorded_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_invoice_id) REFERENCES finance_supplier_invoices(id) ON DELETE RESTRICT,
        FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_payments_date ON finance_supplier_payments(payment_date, payment_method);
      CREATE TABLE IF NOT EXISTS finance_supplier_payment_reversals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_id INTEGER NOT NULL UNIQUE,
        reversal_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        operation_id TEXT NOT NULL UNIQUE,
        reversed_by_user_id INTEGER,
        reversed_by_name TEXT NOT NULL DEFAULT '',
        reversed_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (payment_id) REFERENCES finance_supplier_payments(id) ON DELETE RESTRICT,
        FOREIGN KEY (reversed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS finance_monthly_closings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month_key TEXT NOT NULL UNIQUE,
        readiness_snapshot_json TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        operation_id TEXT NOT NULL UNIQUE,
        closed_by_user_id INTEGER,
        closed_by_name TEXT NOT NULL DEFAULT '',
        closed_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TRIGGER IF NOT EXISTS finance_expenses_document_guard BEFORE INSERT ON finance_expenses BEGIN
        SELECT CASE WHEN date(NEW.expense_date) IS NULL OR date(NEW.expense_date) != NEW.expense_date
          OR NEW.expense_date > date('now','+4 hours')
          OR abs(NEW.amount*100-round(NEW.amount*100)) > 0.0001
          OR trim(NEW.payee) = '' OR trim(NEW.operation_id) = ''
        THEN RAISE(ABORT, 'Invalid expense document') END;
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expense_events_transition_guard BEFORE INSERT ON finance_expense_events BEGIN
        SELECT CASE
          WHEN trim(NEW.operation_id) = '' THEN RAISE(ABORT, 'Expense event requires operation reference')
          WHEN NEW.action = 'submitted' AND EXISTS (
            SELECT 1 FROM finance_expense_events WHERE expense_id=NEW.expense_id
          ) THEN RAISE(ABORT, 'Expense is already submitted')
          WHEN NEW.action IN ('approved','rejected') AND (
            NOT EXISTS (SELECT 1 FROM finance_expense_events WHERE expense_id=NEW.expense_id AND action='submitted')
            OR EXISTS (SELECT 1 FROM finance_expense_events WHERE expense_id=NEW.expense_id AND action IN ('approved','rejected'))
          ) THEN RAISE(ABORT, 'Expense decision is not allowed')
        END;
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expense_payments_document_guard BEFORE INSERT ON finance_expense_payments BEGIN
        SELECT CASE WHEN date(NEW.payment_date) IS NULL OR date(NEW.payment_date) != NEW.payment_date
          OR NEW.payment_date > date('now','+4 hours')
          OR abs(NEW.amount*100-round(NEW.amount*100)) > 0.0001
          OR trim(NEW.operation_id) = ''
          OR (NEW.payment_method != 'cash' AND length(trim(COALESCE(NEW.external_reference,''))) < 3)
        THEN RAISE(ABORT, 'Invalid expense payment') END;
        SELECT CASE WHEN COALESCE((
          SELECT action FROM finance_expense_events WHERE expense_id=NEW.expense_id ORDER BY id DESC LIMIT 1
        ),'submitted') != 'approved' THEN RAISE(ABORT, 'Expense is not approved') END;
        SELECT CASE WHEN NEW.amount
          + COALESCE((SELECT SUM(amount) FROM finance_expense_payments WHERE expense_id=NEW.expense_id),0)
          - COALESCE((SELECT SUM(payment.amount) FROM finance_expense_payments payment
            JOIN finance_expense_payment_reversals reversal ON reversal.payment_id=payment.id
            WHERE payment.expense_id=NEW.expense_id),0)
          > (SELECT amount FROM finance_expenses WHERE id=NEW.expense_id) + 0.004
        THEN RAISE(ABORT, 'Expense payment exceeds outstanding balance') END;
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expense_payment_reversals_document_guard BEFORE INSERT ON finance_expense_payment_reversals BEGIN
        SELECT CASE WHEN date(NEW.reversal_date) IS NULL OR date(NEW.reversal_date) != NEW.reversal_date
          OR NEW.reversal_date > date('now','+4 hours') OR length(trim(NEW.reason)) < 10
          OR trim(NEW.operation_id) = ''
        THEN RAISE(ABORT, 'Invalid expense payment reversal') END;
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_invoices_document_guard BEFORE INSERT ON finance_supplier_invoices BEGIN
        SELECT CASE WHEN date(NEW.invoice_date) IS NULL OR date(NEW.invoice_date) != NEW.invoice_date
          OR NEW.invoice_date > date('now','+4 hours')
          OR (NEW.due_date IS NOT NULL AND (date(NEW.due_date) IS NULL OR date(NEW.due_date) != NEW.due_date))
          OR abs(NEW.other_amount*100-round(NEW.other_amount*100)) > 0.0001
          OR trim(NEW.supplier_name) = '' OR trim(NEW.invoice_number) = '' OR trim(NEW.operation_id) = ''
        THEN RAISE(ABORT, 'Invalid supplier invoice') END;
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_lines_document_guard BEFORE INSERT ON finance_supplier_invoice_lines BEGIN
        SELECT CASE WHEN trim(NEW.description) = ''
          OR abs(NEW.unit_cost*100-round(NEW.unit_cost*100)) > 0.0001
          OR (NEW.batch_id IS NOT NULL AND (
            NEW.inventory_item_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM inventory_batches WHERE id=NEW.batch_id AND item_id=NEW.inventory_item_id
            )
          ))
        THEN RAISE(ABORT, 'Invalid supplier invoice line') END;
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_events_transition_guard BEFORE INSERT ON finance_supplier_invoice_events BEGIN
        SELECT CASE
          WHEN trim(NEW.operation_id) = '' THEN RAISE(ABORT, 'Supplier event requires operation reference')
          WHEN NEW.action = 'submitted' AND EXISTS (
            SELECT 1 FROM finance_supplier_invoice_events WHERE supplier_invoice_id=NEW.supplier_invoice_id
          ) THEN RAISE(ABORT, 'Supplier invoice is already submitted')
          WHEN NEW.action IN ('approved','rejected') AND (
            NOT EXISTS (SELECT 1 FROM finance_supplier_invoice_events WHERE supplier_invoice_id=NEW.supplier_invoice_id AND action='submitted')
            OR EXISTS (SELECT 1 FROM finance_supplier_invoice_events WHERE supplier_invoice_id=NEW.supplier_invoice_id AND action IN ('approved','rejected'))
          ) THEN RAISE(ABORT, 'Supplier invoice decision is not allowed')
        END;
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_payments_document_guard BEFORE INSERT ON finance_supplier_payments BEGIN
        SELECT CASE WHEN date(NEW.payment_date) IS NULL OR date(NEW.payment_date) != NEW.payment_date
          OR NEW.payment_date > date('now','+4 hours')
          OR abs(NEW.amount*100-round(NEW.amount*100)) > 0.0001
          OR trim(NEW.operation_id) = ''
          OR (NEW.payment_method != 'cash' AND length(trim(COALESCE(NEW.external_reference,''))) < 3)
        THEN RAISE(ABORT, 'Invalid supplier payment') END;
        SELECT CASE WHEN COALESCE((
          SELECT action FROM finance_supplier_invoice_events WHERE supplier_invoice_id=NEW.supplier_invoice_id ORDER BY id DESC LIMIT 1
        ),'submitted') != 'approved' THEN RAISE(ABORT, 'Supplier invoice is not approved') END;
        SELECT CASE WHEN NEW.amount
          + COALESCE((SELECT SUM(amount) FROM finance_supplier_payments WHERE supplier_invoice_id=NEW.supplier_invoice_id),0)
          - COALESCE((SELECT SUM(payment.amount) FROM finance_supplier_payments payment
            JOIN finance_supplier_payment_reversals reversal ON reversal.payment_id=payment.id
            WHERE payment.supplier_invoice_id=NEW.supplier_invoice_id),0)
          > (
          SELECT other_amount + COALESCE((SELECT SUM(quantity*unit_cost) FROM finance_supplier_invoice_lines WHERE supplier_invoice_id=NEW.supplier_invoice_id),0)
          FROM finance_supplier_invoices WHERE id=NEW.supplier_invoice_id
        ) + 0.004 THEN RAISE(ABORT, 'Supplier payment exceeds outstanding balance') END;
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_payment_reversals_document_guard BEFORE INSERT ON finance_supplier_payment_reversals BEGIN
        SELECT CASE WHEN date(NEW.reversal_date) IS NULL OR date(NEW.reversal_date) != NEW.reversal_date
          OR NEW.reversal_date > date('now','+4 hours') OR length(trim(NEW.reason)) < 10
          OR trim(NEW.operation_id) = ''
        THEN RAISE(ABORT, 'Invalid supplier payment reversal') END;
      END;
      CREATE TRIGGER IF NOT EXISTS finance_monthly_closings_document_guard BEFORE INSERT ON finance_monthly_closings BEGIN
        SELECT CASE WHEN NEW.month_key NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'
          OR NEW.month_key >= strftime('%Y-%m','now','+4 hours')
          OR trim(NEW.operation_id) = '' OR length(trim(NEW.notes)) < 10
        THEN RAISE(ABORT, 'Invalid monthly close') END;
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expenses_no_update BEFORE UPDATE ON finance_expenses BEGIN
        SELECT RAISE(ABORT, 'Expense documents are immutable; add an approval or compensating entry');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expenses_no_delete BEFORE DELETE ON finance_expenses BEGIN
        SELECT RAISE(ABORT, 'Expense documents are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expense_events_no_update BEFORE UPDATE ON finance_expense_events BEGIN
        SELECT RAISE(ABORT, 'Expense approval history is immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expense_events_no_delete BEFORE DELETE ON finance_expense_events BEGIN
        SELECT RAISE(ABORT, 'Expense approval history is immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expense_payments_no_update BEFORE UPDATE ON finance_expense_payments BEGIN
        SELECT RAISE(ABORT, 'Expense payments are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expense_payments_no_delete BEFORE DELETE ON finance_expense_payments BEGIN
        SELECT RAISE(ABORT, 'Expense payments are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expense_payment_reversals_no_update BEFORE UPDATE ON finance_expense_payment_reversals BEGIN
        SELECT RAISE(ABORT, 'Expense payment reversals are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_expense_payment_reversals_no_delete BEFORE DELETE ON finance_expense_payment_reversals BEGIN
        SELECT RAISE(ABORT, 'Expense payment reversals are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_invoices_no_update BEFORE UPDATE ON finance_supplier_invoices BEGIN
        SELECT RAISE(ABORT, 'Supplier invoices are immutable; add an approval or compensating document');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_invoices_no_delete BEFORE DELETE ON finance_supplier_invoices BEGIN
        SELECT RAISE(ABORT, 'Supplier invoices are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_lines_no_update BEFORE UPDATE ON finance_supplier_invoice_lines BEGIN
        SELECT RAISE(ABORT, 'Supplier invoice lines are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_lines_no_delete BEFORE DELETE ON finance_supplier_invoice_lines BEGIN
        SELECT RAISE(ABORT, 'Supplier invoice lines are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_cost_variances_no_update BEFORE UPDATE ON finance_supplier_cost_variances BEGIN
        SELECT RAISE(ABORT, 'Supplier cost variance history is immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_cost_variances_no_delete BEFORE DELETE ON finance_supplier_cost_variances BEGIN
        SELECT RAISE(ABORT, 'Supplier cost variance history is immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_events_no_update BEFORE UPDATE ON finance_supplier_invoice_events BEGIN
        SELECT RAISE(ABORT, 'Supplier approval history is immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_events_no_delete BEFORE DELETE ON finance_supplier_invoice_events BEGIN
        SELECT RAISE(ABORT, 'Supplier approval history is immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_payments_no_update BEFORE UPDATE ON finance_supplier_payments BEGIN
        SELECT RAISE(ABORT, 'Supplier payments are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_payments_no_delete BEFORE DELETE ON finance_supplier_payments BEGIN
        SELECT RAISE(ABORT, 'Supplier payments are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_payment_reversals_no_update BEFORE UPDATE ON finance_supplier_payment_reversals BEGIN
        SELECT RAISE(ABORT, 'Supplier payment reversals are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_supplier_payment_reversals_no_delete BEFORE DELETE ON finance_supplier_payment_reversals BEGIN
        SELECT RAISE(ABORT, 'Supplier payment reversals are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_monthly_closings_no_update BEFORE UPDATE ON finance_monthly_closings BEGIN
        SELECT RAISE(ABORT, 'Monthly closings are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS finance_monthly_closings_no_delete BEFORE DELETE ON finance_monthly_closings BEGIN
        SELECT RAISE(ABORT, 'Monthly closings are immutable');
      END;
      CREATE TABLE IF NOT EXISTS financial_day_closings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_date TEXT NOT NULL UNIQUE,
        expected_totals_json TEXT NOT NULL,
        counted_cash REAL NOT NULL CHECK (counted_cash >= 0),
        settlement_totals_json TEXT NOT NULL,
        settlement_references_json TEXT NOT NULL,
        variance_total REAL NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        operation_id TEXT NOT NULL,
        closed_by_user_id INTEGER,
        closed_by_name TEXT NOT NULL DEFAULT '',
        closed_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (closed_by_user_id, operation_id)
      );
      CREATE TABLE IF NOT EXISTS financial_day_close_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        closing_id INTEGER NOT NULL,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('juice', 'card', 'ib')),
        expected_amount REAL NOT NULL,
        settled_amount REAL NOT NULL,
        external_reference TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (closing_id) REFERENCES financial_day_closings(id) ON DELETE RESTRICT,
        UNIQUE (closing_id, payment_method)
      );
      CREATE TABLE IF NOT EXISTS financial_day_close_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        closing_id INTEGER NOT NULL,
        cash_delta REAL NOT NULL DEFAULT 0,
        settlement_deltas_json TEXT NOT NULL DEFAULT '{}',
        settlement_references_json TEXT NOT NULL DEFAULT '{}',
        reason TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        adjusted_by_user_id INTEGER,
        adjusted_by_name TEXT NOT NULL DEFAULT '',
        adjusted_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (closing_id) REFERENCES financial_day_closings(id) ON DELETE RESTRICT,
        FOREIGN KEY (adjusted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (adjusted_by_user_id, operation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_day_close_adjustments_closing
        ON financial_day_close_adjustments(closing_id, id);
      CREATE TABLE IF NOT EXISTS financial_day_close_adjustment_references (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        adjustment_id INTEGER NOT NULL,
        payment_method TEXT NOT NULL CHECK (payment_method IN ('juice', 'card', 'ib')),
        external_reference TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (adjustment_id) REFERENCES financial_day_close_adjustments(id) ON DELETE RESTRICT,
        UNIQUE (payment_method, external_reference)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_day_close_adjustment_reference
        ON financial_day_close_adjustment_references(payment_method, lower(trim(external_reference)));
      CREATE TRIGGER IF NOT EXISTS financial_day_close_adjustment_references_no_update
      BEFORE UPDATE ON financial_day_close_adjustment_references BEGIN
        SELECT RAISE(ABORT, 'Day-close adjustment references are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS financial_day_close_adjustment_references_no_delete
      BEFORE DELETE ON financial_day_close_adjustment_references BEGIN
        SELECT RAISE(ABORT, 'Day-close adjustment references are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS financial_day_close_adjustments_no_update
      BEFORE UPDATE ON financial_day_close_adjustments BEGIN
        SELECT RAISE(ABORT, 'Day-close adjustments are immutable; add another compensating adjustment');
      END;
      CREATE TRIGGER IF NOT EXISTS financial_day_close_adjustments_no_delete
      BEFORE DELETE ON financial_day_close_adjustments BEGIN
        SELECT RAISE(ABORT, 'Day-close adjustments are immutable; add another compensating adjustment');
      END;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_day_close_settlement_reference
        ON financial_day_close_settlements(payment_method, lower(trim(external_reference)))
        WHERE external_reference IS NOT NULL AND trim(external_reference) != '';
      CREATE TRIGGER IF NOT EXISTS financial_day_closings_no_update
      BEFORE UPDATE ON financial_day_closings BEGIN
        SELECT RAISE(ABORT, 'Day closings are immutable; document a compensating close');
      END;
      CREATE TRIGGER IF NOT EXISTS financial_day_closings_no_delete
      BEFORE DELETE ON financial_day_closings BEGIN
        SELECT RAISE(ABORT, 'Day closings are immutable; document a compensating close');
      END;
      DROP TRIGGER IF EXISTS financial_day_closings_date_guard;
      CREATE TRIGGER financial_day_closings_date_guard
      BEFORE INSERT ON financial_day_closings
      WHEN date(NEW.business_date) IS NULL
        OR date(NEW.business_date) != NEW.business_date
        OR date(NEW.business_date) > date('now', '+4 hours')
      BEGIN
        SELECT RAISE(ABORT, 'Day closings require a valid non-future Mauritius business date');
      END;
      CREATE TRIGGER IF NOT EXISTS financial_day_close_settlements_no_update
      BEFORE UPDATE ON financial_day_close_settlements BEGIN
        SELECT RAISE(ABORT, 'Settlement records are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS financial_day_close_settlements_no_delete
      BEFORE DELETE ON financial_day_close_settlements BEGIN
        SELECT RAISE(ABORT, 'Settlement records are immutable');
      END;
      CREATE TABLE IF NOT EXISTS operation_receipts (
        actor_id INTEGER NOT NULL, scope TEXT NOT NULL, operation_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(actor_id, scope, operation_id)
      );
      CREATE TABLE IF NOT EXISTS billing_payment_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        billing_id INTEGER NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'juice', 'card', 'ib')),
        payment_date TEXT NOT NULL,
        external_reference TEXT,
        operation_id TEXT NOT NULL UNIQUE,
        recorded_by_user_id INTEGER,
        recorded_by_name TEXT NOT NULL DEFAULT '',
        recorded_by_role TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'recorded' CHECK (source IN ('recorded', 'legacy_migration')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (billing_id) REFERENCES billing(id) ON DELETE RESTRICT,
        FOREIGN KEY (recorded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_billing_payments_bill
        ON billing_payment_transactions(billing_id, id);
      CREATE INDEX IF NOT EXISTS idx_billing_payments_date
        ON billing_payment_transactions(payment_date, payment_method);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payments_external_reference
        ON billing_payment_transactions(payment_method, lower(trim(external_reference)))
        WHERE external_reference IS NOT NULL AND trim(external_reference) != '';
      CREATE TRIGGER IF NOT EXISTS billing_payment_transactions_amount_guard
      BEFORE INSERT ON billing_payment_transactions
      WHEN
        typeof(NEW.amount) NOT IN ('integer', 'real')
        OR NEW.amount <= 0
        OR abs(NEW.amount * 100 - round(NEW.amount * 100)) > 0.000001
      BEGIN
        SELECT RAISE(ABORT, 'Payment amounts must be positive currency values with no more than two decimal places');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_payment_transactions_document_guard
      BEFORE INSERT ON billing_payment_transactions
      WHEN
        length(trim(NEW.operation_id)) = 0
        OR date(NEW.payment_date) IS NULL
        OR date(NEW.payment_date) != NEW.payment_date
        OR (NEW.source = 'recorded' AND date(NEW.payment_date) > date('now', '+4 hours'))
        OR (NEW.payment_method != 'cash' AND NEW.source = 'recorded' AND length(trim(COALESCE(NEW.external_reference, ''))) < 3)
      BEGIN
        SELECT RAISE(ABORT, 'Payments require a valid non-future date, operation reference, and provider reference for non-cash methods');
      END;
      DROP TRIGGER IF EXISTS billing_payment_transactions_balance_guard;
      CREATE TRIGGER billing_payment_transactions_balance_guard
      BEFORE INSERT ON billing_payment_transactions
      WHEN NOT EXISTS (
        SELECT 1
        FROM billing bill
        JOIN consultations consultation ON consultation.id = bill.consultation_id
        WHERE bill.id = NEW.billing_id
          AND bill.voided_at IS NULL
          AND consultation.voided_at IS NULL
          AND NEW.amount <= bill.total_amount - COALESCE((
            SELECT SUM(existing.amount)
            FROM billing_payment_transactions existing
            WHERE existing.billing_id = bill.id
          ), 0) + COALESCE((
            SELECT SUM(reversal.amount)
            FROM billing_payment_reversals reversal
            WHERE reversal.billing_id = bill.id
          ), 0) + 0.000001
      )
      BEGIN
        SELECT RAISE(ABORT, 'Payment exceeds the outstanding invoice balance or invoice is not active');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_payment_transactions_no_update
      BEFORE UPDATE ON billing_payment_transactions BEGIN
        SELECT RAISE(ABORT, 'Payment transactions are immutable; record a compensating transaction');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_payment_transactions_no_delete
      BEFORE DELETE ON billing_payment_transactions BEGIN
        SELECT RAISE(ABORT, 'Payment transactions are immutable; record a compensating transaction');
      END;
      DROP TRIGGER IF EXISTS inventory_money_nonnegative_insert;
      CREATE TRIGGER inventory_money_nonnegative_insert
      BEFORE INSERT ON inventory
      WHEN
        typeof(NEW.cost_price) NOT IN ('integer', 'real')
        OR typeof(NEW.selling_price) NOT IN ('integer', 'real')
        OR NEW.cost_price < 0
        OR NEW.selling_price < 0
        OR abs(NEW.cost_price * 100 - round(NEW.cost_price * 100)) > 0.000001
        OR abs(NEW.selling_price * 100 - round(NEW.selling_price * 100)) > 0.000001
      BEGIN
        SELECT RAISE(ABORT, 'Inventory prices must be non-negative currency values with no more than two decimal places');
      END;
      DROP TRIGGER IF EXISTS inventory_money_nonnegative_update;
      CREATE TRIGGER inventory_money_nonnegative_update
      BEFORE UPDATE OF cost_price, selling_price ON inventory
      WHEN
        typeof(NEW.cost_price) NOT IN ('integer', 'real')
        OR typeof(NEW.selling_price) NOT IN ('integer', 'real')
        OR NEW.cost_price < 0
        OR NEW.selling_price < 0
        OR abs(NEW.cost_price * 100 - round(NEW.cost_price * 100)) > 0.000001
        OR abs(NEW.selling_price * 100 - round(NEW.selling_price * 100)) > 0.000001
      BEGIN
        SELECT RAISE(ABORT, 'Inventory prices must be non-negative currency values with no more than two decimal places');
      END;
      CREATE TABLE IF NOT EXISTS billing_payment_reversals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payment_transaction_id INTEGER NOT NULL UNIQUE,
        billing_id INTEGER NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'juice', 'card', 'ib')),
        reversal_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        external_reference TEXT,
        operation_id TEXT NOT NULL UNIQUE,
        reversed_by_user_id INTEGER,
        reversed_by_name TEXT NOT NULL DEFAULT '',
        reversed_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (payment_transaction_id) REFERENCES billing_payment_transactions(id) ON DELETE RESTRICT,
        FOREIGN KEY (billing_id) REFERENCES billing(id) ON DELETE RESTRICT,
        FOREIGN KEY (reversed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_billing_payment_reversals_bill
        ON billing_payment_reversals(billing_id, id);
      CREATE INDEX IF NOT EXISTS idx_billing_payment_reversals_date
        ON billing_payment_reversals(reversal_date, payment_method);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payment_reversals_external_reference
        ON billing_payment_reversals(payment_method, lower(trim(external_reference)))
        WHERE external_reference IS NOT NULL AND trim(external_reference) != '';
      CREATE TRIGGER IF NOT EXISTS billing_payment_reversals_document_guard
      BEFORE INSERT ON billing_payment_reversals
      WHEN
        length(trim(NEW.reason)) < 8
        OR length(trim(NEW.operation_id)) = 0
        OR date(NEW.reversal_date) IS NULL
        OR date(NEW.reversal_date) != NEW.reversal_date
        OR date(NEW.reversal_date) > date('now', '+4 hours')
        OR (NEW.payment_method != 'cash' AND length(trim(COALESCE(NEW.external_reference, ''))) < 3)
      BEGIN
        SELECT RAISE(ABORT, 'Payment reversals require a valid date, operation reference, reason, and provider reference for non-cash methods');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_payment_reversals_no_update
      BEFORE UPDATE ON billing_payment_reversals BEGIN
        SELECT RAISE(ABORT, 'Payment reversals are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_payment_reversals_no_delete
      BEFORE DELETE ON billing_payment_reversals BEGIN
        SELECT RAISE(ABORT, 'Payment reversals are immutable');
      END;
      DROP VIEW IF EXISTS billing_payment_ledger;
      CREATE VIEW billing_payment_ledger AS
        SELECT
          'payment-' || payment.id AS ledger_id,
          payment.id AS id,
          payment.billing_id,
          payment.id AS payment_transaction_id,
          payment.amount AS amount,
          payment.payment_method,
          payment.payment_date AS transaction_date,
          payment.payment_date AS payment_date,
          payment.external_reference,
          payment.operation_id,
          payment.recorded_by_user_id AS actor_user_id,
          payment.recorded_by_name AS actor_name,
          payment.recorded_by_role AS actor_role,
          payment.source,
          'payment' AS entry_type,
          '' AS reason,
          payment.created_at
        FROM billing_payment_transactions payment
        UNION ALL
        SELECT
          'reversal-' || reversal.id AS ledger_id,
          -reversal.id AS id,
          reversal.billing_id,
          reversal.payment_transaction_id,
          -reversal.amount AS amount,
          reversal.payment_method,
          reversal.reversal_date AS transaction_date,
          reversal.reversal_date AS payment_date,
          reversal.external_reference,
          reversal.operation_id,
          reversal.reversed_by_user_id AS actor_user_id,
          reversal.reversed_by_name AS actor_name,
          reversal.reversed_by_role AS actor_role,
          'recorded' AS source,
          'reversal' AS entry_type,
          reversal.reason,
          reversal.created_at
        FROM billing_payment_reversals reversal;
      CREATE TABLE IF NOT EXISTS billing_refunds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credit_note_number TEXT NOT NULL UNIQUE,
        billing_id INTEGER NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        refund_method TEXT NOT NULL CHECK (refund_method IN ('cash', 'juice', 'card', 'ib')),
        refund_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        external_reference TEXT,
        issued_by_user_id INTEGER,
        issued_by_name TEXT NOT NULL DEFAULT '',
        issued_by_role TEXT NOT NULL DEFAULT '',
        operation_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (billing_id) REFERENCES billing(id) ON DELETE RESTRICT,
        FOREIGN KEY (issued_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (issued_by_user_id, operation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_billing_refunds_bill
        ON billing_refunds(billing_id, id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_refunds_external_reference
        ON billing_refunds(lower(trim(external_reference)))
        WHERE external_reference IS NOT NULL AND trim(external_reference) != '';
      CREATE TRIGGER IF NOT EXISTS billing_refunds_amount_guard
      BEFORE INSERT ON billing_refunds
      WHEN
        typeof(NEW.amount) NOT IN ('integer', 'real')
        OR NEW.amount <= 0
        OR abs(NEW.amount * 100 - round(NEW.amount * 100)) > 0.000001
      BEGIN
        SELECT RAISE(ABORT, 'Refund amounts must be positive currency values with no more than two decimal places');
      END;
      DROP TRIGGER IF EXISTS billing_refunds_document_guard;
      CREATE TRIGGER billing_refunds_document_guard
      BEFORE INSERT ON billing_refunds
      WHEN
        length(trim(NEW.reason)) < 8
        OR length(trim(NEW.operation_id)) = 0
        OR NEW.refund_date IS NULL
        OR date(NEW.refund_date) IS NULL
        OR date(NEW.refund_date) != NEW.refund_date
        OR date(NEW.refund_date) > date('now', '+4 hours')
        OR (NEW.refund_method != 'cash' AND length(trim(COALESCE(NEW.external_reference, ''))) < 3)
      BEGIN
        SELECT RAISE(ABORT, 'Credit notes require a valid non-future date, operation reference, documented reason, and provider reference for non-cash refunds');
      END;
      CREATE TABLE IF NOT EXISTS billing_refund_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        refund_id INTEGER NOT NULL UNIQUE,
        billing_id INTEGER NOT NULL,
        allocation_type TEXT NOT NULL CHECK (allocation_type IN ('service_non_stock', 'supply_submission')),
        submission_id INTEGER,
        amount REAL NOT NULL CHECK (amount > 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (refund_id) REFERENCES billing_refunds(id) ON DELETE RESTRICT,
        FOREIGN KEY (billing_id) REFERENCES billing(id) ON DELETE RESTRICT,
        FOREIGN KEY (submission_id) REFERENCES billing_lite_submissions(id) ON DELETE RESTRICT,
        CHECK (
          (allocation_type = 'service_non_stock' AND submission_id IS NULL)
          OR (allocation_type = 'supply_submission' AND submission_id IS NOT NULL)
        )
      );
      CREATE INDEX IF NOT EXISTS idx_billing_refund_allocations_bill
        ON billing_refund_allocations(billing_id, allocation_type, id);
      CREATE TRIGGER IF NOT EXISTS billing_refund_allocations_guard
      BEFORE INSERT ON billing_refund_allocations
      WHEN NOT EXISTS (
        SELECT 1
        FROM billing_refunds refund
        WHERE refund.id = NEW.refund_id
          AND refund.billing_id = NEW.billing_id
          AND abs(refund.amount - NEW.amount) <= 0.000001
      ) OR (
        NEW.allocation_type = 'supply_submission'
        AND NOT EXISTS (
          SELECT 1
          FROM billing_lite_submissions submission
          WHERE submission.id = NEW.submission_id
            AND submission.billing_id = NEW.billing_id
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'Credit note allocation must match its invoice, amount, and supply submission');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_refund_allocations_no_update
      BEFORE UPDATE ON billing_refund_allocations BEGIN
        SELECT RAISE(ABORT, 'Credit note allocations are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_refund_allocations_no_delete
      BEFORE DELETE ON billing_refund_allocations BEGIN
        SELECT RAISE(ABORT, 'Credit note allocations are immutable');
      END;
      CREATE TABLE IF NOT EXISTS billing_supply_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        billing_id INTEGER NOT NULL,
        submission_id INTEGER NOT NULL UNIQUE,
        refund_id INTEGER NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        disposition TEXT NOT NULL CHECK (disposition IN ('returned_to_stock', 'consumed_or_wasted')),
        original_movement_ids_json TEXT NOT NULL DEFAULT '[]',
        reversal_movement_ids_json TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL,
        operation_id TEXT NOT NULL UNIQUE,
        corrected_by_user_id INTEGER,
        corrected_by_name TEXT NOT NULL DEFAULT '',
        corrected_by_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (billing_id) REFERENCES billing(id) ON DELETE RESTRICT,
        FOREIGN KEY (submission_id) REFERENCES billing_lite_submissions(id) ON DELETE RESTRICT,
        FOREIGN KEY (refund_id) REFERENCES billing_refunds(id) ON DELETE RESTRICT,
        FOREIGN KEY (corrected_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_billing_supply_corrections_bill
        ON billing_supply_corrections(billing_id, id);
      CREATE TRIGGER IF NOT EXISTS billing_supply_corrections_no_update
      BEFORE UPDATE ON billing_supply_corrections BEGIN
        SELECT RAISE(ABORT, 'Paid supply corrections are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_supply_corrections_no_delete
      BEFORE DELETE ON billing_supply_corrections BEGIN
        SELECT RAISE(ABORT, 'Paid supply corrections are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_refunds_balance_guard
      BEFORE INSERT ON billing_refunds
      WHEN NOT EXISTS (
        SELECT 1
        FROM billing bill
        JOIN consultations consultation ON consultation.id = bill.consultation_id
        WHERE bill.id = NEW.billing_id
          AND bill.status = 'paid'
          AND bill.voided_at IS NULL
          AND consultation.voided_at IS NULL
          AND NEW.amount <= bill.total_amount - COALESCE((
            SELECT SUM(existing.amount)
            FROM billing_refunds existing
            WHERE existing.billing_id = bill.id
          ), 0)
      )
      BEGIN
        SELECT RAISE(ABORT, 'Credit note exceeds the refundable balance or invoice is not active and paid');
      END;
      DROP TRIGGER IF EXISTS billing_refunds_no_update;
      CREATE TRIGGER billing_refunds_no_update
      BEFORE UPDATE ON billing_refunds
      WHEN NOT (
        NEW.id = OLD.id
        AND NEW.credit_note_number = OLD.credit_note_number
        AND NEW.billing_id = OLD.billing_id
        AND NEW.amount = OLD.amount
        AND NEW.refund_method = OLD.refund_method
        AND NEW.refund_date = OLD.refund_date
        AND NEW.reason = OLD.reason
        AND NEW.external_reference IS OLD.external_reference
        AND NEW.issued_by_user_id IS NULL
        AND NEW.issued_by_name = OLD.issued_by_name
        AND NEW.issued_by_role = OLD.issued_by_role
        AND NEW.operation_id = OLD.operation_id
        AND NEW.created_at = OLD.created_at
      )
      BEGIN
        SELECT RAISE(ABORT, 'Credit notes are immutable; record a compensating accounting entry');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_refunds_no_delete
      BEFORE DELETE ON billing_refunds BEGIN
        SELECT RAISE(ABORT, 'Credit notes are immutable; record a compensating accounting entry');
      END;
      DROP TRIGGER IF EXISTS billing_paid_financial_guard;
      CREATE TRIGGER billing_paid_financial_guard
      BEFORE UPDATE ON billing
      WHEN OLD.status = 'paid' AND (
        (
          NEW.status != OLD.status
          AND NOT (
            NEW.status = 'unpaid'
            AND COALESCE((SELECT SUM(payment.amount) FROM billing_payment_transactions payment WHERE payment.billing_id = OLD.id), 0)
              - COALESCE((SELECT SUM(reversal.amount) FROM billing_payment_reversals reversal WHERE reversal.billing_id = OLD.id), 0)
              < OLD.total_amount - 0.000001
          )
        )
        OR NEW.items != OLD.items
        OR NEW.total_amount != OLD.total_amount
        OR NEW.voided_at IS NOT OLD.voided_at
      )
      BEGIN
        SELECT RAISE(ABORT, 'Paid invoice financial lines are immutable; use a credit note and adjustment invoice');
      END;
      DROP TRIGGER IF EXISTS billing_part_paid_financial_guard;
      CREATE TRIGGER billing_part_paid_financial_guard
      BEFORE UPDATE ON billing
      WHEN COALESCE((
          SELECT SUM(ledger.amount)
          FROM billing_payment_ledger ledger
          WHERE ledger.billing_id = OLD.id
        ), 0) > 0.000001
        AND (
          NEW.items != OLD.items
          OR NEW.total_amount != OLD.total_amount
          OR NEW.voided_at IS NOT OLD.voided_at
        )
      BEGIN
        SELECT RAISE(ABORT, 'Invoices with an active payment balance cannot change financial lines; reverse the receipt before correcting the invoice');
      END;
      CREATE TABLE IF NOT EXISTS billing_events (
        id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL, actor_id INTEGER,
        event_type TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_billing_events_bill ON billing_events(bill_id, id);
      CREATE TABLE IF NOT EXISTS billing_lite_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        consultation_id INTEGER NOT NULL,
        billing_id INTEGER NOT NULL,
        doctor_id INTEGER NOT NULL,
        submitted_by_user_id INTEGER NOT NULL,
        operation_id TEXT NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        items_json TEXT NOT NULL DEFAULT '[]',
        amount_added REAL NOT NULL DEFAULT 0,
        workflow_status TEXT NOT NULL DEFAULT 'awaiting_operator',
        workflow_note TEXT NOT NULL DEFAULT '',
        workflow_updated_by_user_id INTEGER,
        workflow_updated_at TEXT,
        reversed_at TEXT,
        reversed_by_user_id INTEGER,
        reversal_reason TEXT NOT NULL DEFAULT '',
        reversal_operation_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE RESTRICT,
        FOREIGN KEY (billing_id) REFERENCES billing(id) ON DELETE RESTRICT,
        FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE RESTRICT,
        FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
        UNIQUE (submitted_by_user_id, operation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_billing_lite_visit
        ON billing_lite_submissions(consultation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_billing_lite_doctor
        ON billing_lite_submissions(doctor_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS billing_quick_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        submission_id INTEGER,
        consultation_id INTEGER NOT NULL,
        billing_id INTEGER,
        actor_user_id INTEGER,
        actor_name TEXT NOT NULL DEFAULT '',
        actor_role TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        previous_status TEXT,
        next_status TEXT,
        reason TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (submission_id) REFERENCES billing_lite_submissions(id) ON DELETE RESTRICT,
        FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE RESTRICT,
        FOREIGN KEY (billing_id) REFERENCES billing(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_billing_quick_events_visit
        ON billing_quick_events(consultation_id, created_at DESC);
      CREATE TRIGGER IF NOT EXISTS billing_quick_events_no_update
      BEFORE UPDATE ON billing_quick_events BEGIN
        SELECT RAISE(ABORT, 'Quick billing history is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_quick_events_no_delete
      BEFORE DELETE ON billing_quick_events BEGIN
        SELECT RAISE(ABORT, 'Quick billing history is append-only');
      END;
      DROP TRIGGER IF EXISTS billing_amount_guard_insert;
      DROP TRIGGER IF EXISTS billing_amount_guard_update;
      CREATE TRIGGER billing_amount_guard_insert
      BEFORE INSERT ON billing
      WHEN
        typeof(NEW.total_amount) NOT IN ('integer', 'real')
        OR NEW.total_amount < 0
        OR abs(NEW.total_amount * 100 - round(NEW.total_amount * 100)) > 0.000001
        OR json_valid(NEW.items) = 0
        OR (
          json_valid(NEW.items) = 1
          AND EXISTS (
            SELECT 1
            FROM json_each(NEW.items) AS line
            WHERE COALESCE(json_type(line.value, '$.amount'), '') NOT IN ('integer', 'real')
              OR CAST(json_extract(line.value, '$.amount') AS REAL) < 0
              OR abs(
                CAST(json_extract(line.value, '$.amount') AS REAL) * 100
                - round(CAST(json_extract(line.value, '$.amount') AS REAL) * 100)
              ) > 0.000001
              OR (
                json_type(line.value, '$.unit_price') IS NOT NULL
                AND (
                  json_type(line.value, '$.unit_price') NOT IN ('integer', 'real')
                  OR CAST(json_extract(line.value, '$.unit_price') AS REAL) < 0
                  OR abs(
                    CAST(json_extract(line.value, '$.unit_price') AS REAL) * 100
                    - round(CAST(json_extract(line.value, '$.unit_price') AS REAL) * 100)
                  ) > 0.000001
                )
              )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'Billing amounts must be non-negative currency values with no more than two decimal places');
      END;
      CREATE TRIGGER billing_amount_guard_update
      BEFORE UPDATE OF items, total_amount ON billing
      WHEN
        typeof(NEW.total_amount) NOT IN ('integer', 'real')
        OR NEW.total_amount < 0
        OR abs(NEW.total_amount * 100 - round(NEW.total_amount * 100)) > 0.000001
        OR json_valid(NEW.items) = 0
        OR (
          json_valid(NEW.items) = 1
          AND EXISTS (
            SELECT 1
            FROM json_each(NEW.items) AS line
            WHERE COALESCE(json_type(line.value, '$.amount'), '') NOT IN ('integer', 'real')
              OR CAST(json_extract(line.value, '$.amount') AS REAL) < 0
              OR abs(
                CAST(json_extract(line.value, '$.amount') AS REAL) * 100
                - round(CAST(json_extract(line.value, '$.amount') AS REAL) * 100)
              ) > 0.000001
              OR (
                json_type(line.value, '$.unit_price') IS NOT NULL
                AND (
                  json_type(line.value, '$.unit_price') NOT IN ('integer', 'real')
                  OR CAST(json_extract(line.value, '$.unit_price') AS REAL) < 0
                  OR abs(
                    CAST(json_extract(line.value, '$.unit_price') AS REAL) * 100
                    - round(CAST(json_extract(line.value, '$.unit_price') AS REAL) * 100)
                  ) > 0.000001
                )
              )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'Billing amounts must be non-negative currency values with no more than two decimal places');
      END;
    `);
    // Existing live databases may already contain case-only duplicates. Do not
    // fail startup or rewrite financial history; the API blocks new duplicates
    // while those historical references are reviewed.
    const duplicateInvoiceReference = db.prepare(`
      SELECT 1 FROM finance_supplier_invoices
      GROUP BY lower(trim(supplier_name)), lower(trim(invoice_number))
      HAVING COUNT(*) > 1 LIMIT 1
    `).get();
    if (!duplicateInvoiceReference) {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_invoice_reference_normalized
        ON finance_supplier_invoices(lower(trim(supplier_name)), lower(trim(invoice_number)))`);
    }
    if (process.env.NODE_ENV !== "test") {
      db.prepare(`
        INSERT INTO billing_system_settings (id, cutover_date, reset_reason)
        VALUES (1, '2026-05-14', 'Opened for billing trials before the 1 October 2026 go-live')
        ON CONFLICT(id) DO UPDATE SET
          cutover_date = CASE
            WHEN trim(COALESCE(billing_system_settings.cutover_date, '')) = '' THEN excluded.cutover_date
            ELSE billing_system_settings.cutover_date
          END,
          reset_reason = CASE
            WHEN trim(COALESCE(billing_system_settings.cutover_date, '')) = '' THEN excluded.reset_reason
            ELSE billing_system_settings.reset_reason
          END
      `).run();
      db.prepare(`
        UPDATE billing_system_settings
        SET
          cutover_date = '2026-05-14',
          reset_at = CURRENT_TIMESTAMP,
          reset_reason = 'Opened for billing trials before the 1 October 2026 go-live'
        WHERE id = 1
          AND (
            trim(COALESCE(cutover_date, '')) LIKE '2026-10-01%'
            OR (
              trim(COALESCE(cutover_date, '')) = '2026-05-01'
              AND reset_reason = 'Opened for billing trials before the 1 October 2026 go-live'
            )
          )
      `).run();
    }

    // Older compensating closes stored provider references only inside JSON.
    // Populate the immutable reference ledger so those historical references
    // participate in duplicate detection for every later adjustment.
    const insertAdjustmentReference = db.prepare(`
      INSERT OR IGNORE INTO financial_day_close_adjustment_references (
        adjustment_id, payment_method, external_reference
      ) VALUES (?, ?, ?)
    `);
    for (const adjustment of db.prepare(`
      SELECT id, settlement_references_json
      FROM financial_day_close_adjustments
      ORDER BY id ASC
    `).all()) {
      let references = {};
      try { references = JSON.parse(adjustment.settlement_references_json || '{}'); }
      catch { references = {}; }
      for (const method of ['juice', 'card', 'ib']) {
        const reference = String(references?.[method] || '').trim().replace(/\s+/g, ' ');
        if (reference) insertAdjustmentReference.run(adjustment.id, method, reference);
      }
    }

    // Invoice identifiers and party/category snapshots are accounting facts.
    // Backfill them once from the linked records, then serve them instead of
    // mutable patient/doctor directory values on historical invoices.
    add('finance_supplier_invoice_lines', 'previous_inventory_cost', 'REAL');
    add('finance_supplier_invoice_lines', 'previous_batch_cost', 'REAL');
    db.exec(`
      UPDATE billing
      SET doctor_commission_rate_snapshot = COALESCE(doctor_commission_rate_snapshot, ${Number(DOCTOR_COMMISSION_RATE)}),
          ocs_commission_rate_snapshot = COALESCE(ocs_commission_rate_snapshot, ${Number(OCS_COMMISSION_RATE)});
      UPDATE consultations
      SET transport_benefit_snapshot = COALESCE(transport_benefit_snapshot, ${Number(TRANSPORT_BENEFIT_PER_PATIENT)});
      DROP TRIGGER IF EXISTS billing_revenue_share_snapshot_after_insert;
      CREATE TRIGGER billing_revenue_share_snapshot_after_insert
      AFTER INSERT ON billing BEGIN
        UPDATE billing
        SET doctor_commission_rate_snapshot = COALESCE(NEW.doctor_commission_rate_snapshot, ${Number(DOCTOR_COMMISSION_RATE)}),
            ocs_commission_rate_snapshot = COALESCE(NEW.ocs_commission_rate_snapshot, ${Number(OCS_COMMISSION_RATE)})
        WHERE id = NEW.id;
      END;
      DROP TRIGGER IF EXISTS consultation_transport_snapshot_after_insert;
      CREATE TRIGGER consultation_transport_snapshot_after_insert
      AFTER INSERT ON consultations BEGIN
        UPDATE consultations
        SET transport_benefit_snapshot = COALESCE(NEW.transport_benefit_snapshot, ${Number(TRANSPORT_BENEFIT_PER_PATIENT)})
        WHERE id = NEW.id;
      END;

      UPDATE billing
      SET invoice_number = printf('OCS-INV-%08d', id)
      WHERE trim(COALESCE(invoice_number, '')) = '';

      UPDATE billing
      SET
        issued_at = COALESCE(issued_at, created_at),
        issued_by_user_id = COALESCE(issued_by_user_id, updated_by_user_id),
        issued_by_name = CASE
          WHEN trim(COALESCE(issued_by_name, '')) != '' THEN issued_by_name
          ELSE COALESCE((SELECT full_name FROM users WHERE users.id = billing.updated_by_user_id), 'System')
        END,
        issued_by_role = CASE
          WHEN trim(COALESCE(issued_by_role, '')) != '' THEN issued_by_role
          ELSE COALESCE((SELECT role FROM users WHERE users.id = billing.updated_by_user_id), 'system')
        END,
        patient_identifier_snapshot = CASE
          WHEN trim(COALESCE(patient_identifier_snapshot, '')) != '' THEN patient_identifier_snapshot
          ELSE COALESCE((SELECT patient_identifier FROM patients WHERE patients.id = billing.patient_id), '')
        END,
        patient_name_snapshot = CASE
          WHEN trim(COALESCE(patient_name_snapshot, '')) != '' THEN patient_name_snapshot
          ELSE COALESCE((SELECT full_name FROM patients WHERE patients.id = billing.patient_id), '')
        END,
        doctor_id_snapshot = COALESCE(
          doctor_id_snapshot,
          (SELECT doctor_id FROM consultations WHERE consultations.id = billing.consultation_id)
        ),
        doctor_name_snapshot = CASE
          WHEN trim(COALESCE(doctor_name_snapshot, '')) != '' THEN doctor_name_snapshot
          ELSE COALESCE((
            SELECT doctors.full_name
            FROM consultations
            JOIN doctors ON doctors.id = consultations.doctor_id
            WHERE consultations.id = billing.consultation_id
          ), '')
        END,
        consultation_date_snapshot = COALESCE(
          consultation_date_snapshot,
          (SELECT consultation_date FROM consultations WHERE consultations.id = billing.consultation_id)
        ),
        consultation_type_snapshot = CASE
          WHEN trim(COALESCE(consultation_type_snapshot, '')) != '' THEN consultation_type_snapshot
          ELSE COALESCE((
            SELECT json_extract(line.value, '$.description')
            FROM json_each(billing.items) AS line
            WHERE COALESCE(json_extract(line.value, '$.is_consultation_fee'), 0) = 1
            LIMIT 1
          ), '')
        END,
        partner_category_snapshot = CASE
          WHEN trim(COALESCE(partner_category_snapshot, '')) != '' THEN partner_category_snapshot
          ELSE COALESCE(NULLIF(trim((
            SELECT insurance_provider FROM patients WHERE patients.id = billing.patient_id
          )), ''), 'Self-pay')
        END;
    `);

    // Older operator invoices kept the paper reference inside change_reason.
    // Recover only the first occurrence of each reference so a historical
    // duplicate is visible without preventing startup of the stricter schema.
    const seenSourceReferences = new Set(
      db.prepare(`
        SELECT source_reference
        FROM billing
        WHERE source_reference IS NOT NULL AND trim(source_reference) != ''
      `).all().map((bill) => String(bill.source_reference).trim().replace(/\s+/g, ' ').toLocaleLowerCase()),
    );
    const historicalPaperBills = db.prepare(`
      SELECT
        b.id,
        CASE
          WHEN b.change_reason LIKE 'Paper invoice: %' THEN substr(b.change_reason, 16)
          ELSE (
            SELECT substr(e.reason, 16)
            FROM billing_events e
            WHERE e.bill_id = b.id AND e.reason LIKE 'Paper invoice: %'
            ORDER BY e.id ASC
            LIMIT 1
          )
        END AS source_reference
      FROM billing b
      WHERE b.source_reference IS NULL
        AND (
          b.change_reason LIKE 'Paper invoice: %'
          OR EXISTS (
            SELECT 1 FROM billing_events e
            WHERE e.bill_id = b.id AND e.reason LIKE 'Paper invoice: %'
          )
        )
      ORDER BY b.id ASC
    `).all();
    const restoreSourceReference = db.prepare(
      'UPDATE billing SET source_reference = ? WHERE id = ?',
    );
    for (const bill of historicalPaperBills) {
      const reference = String(bill.source_reference || '').trim().replace(/\s+/g, ' ');
      const key = reference.toLocaleLowerCase();
      if (!reference || seenSourceReferences.has(key)) continue;
      seenSourceReferences.add(key);
      restoreSourceReference.run(reference, bill.id);
    }

    db.exec(`
      INSERT INTO billing_payment_transactions (
        billing_id, amount, payment_method, payment_date, external_reference,
        operation_id, recorded_by_user_id, recorded_by_name, recorded_by_role, source
      )
      SELECT
        b.id,
        b.total_amount,
        b.payment_method,
        COALESCE(NULLIF(b.payment_date, ''), date(b.created_at, '+4 hours')),
        NULL,
        'legacy-paid-bill-' || b.id,
        b.updated_by_user_id,
        COALESCE((SELECT full_name FROM users WHERE id = b.updated_by_user_id), 'Legacy staff record'),
        COALESCE((SELECT role FROM users WHERE id = b.updated_by_user_id), 'legacy'),
        'legacy_migration'
      FROM billing b
      WHERE b.status = 'paid'
        AND b.voided_at IS NULL
        AND b.total_amount > 0
        AND b.payment_method IN ('cash', 'juice', 'card', 'ib')
        AND NOT EXISTS (
          SELECT 1 FROM billing_payment_transactions payment WHERE payment.billing_id = b.id
        );
    `);

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_invoice_number_unique
        ON billing(invoice_number)
        WHERE trim(invoice_number) != '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_source_reference_unique
        ON billing(lower(trim(source_reference)))
        WHERE source_reference IS NOT NULL AND trim(source_reference) != '';
      DROP TRIGGER IF EXISTS billing_invoice_number_after_insert;
      CREATE TRIGGER billing_invoice_number_after_insert
      AFTER INSERT ON billing
      WHEN trim(COALESCE(NEW.invoice_number, '')) = ''
      BEGIN
        UPDATE billing
        SET invoice_number = printf('OCS-INV-%08d', NEW.id)
        WHERE id = NEW.id;
      END;
    `);
    add('billing_lite_submissions', 'workflow_status', "TEXT NOT NULL DEFAULT 'awaiting_operator'");
    add('billing_lite_submissions', 'workflow_note', "TEXT NOT NULL DEFAULT ''");
    add('billing_lite_submissions', 'workflow_updated_by_user_id', 'INTEGER');
    add('billing_lite_submissions', 'workflow_updated_at', 'TEXT');
    add('billing_lite_submissions', 'reversed_at', 'TEXT');
    add('billing_lite_submissions', 'reversed_by_user_id', 'INTEGER');
    add('billing_lite_submissions', 'reversal_reason', "TEXT NOT NULL DEFAULT ''");
    add('billing_lite_submissions', 'reversal_operation_id', 'TEXT');
    db.exec(`
      UPDATE billing_lite_submissions
      SET workflow_status = 'completed',
          workflow_updated_at = COALESCE(workflow_updated_at, CURRENT_TIMESTAMP)
      WHERE reversed_at IS NULL
        AND workflow_status NOT IN ('completed', 'corrected', 'reversed', 'superseded')
        AND EXISTS (
          SELECT 1
          FROM billing
          WHERE billing.id = billing_lite_submissions.billing_id
            AND billing.status = 'paid'
            AND billing.voided_at IS NULL
        );
    `);
    db.exec(`
      UPDATE billing
      SET finalized_at = COALESCE(finalized_at, issued_at, created_at),
          finalized_by_user_id = COALESCE(finalized_by_user_id, issued_by_user_id),
          finalized_by_name = CASE
            WHEN trim(COALESCE(finalized_by_name, '')) = '' THEN COALESCE(NULLIF(issued_by_name, ''), 'Historical migration')
            ELSE finalized_by_name
          END,
          finalized_by_role = CASE
            WHEN trim(COALESCE(finalized_by_role, '')) = '' THEN COALESCE(NULLIF(issued_by_role, ''), 'migration')
            ELSE finalized_by_role
          END
      WHERE finalized_at IS NULL
        AND (
          status = 'paid'
          OR EXISTS (
            SELECT 1 FROM billing_payment_transactions payment
            WHERE payment.billing_id = billing.id
          )
          OR EXISTS (
            SELECT 1 FROM billing_lite_submissions submission
            WHERE submission.billing_id = billing.id
              AND submission.reversed_at IS NULL
              AND submission.workflow_status NOT IN ('reversed', 'superseded')
          )
          OR trim(COALESCE(source_reference, '')) != ''
        );
    `);
    if (!db.prepare("SELECT 1 FROM financial_migrations WHERE name='consultation_tariffs_20260909'").get()) {
      for (const [name, amount] of Object.entries(require('./consultationFees').CONSULTATION_FEES)) {
        db.prepare('UPDATE consultation_fee_types SET default_amount=?, updated_at=CURRENT_TIMESTAMP WHERE type_name=?').run(amount, name);
      }
      db.prepare("INSERT INTO financial_migrations(name) VALUES ('consultation_tariffs_20260909')").run();
    }
    add('billing_events', 'actor_name', "TEXT NOT NULL DEFAULT ''");
    add('billing_events', 'actor_role', "TEXT NOT NULL DEFAULT ''");
    const actorName = id => `(SELECT full_name FROM users WHERE id=${id})`;
    const actorRole = id => `(SELECT role FROM users WHERE id=${id})`;
    const snapshot = alias => `json_object('status', ${alias}.status, 'total_amount', ${alias}.total_amount,
      'items', ${alias}.items, 'payment_method', ${alias}.payment_method,
      'payment_date', ${alias}.payment_date, 'voided_at', ${alias}.voided_at, 'fee_review_required', ${alias}.fee_review_required,
      'legacy_fee_review_required', ${alias}.legacy_fee_review_required)`;
    db.exec(`
      INSERT INTO billing_events(bill_id, actor_id, actor_name, actor_role, event_type, after_json, reason)
      SELECT b.id, b.updated_by_user_id, COALESCE(${actorName('b.updated_by_user_id')}, ''), COALESCE(${actorRole('b.updated_by_user_id')}, ''), 'migration_baseline', ${snapshot('b')},
        'Opening snapshot; changes before this migration are not reconstructed.'
      FROM billing b WHERE NOT EXISTS (SELECT 1 FROM billing_events e WHERE e.bill_id = b.id);
      DROP TRIGGER IF EXISTS billing_event_insert;
      DROP TRIGGER IF EXISTS billing_event_update;
      CREATE TRIGGER billing_event_insert AFTER INSERT ON billing
      WHEN NEW.items != '[]' BEGIN
        INSERT INTO billing_events(bill_id, actor_id, actor_name, actor_role, event_type, after_json)
        VALUES (NEW.id, NEW.updated_by_user_id, COALESCE(${actorName('NEW.updated_by_user_id')}, ''), COALESCE(${actorRole('NEW.updated_by_user_id')}, ''), 'created', ${snapshot('NEW')});
      END;
      CREATE TRIGGER IF NOT EXISTS billing_event_update AFTER UPDATE OF items, total_amount, status, payment_method, payment_date, voided_at, fee_review_required, legacy_fee_review_required ON billing
      WHEN ${snapshot('OLD')} != ${snapshot('NEW')} BEGIN
        INSERT INTO billing_events(bill_id, actor_id, actor_name, actor_role, event_type, before_json, after_json, reason)
        VALUES (NEW.id, COALESCE(NEW.voided_by_user_id, NEW.updated_by_user_id),
          COALESCE(${actorName('COALESCE(NEW.voided_by_user_id, NEW.updated_by_user_id)')}, ''),
          COALESCE(${actorRole('COALESCE(NEW.voided_by_user_id, NEW.updated_by_user_id)')}, ''),
          CASE WHEN NEW.voided_at IS NOT OLD.voided_at THEN 'voided' WHEN OLD.items = '[]' THEN 'created' ELSE 'updated' END,
          CASE WHEN OLD.items = '[]' THEN NULL ELSE ${snapshot('OLD')} END, ${snapshot('NEW')}, CASE WHEN NEW.voided_at IS NOT OLD.voided_at THEN NEW.void_reason ELSE NEW.change_reason END);
        UPDATE billing SET row_version = OLD.row_version + 1 WHERE id = NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS billing_events_no_update BEFORE UPDATE ON billing_events BEGIN
        SELECT RAISE(ABORT, 'Billing history is append-only');
      END;
      CREATE TRIGGER IF NOT EXISTS billing_events_no_delete BEFORE DELETE ON billing_events BEGIN
        SELECT RAISE(ABORT, 'Billing history is append-only');
      END;
    `);
    if (!db.prepare("SELECT 1 FROM financial_migrations WHERE name='legacy_unpaid_fee_review_20260909'").get()) {
      const { isConsultationFee, CONSULTATION_FEES } = require('./consultationFees');
      for (const bill of db.prepare("SELECT id, items FROM billing WHERE status='unpaid' AND voided_at IS NULL AND fee_review_required=0").all()) {
        let items;
        try { items = JSON.parse(bill.items); } catch { continue; }
        if (!Array.isArray(items)) continue;
        const fees = items.filter(isConsultationFee);
        if (!fees.some(line => line.is_consultation_fee !== true || Number(line.amount) !== CONSULTATION_FEES[line.description])) continue;
        db.prepare(`UPDATE billing SET fee_review_required=1, legacy_fee_review_required=1,
          updated_by_user_id=NULL, change_reason='Historical unpaid fee requires source-record verification; amount preserved'
          WHERE id=?`).run(bill.id);
      }
      db.prepare("INSERT INTO financial_migrations(name) VALUES ('legacy_unpaid_fee_review_20260909')").run();
    }
    // Preserve exact allocation costs where available. Legacy catalogue values
    // are frozen once and explicitly labelled estimates, never silently repriced.
    db.exec(`
      UPDATE inventory_movements AS m SET
        unit_cost_snapshot = COALESCE((SELECT SUM(a.quantity*a.unit_cost)/SUM(a.quantity) FROM inventory_movement_allocations a WHERE a.movement_id=m.id),
          (SELECT cost_price FROM inventory WHERE id=m.item_id), 0),
        unit_price_snapshot = COALESCE((SELECT selling_price FROM inventory WHERE id=m.item_id), 0),
        valuation_basis = 'legacy_estimate'
      WHERE unit_cost_snapshot IS NULL;
      CREATE TRIGGER IF NOT EXISTS movement_price_snapshot AFTER INSERT ON inventory_movements BEGIN
        UPDATE inventory_movements SET
          unit_cost_snapshot = COALESCE(NEW.unit_cost_snapshot, (SELECT cost_price FROM inventory WHERE id=NEW.item_id), 0),
          unit_price_snapshot = COALESCE(NEW.unit_price_snapshot, (SELECT selling_price FROM inventory WHERE id=NEW.item_id), 0),
          valuation_basis = COALESCE(NEW.valuation_basis, 'recorded_price')
        WHERE id=NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS movement_allocation_cost AFTER INSERT ON inventory_movement_allocations BEGIN
        UPDATE inventory_movements SET unit_cost_snapshot =
          (SELECT SUM(quantity*unit_cost)/SUM(quantity) FROM inventory_movement_allocations WHERE movement_id=NEW.movement_id)
        WHERE id=NEW.movement_id;
      END;
    `);
  }).immediate();
}
module.exports = { ensureFinancialIntegritySchema };
