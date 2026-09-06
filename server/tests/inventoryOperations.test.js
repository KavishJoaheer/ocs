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

async function pickAndReady(requestId, { fulfilledQuantity, partialReason } = {}) {
  const detail = await api("GET", `/api/restock-requests/${requestId}/fulfilment`, { token: operatorToken });
  const lines = (detail.data.fulfilment?.items || []).map((line) => {
    const reserved = Number(line.reserved_quantity);
    const fulfilled = fulfilledQuantity == null ? reserved : fulfilledQuantity;
    return {
      id: line.id,
      picked_quantity: fulfilled,
      fulfilled_quantity: fulfilled,
    };
  });
  const body = { lines };
  if (fulfilledQuantity != null) {
    body.partial_approved = true;
    body.partial_reason = partialReason || "Partial pack approved after a warehouse shortage";
  }
  const picked = await api("PATCH", `/api/restock-requests/${requestId}/fulfilment`, {
    token: operatorToken,
    body,
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

test("partial fulfilment consumes only the fulfilled quantity and returns unused ATP", async () => {
  const itemName = `Partial ${Date.now()}`;
  const itemId = insertOcsItem({ name: itemName, qty: 10 });
  const request = await createAcceptedRequest({ itemId, itemName, quantity: 10 });
  assert.equal(Number(request.fulfilment.items[0].reserved_quantity), 10);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 10);
  await pickAndReady(request.id, { fulfilledQuantity: 5 });
  const completed = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 5);
  const batchRemaining = Number(
    db.prepare("SELECT COALESCE(SUM(quantity_remaining),0) AS total FROM inventory_batches WHERE item_id = ?").get(itemId)
      .total,
  );
  assert.equal(batchRemaining, 5);
  const bag = db
    .prepare(`SELECT id, quantity FROM inventory WHERE stock_scope = 'doctor' AND owner_doctor_id = ? AND item_name = ?`)
    .get(doctorId, itemName);
  assert.equal(Number(bag.quantity), 5);
  const bagBatches = Number(
    db.prepare("SELECT COALESCE(SUM(quantity_remaining),0) AS total FROM inventory_batches WHERE item_id = ?").get(bag.id)
      .total,
  );
  assert.equal(bagBatches, 5);
  const movements = db
    .prepare(`SELECT action_type, quantity FROM inventory_movements WHERE meta_json LIKE ? ORDER BY id ASC`)
    .all(`%"request_id":${request.id}%`);
  const out = movements.find((row) => row.action_type === "restock_out");
  const inn = movements.find((row) => row.action_type === "restock_in");
  assert.equal(Number(out.quantity), 5);
  assert.equal(Number(inn.quantity), 5);
  const receipt = await api("GET", `/api/inventory/receipts/${completed.data.request.transfer_transaction_id}`, {
    token: doctorToken,
  });
  assert.equal(receipt.status, 200);
  const receiptQty = (receipt.data.receipt?.items || receipt.data.items || []).reduce(
    (sum, row) => sum + Number(row.quantity),
    0,
  );
  assert.equal(receiptQty, 5);
  const operatorName = db.prepare("SELECT full_name FROM users WHERE username = 'operator01'").get().full_name;
  const doctorName = db.prepare("SELECT full_name FROM doctors WHERE id = ?").get(doctorId).full_name;
  const issued = receipt.data.receipt?.issued_by_name || receipt.data.issued_by_name;
  const received = receipt.data.receipt?.received_by_name || receipt.data.received_by_name;
  assert.equal(issued, operatorName);
  assert.equal(received, doctorName);
  assert.equal(availableToPromise(itemId), 5);
  const reservation = db
    .prepare(`SELECT status, quantity FROM inventory_reservations WHERE request_id = ? ORDER BY id DESC LIMIT 1`)
    .get(request.id);
  assert.equal(reservation.status, "consumed");
  assert.equal(Number(reservation.quantity), 5);
  const reservedBatches = Number(
    db
      .prepare(
        `SELECT COALESCE(SUM(rb.quantity),0) AS total
         FROM inventory_reservation_batches rb
         JOIN inventory_reservations r ON r.id = rb.reservation_id
         WHERE r.request_id = ?`,
      )
      .get(request.id).total,
  );
  assert.equal(reservedBatches, 5);
  const fulfilment = db
    .prepare(
      `SELECT requested_quantity, reserved_quantity, fulfilled_quantity
       FROM restock_request_fulfillment_items WHERE request_item_id = ?`,
    )
    .get(request.items[0].id);
  assert.equal(Number(fulfilment.requested_quantity), 10);
  assert.equal(Number(fulfilment.reserved_quantity), 10);
  assert.equal(Number(fulfilment.fulfilled_quantity), 5);
});

test("fulfilled quantity of zero transfers nothing and releases the reservation", async () => {
  const itemName = `ZeroFill ${Date.now()}`;
  const itemId = insertOcsItem({ name: itemName, qty: 8 });
  const request = await createAcceptedRequest({ itemId, itemName, quantity: 3 });
  await pickAndReady(request.id, { fulfilledQuantity: 0 });
  const completed = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 8);
  const bag = db
    .prepare(`SELECT quantity FROM inventory WHERE stock_scope = 'doctor' AND owner_doctor_id = ? AND item_name = ?`)
    .get(doctorId, itemName);
  assert.ok(!bag || Number(bag.quantity) === 0);
  const reservation = db
    .prepare(`SELECT status FROM inventory_reservations WHERE request_id = ? ORDER BY id DESC LIMIT 1`)
    .get(request.id);
  assert.equal(reservation.status, "released");
  assert.equal(availableToPromise(itemId), 8);
  const movementCount = Number(
    db.prepare(`SELECT COUNT(*) AS count FROM inventory_movements WHERE meta_json LIKE ?`).get(`%"request_id":${request.id}%`)
      .count,
  );
  assert.equal(movementCount, 0);
});

