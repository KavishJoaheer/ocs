// Additive migration: retain financial history and freeze movement valuations.
function ensureFinancialIntegritySchema(db) {
  const add = (table, name, type) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  };
  db.transaction(() => {
    add('billing', 'row_version', 'INTEGER NOT NULL DEFAULT 1');
    add('billing', 'change_reason', "TEXT NOT NULL DEFAULT ''");
    add('inventory_movements', 'unit_cost_snapshot', 'REAL');
    add('inventory_movements', 'unit_price_snapshot', 'REAL');
    add('inventory_movements', 'valuation_basis', 'TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS operation_receipts (
        actor_id INTEGER NOT NULL, scope TEXT NOT NULL, operation_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(actor_id, scope, operation_id)
      );
      CREATE TABLE IF NOT EXISTS billing_events (
        id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL, actor_id INTEGER,
        event_type TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_billing_events_bill ON billing_events(bill_id, id);
    `);
    add('billing_events', 'actor_name', "TEXT NOT NULL DEFAULT ''");
    add('billing_events', 'actor_role', "TEXT NOT NULL DEFAULT ''");
    const actorName = id => `(SELECT full_name FROM users WHERE id=${id})`;
    const actorRole = id => `(SELECT role FROM users WHERE id=${id})`;
    const snapshot = alias => `json_object('status', ${alias}.status, 'total_amount', ${alias}.total_amount,
      'items', ${alias}.items, 'payment_method', ${alias}.payment_method,
      'payment_date', ${alias}.payment_date, 'voided_at', ${alias}.voided_at)`;
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
      CREATE TRIGGER IF NOT EXISTS billing_event_update AFTER UPDATE OF items, total_amount, status, payment_method, payment_date, voided_at ON billing
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
