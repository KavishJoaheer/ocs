"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const assert = require("node:assert/strict");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-production-security-"));
process.env.DB_PATH = path.join(testRoot, "clinic.db");
process.env.NODE_ENV = "production";
process.env.SEED_USER_PASSWORD = "Production-Test-Seed-Password-2026";

const { createApp } = require("../src/app");
const { db } = require("../src/db");
const { verifyPassword } = require("../src/lib/security");

after(() => {
  db.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("production refuses a missing or known default seed password", () => {
  const securePassword = process.env.SEED_USER_PASSWORD;
  delete process.env.SEED_USER_PASSWORD;
  assert.throws(() => createApp(), /SEED_USER_PASSWORD/);

  process.env.SEED_USER_PASSWORD = "Welcome@123";
  assert.throws(() => createApp(), /SEED_USER_PASSWORD/);

  process.env.SEED_USER_PASSWORD = securePassword;
  assert.doesNotThrow(() => createApp());

  const activeUsers = db
    .prepare("SELECT password_hash FROM users WHERE is_active = 1 AND deleted_at IS NULL")
    .all();
  assert.ok(activeUsers.length > 0);
  assert.equal(activeUsers.some((user) => verifyPassword("Welcome@123", user.password_hash)), false);
});