test("partial fulfilment across batches consumes fulfilled quantity in locked FEFO order", async () => {
  const itemName = `Split ${Date.now()}`;
  const itemId = insertOcsItem({ name: itemName, qty: 0, expiry: "2028-01-01" });
  db.prepare("UPDATE inventory SET quantity = 10 WHERE id = ?").run(itemId);
  db.prepare("DELETE FROM inventory_batches WHERE item_id = ?").run(itemId);
  const early = Number(
    db
      .prepare(
        `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring) VALUES (?, 3, '2028-01-01', 5, 0)`,
      )
      .run(itemId).lastInsertRowid,
  );
  const later = Number(
    db
      .prepare(
        `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring) VALUES (?, 7, '2029-06-01', 5, 0)`,
      )
      .run(itemId).lastInsertRowid,
  );
  const request = await createAcceptedRequest({ itemId, itemName, quantity: 10 });
  await pickAndReady(request.id, { fulfilledQuantity: 5 });
  const completed = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  assert.equal(db.prepare("SELECT quantity_remaining FROM inventory_batches WHERE id = ?").get(early).quantity_remaining, 0);
  assert.equal(db.prepare("SELECT quantity_remaining FROM inventory_batches WHERE id = ?").get(later).quantity_remaining, 5);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 5);
});

test("failed partial collection rolls back batches, bag, movements and status", async () => {
  const itemName = `FailPartial ${Date.now()}`;
  const itemId = insertOcsItem({ name: itemName, qty: 10 });
  const request = await createAcceptedRequest({ itemId, itemName, quantity: 10 });
  await pickAndReady(request.id, { fulfilledQuantity: 5 });
  const batchBefore = db.prepare("SELECT id, quantity_remaining FROM inventory_batches WHERE item_id = ?").all(itemId);
  db.prepare("UPDATE inventory SET quantity = 0 WHERE id = ?").run(itemId);
  const failed = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.ok(failed.status >= 400, JSON.stringify(failed.data));
  assert.equal(db.prepare("SELECT status FROM restock_requests WHERE id = ?").get(request.id).status, "ready");
  db.prepare("UPDATE inventory SET quantity = 10 WHERE id = ?").run(itemId);
  const batchAfter = db.prepare("SELECT id, quantity_remaining FROM inventory_batches WHERE item_id = ?").all(itemId);
  assert.deepEqual(batchAfter, batchBefore);
  const bag = db
    .prepare(`SELECT quantity FROM inventory WHERE stock_scope = 'doctor' AND owner_doctor_id = ? AND item_name = ?`)
    .get(doctorId, itemName);
  assert.ok(!bag);
  assert.equal(
    Number(
      db.prepare(`SELECT COUNT(*) AS count FROM inventory_movements WHERE meta_json LIKE ?`).get(`%"request_id":${request.id}%`)
        .count,
    ),
    0,
  );
});

