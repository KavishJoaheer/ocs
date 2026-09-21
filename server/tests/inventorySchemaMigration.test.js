"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const TMP_DB = path.join(os.tmpdir(), `ocs-inv-schema-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { db, initializeDatabase, ensureInventoryOperationsSchema } = require("../src/db");

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

test("clean inventory databases include release and recount columns", () => {
  const staging = db.prepare("PRAGMA table_info(inventory_staging)").all().map((row) => row.name);
  const items = db.prepare("PRAGMA table_info(inventory_stocktake_session_items)").all().map((row) => row.name);
  assert.ok(staging.includes("release_transaction_id"));
  assert.ok(staging.includes("released_inventory_id"));
  assert.ok(staging.includes("released_batch_id"));
  assert.ok(items.includes("recounted_by_user_id"));
  assert.ok(items.includes("recounted_at"));
  assert.ok(items.includes("previous_count_quantity"));
  assert.ok(items.includes("previous_count_at"));
  assert.ok(items.includes("previous_count_session_id"));
  assert.ok(items.includes("surplus_expiry_date"));
  assert.ok(items.includes("surplus_is_non_expiring"));
  assert.ok(items.includes("surplus_unit_cost"));
  assert.ok(items.includes("surplus_supplier_name"));
  assert.ok(items.includes("surplus_received_date"));
  const sessions = db.prepare("PRAGMA table_info(inventory_stocktake_sessions)").all().map((row) => row.name);
  assert.ok(sessions.includes("owner_doctor_id"));
  assert.ok(sessions.includes("scope_token"));
  const batches = db.prepare("PRAGMA table_info(inventory_batches)").all().map((row) => row.name);
  assert.ok(batches.includes("supplier_name"));
  assert.ok(batches.includes("received_date"));
});

test("previously upgraded inventory databases keep release columns when migrations re-run", () => {
  ensureInventoryOperationsSchema();
  ensureInventoryOperationsSchema();
  const upgraded = db.prepare("PRAGMA table_info(inventory_staging)").all().map((row) => row.name);
  const items = db.prepare("PRAGMA table_info(inventory_stocktake_session_items)").all().map((row) => row.name);
  assert.ok(upgraded.includes("release_transaction_id"));
  assert.ok(upgraded.includes("released_inventory_id"));
  assert.ok(upgraded.includes("released_batch_id"));
  assert.ok(items.includes("recounted_by_user_id"));
  assert.ok(items.includes("recounted_at"));
  assert.ok(items.includes("previous_count_quantity"));
  assert.ok(items.includes("previous_count_at"));
  assert.ok(items.includes("previous_count_session_id"));
  assert.ok(items.includes("surplus_expiry_date"));
  assert.ok(items.includes("surplus_is_non_expiring"));
  assert.ok(items.includes("surplus_unit_cost"));
  assert.ok(items.includes("surplus_supplier_name"));
  assert.ok(items.includes("surplus_received_date"));
});

test("staging migration recovers from a leftover temporary table", () => {
  const folderId = db.prepare("SELECT id FROM inventory_folders ORDER BY id LIMIT 1").get().id;
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("DROP TABLE IF EXISTS inventory_staging_migrated");
  db.exec("DROP TABLE inventory_staging");
  db.exec(`
    CREATE TABLE inventory_staging (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      minimum_quantity INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'unit',
      cost_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      attributes TEXT NOT NULL DEFAULT '',
      moa_notes TEXT NOT NULL DEFAULT '',
      expiry_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released', 'cancelled')),
      created_by_user_id INTEGER,
      released_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      released_at TEXT
    );
    CREATE TABLE inventory_staging_migrated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
    );
  `);
  db.prepare("INSERT INTO inventory_staging (folder_id, item_name, quantity) VALUES (?, ?, ?)")
    .run(folderId, "Migration recovery item", 7);
  db.exec("PRAGMA foreign_keys = ON");

  ensureInventoryOperationsSchema();

  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inventory_staging'").get().sql;
  const columns = db.prepare("PRAGMA table_info(inventory_staging)").all().map((row) => row.name);
  const preserved = db.prepare("SELECT item_name, quantity FROM inventory_staging WHERE item_name = ?").get("Migration recovery item");
  assert.match(ddl, /'excluded'/);
  assert.ok(columns.includes("release_transaction_id"));
  assert.ok(columns.includes("released_inventory_id"));
  assert.ok(columns.includes("released_batch_id"));
  assert.deepEqual(preserved, { item_name: "Migration recovery item", quantity: 7 });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'inventory_staging_migrated'").get().count,
    0,
  );
});
