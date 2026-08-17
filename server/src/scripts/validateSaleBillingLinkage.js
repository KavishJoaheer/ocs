#!/usr/bin/env node
/**
 * Validates that a Sale stock-out followed by a matching billing entry does
 * NOT double-decrement the doctor's bag, that the Sale movement is marked
 * "Billed", and that deleting the consultation un-links it again.
 *
 * Uses an isolated in-memory SQLite DB so the production data file is
 * untouched.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");

const tmpFile = path.join(os.tmpdir(), `linkage-${Date.now()}.db`);
process.env.DB_PATH = tmpFile;

const { db, initializeDatabase, ensureBillingForConsultation } = require("../db");
const { applyInventoryTransactionsForTest, runLinkageScenario } = (() => {
  // Re-export the closures we need from billing.js by spawning a small
  // adapter; billing.js wraps applyInventoryTransactions in module scope and
  // is not directly exported. Instead we'll drive the public route handler
  // via supertest-style helpers if available — but to stay dependency-free
  // we'll just exercise the helper module directly.
  const linkage = require("../lib/saleBillingLinkage");
  return { applyInventoryTransactionsForTest: null, runLinkageScenario: linkage };
})();

function fail(message) {
  console.error(`[sale-billing-linkage] FAILED: ${message}`);
  cleanup();
  process.exit(1);
}

function cleanup() {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(tmpFile);
  } catch {
    /* ignore */
  }
}

initializeDatabase();

// Minimal fixture: a doctor, a patient assigned to them, and one doctor-bag item.
const doctorInsert = db.prepare("INSERT INTO doctors (full_name, specialization) VALUES (?, ?)");
const patientInsert = db.prepare(
  "INSERT INTO patients (full_name, age, contact_number, address, assigned_doctor_id, status) VALUES (?, ?, ?, ?, ?, 'active')",
);
const inventoryInsert = db.prepare(
  `INSERT INTO inventory (
    item_name, quantity, minimum_quantity, unit,
    cost_price, selling_price, owner_doctor_id
  ) VALUES (?, ?, ?, 'unit', ?, ?, ?)`,
);

const doctorId = Number(doctorInsert.run("Dr Test", "GP").lastInsertRowid);
const patientId = Number(
  patientInsert.run("Test Patient", 30, "0000", "Test Addr", doctorId).lastInsertRowid,
);
const itemId = Number(
  inventoryInsert.run("Paracetamol 500mg", 10, 2, 1, 5, doctorId).lastInsertRowid,
);

// 1. Log a Sale stock-out as if the doctor used the mobile deduct sheet.
const saleQty = 2;
db.prepare(
  `UPDATE inventory SET quantity = quantity - ? WHERE id = ?`,
).run(saleQty, itemId);
const movementInsert = db.prepare(
  `INSERT INTO inventory_movements (
    item_id, movement_type, quantity, previous_quantity, next_quantity,
    recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
  ) VALUES (?, 'out', ?, ?, ?, NULL, 'Pending Manual Entry', 'stock_out', '', NULL, ?)`,
);
const saleMovementId = Number(
  movementInsert.run(
    itemId,
    saleQty,
    10,
    8,
    JSON.stringify({
      stock_out_reason: "Sale",
      billing_status: "Pending Manual Entry",
      patient_id: patientId,
      doctor_id: doctorId,
      patient_name: "Test Patient",
    }),
  ).lastInsertRowid,
);

const bagAfterSale = Number(
  db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity,
);
if (bagAfterSale !== 8) fail(`After Sale stock-out expected qty 8, got ${bagAfterSale}`);

// 2. Now find unbilled Sale credit — should return the movement we just made.
const { matched, consumedQty } = runLinkageScenario.findUnbilledSaleCredit({
  itemId,
  patientId,
  doctorId,
  maxQty: saleQty,
});

if (matched.length !== 1) fail(`Expected 1 matched Sale movement, got ${matched.length}`);
if (consumedQty !== saleQty) fail(`Expected consumedQty ${saleQty}, got ${consumedQty}`);
if (Number(matched[0].id) !== saleMovementId) {
  fail(`Matched movement id mismatch (${matched[0].id} vs ${saleMovementId})`);
}

