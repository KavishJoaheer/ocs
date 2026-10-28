const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-withdrawn-inventory-"));
process.env.DB_PATH = path.join(tempDir, "test.db");
process.env.NODE_ENV = "test";
const { db, initializeDatabase } = require("../src/db");
const { WITHDRAWN_INVENTORY_NAMES, removeWithdrawnInventory } = require("../src/lib/removeWithdrawnInventory");
initializeDatabase();
after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function snapshot() {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}

function insertItem(name, scope = "ocs", quantity = 0) {
  const doctorId = scope === "doctor" ? db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get().id : null;
  return Number(db.prepare(`INSERT INTO inventory
    (item_name, stock_scope, owner_doctor_id, quantity, minimum_quantity, unit, cost_price, selling_price)
    VALUES (?, ?, ?, ?, 2, 'unit', 10, 20)`).run(name, scope, doctorId, quantity).lastInsertRowid);
}

test("withdrawn SKUs are absent from seed catalogues while neighbouring sizes remain", () => {
  const { ocsIMDrugsExtension } = require("../src/config/ocsIMDrugsExtension");
  const { ocsWoundDressingExtension } = require("../src/config/ocsWoundDressingExtension");
  const { ocsConsumablesExtension } = require("../src/config/ocsConsumablesExtension");
  const { ocsMasterStockData } = require("../src/config/ocsMasterStockData");
  const names = new Set([...ocsIMDrugsExtension, ...ocsWoundDressingExtension,
    ...ocsConsumablesExtension, ...ocsMasterStockData].map((row) => row.name.toLowerCase()));
  for (const name of WITHDRAWN_INVENTORY_NAMES) assert.equal(names.has(name.toLowerCase()), false, name);
  for (const name of ["Lovenox 0.4ml", "Tegaderm 9x10cm", "Tegaderm 9x15cm", "Alcohol 250ml"]) {
    assert.equal(names.has(name.toLowerCase()), true, name);
  }
});

test("cleanup deletes only the six exact SKUs and their inventory records, and is repeatable", () => {
  db.exec("SAVEPOINT cleanup_test");
  try {
    for (const name of ["Lovenox 0.4ml", "Tegaderm 9x10cm", "Alcohol 250ml", "Needle Blue box", "White Adhesive Tape", "Staple remover"]) {
      const id = insertItem(name, "ocs", 8);
      db.prepare("INSERT INTO inventory_batches (item_id, quantity_remaining, unit_cost) VALUES (?, 8, 10)").run(id);
    }
    const deletedIds = {};
    function insert(table, sql, ...args) {
      const id = Number(db.prepare(sql).run(...args).lastInsertRowid);
      (deletedIds[table] ||= new Set()).add(id);
      return id;
    }
    for (const [index, name] of WITHDRAWN_INVENTORY_NAMES.entries()) {
      for (const scope of ["ocs", "doctor"]) {
        const label = index === 0 ? ` ${name.toUpperCase()} ` : name;
        const id = insertItem(label, scope, name === "Needle Black box" ? 40 : 1);
        (deletedIds.inventory ||= new Set()).add(id);
        const batchId = insert("inventory_batches", "INSERT INTO inventory_batches (item_id, quantity_remaining, unit_cost) VALUES (?, 1, 10)", id);
        const movementId = insert("inventory_movements", `INSERT INTO inventory_movements
          (item_id, movement_type, quantity, previous_quantity, next_quantity, note)
          VALUES (?, 'in', 1, 0, 1, 'Receipt')`, id);
        insert("inventory_movement_allocations", "INSERT INTO inventory_movement_allocations (movement_id, batch_id, quantity) VALUES (?, ?, 1)", movementId, batchId);
        insert("inventory_batch_quarantine_events", `INSERT INTO inventory_batch_quarantine_events
          (batch_id, item_id, action_type, reason) VALUES (?, ?, 'quarantine', 'Review')`, batchId, id);
        insert("inventory_stocktakes", "INSERT INTO inventory_stocktakes (item_id) VALUES (?)", id);
        insert("inventory_audit_logs", "INSERT INTO inventory_audit_logs (action_type, item_id, item_name) VALUES ('create', ?, ?)", id, label);
        insert("inventory_activity_history", "INSERT INTO inventory_activity_history (movement_id, item_name) VALUES (?, ?)", movementId, label);
        const folderId = db.prepare("SELECT id FROM inventory_folders ORDER BY id LIMIT 1").get().id;
        insert("inventory_staging", "INSERT INTO inventory_staging (folder_id, item_name, quantity, unit) VALUES (?, ?, 1, 'unit')", folderId, label);
      }
    }
    const sessionId = Number(db.prepare("INSERT INTO inventory_stocktake_sessions (scope, status) VALUES ('ocs', 'in_progress')").run().lastInsertRowid);
    const targetId = [...deletedIds.inventory][0];
    insert("inventory_stocktake_session_items", "INSERT INTO inventory_stocktake_session_items (session_id, inventory_id) VALUES (?, ?)", sessionId, targetId);
    const keptId = db.prepare("SELECT id FROM inventory WHERE item_name='Needle Blue box'").get().id;
    db.prepare("INSERT INTO inventory_stocktake_session_items (session_id, inventory_id) VALUES (?, ?)").run(sessionId, keptId);

    const before = snapshot();
    const expected = Object.fromEntries(Object.entries(before).map(([table, rows]) =>
      [table, rows.filter((row) => !deletedIds[table]?.has(row.id))]));
    assert.deepEqual(removeWithdrawnInventory(db), { removed: 12 });
    assert.deepEqual(snapshot(), expected, "every unrelated row in every table must remain identical");
    assert.deepEqual(removeWithdrawnInventory(db), { removed: 0 });
    assert.deepEqual(snapshot(), expected);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.exec("ROLLBACK TO cleanup_test; RELEASE cleanup_test");
  }
});

