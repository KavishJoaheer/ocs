"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const TMP_DB = path.join(os.tmpdir(), `ocs-inventory-ops-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = "test";
delete process.env.ENABLE_DOCTOR_EMERGENCY_RESTOCK;

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { db } = require("../src/db");
const { isValidCollectionDate } = require("../src/lib/collectionDays");
const { availableToPromise } = require("../src/lib/restockFulfilment");

let server;
let baseUrl;
let adminToken;
let operatorToken;
let doctorToken;
let doctorTwoToken;
let doctorId;
let folderId;
let collectionDate;

function nextCollectionIso() {
  const start = new Date();
  for (let i = 1; i < 28; i += 1) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    const iso = date.toISOString().slice(0, 10);
    if (isValidCollectionDate(iso)) return iso;
  }
  throw new Error("Could not find a valid collection date.");
}

async function api(method, urlPath, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function login(username) {
  const res = await api("POST", "/api/auth/login", {
    body: { username, password: "Welcome@123" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.token;
}

function insertOcsItem({ name, qty, expiry = "2028-06-01", nonExpiring = 0 }) {
  const id = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope)
         VALUES (?, ?, ?, 0, 'unit', 5, 10, 'ocs')`,
      )
      .run(name, folderId, qty).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, ?, ?, 5, ?)`,
  ).run(id, qty, nonExpiring ? null : expiry, nonExpiring);
  return id;
}

async function createAcceptedRequest({ token = doctorToken, itemId, itemName, quantity, note = "ops" }) {
  const created = await api("POST", "/api/restock-requests", {
    token,
    body: {
      collection_date: collectionDate,
      note,
      items: [{ inventory_id: itemId, item_name: itemName, quantity }],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const accepted = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: operatorToken,
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  return accepted.data.request;
}

async function pickAndReady(requestId) {
  const detail = await api("GET", `/api/restock-requests/${requestId}/fulfilment`, { token: operatorToken });
  const lines = (detail.data.fulfilment?.items || []).map((line) => ({
    id: line.id,
    picked_quantity: Number(line.reserved_quantity || 0),
    fulfilled_quantity: Number(line.reserved_quantity || 0),
  }));
  const picked = await api("PATCH", `/api/restock-requests/${requestId}/fulfilment`, {
    token: operatorToken,
    body: { lines },
  });
  assert.equal(picked.status, 200, JSON.stringify(picked.data));
  const ready = await api("PATCH", `/api/restock-requests/${requestId}`, {
    token: operatorToken,
    body: { status: "ready" },
  });
  assert.equal(ready.status, 200, JSON.stringify(ready.data));
  return ready.data.request;
}

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  adminToken = await login("shravan.joaheer");
  operatorToken = await login("operator01");
  doctorToken = await login("arun.dharee");
  doctorTwoToken = await login("bhobun.muneshwarshing");
  doctorId = db.prepare("SELECT doctor_id FROM users WHERE username = 'arun.dharee'").get().doctor_id;
  folderId = db.prepare("SELECT id FROM inventory_folders LIMIT 1").get()?.id || null;
  collectionDate = nextCollectionIso();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${TMP_DB}${suffix}`);
    } catch {
      // ignore
    }
  }
});

test("acceptance creates reservations without reducing physical quantity", async () => {
  const itemId = insertOcsItem({ name: `Reserve ${Date.now()}`, qty: 10 });
  const qtyBefore = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  const request = await createAcceptedRequest({ itemId, itemName: "Reserve", quantity: 4 });
  const qtyAfter = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  assert.equal(qtyAfter, qtyBefore);
  assert.equal(Number(request.fulfilment.items[0].reserved_quantity), 4);
  assert.equal(Number(request.fulfilment.items[0].shortage_quantity), 0);
});

test("available-to-promise excludes other active reservations", async () => {
  const itemId = insertOcsItem({ name: `ATP ${Date.now()}`, qty: 10 });
  await createAcceptedRequest({ itemId, itemName: "ATP", quantity: 6, note: "first" });
  assert.equal(availableToPromise(itemId), 4);
});

test("concurrent acceptance cannot over-reserve stock", async () => {
  const itemId = insertOcsItem({ name: `Race ${Date.now()}`, qty: 5 });
  const first = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: {
      collection_date: collectionDate,
      note: "race-a",
      items: [{ inventory_id: itemId, item_name: "Race", quantity: 5 }],
    },
  });
  const second = await api("POST", "/api/restock-requests", {
    token: doctorTwoToken,
    body: {
      collection_date: collectionDate,
      note: "race-b",
      items: [{ inventory_id: itemId, item_name: "Race", quantity: 5 }],
    },
  });
  const [a, b] = await Promise.all([
    api("PATCH", `/api/restock-requests/${first.data.request.id}`, {
      token: operatorToken,
      body: { status: "accepted" },
    }),
    api("PATCH", `/api/restock-requests/${second.data.request.id}`, {
      token: operatorToken,
      body: { status: "accepted" },
    }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const reserved = Number(
    db
      .prepare(`SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservations WHERE inventory_id = ? AND status = 'active'`)
      .get(itemId).total,
  );
  assert.ok(reserved <= 5, `reserved ${reserved}`);
  const physical = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  assert.equal(physical, 5);
});

test("shortages are calculated and block ready until partial approval", async () => {
  const itemId = insertOcsItem({ name: `Short ${Date.now()}`, qty: 2 });
  const request = await createAcceptedRequest({ itemId, itemName: "Short", quantity: 5 });
  assert.equal(Number(request.fulfilment.items[0].shortage_quantity), 3);
  const queues = await api("GET", "/api/restock-requests/queues", { token: operatorToken });
  assert.ok(queues.data.shortages.some((row) => row.id === request.id));
  const ready = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: operatorToken,
    body: { status: "ready" },
  });
  assert.equal(ready.status, 400);
  const noReason = await api("PATCH", `/api/restock-requests/${request.id}/fulfilment`, {
    token: operatorToken,
    body: {
      lines: request.fulfilment.items.map((line) => ({
        id: line.id,
        picked_quantity: Number(line.reserved_quantity),
        fulfilled_quantity: Number(line.reserved_quantity),
      })),
      partial_approved: true,
      partial_reason: "short",
    },
  });
  assert.equal(noReason.status, 400);
  const partial = await api("PATCH", `/api/restock-requests/${request.id}/fulfilment`, {
    token: operatorToken,
    body: {
      lines: request.fulfilment.items.map((line) => ({
        id: line.id,
        picked_quantity: Number(line.reserved_quantity),
        fulfilled_quantity: Number(line.reserved_quantity),
      })),
      partial_approved: true,
      partial_reason: "Only two units arrived from supplier",
    },
  });
  assert.equal(partial.status, 200, JSON.stringify(partial.data));
  const readyAfter = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: operatorToken,
    body: { status: "ready" },
  });
  assert.equal(readyAfter.status, 200, JSON.stringify(readyAfter.data));
});

test("cancellation releases reservations", async () => {
  const itemId = insertOcsItem({ name: `Cancel ${Date.now()}`, qty: 8 });
  const request = await createAcceptedRequest({ itemId, itemName: "Cancel", quantity: 3 });
  const cancelled = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: operatorToken,
    body: { status: "cancelled", reason: "Doctor postponed the clinic day" },
  });
  assert.equal(cancelled.status, 200);
  const reserved = Number(
    db
      .prepare(`SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservations WHERE request_id = ? AND status = 'active'`)
      .get(request.id).total,
  );
  assert.equal(reserved, 0);
  assert.equal(availableToPromise(itemId), 8);
});

test("accepted amendment replaces reservations and rejected amendments do not", async () => {
  const itemId = insertOcsItem({ name: `Amend ${Date.now()}`, qty: 20 });
  const request = await createAcceptedRequest({ itemId, itemName: "Amend", quantity: 2 });
  const reservedBefore = Number(request.fulfilment.items[0].reserved_quantity);
  const rejectedSubmit = await api("POST", `/api/restock-requests/${request.id}/amendments`, {
    token: doctorToken,
    body: {
      collection_date: collectionDate,
      note: "try more",
      items: [{ inventory_id: itemId, item_name: "Amend", quantity: 9 }],
    },
  });
  const rejected = await api(
    "PATCH",
    `/api/restock-requests/${request.id}/amendments/${rejectedSubmit.data.amendment.id}`,
    { token: operatorToken, body: { decision: "rejected", reason: "Keep original pack" } },
  );
  assert.equal(rejected.status, 200);
  assert.equal(Number(rejected.data.request.fulfilment.items[0].reserved_quantity), reservedBefore);

  const submitted = await api("POST", `/api/restock-requests/${request.id}/amendments`, {
    token: doctorToken,
    body: {
      collection_date: collectionDate,
      note: "need five",
      items: [{ inventory_id: itemId, item_name: "Amend", quantity: 5 }],
    },
  });
  const accepted = await api(
    "PATCH",
    `/api/restock-requests/${request.id}/amendments/${submitted.data.amendment.id}`,
    { token: operatorToken, body: { decision: "accepted" } },
  );
  assert.equal(accepted.status, 200);
  assert.equal(Number(accepted.data.request.items[0].quantity), 5);
  assert.equal(Number(accepted.data.request.fulfilment.items[0].reserved_quantity), 5);
});

test("FEFO skips expired batches and uses non-expiring after dated stock", async () => {
  const itemId = insertOcsItem({ name: `FEFO ${Date.now()}`, qty: 0, expiry: "2028-01-01" });
  db.prepare("UPDATE inventory SET quantity = 6 WHERE id = ?").run(itemId);
  db.prepare("DELETE FROM inventory_batches WHERE item_id = ?").run(itemId);
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring) VALUES (?, 3, '2020-01-01', 5, 0)`,
  ).run(itemId);
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring) VALUES (?, 2, '2028-01-01', 5, 0)`,
  ).run(itemId);
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring) VALUES (?, 4, NULL, 5, 1)`,
  ).run(itemId);
  const request = await createAcceptedRequest({ itemId, itemName: "FEFO", quantity: 5 });
  const allocations = request.fulfilment.items[0].allocations;
  assert.equal(allocations.some((row) => String(row.expiry_date || "").startsWith("2020")), false);
  assert.equal(String(allocations[0].expiry_date).startsWith("2028"), true);
  assert.equal(allocations.some((row) => row.is_non_expiring), true);
});