// 3. Mark them billed and verify the meta_json flipped.
const fakeBillId = 42;
runLinkageScenario.markSaleMovementsBilled(matched, fakeBillId);
const afterBilledMeta = JSON.parse(
  db.prepare("SELECT meta_json FROM inventory_movements WHERE id = ?").get(saleMovementId).meta_json,
);
if (afterBilledMeta.billing_status !== "Billed") {
  fail(`Expected billing_status Billed, got ${afterBilledMeta.billing_status}`);
}
if (Number(afterBilledMeta.billing_id) !== fakeBillId) {
  fail(`Expected billing_id ${fakeBillId}, got ${afterBilledMeta.billing_id}`);
}
if (!afterBilledMeta.billed_at) fail(`Expected billed_at to be set`);

// 4. Bag should still be at 8 (linkage doesn't move stock; it only relabels).
const bagAfterLinkage = Number(
  db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity,
);
if (bagAfterLinkage !== 8) fail(`After linkage expected qty 8, got ${bagAfterLinkage}`);

// 5. A second linkage attempt should return nothing because the movement is
// no longer in "Pending Manual Entry".
const second = runLinkageScenario.findUnbilledSaleCredit({
  itemId,
  patientId,
  doctorId,
  maxQty: saleQty,
});
if (second.matched.length !== 0 || second.consumedQty !== 0) {
  fail("Already-billed Sale movement was re-matched");
}

// 6. Unlink and confirm it falls back to Pending Manual Entry without
// changing the stock level (the dispense really happened in the field).
runLinkageScenario.unlinkSaleMovementsForBills([fakeBillId]);
const afterUnlinkMeta = JSON.parse(
  db.prepare("SELECT meta_json FROM inventory_movements WHERE id = ?").get(saleMovementId).meta_json,
);
if (afterUnlinkMeta.billing_status !== "Pending Manual Entry") {
  fail(`After unlink expected Pending Manual Entry, got ${afterUnlinkMeta.billing_status}`);
}
if (afterUnlinkMeta.billing_id) {
  fail(`After unlink expected billing_id cleared, got ${afterUnlinkMeta.billing_id}`);
}
const bagAfterUnlink = Number(
  db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity,
);
if (bagAfterUnlink !== 8) fail(`After unlink expected bag qty 8, got ${bagAfterUnlink}`);

// 7. Partial-match guard: a Sale of 5 cannot be matched to a bill of 3.
const bigItemId = Number(
  inventoryInsert.run("Saline 250ml", 10, 2, 1, 5, doctorId).lastInsertRowid,
);
db.prepare("UPDATE inventory SET quantity = quantity - 5 WHERE id = ?").run(bigItemId);
movementInsert.run(
  bigItemId,
  5,
  10,
  5,
  JSON.stringify({
    stock_out_reason: "Sale",
    billing_status: "Pending Manual Entry",
    patient_id: patientId,
    doctor_id: doctorId,
  }),
);

const partial = runLinkageScenario.findUnbilledSaleCredit({
  itemId: bigItemId,
  patientId,
  doctorId,
  maxQty: 3,
});
if (partial.matched.length !== 0 || partial.consumedQty !== 0) {
  fail("Partial-match guard failed — a 5-qty Sale was credited against a 3-qty bill");
}

const { getTodayLocal, normalizeBillingItems, calculateBillingTotal } = require("../lib/utils");

function createConsultationBill(forPatientId, forDoctorId) {
  const today = getTodayLocal();
  const appointmentId = Number(
    db
      .prepare(
        `
          INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
          VALUES (?, ?, ?, '09:00', 'completed')
        `,
      )
      .run(forPatientId, forDoctorId, today).lastInsertRowid,
  );
  const consultationId = Number(
    db
      .prepare(
        `
          INSERT INTO consultations (
            appointment_id, patient_id, doctor_id, consultation_date, doctor_notes
          )
          VALUES (?, ?, ?, ?, 'Auto-bill linkage test')
        `,
      )
      .run(appointmentId, forPatientId, forDoctorId, today).lastInsertRowid,
  );
  const billingId = Number(ensureBillingForConsultation(consultationId, forPatientId));
  return { appointmentId, consultationId, billingId };
}

