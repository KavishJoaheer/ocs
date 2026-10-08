"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const TMP_DB = path.join(
  os.tmpdir(),
  `ocs-tech-operator-migration-${process.pid}-${Date.now()}.db`,
);

process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = "test";

const legacyDb = new Database(TMP_DB);
legacyDb.exec(`
  CREATE TABLE doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    specialization TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'doctor', 'operator', 'lab_tech', 'accountant', 'linkham_admin')),
    password_hash TEXT NOT NULL,
    doctor_id INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    operation_status TEXT NOT NULL DEFAULT 'active',
    operation_status_updated_at TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL
  );

  CREATE TABLE auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE audit_probe (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    actor_name TEXT NOT NULL DEFAULT ''
  );

  CREATE TRIGGER audit_probe_insert
  AFTER INSERT ON audit_probe
  WHEN NEW.user_id IS NOT NULL
  BEGIN
    UPDATE audit_probe
    SET actor_name = COALESCE((SELECT full_name FROM users WHERE id = NEW.user_id), '')
    WHERE id = NEW.id;
  END;

  INSERT INTO users (username, full_name, role, password_hash)
  VALUES ('existing.admin', 'Existing Admin', 'admin', 'salt:hash');
`);
legacyDb.close();

const { db, initializeDatabase } = require("../src/db");

after(() => {
  try {
    db.close();
  } catch {
    // Best-effort test cleanup.
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${TMP_DB}${suffix}`);
    } catch {
      // Best-effort test cleanup.
    }
  }
});

test("existing databases gain the tech operator role without breaking user references", () => {
  initializeDatabase();

  const usersSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get().sql;
  assert.match(usersSql, /'tech_operator'/);

  const authSessionUserReference = db
    .prepare("PRAGMA foreign_key_list(auth_sessions)")
    .all()
    .find((foreignKey) => foreignKey.from === "user_id");
  assert.equal(authSessionUserReference.table, "users");

  const triggerSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'audit_probe_insert'")
    .get().sql;
  assert.doesNotMatch(triggerSql, /users_tech_operator_role_legacy/);

  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE username = 'existing.admin'")
    .get();
  db.prepare("INSERT INTO audit_probe (user_id) VALUES (?)").run(existingAdmin.id);
  assert.equal(db.prepare("SELECT actor_name FROM audit_probe").get().actor_name, "Existing Admin");

  assert.ok(existingAdmin);
  assert.ok(
    db
      .prepare("SELECT id FROM users WHERE username = 'tech.operator' AND role = 'tech_operator'")
      .get(),
  );
});
