const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const assert = require("node:assert/strict");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-trial-billing-reset-"));
process.env.DB_PATH = path.join(tempDir, "reset.db");
process.env.NODE_ENV = "test";

const { db, ensureBillingForConsultation, initializeDatabase } = require("../src/db");
const { getBillingCutoverDate } = require("../src/lib/billingCutover");
const { ensureFinancialIntegritySchema } = require("../src/lib/financialIntegritySchema");
const { resetTrialBilling } = require("../src/lib/trialBillingReset");

initializeDatabase();

after(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createVisit(date, suffix) {
  const doctorId = Number(db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get().id);
  const patientId = Number(db.prepare(`
    INSERT INTO patients (
      full_name, first_name, last_name, patient_identifier, age,
      contact_number, patient_contact_number, address, assigned_doctor_id
    ) VALUES (?, 'Trial', 'Patient', ?, 35, '57000000', '57000000', 'Trial address', ?)
  `).run(`Trial Patient ${suffix}`, `RESET-${suffix}`, doctorId).lastInsertRowid);
  const appointmentId = Number(db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, '09:00', 'completed')
  `).run(patientId, doctorId, date).lastInsertRowid);
  const consultationId = Number(db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, ?, 'Preserved consultation note')
  `).run(appointmentId, patientId, doctorId, date).lastInsertRowid);
  return { doctorId, patientId, appointmentId, consultationId };
}