test("billing links prevent partial cleanup and leave all tables identical", () => {
  db.exec("SAVEPOINT billing_test");
  try {
    const id = insertItem("Lovenox 0.2ml");
    insertItem("Alcohol 500ml");
    const consultation = db.prepare("SELECT id, patient_id FROM consultations ORDER BY id LIMIT 1").get();
    db.prepare(`INSERT INTO billing (patient_id, consultation_id, items, total_amount, status)
      VALUES (?, ?, ?, 0, 'unpaid')`).run(consultation.patient_id, consultation.id, JSON.stringify([{ inventory_item_id: id, description: "Supply", quantity: 1, amount: 0 }]));
    const before = snapshot();
    assert.throws(() => removeWithdrawnInventory(db), /linked billing/);
    assert.deepEqual(snapshot(), before);
  } finally {
    db.exec("ROLLBACK TO billing_test; RELEASE billing_test");
  }
});

test("database initialization applies the cleanup to existing installations", () => {
  insertItem("Adhesive Tape");
  initializeDatabase();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE item_name='Adhesive Tape'").get().n, 0);
});

test("restock links stay intact instead of being silently set to null", () => {
  db.exec("SAVEPOINT restock_test");
  try {
    const id = insertItem("Needle Black box", "ocs", 40);
    const doctorId = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get().id;
    const userId = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get().id;
    const requestId = Number(db.prepare(`INSERT INTO restock_requests
      (doctor_id, requested_by_user_id, collection_date, collection_day)
      VALUES (?, ?, '2026-10-30', 5)`).run(doctorId, userId).lastInsertRowid);
    db.prepare("INSERT INTO restock_request_items (request_id, inventory_id, item_name, quantity) VALUES (?, ?, 'Needle Black box', 2)").run(requestId, id);
    const before = snapshot();
    assert.throws(() => removeWithdrawnInventory(db), /linked restock/);
    assert.deepEqual(snapshot(), before);
  } finally {
    db.exec("ROLLBACK TO restock_test; RELEASE restock_test");
  }
});

test("supplier invoice restrictions roll back even inventory history already deleted", () => {
  db.exec("SAVEPOINT supplier_test");
  try {
    const id = insertItem("Alcohol 500ml", "ocs", 1);
    db.prepare("INSERT INTO inventory_audit_logs (action_type, item_id, item_name) VALUES ('create', ?, 'Alcohol 500ml')").run(id);
    const batchId = Number(db.prepare("INSERT INTO inventory_batches (item_id, quantity_remaining, unit_cost) VALUES (?, 1, 10)").run(id).lastInsertRowid);
    const invoiceId = Number(db.prepare(`INSERT INTO finance_supplier_invoices
      (supplier_name, invoice_number, invoice_date, operation_id)
      VALUES ('Cleanup test supplier', 'CLEANUP-1', '2026-01-01', 'cleanup-supplier-test')`).run().lastInsertRowid);
    db.prepare(`INSERT INTO finance_supplier_invoice_lines
      (supplier_invoice_id, inventory_item_id, batch_id, description, quantity, unit_cost)
      VALUES (?, ?, ?, 'Alcohol 500ml', 1, 10)`).run(invoiceId, id, batchId);
    const before = snapshot();
    assert.throws(() => removeWithdrawnInventory(db), /FOREIGN KEY/);
    assert.deepEqual(snapshot(), before);
  } finally {
    db.exec("ROLLBACK TO supplier_test; RELEASE supplier_test");
  }
});