function insertPendingSale({ forItemId, forPatientId, forDoctorId, qty, previousQty }) {
  return Number(
    movementInsert.run(
      forItemId,
      qty,
      previousQty,
      previousQty - qty,
      JSON.stringify({
        stock_out_reason: "Sale",
        billing_status: "Pending Manual Entry",
        patient_id: forPatientId,
        doctor_id: forDoctorId,
      }),
    ).lastInsertRowid,
  );
}

function readBill(billingId) {
  const row = db.prepare("SELECT items, total_amount, status FROM billing WHERE id = ?").get(billingId);
  return {
    ...row,
    items: normalizeBillingItems(row.items),
    total_amount: Number(row.total_amount),
  };
}

// 8. Sale deduct after an unpaid consultation bill exists → line is added
// automatically and stock is not deducted again by the helper.
const billedPatientId = Number(
  patientInsert.run("Auto Bill Patient", 40, "1111", "Test Addr", doctorId).lastInsertRowid,
);
const billedItemId = Number(
  inventoryInsert.run("Galvus Met 50/1000", 20, 2, 2, 15, doctorId).lastInsertRowid,
);
db.prepare("UPDATE inventory SET quantity = quantity - 1 WHERE id = ?").run(billedItemId);
const { billingId: liveBillId } = createConsultationBill(billedPatientId, doctorId);
const liveMovementId = insertPendingSale({
  forItemId: billedItemId,
  forPatientId: billedPatientId,
  forDoctorId: doctorId,
  qty: 1,
  previousQty: 20,
});
const liveAttach = runLinkageScenario.attachSaleDeductToPatientBill({
  patientId: billedPatientId,
  doctorId,
  item: { id: billedItemId, item_name: "Galvus Met 50/1000", selling_price: 15 },
  quantity: 1,
  movementId: liveMovementId,
});
if (!liveAttach.attached || Number(liveAttach.billingId) !== liveBillId) {
  fail(`Expected Sale deduct to attach to bill ${liveBillId}, got ${JSON.stringify(liveAttach)}`);
}
const liveBill = readBill(liveBillId);
const galvusLine = liveBill.items.find((line) => Number(line.inventory_item_id) === billedItemId);
if (!galvusLine || Number(galvusLine.quantity) !== 1 || Number(galvusLine.amount) !== 15) {
  fail(`Expected Galvus Met line qty 1 amount 15, got ${JSON.stringify(galvusLine)}`);
}
if (liveBill.total_amount !== calculateBillingTotal(liveBill.items)) {
  fail(`Bill total_amount ${liveBill.total_amount} does not match items`);
}
const bagAfterAutoAttach = Number(
  db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(billedItemId).quantity,
);
if (bagAfterAutoAttach !== 19) {
  fail(`Auto-attach must not deduct bag again (expected 19, got ${bagAfterAutoAttach})`);
}
const liveMeta = JSON.parse(
  db.prepare("SELECT meta_json FROM inventory_movements WHERE id = ?").get(liveMovementId).meta_json,
);
if (liveMeta.billing_status !== "Billed" || Number(liveMeta.billing_id) !== liveBillId) {
  fail(`Expected movement billed against ${liveBillId}, got ${JSON.stringify(liveMeta)}`);
}

// 9. A second Sale of the same item merges onto the existing bill line.
db.prepare("UPDATE inventory SET quantity = quantity - 2 WHERE id = ?").run(billedItemId);
const mergeMovementId = insertPendingSale({
  forItemId: billedItemId,
  forPatientId: billedPatientId,
  forDoctorId: doctorId,
  qty: 2,
  previousQty: 19,
});
const mergeAttach = runLinkageScenario.attachSaleDeductToPatientBill({
  patientId: billedPatientId,
  doctorId,
  item: { id: billedItemId, item_name: "Galvus Met 50/1000", selling_price: 15 },
  quantity: 2,
  movementId: mergeMovementId,
});
if (!mergeAttach.attached) fail("Expected second Sale deduct to merge onto the unpaid bill");
const mergedBill = readBill(liveBillId);
const mergedLine = mergedBill.items.find((line) => Number(line.inventory_item_id) === billedItemId);
if (!mergedLine || Number(mergedLine.quantity) !== 3 || Number(mergedLine.amount) !== 45) {
  fail(`Expected merged Galvus line qty 3 amount 45, got ${JSON.stringify(mergedLine)}`);
}

