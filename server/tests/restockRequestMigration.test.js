"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const TMP_DB = path.join(os.tmpdir(), `ocs-restock-migration-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const {
  db,
  initializeDatabase,
  inspectRestockRequestItemForeignKeys,
  migrateRestockRequestsSchemaIfNeeded,
} = require("../src/db");
const { isValidIsoCalendarDate } = require("../src/lib/calendarDate");

function fkCheck(tableName) {
  return db.prepare(`PRAGMA foreign_key_check(${tableName})`).all();
}

function plantStaleChildForeignKey() {
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE restock_request_items_stale (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      inventory_id INTEGER,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES restock_requests_legacy(id) ON DELETE RESTRICT,
      FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE SET NULL
    );
    INSERT INTO restock_request_items_stale (id, request_id, inventory_id, item_name, quantity, created_at)
    SELECT id, request_id, inventory_id, item_name, quantity, created_at FROM restock_request_items;
    DROP TABLE restock_request_items;
    ALTER TABLE restock_request_items_stale RENAME TO restock_request_items;
  `);
  db.pragma("foreign_keys = ON");
}

before(() => {
  initializeDatabase();
});

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${TMP_DB}${suffix}`);
    } catch {
      // ignore
    }
  }
});

test("calendar dates reject impossible ISO values", () => {
  assert.equal(isValidIsoCalendarDate("2028-02-29"), true);
  assert.equal(isValidIsoCalendarDate("2027-02-29"), false);
  assert.equal(isValidIsoCalendarDate("2027-02-31"), false);
  assert.equal(isValidIsoCalendarDate("2027-13-01"), false);
  assert.equal(isValidIsoCalendarDate("2027-00-10"), false);
  assert.equal(isValidIsoCalendarDate("2027-1-01"), false);
  assert.equal(isValidIsoCalendarDate("not-a-date"), false);
});

test("fresh database restock_request_items references restock_requests", () => {
  const inspection = inspectRestockRequestItemForeignKeys();
  assert.equal(inspection.stale, false);
  assert.equal(inspection.referencedTable, "restock_requests");
  assert.equal(fkCheck("restock_request_items").length, 0);
});

test("fully upgraded database keeps current child foreign keys", () => {
  const first = migrateRestockRequestsSchemaIfNeeded();
  const inspection = inspectRestockRequestItemForeignKeys();
  assert.equal(inspection.stale, false);
  assert.equal(inspection.referencedTable, "restock_requests");
  assert.equal(first.childRepair.repaired, false);
});

test("current parent table with a stale child foreign key is repaired", () => {
  const folderId = db.prepare("SELECT id FROM inventory_folders LIMIT 1").get().id;
  const inventoryId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope)
         VALUES ('Migration Gauze', ?, 4, 0, 'unit', 1, 2, 'ocs')`,
      )
      .run(folderId).lastInsertRowid,
  );
  const doctor = db.prepare("SELECT id, doctor_id FROM users WHERE username = 'arun.dharee'").get();
  const requestId = Number(
    db
      .prepare(
        `INSERT INTO restock_requests (doctor_id, requested_by_user_id, collection_date, collection_day, status, note)
         VALUES (?, ?, '2026-09-07', 1, 'pending', 'fk-repair')`,
      )
      .run(doctor.doctor_id, doctor.id).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO restock_request_items (request_id, inventory_id, item_name, quantity) VALUES (?, ?, 'Migration Gauze', 2)`,
  ).run(requestId, inventoryId);

  plantStaleChildForeignKey();
  const before = inspectRestockRequestItemForeignKeys();
  assert.equal(before.stale, true);
  assert.equal(before.referencedTable, "restock_requests_legacy");

  const result = migrateRestockRequestsSchemaIfNeeded();
  assert.equal(result.childRepair.repaired, true);
  const after = inspectRestockRequestItemForeignKeys();
  assert.equal(after.stale, false);
  assert.equal(after.referencedTable, "restock_requests");
  const row = db.prepare("SELECT * FROM restock_request_items WHERE request_id = ?").get(requestId);
  assert.equal(Number(row.quantity), 2);
  assert.equal(Number(row.inventory_id), inventoryId);
  assert.equal(fkCheck("restock_request_items").length, 0);
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
});

test("re-running the restock migration is idempotent", () => {
  const again = migrateRestockRequestsSchemaIfNeeded();
  assert.equal(again.childRepair.repaired, false);
  assert.equal(inspectRestockRequestItemForeignKeys().stale, false);
  assert.equal(fkCheck("restock_request_items").length, 0);
});

test("creating a request and item rows still works after migration", () => {
  const doctor = db.prepare("SELECT id, doctor_id FROM users WHERE username = 'arun.dharee'").get();
  const inventory = db.prepare("SELECT id FROM inventory WHERE stock_scope = 'ocs' LIMIT 1").get();
  const requestId = Number(
    db
      .prepare(
        `INSERT INTO restock_requests (doctor_id, requested_by_user_id, collection_date, collection_day, status, note)
         VALUES (?, ?, '2026-09-09', 3, 'pending', 'post-migration')`,
      )
      .run(doctor.doctor_id, doctor.id).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO restock_request_items (request_id, inventory_id, item_name, quantity) VALUES (?, ?, 'Post migration item', 1)`,
  ).run(requestId, inventory.id);
  assert.equal(fkCheck("restock_request_items").length, 0);
  const stored = db.prepare("SELECT quantity FROM restock_request_items WHERE request_id = ?").get(requestId);
  assert.equal(Number(stored.quantity), 1);
});