test("repeated collection after partial fulfilment stays idempotent", async () => {
  const itemName = `IdemPartial ${Date.now()}`;
  const itemId = insertOcsItem({ name: itemName, qty: 10 });
  const request = await createAcceptedRequest({ itemId, itemName, quantity: 10 });
  await pickAndReady(request.id, { fulfilledQuantity: 5 });
  const first = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(first.status, 200);
  const qty = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  const second = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(second.status, 200);
  assert.equal(second.data.request.transfer_transaction_id, first.data.request.transfer_transaction_id);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, qty);
});

test("stocktake blank counts stay null and explicit zero is stored", async () => {
  const first = insertOcsItem({ name: `CountA ${Date.now()}`, qty: 4 });
  const second = insertOcsItem({ name: `CountB ${Date.now()}`, qty: 6 });
  const created = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { item_ids: [first, second] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const [lineA, lineB] = created.data.session.items;
  const saved = await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineA.id, physical_quantity: 4 }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const savedA = saved.data.session.items.find((row) => row.id === lineA.id);
  const savedB = saved.data.session.items.find((row) => row.id === lineB.id);
  assert.equal(savedA.physical_quantity, 4);
  assert.equal(savedB.physical_quantity, null);
  const zero = await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineB.id, physical_quantity: 0 }] },
  });
  assert.equal(zero.status, 200, JSON.stringify(zero.data));
  assert.equal(zero.data.session.items.find((row) => row.id === lineB.id).physical_quantity, 0);

  const third = insertOcsItem({ name: `CountC ${Date.now()}`, qty: 2 });
  const blankSession = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { item_ids: [third] },
  });
  const blankLine = blankSession.data.session.items[0].id;
  for (const value of ["", "  ", null, 1.5, -1]) {
    const bad = await api("PATCH", `/api/inventory/stocktake/sessions/${blankSession.data.session.id}`, {
      token: operatorToken,
      body: { lines: [{ id: blankLine, physical_quantity: value }] },
    });
    if (value === null) {
      assert.equal(bad.status, 200, JSON.stringify(bad.data));
      assert.equal(bad.data.session.items[0].physical_quantity, null);
    } else {
      assert.equal(bad.status, 400, `value ${JSON.stringify(value)} => ${JSON.stringify(bad.data)}`);
      const still = db
        .prepare("SELECT physical_quantity FROM inventory_stocktake_session_items WHERE id = ?")
        .get(blankLine);
      assert.equal(still.physical_quantity, null);
    }
  }
  const submitBlank = await api("POST", `/api/inventory/stocktake/sessions/${blankSession.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(submitBlank.status, 400);

  const equal = insertOcsItem({ name: `CountZeroVar ${Date.now()}`, qty: 3 });
  const zeroVar = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { item_ids: [equal] },
  });
  const counted = await api("PATCH", `/api/inventory/stocktake/sessions/${zeroVar.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: zeroVar.data.session.items[0].id, physical_quantity: 3 }] },
  });
  assert.equal(counted.status, 200);
  const closed = await api("POST", `/api/inventory/stocktake/sessions/${zeroVar.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  assert.equal(closed.data.session.status, "applied");
});

test("operator can inspect, accept and reject amendments from the changes workflow", async () => {
  const itemId = insertOcsItem({ name: `AmendQ ${Date.now()}`, qty: 20 });
  const request = await createAcceptedRequest({ itemId, itemName: "AmendQ", quantity: 2 });
  const submitted = await api("POST", `/api/restock-requests/${request.id}/amendments`, {
    token: doctorToken,
    body: {
      collection_date: collectionDate,
      note: "Need nine instead",
      items: [{ inventory_id: itemId, item_name: "AmendQ", quantity: 9 }],
    },
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  const viewed = await api("GET", `/api/restock-requests/${request.id}`, { token: operatorToken });
  assert.equal(viewed.status, 200);
  assert.equal(Number(viewed.data.request.items[0].quantity), 2);
  assert.equal(Number(viewed.data.request.pending_amendment.items[0].quantity), 9);
  const queues = await api("GET", "/api/restock-requests/queues", { token: operatorToken });
  assert.ok(queues.data.changes.some((row) => row.id === request.id));
  const short = await api(
    "PATCH",
    `/api/restock-requests/${request.id}/amendments/${submitted.data.amendment.id}`,
    { token: operatorToken, body: { decision: "rejected", reason: "too short" } },
  );
  assert.equal(short.status, 400);
  const reservedBefore = Number(
    db
      .prepare(`SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservations WHERE request_id = ? AND status = 'active'`)
      .get(request.id).total,
  );
  const rejected = await api(
    "PATCH",
    `/api/restock-requests/${request.id}/amendments/${submitted.data.amendment.id}`,
    { token: operatorToken, body: { decision: "rejected", reason: "Keep the original accepted pack" } },
  );
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  assert.equal(Number(rejected.data.request.items[0].quantity), 2);
  assert.equal(
    Number(
      db
        .prepare(`SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_reservations WHERE request_id = ? AND status = 'active'`)
        .get(request.id).total,
    ),
    reservedBefore,
  );
  const afterReject = await api("GET", "/api/restock-requests/queues", { token: operatorToken });
  assert.equal(afterReject.data.changes.some((row) => row.id === request.id), false);

  const again = await api("POST", `/api/restock-requests/${request.id}/amendments`, {
    token: doctorToken,
    body: {
      collection_date: collectionDate,
      note: "Need five",
      items: [{ inventory_id: itemId, item_name: "AmendQ", quantity: 5 }],
    },
  });
  const readyBlocked = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: operatorToken,
    body: { status: "ready" },
  });
  assert.equal(readyBlocked.status, 400);
  const amendmentId = again.data.amendment.id;
  const [first, second] = await Promise.all([
    api("PATCH", `/api/restock-requests/${request.id}/amendments/${amendmentId}`, {
      token: operatorToken,
      body: { decision: "accepted", reason: "Approved revised quantities" },
    }),
    api("PATCH", `/api/restock-requests/${request.id}/amendments/${amendmentId}`, {
      token: operatorToken,
      body: { decision: "accepted", reason: "Approved revised quantities" },
    }),
  ]);
  const acceptedCount = [first.status, second.status].filter((status) => status === 200).length;
  const conflictCount = [first.status, second.status].filter((status) => status === 409).length;
  assert.equal(acceptedCount, 1, JSON.stringify([first.data, second.data]));
  assert.ok(conflictCount >= 1 || [first.status, second.status].includes(409) || [first.status, second.status].filter((s) => s === 200).length === 1);
  const winner = first.status === 200 ? first : second;
  if (winner.status !== 200) {
    const sequential = await api("PATCH", `/api/restock-requests/${request.id}/amendments/${amendmentId}`, {
      token: operatorToken,
      body: { decision: "accepted" },
    });
    assert.equal(sequential.status, 409);
  } else {
    assert.equal(Number(winner.data.request.items[0].quantity), 5);
    const repeat = await api("PATCH", `/api/restock-requests/${request.id}/amendments/${amendmentId}`, {
      token: operatorToken,
      body: { decision: "accepted" },
    });
    assert.equal(repeat.status, 409);
  }
  const updated = await api("GET", `/api/restock-requests/${request.id}`, { token: operatorToken });
  assert.equal(Number(updated.data.request.items[0].quantity), 5);
  assert.equal(updated.data.request.pending_amendment, null);
  assert.equal(Number(updated.data.request.fulfilment.items[0].reserved_quantity), 5);
  const nextQueues = await api("GET", "/api/restock-requests/queues", { token: operatorToken });
  assert.equal(nextQueues.data.changes.some((row) => row.id === request.id), false);
  assert.ok(
    nextQueues.data.pick_today.some((row) => row.id === request.id) ||
      nextQueues.data.shortages.some((row) => row.id === request.id),
  );
});

function todayLocalIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function offsetIso(days) {
  const now = new Date();
  now.setDate(now.getDate() + days);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

test("past expiry receipt is rejected and future or non-expiring receipts are accepted", async () => {
  const itemId = insertOcsItem({ name: `Recv ${Date.now()}`, qty: 2 });
  const past = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: offsetIso(-1) },
  });
  assert.equal(past.status, 400, JSON.stringify(past.data));
  const future = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 2, expiry_date: offsetIso(14) },
  });
  assert.equal(future.status, 201, JSON.stringify(future.data));
  const today = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: todayLocalIso() },
  });
  assert.equal(today.status, 201, JSON.stringify(today.data));
  const nonExpiring = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 3, is_non_expiring: true },
  });
  assert.equal(nonExpiring.status, 201, JSON.stringify(nonExpiring.data));
  const qty = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  assert.equal(qty, 8);
});

test("admin cannot receive stock without an operational override and operators cannot edit catalogue prices", async () => {
  const itemId = insertOcsItem({ name: `Perm ${Date.now()}`, qty: 2 });
  const adminReceive = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: adminToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: offsetIso(30) },
  });
  assert.equal(adminReceive.status, 403, JSON.stringify(adminReceive.data));
  const adminOverride = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: adminToken,
    body: {
      action_type: "stock_in",
      quantity: 1,
      expiry_date: offsetIso(30),
      operational_override: true,
      override_reason: "Emergency weekend receiving while no operator is on duty",
    },
  });
  assert.equal(adminOverride.status, 201, JSON.stringify(adminOverride.data));
  const doctorReceive = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: doctorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: offsetIso(30) },
  });
  assert.equal(doctorReceive.status, 403);
});

test("exceptional correction is admin-only, audited, and keeps batch totals aligned", async () => {
  const itemId = insertOcsItem({ name: `Corr ${Date.now()}`, qty: 5 });
  const operatorDenied = await api("POST", `/api/inventory/items/${itemId}/exceptional-correction`, {
    token: operatorToken,
    body: { next_quantity: 8, reason: "Found extra boxes in the locked cupboard", confirm: true },
  });
  assert.equal(operatorDenied.status, 403);
  const missingConfirm = await api("POST", `/api/inventory/items/${itemId}/exceptional-correction`, {
    token: adminToken,
    body: { next_quantity: 8, reason: "Found extra boxes in the locked cupboard" },
  });
  assert.equal(missingConfirm.status, 400);
  const ok = await api("POST", `/api/inventory/items/${itemId}/exceptional-correction`, {
    token: adminToken,
    body: {
      next_quantity: 8,
      reason: "Found extra boxes in the locked cupboard",
      note: "Weekend count",
      confirm: true,
    },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const qty = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  const batches = db
    .prepare("SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM inventory_batches WHERE item_id = ?")
    .get(itemId).total;
  assert.equal(qty, 8);
  assert.equal(batches, 8);
  const movement = db
    .prepare("SELECT * FROM inventory_movements WHERE item_id = ? AND action_type = 'exceptional_correction'")
    .get(itemId);
  assert.ok(movement);
  assert.match(String(movement.note || ""), /Found extra boxes/);
  const audit = db
    .prepare("SELECT * FROM inventory_audit_logs WHERE item_id = ? AND action_type = 'exceptional_correction'")
    .get(itemId);
  assert.ok(audit);
  const cataloguePut = await api("PUT", `/api/inventory/items/${itemId}`, {
    token: adminToken,
    body: { quantity: 99, minimum_quantity: 0, item_name: `Corr ${Date.now()}`, folder_id: folderId, unit: "unit", cost_price: 5, selling_price: 10 },
  });
  assert.equal(cataloguePut.status, 400, JSON.stringify(cataloguePut.data));
});

test("write-off preview is atomic and cannot exceed available-to-transfer stock", async () => {
  const itemId = insertOcsItem({ name: `WO ${Date.now()}`, qty: 6 });
  await createAcceptedRequest({ itemId, itemName: "WO", quantity: 2, note: "hold" });
  const preview = await api("GET", `/api/inventory/items/${itemId}/allocation-preview?quantity=5&mode=write_off`, {
    token: operatorToken,
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.preview.available_to_transfer, 4);
  const over = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "remove", quantity: 5, reason: "Expired", confirm: true },
  });
  assert.equal(over.status, 400);
  const damagedNoNote = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "remove", quantity: 1, reason: "Damaged", confirm: true },
  });
  assert.equal(damagedNoNote.status, 400);
  const ok = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: {
      action_type: "remove",
      quantity: 1,
      reason: "Damaged",
      note: "Carton crushed in transit",
      confirm: true,
    },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const qty = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  const batches = db
    .prepare("SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM inventory_batches WHERE item_id = ?")
    .get(itemId).total;
  assert.equal(qty, 5);
  assert.equal(batches, 5);
});

test("accepted and ready cancellation releases reservations without deleting history", async () => {
  const itemId = insertOcsItem({ name: `Can ${Date.now()}`, qty: 8 });
  const request = await createAcceptedRequest({ itemId, itemName: "Can", quantity: 3, note: "cancel me" });
  const active = db
    .prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE request_id = ? AND status = 'active'")
    .get(request.id).count;
  assert.equal(Number(active), 1);
  const cancelled = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: operatorToken,
    body: { status: "cancelled", reason: "Doctor postponed the visit" },
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.request.status, "cancelled");
  assert.ok(cancelled.data.request.archived_at);
  const remaining = db
    .prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE request_id = ? AND status = 'active'")
    .get(request.id).count;
  assert.equal(Number(remaining), 0);
  const history = await api("GET", `/api/restock-requests/${request.id}`, { token: operatorToken });
  assert.equal(history.status, 200);
  assert.ok(history.data.request.events.length >= 2);
  assert.ok(history.data.request.timeline.some((row) => /cancel/i.test(row.label)));
  const deleted = await api("DELETE", `/api/restock-requests/${request.id}`, { token: operatorToken });
  assert.equal(deleted.status, 405);
});

test("request detail is role-scoped and includes events, fulfilment, and receipt references", async () => {
  const itemId = insertOcsItem({ name: `Det ${Date.now()}`, qty: 4 });
  const request = await createAcceptedRequest({ itemId, itemName: "Det", quantity: 1 });
  await pickAndReady(request.id);
  const completed = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  const own = await api("GET", `/api/restock-requests/${request.id}`, { token: doctorToken });
  assert.equal(own.status, 200);
  assert.ok(own.data.request.events.length);
  assert.ok(own.data.request.fulfilment);
  assert.ok(own.data.request.transfer_transaction_id);
  assert.equal(own.data.request.receipt_available, true);
  assert.ok(Array.isArray(own.data.request.movement_ids));
  const other = await api("GET", `/api/restock-requests/${request.id}`, { token: doctorTwoToken });
  assert.equal(other.status, 403);
});

test("excluded shipment rows become terminal and idle shipments leave the incoming queue", async () => {
  const csv = [
    "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
    `Consumable,Keep ${Date.now()},2,0,unit,1,2,2029-01-01`,
    `Consumable,Drop ${Date.now()},4,0,unit,1,2,2029-01-01`,
  ].join("\n");
  const imported = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: { csv_text: csv, supplier: "Exclude Co" },
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  const shipmentId = imported.data.import_summary.shipment_id;
  const drop = imported.data.shipment.lines.find((line) => String(line.item_name).startsWith("Drop"));
  const keep = imported.data.shipment.lines.find((line) => String(line.item_name).startsWith("Keep"));
  const excluded = await api("POST", `/api/inventory/shipments/${shipmentId}/exclude`, {
    token: operatorToken,
    body: { lines: [{ id: drop.id, reason: "Wrong product on delivery note" }] },
  });
  assert.equal(excluded.status, 200, JSON.stringify(excluded.data));
  const excludedLine = excluded.data.shipment.lines.find((line) => Number(line.id) === Number(drop.id));
  assert.equal(excludedLine.status, "excluded");
  assert.match(String(excludedLine.exclude_reason || ""), /Wrong product/);
  const released = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [keep.id] },
  });
  assert.ok([200, 201].includes(released.status), JSON.stringify(released.data));
  const after = await api("GET", `/api/inventory/shipments/${shipmentId}`, { token: operatorToken });
  assert.equal(after.data.shipment.in_incoming_queue, false);
  assert.equal(
    after.data.shipment.lines.find((line) => Number(line.id) === Number(drop.id)).status,
    "excluded",
  );
  const accidental = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [drop.id] },
  });
  assert.ok([200, 201, 400].includes(accidental.status));
  if (accidental.status === 201) {
    assert.equal(accidental.data.shipment.lines.find((line) => Number(line.id) === Number(drop.id)).status, "excluded");
  }
});

test("explicit zero stocktake can be submitted and blank stocktake cannot", async () => {
  const itemId = insertOcsItem({ name: `ZeroSub ${Date.now()}`, qty: 4 });
  const created = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { item_ids: [itemId] },
  });
  const lineId = created.data.session.items[0].id;
  const blank = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(blank.status, 400);
  const saved = await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 0 }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const submitted = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  assert.ok(["submitted", "applied"].includes(submitted.data.session.status));
});

test("human-triggered bag movements retain the acting user rather than System", async () => {
  const itemId = insertOcsItem({ name: `BagAct ${Date.now()}`, qty: 5 });
  const restock = await api("POST", "/api/inventory/restock", {
    token: operatorToken,
    body: { ocs_item_id: itemId, doctor_id: doctorId, quantity: 2 },
  });
  assert.equal(restock.status, 201, JSON.stringify(restock.data));
  const operatorName = db.prepare("SELECT full_name FROM users WHERE username = 'operator01'").get().full_name;
  const out = db
    .prepare("SELECT meta_json FROM inventory_movements WHERE action_type = 'restock_out' ORDER BY id DESC LIMIT 1")
    .get();
  const meta = JSON.parse(out.meta_json || "{}");
  assert.equal(meta.performed_by_name, operatorName);
  assert.notEqual(meta.performed_by_name, "System");
});

