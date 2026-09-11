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
const { hashPassword, verifyPassword } = require("../src/lib/security");

after(() => {
  db.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("production warns without blocking sign-in during the staged password migration", () => {
  const securePassword = process.env.SEED_USER_PASSWORD;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  try {
    delete process.env.SEED_USER_PASSWORD;
    assert.doesNotThrow(() => createApp());

    db.prepare(`
      INSERT INTO users (username, full_name, password_hash, role)
      VALUES (?, ?, ?, 'operator')
    `).run("staged.password.user", "Staged Password User", hashPassword("Welcome@123"));

    process.env.SEED_USER_PASSWORD = "Welcome@123";
    assert.doesNotThrow(() => createApp());
  } finally {
    console.warn = originalWarn;
    process.env.SEED_USER_PASSWORD = securePassword;
  }

  assert.ok(warnings.some((warning) => warning.includes("SEED_USER_PASSWORD")));
  assert.ok(warnings.some((warning) => warning.includes("Staff password rotation is deferred")));

  const activeUsers = db
    .prepare("SELECT password_hash FROM users WHERE is_active = 1 AND deleted_at IS NULL")
    .all();
  assert.ok(activeUsers.length > 0);
  assert.equal(activeUsers.some((user) => verifyPassword("Welcome@123", user.password_hash)), true);
});
