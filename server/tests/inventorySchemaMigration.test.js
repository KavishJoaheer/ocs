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
});