test("trial billing reset clears the ledger, restores billed stock, preserves visits and establishes the cutover", () => {
  resetTrialBilling(db, { cutoverDate: "2026-10-01", reason: "Test baseline" });
  db.prepare("DELETE FROM billing_system_settings").run();
  const visit = createVisit("2026-09-16", "OLD");
  const userId = Number(db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get().id);
  const billId = Number(ensureBillingForConsultation(visit.consultationId, visit.patientId, { id: userId }));

  const folderId = Number(db.prepare("SELECT id FROM inventory_folders ORDER BY id LIMIT 1").get().id);
  const itemId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, owner_doctor_id, quantity, minimum_quantity, unit,
      cost_price, selling_price, stock_scope, row_version
    ) VALUES ('Reset medicine', ?, ?, 8, 0, 'unit', 10, 25, 'doctor', 1)
  `).run(folderId, visit.doctorId).lastInsertRowid);
  const batchId = Number(db.prepare(`
    INSERT INTO inventory_batches (
      item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status
    ) VALUES (?, 8, '2030-12-31', 10, 0, 'usable')
  `).run(itemId).lastInsertRowid);
  const movementId = Number(db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
      recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json,
      unit_cost_snapshot, unit_price_snapshot, valuation_basis
    ) VALUES (?, 'out', 2, 10, 8, ?, ?, 'Trial bill', 'sell', 'appointment', ?, ?, 10, 25, 'recorded_price')
  `).run(
    itemId,
    visit.doctorId,
    userId,
    visit.appointmentId,
    JSON.stringify({
      billing_id: billId,
      consultation_id: visit.consultationId,
      allocations: [{ batch_id: batchId, quantity: 2, unit_cost: 10, expiry_date: "2030-12-31" }],
    }),
  ).lastInsertRowid);
  db.prepare(`
    INSERT INTO inventory_movement_allocations (movement_id, batch_id, quantity, expiry_date, unit_cost)
    VALUES (?, ?, 2, '2030-12-31', 10)
  `).run(movementId, batchId);
  db.prepare(`
    INSERT INTO inventory_activity_history (
      movement_id, actor_user_id, actor_name, actor_role, action_type, item_name,
      quantity, direction, source_text, destination_text, batch_id, meta_json
    ) VALUES (?, ?, 'Trial User', 'doctor', 'sell', 'Reset medicine', 2, 'out', 'Doctor Stock', 'Patient Bill', ?, '{}')
  `).run(movementId, userId, String(batchId));

  const items = [
    { description: "Day Consultation", type: "Sale", quantity: 1, amount: 2000, is_consultation_fee: true },
    {
      description: "Reset medicine",
      type: "Sale",
      quantity: 2,
      amount: 50,
      inventory_item_id: itemId,
      inventory_movement_ids: [movementId],
    },
  ];
  db.prepare(`
    UPDATE billing
    SET items = ?, total_amount = 2050, finalized_at = CURRENT_TIMESTAMP,
        finalized_by_user_id = ?, finalized_by_name = 'Trial User', finalized_by_role = 'operator'
    WHERE id = ?
  `).run(JSON.stringify(items), userId, billId);
  const submissionId = Number(db.prepare(`
    INSERT INTO billing_lite_submissions (
      consultation_id, billing_id, doctor_id, submitted_by_user_id, operation_id,
      item_count, items_json, amount_added, workflow_status
    ) VALUES (?, ?, ?, ?, 'trial-submit', 2, ?, 50, 'completed')
  `).run(visit.consultationId, billId, visit.doctorId, userId, JSON.stringify(items.slice(1))).lastInsertRowid);
  db.prepare(`
    INSERT INTO billing_quick_events (
      submission_id, consultation_id, billing_id, actor_user_id, actor_name,
      actor_role, event_type, next_status
    ) VALUES (?, ?, ?, ?, 'Trial User', 'operator', 'submitted', 'completed')
  `).run(submissionId, visit.consultationId, billId, userId);
  db.prepare(`
    INSERT INTO billing_payment_transactions (
      billing_id, amount, payment_method, payment_date, operation_id,
      recorded_by_user_id, recorded_by_name, recorded_by_role, source
    ) VALUES (?, 2050, 'cash', '2026-09-16', 'trial-payment', ?, 'Trial User', 'operator', 'legacy_migration')
  `).run(billId, userId);
  db.prepare("UPDATE billing SET status = 'paid', payment_method = 'cash', payment_date = '2026-09-16' WHERE id = ?")
    .run(billId);
  const refundId = Number(db.prepare(`
    INSERT INTO billing_refunds (
      credit_note_number, billing_id, amount, refund_method, refund_date, reason,
      issued_by_user_id, issued_by_name, issued_by_role, operation_id
    ) VALUES ('OCS-CN-00000001', ?, 25, 'cash', '2026-09-16', 'Trial refund', ?, 'Trial User', 'operator', 'trial-refund')
  `).run(billId, userId).lastInsertRowid);
  db.prepare(`
    INSERT INTO billing_refund_allocations (refund_id, billing_id, allocation_type, amount)
    VALUES (?, ?, 'service_non_stock', 25)
  `).run(refundId, billId);
  db.prepare(`
    INSERT INTO financial_day_closings (
      business_date, expected_totals_json, counted_cash, settlement_totals_json,
      settlement_references_json, variance_total, notes, operation_id,
      closed_by_user_id, closed_by_name, closed_by_role
    ) VALUES ('2026-09-16', '{}', 2025, '{}', '{}', 0, 'Trial close', 'trial-close', ?, 'Trial User', 'operator')
  `).run(userId);
  db.prepare(`
    INSERT INTO operation_receipts (actor_id, scope, operation_id, request_hash, result_json)
    VALUES (?, 'billing:quick-capture:1', 'trial-operation', 'hash', '{}')
  `).run(userId);

  const result = resetTrialBilling(db, {
    cutoverDate: "2026-10-01",
    reason: "Approved test reset",
  });

  assert.equal(result.inventoryMovementsRemoved, 1);
  for (const table of [
    "billing",
    "billing_events",
    "billing_lite_submissions",
    "billing_quick_events",
    "billing_payment_transactions",
    "billing_refunds",
    "billing_refund_allocations",
    "financial_day_closings",
  ]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM operation_receipts WHERE scope LIKE 'billing:%'").get().count, 0);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 10);
  assert.equal(db.prepare("SELECT quantity_remaining FROM inventory_batches WHERE id = ?").get(batchId).quantity_remaining, 10);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE id = ?").get(movementId).count, 0);
  assert.equal(db.prepare("SELECT doctor_notes FROM consultations WHERE id = ?").get(visit.consultationId).doctor_notes, "Preserved consultation note");
  assert.equal(getBillingCutoverDate(db), "2026-10-01");
  for (const trigger of [
    "billing_events_no_delete",
    "billing_quick_events_no_delete",
    "billing_payment_transactions_no_delete",
    "billing_payment_reversals_no_delete",
    "billing_refunds_no_delete",
    "billing_refund_allocations_no_delete",
    "billing_supply_corrections_no_delete",
    "financial_day_closings_no_delete",
    "financial_day_close_settlements_no_delete",
  ]) {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger), trigger);
  }
  const blockedOldVisit = createVisit("2026-09-30", "BLOCKED");
  assert.equal(
    ensureBillingForConsultation(blockedOldVisit.consultationId, blockedOldVisit.patientId, { id: userId }),
    null,
  );

  const launchVisit = createVisit("2026-10-01", "LAUNCH");
  const firstLiveBillId = Number(ensureBillingForConsultation(
    launchVisit.consultationId,
    launchVisit.patientId,
    { id: userId },
  ));
  assert.equal(firstLiveBillId, 1);
});

test("trial billing reset rolls back every deletion when integrity guards cannot be recreated", () => {
  const billBefore = db.prepare("SELECT COUNT(*) AS count FROM billing").get().count;
  assert.ok(billBefore > 0);
  db.exec("DROP TABLE billing_refund_allocations; CREATE TABLE billing_refund_allocations (id INTEGER PRIMARY KEY)");
  assert.throws(
    () => resetTrialBilling(db, { cutoverDate: "2026-10-01", reason: "Atomic failure test" }),
    /billing_id|no such column/i,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing").get().count, billBefore);
  db.exec("DROP TABLE billing_refund_allocations");
  ensureFinancialIntegritySchema(db);
});