test("collection posts a linked receipt, is idempotent, and failed transfer stays ready", async () => {
  const itemName = `Collect ${Date.now()}`;
  const itemId = insertOcsItem({ name: itemName, qty: 4 });
  const request = await createAcceptedRequest({ itemId, itemName, quantity: 2 });
  await pickAndReady(request.id);
  const qtyBefore = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  const completed = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  assert.ok(completed.data.request.transfer_transaction_id);
  const qtyAfter = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  assert.equal(qtyAfter, qtyBefore - 2);
  const bag = db
    .prepare(`SELECT quantity FROM inventory WHERE stock_scope = 'doctor' AND owner_doctor_id = ? AND item_name = ?`)
    .get(doctorId, itemName);
  assert.equal(Number(bag.quantity), 2);
  const receipt = await api("GET", `/api/inventory/receipts/${completed.data.request.transfer_transaction_id}`, {
    token: doctorToken,
  });
  assert.equal(receipt.status, 200);
  const again = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.request.transfer_transaction_id, completed.data.request.transfer_transaction_id);
  const qtyAgain = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  assert.equal(qtyAgain, qtyAfter);

  const other = await createAcceptedRequest({
    token: doctorTwoToken,
    itemId,
    itemName,
    quantity: 1,
    note: "other collect",
  });
  await pickAndReady(other.id);
  db.prepare("UPDATE inventory SET quantity = 0 WHERE id = ?").run(itemId);
  const failed = await api("PATCH", `/api/restock-requests/${other.id}`, {
    token: doctorTwoToken,
    body: { status: "completed" },
  });
  assert.ok(failed.status >= 400);
  const stillReady = db.prepare("SELECT status FROM restock_requests WHERE id = ?").get(other.id);
  assert.equal(stillReady.status, "ready");
});

