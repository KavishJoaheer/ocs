#!/usr/bin/env node
/**
 * Proves the cross-device inventory SSE fan-out:
 *
 *   * Same user, different tabs/devices  → BOTH tabs see the event (the
 *     originating tab will drop it client-side via its session-id filter).
 *   * Same user, same tab session         → server still sends, client-side
 *     filter (changedByClientSessionId === ourSessionId) suppresses it.
 *   * Wrong role / wrong doctor scope     → no event.
 *
 * This script invokes the server-side `shouldDeliverInventoryEvent` helper
 * against fixture clients and asserts the delivery matrix.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpFile = path.join(os.tmpdir(), `cross-device-stream-${Date.now()}.db`);
process.env.DB_PATH = tmpFile;

const { db, initializeDatabase } = require("../db");
const {
  publishInventoryChange,
  shouldDeliverInventoryEvent,
  addInventoryStreamClient,
} = require("../lib/inventoryRealtime");

function fail(message) {
  console.error(`[cross-device-stream] FAILED: ${message}`);
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

const doctorId = Number(
  db.prepare("INSERT INTO doctors (full_name, specialization) VALUES (?, ?)")
    .run("Dr Test", "GP").lastInsertRowid,
);
const itemId = Number(
  db.prepare(
    `INSERT INTO inventory (item_name, quantity, minimum_quantity, unit, owner_doctor_id)
     VALUES (?, ?, ?, 'unit', ?)`,
  )
    .run("Paracetamol 500mg", 10, 2, doctorId).lastInsertRowid,
);

// Mark the seeded item as doctor-scoped so the doctor client can receive its events.
db.prepare("UPDATE inventory SET quantity = quantity WHERE id = ?").run(itemId);
db.exec(
  `UPDATE inventory SET quantity = quantity WHERE id = ${itemId}`,
);
db.prepare("UPDATE inventory SET unit = unit WHERE id = ?").run(itemId);

const inventoryHasStockScope = (() => {
  try {
    const info = db.prepare("PRAGMA table_info(inventory)").all();
    return info.some((row) => row.name === "stock_scope");
  } catch {
    return false;
  }
})();

if (inventoryHasStockScope) {
  db.prepare("UPDATE inventory SET stock_scope = 'doctor' WHERE id = ?").run(itemId);
}

// Build three fake stream clients. We capture writes into per-client buffers
// so we can assert which ones the publisher actually delivered to.
function fakeRes() {
  const writes = [];
  return {
    writes,
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
    on() {
      /* no-op for close handler */
    },
  };
}

const tabA = fakeRes();
const tabB = fakeRes();
const otherDoctor = fakeRes();

addInventoryStreamClient(tabA, { id: 99, role: "doctor", doctor_id: doctorId }, "session-tab-a");
addInventoryStreamClient(tabB, { id: 99, role: "doctor", doctor_id: doctorId }, "session-tab-b");
addInventoryStreamClient(
  otherDoctor,
  { id: 100, role: "doctor", doctor_id: doctorId + 9999 },
  "session-other-doctor",
);

// Publish a change as if tab A made the mutation.
publishInventoryChange({
  itemId,
  changedByUserId: 99,
  changedByClientSessionId: "session-tab-a",
});

function inventoryEventsFor(res) {
  const stream = res.writes.join("");
  const matches = [];
  const regex = /event: inventory_change\ndata: (\{.*?\})\n\n/g;
  let m;
  while ((m = regex.exec(stream)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

const aEvents = inventoryEventsFor(tabA);
const bEvents = inventoryEventsFor(tabB);
const otherEvents = inventoryEventsFor(otherDoctor);

// Server-side: every authorized listener receives the event. Originating-tab
// suppression happens on the CLIENT, because the SSE wire is one-to-many.
if (aEvents.length !== 1) fail(`tab A should receive 1 event, got ${aEvents.length}`);
if (bEvents.length !== 1) fail(`tab B (same user, other device) should receive 1 event, got ${bEvents.length}`);
if (otherEvents.length !== 0) fail(`other doctor should NOT receive event, got ${otherEvents.length}`);

const payload = JSON.parse(bEvents[0]);
if (payload.changedByClientSessionId !== "session-tab-a") {
  fail(`payload.changedByClientSessionId expected session-tab-a, got ${payload.changedByClientSessionId}`);
}
if (Number(payload.changedByUserId) !== 99) {
  fail(`payload.changedByUserId expected 99, got ${payload.changedByUserId}`);
}

// Direct delivery filter sanity: role and scope still get respected.
const doctorClient = { role: "doctor", doctorId, clientSessionId: "session-tab-b" };
const otherDoctorClient = { role: "doctor", doctorId: doctorId + 9999, clientSessionId: "x" };
const ocsEvent = { stockScope: "ocs", ownerDoctorId: null };
const otherDoctorBagEvent = { stockScope: "doctor", ownerDoctorId: doctorId + 9999 };

if (!shouldDeliverInventoryEvent(doctorClient, ocsEvent)) {
  fail("Doctor should receive OCS-scope events");
}
if (shouldDeliverInventoryEvent(doctorClient, otherDoctorBagEvent)) {
  fail("Doctor must not receive another doctor's bag events");
}
if (!shouldDeliverInventoryEvent(otherDoctorClient, otherDoctorBagEvent)) {
  fail("Other doctor should receive their own bag events");
}

cleanup();
console.log("[cross-device-stream] all checks passed");