// 10. Sale deduct before any consultation stays pending, then lands on the
// bill when the consultation is saved.
const laterPatientId = Number(
  patientInsert.run("Later Bill Patient", 41, "2222", "Test Addr", doctorId).lastInsertRowid,
);
const laterItemId = Number(
  inventoryInsert.run("Aspirin 100mg", 10, 2, 1, 8, doctorId).lastInsertRowid,
);
db.prepare("UPDATE inventory SET quantity = quantity - 2 WHERE id = ?").run(laterItemId);
const laterMovementId = insertPendingSale({
  forItemId: laterItemId,
  forPatientId: laterPatientId,
  forDoctorId: doctorId,
  qty: 2,
  previousQty: 10,
});
const beforeConsult = runLinkageScenario.attachSaleDeductToPatientBill({
  patientId: laterPatientId,
  doctorId,
  item: { id: laterItemId, item_name: "Aspirin 100mg", selling_price: 8 },
  quantity: 2,
  movementId: laterMovementId,
});
if (beforeConsult.attached) {
  fail("Sale deduct with no consultation must stay pending, not invent a bill");
}
const laterPendingMeta = JSON.parse(
  db.prepare("SELECT meta_json FROM inventory_movements WHERE id = ?").get(laterMovementId).meta_json,
);
if (laterPendingMeta.billing_status !== "Pending Manual Entry") {
  fail(`Expected pending status before consultation, got ${laterPendingMeta.billing_status}`);
}
const { billingId: laterBillId } = createConsultationBill(laterPatientId, doctorId);
const laterBill = readBill(laterBillId);
const aspirinLine = laterBill.items.find((line) => Number(line.inventory_item_id) === laterItemId);
if (!aspirinLine || Number(aspirinLine.quantity) !== 2 || Number(aspirinLine.amount) !== 16) {
  fail(`Expected Aspirin line qty 2 amount 16 after consultation save, got ${JSON.stringify(aspirinLine)}`);
}
const laterBilledMeta = JSON.parse(
  db.prepare("SELECT meta_json FROM inventory_movements WHERE id = ?").get(laterMovementId).meta_json,
);
if (laterBilledMeta.billing_status !== "Billed" || Number(laterBilledMeta.billing_id) !== laterBillId) {
  fail(`Expected pending Sale to bill on consultation save, got ${JSON.stringify(laterBilledMeta)}`);
}

// 11. A paid bill is left alone — the Sale stays pending for the next unpaid bill.
const paidPatientId = Number(
  patientInsert.run("Paid Bill Patient", 42, "3333", "Test Addr", doctorId).lastInsertRowid,
);
const paidItemId = Number(
  inventoryInsert.run("Betadine 10ml", 10, 2, 1, 12, doctorId).lastInsertRowid,
);
const { billingId: paidBillId } = createConsultationBill(paidPatientId, doctorId);
db.prepare("UPDATE billing SET status = 'paid', payment_method = 'cash' WHERE id = ?").run(paidBillId);
db.prepare("UPDATE inventory SET quantity = quantity - 1 WHERE id = ?").run(paidItemId);
const paidMovementId = insertPendingSale({
  forItemId: paidItemId,
  forPatientId: paidPatientId,
  forDoctorId: doctorId,
  qty: 1,
  previousQty: 10,
});
const paidAttach = runLinkageScenario.attachSaleDeductToPatientBill({
  patientId: paidPatientId,
  doctorId,
  item: { id: paidItemId, item_name: "Betadine 10ml", selling_price: 12 },
  quantity: 1,
  movementId: paidMovementId,
});
if (paidAttach.attached) {
  fail("Must not append a Sale line onto an already-paid bill");
}
const paidBill = readBill(paidBillId);
if (paidBill.items.some((line) => Number(line.inventory_item_id) === paidItemId)) {
  fail("Paid bill must not gain an inventory Sale line");
}

cleanup();
console.log("[sale-billing-linkage] all checks passed");