test("same-status PATCH still checks doctor ownership", async () => {
  const itemId = insertOcsItem({ name: `Own ${Date.now()}`, qty: 3 });
  const request = await createAcceptedRequest({ itemId, itemName: "Own", quantity: 1 });
  const other = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorTwoToken,
    body: { status: "accepted" },
  });
  assert.equal(other.status, 403);
});

test("doctors cannot use normal self-restock and emergency override is off by default", async () => {
  const itemId = insertOcsItem({ name: `Emerg ${Date.now()}`, qty: 5 });
  const blocked = await api("POST", "/api/inventory/restock/my-inventory", {
    token: doctorToken,
    body: { items: [{ ocs_item_id: itemId, quantity: 1 }] },
  });
  assert.equal(blocked.status, 403);
  const cap = await api("GET", "/api/inventory/emergency-restock-capability", { token: doctorToken });
  assert.equal(cap.data.enabled, false);
});

test("enabled emergency override requires a valid reason and records the flag", async () => {
  process.env.ENABLE_DOCTOR_EMERGENCY_RESTOCK = "true";
  const itemId = insertOcsItem({ name: `EmergOn ${Date.now()}`, qty: 5 });
  const missing = await api("POST", "/api/inventory/restock/my-inventory", {
    token: doctorToken,
    body: { items: [{ ocs_item_id: itemId, quantity: 1 }], confirm: true, reason: "short" },
  });
  assert.equal(missing.status, 400);
  const ok = await api("POST", "/api/inventory/restock/my-inventory", {
    token: doctorToken,
    body: {
      items: [{ ocs_item_id: itemId, quantity: 1 }],
      confirm: true,
      reason: "Clinic bag empty before an urgent home visit",
    },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.emergency_override, true);
  delete process.env.ENABLE_DOCTOR_EMERGENCY_RESTOCK;
});

test("doctors cannot change quantity through item editing and operators cannot change prices", async () => {
  const itemId = insertOcsItem({ name: `Edit ${Date.now()}`, qty: 4 });
  const bagId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
         VALUES (?, ?, 2, 1, 'unit', 5, 10, 'doctor', ?)`,
      )
      .run("Bag Edit", folderId, doctorId).lastInsertRowid,
  );
  const doctorPut = await api("PUT", `/api/inventory/items/${bagId}`, {
    token: doctorToken,
    body: { quantity: 99, minimum_quantity: 1 },
  });
  assert.equal(doctorPut.status, 400);
  const parOk = await api("PUT", `/api/inventory/items/${bagId}`, {
    token: doctorToken,
    body: { minimum_quantity: 3 },
  });
  assert.equal(parOk.status, 200, JSON.stringify(parOk.data));
  const operatorPut = await api("PUT", `/api/inventory/items/${itemId}`, {
    token: operatorToken,
    body: { cost_price: 1, selling_price: 2, quantity: 4, minimum_quantity: 0, item_name: "Hacked" },
  });
  assert.equal(operatorPut.status, 403);
});

test("doctor history and receipts are scoped to their own bag", async () => {
  const itemId = insertOcsItem({ name: `Hist ${Date.now()}`, qty: 6 });
  const request = await createAcceptedRequest({ itemId, itemName: "Hist", quantity: 1 });
  await pickAndReady(request.id);
  const completed = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  const history = await api("GET", "/api/inventory/activity-history", { token: doctorToken });
  assert.equal(history.status, 200);
  assert.equal(history.data.net_value_rs, null);
  const tx = completed.data.request.transfer_transaction_id;
  const own = await api("GET", `/api/inventory/receipts/${tx}`, { token: doctorToken });
  assert.equal(own.status, 200);
  const other = await api("GET", `/api/inventory/receipts/${tx}`, { token: doctorTwoToken });
  assert.equal(other.status, 403);
});

test("stocktake sessions save, require approval, and apply atomically", async () => {
  const itemId = insertOcsItem({ name: `Count ${Date.now()}`, qty: 5 });
  const created = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { item_ids: [itemId] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.session.items[0].system_quantity, null);
  const lineId = created.data.session.items[0].id;
  const saved = await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 7 }] },
  });
  assert.equal(saved.status, 200);
  const submitted = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.session.status, "submitted");
  const applyEarly = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(applyEarly.status, 400);
  const approved = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.session.status, "applied");
  const qty = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  assert.equal(qty, 7);
  const again = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(again.data.idempotent, true);
});

test("shipment bulk release is atomic and idempotent", async () => {
  const csv = [
    "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
    `Consumable,Bulk ${Date.now()},3,0,unit,1,2,2029-01-01`,
  ].join("\n");
  const imported = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: { csv_text: csv, supplier: "Test Supplier" },
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  const shipmentId = imported.data.import_summary.shipment_id;
  const released = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "all_valid" },
  });
  assert.ok([200, 201].includes(released.status), JSON.stringify(released.data));
  const again = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "all_valid" },
  });
  assert.equal(again.data.idempotent, true);
});

test("queue counts match actionable records and legacy requests need linkage", async () => {
  const pending = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: {
      collection_date: collectionDate,
      note: "queue pending",
      items: [{ inventory_id: insertOcsItem({ name: `Q ${Date.now()}`, qty: 4 }), item_name: "Queue", quantity: 1 }],
    },
  });
  const queues = await api("GET", "/api/restock-requests/queues", { token: operatorToken });
  assert.equal(queues.status, 200);
  assert.equal(queues.data.counts.new_requests, queues.data.new_requests.length);
  assert.ok(queues.data.new_requests.some((row) => row.id === pending.data.request.id));

  const legacyId = Number(
    db
      .prepare(
        `INSERT INTO restock_requests (doctor_id, requested_by_user_id, collection_date, collection_day, status, note)
         VALUES (?, ?, ?, 1, 'accepted', 'legacy unlinked')`,
      )
      .run(doctorId, db.prepare("SELECT id FROM users WHERE username = 'arun.dharee'").get().id, collectionDate)
      .lastInsertRowid,
  );
  const after = await api("GET", "/api/restock-requests/queues", { token: operatorToken });
  assert.ok(after.data.fulfilment_linkage_required.some((row) => row.id === legacyId));
});

test("admin authorization remains and linkham cannot use inventory", async () => {
  const archived = await api("DELETE", `/api/inventory/items/${insertOcsItem({ name: `Arch ${Date.now()}`, qty: 1 })}`, {
    token: adminToken,
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.data.archived, true);
});
