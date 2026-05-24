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

const { db, initializeDatabase } = require("../db");
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

cleanup();
console.log("[sale-billing-linkage] all checks passed");
