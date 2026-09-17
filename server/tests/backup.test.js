"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-backup-test-"));
const liveDir = path.join(testRoot, "live");
const backupRoot = path.join(testRoot, "verified-backups");
fs.mkdirSync(liveDir, { recursive: true });
process.env.DB_PATH = path.join(liveDir, "clinic.db");
process.env.NODE_ENV = "test";

const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { db, financeAttachmentsDir, initializeDatabase, labReportAttachmentsDir } = require("../src/db");
const { createVerifiedBackup, sha256File } = require("../src/scripts/backupClinicData");

after(() => {
  db.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test("creates a verified SQLite snapshot with referenced attachments and checksums", async () => {
  initializeDatabase();
  fs.mkdirSync(labReportAttachmentsDir, { recursive: true });
  const storedName = "backup-test-report.pdf";
  fs.writeFileSync(path.join(labReportAttachmentsDir, storedName), "%PDF-1.4 backup test");

  const patientId = db.prepare("SELECT id FROM patients ORDER BY id LIMIT 1").get().id;
  const reportId = db
    .prepare(`
      INSERT INTO lab_reports (patient_id, report_title, report_date, report_details)
      VALUES (?, 'Backup test', '2030-01-01', 'Verified snapshot')
    `)
    .run(patientId).lastInsertRowid;
  db.prepare(`
    INSERT INTO lab_report_attachments (
      report_id, patient_id, original_name, stored_name, mime_type, file_size, relative_path
    ) VALUES (?, ?, 'report.pdf', ?, 'application/pdf', 20, ?)
  `).run(reportId, patientId, storedName, storedName);

  fs.mkdirSync(financeAttachmentsDir, { recursive: true });
  const financeStoredName = "backup-test-expense.pdf";
  fs.writeFileSync(path.join(financeAttachmentsDir, financeStoredName), "%PDF-1.4 expense backup test");
  const userId = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get().id;
  const expenseId = db.prepare(`
    INSERT INTO finance_expenses (
      expense_date,category,payee,description,amount,receipt_stored_name,
      receipt_original_name,receipt_mime_type,receipt_size,operation_id,
      created_by_user_id,created_by_name,created_by_role
    ) VALUES (date('now','+4 hours'),'utilities','Backup supplier','Backup evidence',100,?,
      'expense.pdf','application/pdf',30,'backup-expense-operation',?,'Backup user','admin')
  `).run(financeStoredName, userId).lastInsertRowid;
  db.prepare(`INSERT INTO finance_expense_events (
    expense_id,action,note,operation_id,actor_user_id,actor_name,actor_role
  ) VALUES (?,'submitted','Submitted for backup','backup-expense-event',?,'Backup user','admin')`).run(expenseId, userId);

  const result = await createVerifiedBackup({ backupRoot, backupName: "test-backup" });
  const snapshotPath = path.join(result.backupDir, "clinic.db");
  const attachmentPath = path.join(result.backupDir, "lab-report-attachments", storedName);
  const financeAttachmentPath = path.join(result.backupDir, "finance-attachments", financeStoredName);
  assert.equal(fs.existsSync(snapshotPath), true);
  assert.equal(fs.existsSync(attachmentPath), true);
  assert.equal(fs.existsSync(financeAttachmentPath), true);
  assert.equal(result.manifest.sqlite_quick_check, "ok");
  assert.equal(result.manifest.foreign_key_violations, 0);
  assert.equal(result.manifest.attachment_records, 1);
  assert.equal(result.manifest.finance_attachment_records, 1);
  assert.equal(result.manifest.files.find((file) => file.path === "clinic.db").sha256, sha256File(snapshotPath));

  const snapshot = new Database(snapshotPath, { readonly: true });
  assert.equal(snapshot.prepare("SELECT COUNT(*) AS count FROM lab_report_attachments").get().count, 1);
  snapshot.close();
});

test("refuses to call a directory inside the live volume a disaster-recovery backup", async () => {
  await assert.rejects(
    createVerifiedBackup({ backupRoot: path.join(liveDir, "backups"), backupName: "unsafe" }),
    /inside the live data volume/i,
  );
});
