"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const assert = require("node:assert/strict");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-billing-schema-"));
const dbPath = path.join(tempDir, "test.db");
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = "test";

const { db, initializeDatabase } = require("../src/db");

after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("legacy unique-consultation migration preserves every billing column and row", () => {
  initializeDatabase();
  const doctorId = Number(db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get().id);
  const userId = Number(db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get().id);
  const patientId = Number(db.prepare(`
    INSERT INTO patients (
      full_name, first_name, last_name, patient_identifier, age,
      contact_number, patient_contact_number, address, assigned_doctor_id
    ) VALUES ('Migration Patient', 'Migration', 'Patient', 'MIGRATION-UNIQUE-1', 40,
      '57000002', '57000002', 'Migration test address', ?)
  `).run(doctorId).lastInsertRowid);
  const appointmentId = Number(db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, '2026-09-15', '11:00', 'completed')
  `).run(patientId, doctorId).lastInsertRowid);
  const consultationId = Number(db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, '2026-09-15', 'Migration regression fixture')
  `).run(appointmentId, patientId, doctorId).lastInsertRowid);

  db.pragma("foreign_keys = OFF");
  db.exec(`
    DROP TABLE billing_refunds;
    DROP TABLE billing_quick_events;
    DROP TABLE billing_lite_submissions;
    DROP TABLE billing_events;
    CREATE TABLE billing_legacy_unique (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultation_id INTEGER NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL,
      items TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
      payment_method TEXT CHECK (payment_method IN ('cash', 'juice', 'card', 'ib') OR payment_method IS NULL),
      payment_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      linkham_claim_status TEXT CHECK (linkham_claim_status IN ('pending', 'approved', 'settled') OR linkham_claim_status IS NULL),
      linkham_claim_reviewed_at TEXT,
      dispute_status TEXT NOT NULL DEFAULT 'Clean' CHECK (dispute_status IN ('Clean', 'Flagged_Review')),
      dispute_reason TEXT,
      dispute_flagged_at TEXT,
      dispute_flagged_by_user_id INTEGER,
      linkham_claim_reviewed_by_user_id INTEGER,
      linkham_claim_settled_at TEXT,
      linkham_claim_settled_by_user_id INTEGER,
      updated_at TEXT,
      updated_by_user_id INTEGER,
      voided_at TEXT,
      voided_by_user_id INTEGER,
      void_reason TEXT NOT NULL DEFAULT '',
      row_version INTEGER NOT NULL DEFAULT 1,
      fee_review_required INTEGER NOT NULL DEFAULT 0,
      legacy_fee_review_required INTEGER NOT NULL DEFAULT 0,
      change_reason TEXT NOT NULL DEFAULT '',
      future_audit_reference TEXT NOT NULL DEFAULT ''
    );
  `);
  const items = JSON.stringify([{
    description: "Day Consultation",
    amount: 2000,
    type: "Sale",
    quantity: 1,
    is_consultation_fee: true,
  }]);
  db.prepare(`
    INSERT INTO billing_legacy_unique (
      consultation_id, patient_id, items, total_amount, status,
      linkham_claim_status, linkham_claim_reviewed_at,
      dispute_status, dispute_reason, dispute_flagged_at, dispute_flagged_by_user_id,
      linkham_claim_reviewed_by_user_id, linkham_claim_settled_at, linkham_claim_settled_by_user_id,
      updated_at, updated_by_user_id, void_reason, row_version,
      fee_review_required, legacy_fee_review_required, change_reason, future_audit_reference
    ) VALUES (?, ?, ?, 2000, 'unpaid', 'settled', '2026-09-15 10:00:00',
      'Flagged_Review', 'Preserve dispute', '2026-09-15 10:01:00', ?,
      ?, '2026-09-15 10:02:00', ?, '2026-09-15 10:03:00', ?, '', 7, 1, 1,
      'Preserve audit reason', 'FUTURE-REF-42')
  `).run(consultationId, patientId, items, userId, userId, userId, userId);
  db.exec("DROP TABLE billing; ALTER TABLE billing_legacy_unique RENAME TO billing;");
  db.pragma("foreign_keys = ON");

  initializeDatabase();

  const columns = db.prepare("PRAGMA table_info(billing)").all().map((row) => row.name);
  for (const column of [
    "linkham_claim_status",
    "linkham_claim_reviewed_at",
    "linkham_claim_reviewed_by_user_id",
    "linkham_claim_settled_at",
    "linkham_claim_settled_by_user_id",
    "dispute_status",
    "dispute_reason",
    "dispute_flagged_at",
    "dispute_flagged_by_user_id",
    "updated_at",
    "updated_by_user_id",
    "voided_at",
    "voided_by_user_id",
    "void_reason",
    "row_version",
    "fee_review_required",
    "legacy_fee_review_required",
    "change_reason",
    "future_audit_reference",
  ]) {
    assert.ok(columns.includes(column), `missing preserved column ${column}`);
  }

  const migrated = db.prepare("SELECT * FROM billing WHERE consultation_id = ?").get(consultationId);
  assert.equal(migrated.linkham_claim_status, "settled");
  assert.equal(migrated.dispute_status, "Flagged_Review");
  assert.equal(migrated.dispute_reason, "Preserve dispute");
  assert.equal(migrated.change_reason, "Preserve audit reason");
  assert.equal(migrated.future_audit_reference, "FUTURE-REF-42");
  assert.equal(Number(migrated.row_version), 7);

  assert.doesNotThrow(() => db.prepare(`
    INSERT INTO billing (consultation_id, patient_id, items, total_amount, status, future_audit_reference)
    VALUES (?, ?, ?, 100, 'unpaid', 'SECOND-BILL')
  `).run(
    consultationId,
    patientId,
    JSON.stringify([{ description: "Additional procedure", amount: 100, type: "Sale", quantity: 1 }]),
  ));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing WHERE consultation_id = ?").get(consultationId).count, 2);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

  const insertLegacyPaperBill = db.prepare(`
    INSERT INTO billing (
      consultation_id, patient_id, items, total_amount, status,
      change_reason, future_audit_reference
    ) VALUES (?, ?, ?, 100, 'unpaid', 'Paper invoice: LEGACY-DUPLICATE-7', ?)
  `);
  insertLegacyPaperBill.run(
    consultationId,
    patientId,
    JSON.stringify([{ description: "Legacy line A", amount: 100, type: "Sale", quantity: 1 }]),
    "LEGACY-PAPER-A",
  );
  insertLegacyPaperBill.run(
    consultationId,
    patientId,
    JSON.stringify([{ description: "Legacy line B", amount: 100, type: "Sale", quantity: 1 }]),
    "LEGACY-PAPER-B",
  );
  const { ensureFinancialIntegritySchema } = require("../src/lib/financialIntegritySchema");
  assert.doesNotThrow(() => ensureFinancialIntegritySchema(db));
  assert.doesNotThrow(() => ensureFinancialIntegritySchema(db));
  const legacyReferences = db.prepare(`
    SELECT source_reference
    FROM billing
    WHERE future_audit_reference IN ('LEGACY-PAPER-A', 'LEGACY-PAPER-B')
    ORDER BY id
  `).all();
  assert.deepEqual(legacyReferences.map((row) => row.source_reference), ["LEGACY-DUPLICATE-7", null]);
});
