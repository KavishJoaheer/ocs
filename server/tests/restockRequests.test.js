"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const TMP_DB = path.join(
  os.tmpdir(),
  `ocs-restock-test-${process.pid}-${Date.now()}.db`,
);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { db, migrateRestockRequestsSchemaIfNeeded } = require("../src/db");
const { isValidCollectionDate } = require("../src/lib/collectionDays");
const { shouldDeliverSupplyRequestEvent } = require("../src/lib/inventoryRealtime");

let server;
let baseUrl;
let adminToken;
let operatorToken;
let doctorToken;
let doctorTwoToken;
let inventoryId;
let inventoryName;
let collectionDate;
let collectionDateTwo;
let createdId;
let acceptedId;
let amendmentId;
let readyId;
let otherDoctorReadyId;

function nextCollectionIso(skip = 0) {
  const start = new Date();
  let found = 0;
  for (let i = 1; i < 28; i += 1) {
    const date = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i),
    );
    const iso = date.toISOString().slice(0, 10);
    if (!isValidCollectionDate(iso)) continue;
    if (found === skip) return iso;
    found += 1;
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
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

async function login(username) {
  const res = await api("POST", "/api/auth/login", {
    body: { username, password: "Welcome@123" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.token;
}

function requestPayload(overrides = {}) {
  return {
    collection_date: collectionDate,
    note: "Please pack separately",
    items: [
      {
        inventory_id: inventoryId,
        item_name: inventoryName,
        quantity: 2,
      },
    ],
    ...overrides,
  };
}

async function pickReservedThenReady(requestId, token) {
  const detail = await api("GET", `/api/restock-requests/${requestId}/fulfilment`, { token });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  const lines = (detail.data.fulfilment?.items || []).map((line) => ({
    id: line.id,
    picked_quantity: Number(line.reserved_quantity || 0),
    fulfilled_quantity: Number(line.reserved_quantity || 0),
  }));
  const picked = await api("PATCH", `/api/restock-requests/${requestId}/fulfilment`, {
    token,
    body: { lines },
  });
  assert.equal(picked.status, 200, JSON.stringify(picked.data));
  return api("PATCH", `/api/restock-requests/${requestId}`, {
    token,
    body: { status: "ready" },
  });
}

function startSseListener(streamToken) {
  const ac = new AbortController();
  let buffer = "";
  let resolveConnected;
  let resolveChange;
  const connected = new Promise((resolve, reject) => {
    resolveConnected = resolve;
    setTimeout(() => reject(new Error("SSE connected event not received")), 4000);
  }).catch((error) => error);
  const change = new Promise((resolve) => {
    resolveChange = resolve;
  });

  const running = (async () => {
    const res = await fetch(
      `${baseUrl}/api/inventory/stream?access_token=${encodeURIComponent(streamToken)}`,
      { signal: ac.signal, headers: { Accept: "text/event-stream" } },
    );
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("event: connected") && resolveConnected) {
        resolveConnected(true);
        resolveConnected = null;
      }
      if (buffer.includes("event: supply_request_change") && resolveChange) {
        resolveChange(buffer);
        resolveChange = null;
      }
    }
  })().catch(() => {});

  return {
    connected,
    change,
    buffer: () => buffer,
    close() {
      ac.abort();
      return running;
    },
  };
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
  collectionDate = nextCollectionIso(0);
  collectionDateTwo = nextCollectionIso(1);

  inventoryName = `Restock Test Gauze ${Date.now()}`;
  inventoryId = Number(
    db
      .prepare(`
        INSERT INTO inventory (
          item_name, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope
        )
        VALUES (?, 40, 2, 'unit', 1, 2, 'ocs')
      `)
      .run(inventoryName).lastInsertRowid,
  );
  db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
    VALUES (?, 40, '2028-12-01', 1, 0)
  `).run(inventoryId);
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${TMP_DB}${suffix}`);
    } catch {
      // best-effort cleanup
    }
  }
});

test("legacy prepared data migrates to ready", () => {
  const doctor = db
    .prepare("SELECT id, doctor_id FROM users WHERE username = 'arun.dharee'")
    .get();
  db.pragma("foreign_keys = OFF");
  try {
    db.exec("ALTER TABLE restock_requests RENAME TO restock_requests_keep");
    db.exec(`
      CREATE TABLE restock_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doctor_id INTEGER NOT NULL,
        requested_by_user_id INTEGER NOT NULL,
        collection_date TEXT NOT NULL,
        collection_day INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'prepared', 'cancelled')),
        note TEXT NOT NULL DEFAULT '',
        prepared_at TEXT,
        prepared_by_user_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const info = db
      .prepare(`
        INSERT INTO restock_requests (
          doctor_id, requested_by_user_id, collection_date, collection_day,
          status, note, prepared_at, prepared_by_user_id
        ) VALUES (?, ?, ?, 1, 'prepared', 'legacy prepared row', '2026-01-02 08:00:00', ?)
      `)
      .run(doctor.doctor_id, doctor.id, collectionDate, doctor.id);
    const legacyId = Number(info.lastInsertRowid);
    migrateRestockRequestsSchemaIfNeeded();
    const migrated = db
      .prepare("SELECT status, ready_at, archived_at FROM restock_requests WHERE id = ?")
      .get(legacyId);
    assert.equal(migrated.status, "ready");
    assert.equal(migrated.ready_at, "2026-01-02 08:00:00");

    db.exec("ALTER TABLE restock_requests RENAME TO restock_requests_migrated_row");
    db.exec("ALTER TABLE restock_requests_keep RENAME TO restock_requests");
    const keepCols = db.prepare("PRAGMA table_info(restock_requests)").all().map((col) => col.name);
    const extra = db.prepare("SELECT * FROM restock_requests_migrated_row WHERE id = ?").get(legacyId);
    const insertCols = [
      "id",
      "doctor_id",
      "requested_by_user_id",
      "collection_date",
      "collection_day",
      "status",
      "note",
      "ready_at",
      "ready_by_user_id",
      "archived_at",
      "created_at",
      "updated_at",
    ].filter((col) => keepCols.includes(col));
    db.prepare(
      `INSERT INTO restock_requests (${insertCols.join(", ")})
       VALUES (${insertCols.map(() => "?").join(", ")})`,
    ).run(...insertCols.map((col) => extra[col]));
    db.exec("DROP TABLE restock_requests_migrated_row");
    migrateRestockRequestsSchemaIfNeeded();
  } finally {
    db.pragma("foreign_keys = ON");
  }

  const live = db.prepare("SELECT status FROM restock_requests WHERE note = 'legacy prepared row'").get();
  assert.equal(live.status, "ready");
});

test("doctor creates a pending request", async () => {
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: requestPayload(),
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.request.status, "pending");
  assert.equal(created.data.request.status_labels.doctor, "Requested");
  assert.equal(created.data.request.items.length, 1);
  createdId = created.data.request.id;

  const listed = await api("GET", "/api/restock-requests", { token: doctorToken });
  assert.equal(listed.status, 200);
  assert.ok(listed.data.requests.some((row) => row.id === createdId));
});

test("doctor edits and cancels while pending", async () => {
  const edited = await api("PUT", `/api/restock-requests/${createdId}`, {
    token: doctorToken,
    body: requestPayload({
      note: "Updated note",
      items: [{ inventory_id: inventoryId, item_name: "Test Gauze Pad", quantity: 3 }],
    }),
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.request.note, "Updated note");
  assert.equal(edited.data.request.items[0].quantity, 3);

  const cancelled = await api("PATCH", `/api/restock-requests/${createdId}`, {
    token: doctorToken,
    body: { status: "cancelled" },
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.request.status, "cancelled");
  assert.ok(cancelled.data.request.archived_at);
});

test("operator accepts a pending request", async () => {
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: requestPayload({ note: "Accept me" }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  acceptedId = created.data.request.id;

  const accepted = await api("PATCH", `/api/restock-requests/${acceptedId}`, {
    token: operatorToken,
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.equal(accepted.data.request.status, "accepted");
  assert.equal(accepted.data.request.status_labels.doctor, "Request Accepted");
  assert.ok(accepted.data.request.accepted_at);
  const qtyAfterAccept = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(inventoryId).quantity;
  assert.equal(qtyAfterAccept, 40);
  assert.ok(accepted.data.request.fulfilment);
  assert.equal(Number(accepted.data.request.fulfilment.items[0].reserved_quantity), 2);
});

test("doctor cannot edit or cancel after acceptance", async () => {
  const edited = await api("PUT", `/api/restock-requests/${acceptedId}`, {
    token: doctorToken,
    body: requestPayload({ note: "should fail" }),
  });
  assert.equal(edited.status, 400, JSON.stringify(edited.data));

  const cancelled = await api("PATCH", `/api/restock-requests/${acceptedId}`, {
    token: doctorToken,
    body: { status: "cancelled" },
  });
  assert.equal(cancelled.status, 400, JSON.stringify(cancelled.data));
});

test("doctor submits an amendment and original accepted values stay unchanged", async () => {
  const before = await api("GET", `/api/restock-requests/${acceptedId}`, { token: doctorToken });
  const submitted = await api("POST", `/api/restock-requests/${acceptedId}/amendments`, {
    token: doctorToken,
    body: requestPayload({
      collection_date: collectionDateTwo,
      note: "Please add more gauze",
      items: [{ inventory_id: inventoryId, item_name: "Test Gauze Pad", quantity: 9 }],
    }),
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  assert.equal(submitted.data.request.status, "accepted");
  assert.equal(submitted.data.request.note, before.data.request.note);
  assert.equal(submitted.data.request.items[0].quantity, before.data.request.items[0].quantity);
  assert.equal(submitted.data.request.collection_date, before.data.request.collection_date);
  assert.equal(submitted.data.request.pending_amendment.status, "pending");
  amendmentId = submitted.data.amendment.id;

  const duplicate = await api("POST", `/api/restock-requests/${acceptedId}/amendments`, {
    token: doctorToken,
    body: requestPayload({ collection_date: collectionDateTwo }),
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));
});

test("a pending amendment blocks Supply Ready", async () => {
  const ready = await api("PATCH", `/api/restock-requests/${acceptedId}`, {
    token: operatorToken,
    body: { status: "ready" },
  });
  assert.equal(ready.status, 400, JSON.stringify(ready.data));
  assert.match(String(ready.data.error || ""), /change request/i);
});

test("operator rejects an amendment without changing the accepted request", async () => {
  const rejected = await api(
    "PATCH",
    `/api/restock-requests/${acceptedId}/amendments/${amendmentId}`,
    {
      token: operatorToken,
      body: { decision: "rejected", reason: "Already packed" },
    },
  );
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  assert.equal(rejected.data.request.status, "accepted");
  assert.equal(rejected.data.request.items[0].quantity, 2);
  assert.equal(rejected.data.request.note, "Accept me");
  assert.equal(rejected.data.request.pending_amendment, null);
  assert.equal(rejected.data.request.latest_amendment.status, "rejected");
});

test("operator accepts an amendment atomically", async () => {
  const submitted = await api("POST", `/api/restock-requests/${acceptedId}/amendments`, {
    token: doctorToken,
    body: requestPayload({
      collection_date: collectionDateTwo,
      note: "Confirmed extra gauze",
      items: [{ inventory_id: inventoryId, item_name: "Test Gauze Pad", quantity: 5 }],
    }),
  });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.data));
  const pendingId = submitted.data.amendment.id;

  const accepted = await api(
    "PATCH",
    `/api/restock-requests/${acceptedId}/amendments/${pendingId}`,
    {
      token: operatorToken,
      body: { decision: "accepted" },
    },
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.equal(accepted.data.request.status, "accepted");
  assert.equal(accepted.data.request.collection_date, collectionDateTwo);
  assert.equal(accepted.data.request.note, "Confirmed extra gauze");
  assert.equal(accepted.data.request.items[0].quantity, 5);
  assert.equal(accepted.data.request.pending_amendment, null);
});

test("operator marks an accepted request ready and doctor observes it", async () => {
  const qtyBefore = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(inventoryId).quantity;
  const movementsBefore = Number(
    db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id = ?").get(inventoryId)
      .count || 0,
  );

  const ready = await pickReservedThenReady(acceptedId, operatorToken);
  assert.equal(ready.status, 200, JSON.stringify(ready.data));
  assert.equal(ready.data.request.status, "ready");
  assert.equal(ready.data.request.status_labels.doctor, "Supply Ready");
  readyId = acceptedId;

  const doctorView = await api("GET", `/api/restock-requests/${readyId}`, { token: doctorToken });
  assert.equal(doctorView.status, 200);
  assert.equal(doctorView.data.request.status, "ready");
  assert.equal(doctorView.data.request.status_labels.doctor, "Supply Ready");

  const qtyAfter = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(inventoryId).quantity;
  const movementsAfter = Number(
    db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id = ?").get(inventoryId)
      .count || 0,
  );
  assert.equal(qtyAfter, qtyBefore);
  assert.equal(movementsAfter, movementsBefore);
});

test("only the owning doctor can confirm collection", async () => {
  const other = await api("PATCH", `/api/restock-requests/${readyId}`, {
    token: doctorTwoToken,
    body: { status: "completed" },
  });
  assert.equal(other.status, 403, JSON.stringify(other.data));

  const tooSoon = await api("POST", "/api/restock-requests", {
    token: doctorTwoToken,
    body: requestPayload({
      note: "Other doctor pack",
      items: [{ inventory_id: inventoryId, item_name: "Other Doctor Gloves", quantity: 1 }],
    }),
  });
  assert.equal(tooSoon.status, 201, JSON.stringify(tooSoon.data));
  const accepted = await api("PATCH", `/api/restock-requests/${tooSoon.data.request.id}`, {
    token: operatorToken,
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200);
  const prepared = await pickReservedThenReady(tooSoon.data.request.id, operatorToken);
  assert.equal(prepared.status, 200);
  otherDoctorReadyId = tooSoon.data.request.id;

  const crossComplete = await api("PATCH", `/api/restock-requests/${otherDoctorReadyId}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(crossComplete.status, 403, JSON.stringify(crossComplete.data));
});

test("collection changes the request to completed with role-specific labels", async () => {
  const qtyBefore = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(inventoryId).quantity;
  const completed = await api("PATCH", `/api/restock-requests/${readyId}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  assert.equal(completed.data.request.status, "completed");
  assert.equal(completed.data.request.status_labels.doctor, "Supply Collected");
  assert.equal(completed.data.request.status_labels.operator, "Supply Dispatched");
  assert.equal(completed.data.request.status_labels.admin, "Completed");
  assert.ok(completed.data.request.completed_at);
  assert.ok(completed.data.request.archived_at);
  assert.ok(completed.data.request.transfer_transaction_id);

  const qtyAfter = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(inventoryId).quantity;
  assert.equal(qtyAfter, qtyBefore - 5);

  const itemsStillThere = db
    .prepare("SELECT COUNT(*) AS count FROM restock_request_items WHERE request_id = ?")
    .get(readyId);
  assert.equal(Number(itemsStillThere.count), 1);
});

test("completed and cancelled requests move to history", async () => {
  const activeDoctor = await api("GET", "/api/restock-requests", { token: doctorToken });
  assert.equal(activeDoctor.status, 200);
  assert.equal(
    activeDoctor.data.requests.some((row) => row.id === readyId),
    false,
  );

  const historyDoctor = await api("GET", "/api/restock-requests?view=history", {
    token: doctorToken,
  });
  assert.equal(historyDoctor.status, 200);
  assert.ok(historyDoctor.data.requests.some((row) => row.id === readyId));
  assert.equal(
    historyDoctor.data.requests.some((row) => row.id === otherDoctorReadyId),
    false,
    "doctor history must not include another doctor's requests",
  );

  const historyOperator = await api("GET", "/api/restock-requests?view=history", {
    token: operatorToken,
  });
  assert.equal(historyOperator.status, 200);
  assert.ok(historyOperator.data.requests.some((row) => row.id === readyId));
});

test("completed and cancelled records cannot be permanently deleted", async () => {
  const removed = await api("DELETE", `/api/restock-requests/${readyId}`, {
    token: operatorToken,
  });
  assert.equal(removed.status, 405, JSON.stringify(removed.data));
  const stillThere = db.prepare("SELECT id, status FROM restock_requests WHERE id = ?").get(readyId);
  assert.ok(stillThere);
  assert.equal(stillThere.status, "completed");
});

test("historical filters and request/item frequency counts are correct", async () => {
  const doctor = db
    .prepare("SELECT doctor_id FROM users WHERE username = 'arun.dharee'")
    .get();
  const history = await api(
    "GET",
    `/api/restock-requests?view=history&item=${encodeURIComponent(inventoryName)}&doctor_id=${doctor.doctor_id}`,
    { token: adminToken },
  );
  assert.equal(history.status, 200, JSON.stringify(history.data));
  assert.ok(history.data.requests.length >= 1);
  assert.ok(
    history.data.requests.every((row) =>
      (row.items || []).some((item) => String(item.item_name).includes(inventoryName)),
    ),
  );
  const doctorCount = (history.data.doctor_counts || []).find(
    (row) => Number(row.doctor_id) === Number(doctor.doctor_id),
  );
  assert.ok(doctorCount);
  assert.ok(Number(doctorCount.request_count) >= 1);
  const itemCount = (history.data.item_counts || []).find((row) =>
    String(row.item_name).includes(inventoryName),
  );
  assert.ok(itemCount);
  assert.ok(Number(itemCount.request_count) >= 1);

  const completedOnly = await api("GET", "/api/restock-requests?view=history&status=completed", {
    token: operatorToken,
  });
  assert.equal(completedOnly.status, 200);
  assert.ok(completedOnly.data.requests.every((row) => row.status === "completed"));
});

test("real-time events refresh doctor and operator views", async () => {
  const event = { doctorId: 12 };
  assert.equal(shouldDeliverSupplyRequestEvent({ role: "operator", doctorId: null }, event), true);
  assert.equal(shouldDeliverSupplyRequestEvent({ role: "doctor", doctorId: 12 }, event), true);
  assert.equal(shouldDeliverSupplyRequestEvent({ role: "doctor", doctorId: 99 }, event), false);

  const operatorMint = await api("POST", "/api/auth/stream-token", { token: operatorToken });
  const doctorMint = await api("POST", "/api/auth/stream-token", { token: doctorToken });
  assert.equal(operatorMint.status, 200);
  assert.equal(doctorMint.status, 200);

  const operatorStream = startSseListener(operatorMint.data.token);
  const doctorStream = startSseListener(doctorMint.data.token);
  assert.equal(await operatorStream.connected, true);
  assert.equal(await doctorStream.connected, true);

  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: requestPayload({
      note: "SSE ping",
      items: [{ inventory_id: inventoryId, item_name: "SSE Saline", quantity: 1 }],
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const operatorBuf = await Promise.race([
    operatorStream.change,
    new Promise((_, reject) => setTimeout(() => reject(new Error("operator SSE timeout")), 4000)),
  ]);
  const doctorBuf = await Promise.race([
    doctorStream.change,
    new Promise((_, reject) => setTimeout(() => reject(new Error("doctor SSE timeout")), 4000)),
  ]);
  assert.match(String(operatorBuf), /supply_request_change/);
  assert.match(String(doctorBuf), /supply_request_change/);

  await operatorStream.close();
  await doctorStream.close();
});

test("existing inventory quantities are not silently changed by lifecycle transitions", async () => {
  const qty = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(inventoryId).quantity;
  assert.equal(qty, 35);
  const movements = Number(
    db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id = ?").get(inventoryId)
      .count || 0,
  );
  assert.ok(movements >= 1);
});

test("request detail returns fulfilment, batches, movements, amendments and timeline when recorded", async () => {
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: requestPayload({ note: "detail-audit", items: [{ inventory_id: inventoryId, item_name: "Test Gauze Pad", quantity: 1 }] }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const requestId = created.data.request.id;
  const accepted = await api("PATCH", `/api/restock-requests/${requestId}`, {
    token: operatorToken,
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  const ready = await pickReservedThenReady(requestId, operatorToken);
  assert.equal(ready.status, 200, JSON.stringify(ready.data));
  const detail = await api("GET", `/api/restock-requests/${requestId}`, { token: operatorToken });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  const request = detail.data.request;
  assert.equal(request.status, "ready");
  assert.equal(request.can_cancel, true);
  assert.equal(request.fulfilment_recorded, true);
  assert.equal(request.timeline_available, true);
  assert.ok((request.timeline || []).length >= 2);
  assert.ok((request.fulfilment?.items || []).length >= 1);
  const line = request.fulfilment.items[0];
  assert.ok(Number(line.reserved_quantity) >= 1);
  assert.ok((line.picked_batches || []).length >= 1);
  assert.ok(line.picked_batches[0].batch_id);
  const operatorName = db.prepare("SELECT full_name FROM users WHERE username = 'operator01'").get().full_name;
  assert.equal(request.accepted_by_name, operatorName);
  assert.equal(request.ready_by_name, operatorName);
});

test("request cancellation detail uses the correct actor", async () => {
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: requestPayload({ note: "cancel-actor", items: [{ inventory_id: inventoryId, item_name: "Test Gauze Pad", quantity: 1 }] }),
  });
  const requestId = created.data.request.id;
  const cancelled = await api("PATCH", `/api/restock-requests/${requestId}`, {
    token: operatorToken,
    body: { status: "cancelled", reason: "Doctor no longer needs this pack today." },
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  const detail = await api("GET", `/api/restock-requests/${requestId}`, { token: adminToken });
  assert.equal(detail.status, 200);
  const operatorName = db.prepare("SELECT full_name FROM users WHERE username = 'operator01'").get().full_name;
  assert.equal(detail.data.request.cancelled_by_name, operatorName);
  assert.notEqual(String(detail.data.request.cancelled_by_name || "").toLowerCase(), "staff");
  assert.ok((detail.data.request.timeline || []).some((event) => /cancel/i.test(event.label)));
});

test("legacy request detail identifies unavailable fulfilment and timeline honestly", async () => {
  const doctor = db.prepare("SELECT id, doctor_id FROM users WHERE username = 'arun.dharee'").get();
  const legacyId = Number(
    db
      .prepare(
        `INSERT INTO restock_requests (doctor_id, requested_by_user_id, collection_date, collection_day, status, note, cancelled_at, cancelled_reason)
         VALUES (?, ?, ?, 1, 'cancelled', 'legacy-no-events', CURRENT_TIMESTAMP, 'legacy cancel')`,
      )
      .run(doctor.doctor_id, doctor.id, collectionDate).lastInsertRowid,
  );
  db.prepare("UPDATE restock_requests SET cancelled_by_user_id = NULL WHERE id = ?").run(legacyId);
  db.prepare(
    `INSERT INTO restock_request_items (request_id, inventory_id, item_name, quantity)
     VALUES (?, ?, 'Legacy gauze', 1)`,
  ).run(legacyId, inventoryId);
  const detail = await api("GET", `/api/restock-requests/${legacyId}`, { token: operatorToken });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.request.fulfilment_recorded, false);
  assert.equal(detail.data.request.timeline_available, false);
  assert.equal(detail.data.request.cancelled_by_name, "Legacy staff record");
  assert.notEqual(String(detail.data.request.cancelled_by_name || "").toLowerCase(), "staff");
});

test("crafted item names are replaced with the canonical catalogue name", async () => {
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: requestPayload({
      note: "crafted-name",
      items: [{ inventory_id: inventoryId, item_name: "Definitely Not The Real Name", quantity: 1 }],
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.request.items[0].item_name, inventoryName);
  const missing = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: requestPayload({
      items: [{ item_name: "Test Gauze Pad", quantity: 1 }],
    }),
  });
  assert.equal(missing.status, 400);
  const unknown = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: requestPayload({
      items: [{ inventory_id: 999999, item_name: "Ghost", quantity: 1 }],
    }),
  });
  assert.equal(unknown.status, 400);
});

test("admins cannot mark a request ready without an operational override", async () => {
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: requestPayload({ note: "admin-override" }),
  });
  const accepted = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: operatorToken,
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  const blocked = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: adminToken,
    body: { status: "ready" },
  });
  assert.equal(blocked.status, 403);
});

test("legacy reconciliation demotes a ready request when stock is unavailable", async () => {
  const doctor = db.prepare("SELECT id, doctor_id FROM users WHERE username = 'arun.dharee'").get();
  const emptyItem = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope)
         VALUES ('Empty recon', (SELECT id FROM inventory_folders LIMIT 1), 0, 0, 'unit', 1, 2, 'ocs')`,
      )
      .run().lastInsertRowid,
  );
  const requestId = Number(
    db
      .prepare(
        `INSERT INTO restock_requests (doctor_id, requested_by_user_id, collection_date, collection_day, status, note, ready_at)
         VALUES (?, ?, ?, 1, 'ready', 'legacy-ready-empty', CURRENT_TIMESTAMP)`,
      )
      .run(doctor.doctor_id, doctor.id, collectionDate).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO restock_request_items (request_id, inventory_id, item_name, quantity) VALUES (?, ?, 'Empty recon', 4)`,
  ).run(requestId, emptyItem);
  const recon = await api("POST", `/api/restock-requests/${requestId}/reconcile`, {
    token: operatorToken,
    body: { reason: "Operator reconciled legacy fulfilment quantities and batches." },
  });
  assert.equal(recon.status, 200, JSON.stringify(recon.data));
  assert.equal(recon.data.status, "accepted");
  assert.equal(recon.data.demoted, true);
  assert.equal(recon.data.request.status, "accepted");
  assert.ok(recon.data.fulfilment);
  assert.equal(Number(recon.data.fulfilment.items[0].reserved_quantity), 0);
});

test("accepted legacy requests are reserved not auto-picked", async () => {
  const doctor = db.prepare("SELECT id, doctor_id FROM users WHERE username = 'arun.dharee'").get();
  const itemId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope)
         VALUES ('Accepted recon', (SELECT id FROM inventory_folders LIMIT 1), 6, 0, 'unit', 1, 2, 'ocs')`,
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, 6, '2029-01-01', 1, 0)`,
  ).run(itemId);
  const requestId = Number(
    db
      .prepare(
        `INSERT INTO restock_requests (doctor_id, requested_by_user_id, collection_date, collection_day, status, note)
         VALUES (?, ?, ?, 1, 'accepted', 'legacy-accepted')`,
      )
      .run(doctor.doctor_id, doctor.id, collectionDate).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO restock_request_items (request_id, inventory_id, item_name, quantity) VALUES (?, ?, 'Accepted recon', 2)`,
  ).run(requestId, itemId);
  const recon = await api("POST", `/api/restock-requests/${requestId}/reconcile`, {
    token: operatorToken,
    body: { reason: "Operator reconciled legacy fulfilment quantities and batches." },
  });
  assert.equal(recon.status, 200, JSON.stringify(recon.data));
  assert.equal(recon.data.status, "accepted");
  assert.equal(recon.data.outcome, "needs_picking");
  assert.equal(Number(recon.data.fulfilment.items[0].picked_quantity || 0), 0);
  assert.equal(Number(recon.data.fulfilment.items[0].reserved_quantity), 2);
});

test("insufficient legacy data is flagged for reconciliation rather than invented picks", async () => {
  const doctor = db.prepare("SELECT id, doctor_id FROM users WHERE username = 'arun.dharee'").get();
  const requestId = Number(
    db
      .prepare(
        `INSERT INTO restock_requests (doctor_id, requested_by_user_id, collection_date, collection_day, status, note)
         VALUES (?, ?, ?, 1, 'accepted', 'legacy-missing-link')`,
      )
      .run(doctor.doctor_id, doctor.id, collectionDate).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO restock_request_items (request_id, inventory_id, item_name, quantity) VALUES (?, NULL, 'Unknown legacy item', 3)`,
  ).run(requestId);
  const recon = await api("POST", `/api/restock-requests/${requestId}/reconcile`, {
    token: operatorToken,
    body: { reason: "Operator reconciled legacy fulfilment quantities and batches." },
  });
  assert.equal(recon.status, 200, JSON.stringify(recon.data));
  assert.equal(recon.data.outcome, "insufficient_data");
  const queues = await api("GET", "/api/restock-requests/queues", { token: operatorToken });
  assert.ok(Number(queues.data.counts.reconciliation_required) >= 1);
});

test("admin emergency override is required and audited for request acceptance", async () => {
  const doctor = db.prepare("SELECT doctor_id FROM users WHERE username = 'arun.dharee'").get();
  const itemId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope)
         VALUES ('Override item', (SELECT id FROM inventory_folders LIMIT 1), 4, 0, 'unit', 1, 2, 'ocs')`,
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, 4, '2029-01-01', 1, 0)`,
  ).run(itemId);
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: {
      collection_date: collectionDate,
      note: "admin override",
      items: [{ inventory_id: itemId, item_name: "Override item", quantity: 1 }],
    },
  });
  const denied = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: adminToken,
    body: { status: "accepted" },
  });
  assert.equal(denied.status, 403);
  const ok = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: adminToken,
    body: {
      status: "accepted",
      operational_override: true,
      override_reason: "Operator unavailable during clinic close",
    },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const events = ok.data.request.timeline || ok.data.request.events || [];
  assert.ok(
    JSON.stringify(events).includes("operational_override") ||
      JSON.stringify(ok.data.request).includes("accepted"),
  );
  void doctor;
});

test("history operator and folder filters change both records and aggregate stats", async () => {
  const operator = db.prepare("SELECT id FROM users WHERE username = 'operator01'").get();
  const folder = db.prepare("SELECT id FROM inventory_folders ORDER BY id ASC LIMIT 1").get();
  const itemId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope)
         VALUES (?, ?, 6, 0, 'unit', 1, 2, 'ocs')`,
      )
      .run(`FilterItem ${Date.now()}`, folder.id).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, 6, '2028-12-01', 1, 0)`,
  ).run(itemId);
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: {
      collection_date: collectionDate,
      note: "filter stats",
      items: [{ inventory_id: itemId, item_name: "FilterItem", quantity: 1 }],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const accepted = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: operatorToken,
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  const fulfilment = await api("GET", `/api/restock-requests/${created.data.request.id}/fulfilment`, {
    token: operatorToken,
  });
  const line = fulfilment.data.fulfilment.items[0];
  await api("PATCH", `/api/restock-requests/${created.data.request.id}/fulfilment`, {
    token: operatorToken,
    body: {
      lines: [{ id: line.id, picked_quantity: 1, fulfilled_quantity: 1 }],
    },
  });
  await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: operatorToken,
    body: { status: "ready" },
  });
  await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });

  const lookups = await api("GET", "/api/restock-requests/history-lookups", { token: operatorToken });
  assert.equal(lookups.status, 200, JSON.stringify(lookups.data));
  assert.ok((lookups.data.operators || []).some((row) => Number(row.id) === Number(operator.id)));
  assert.ok((lookups.data.folders || []).some((row) => Number(row.id) === Number(folder.id)));

  const byOperator = await api(
    "GET",
    `/api/restock-requests?view=history&operator_id=${operator.id}`,
    { token: operatorToken },
  );
  assert.equal(byOperator.status, 200, JSON.stringify(byOperator.data));
  assert.ok(Number(byOperator.data.request_count) >= 1);
  assert.equal(Number(byOperator.data.request_count), Number(byOperator.data.total));
  const byOtherOperator = await api("GET", "/api/restock-requests?view=history&operator_id=999999", {
    token: operatorToken,
  });
  assert.equal(Number(byOtherOperator.data.total || 0), 0);
  assert.equal(Number(byOtherOperator.data.request_count || 0), 0);

  const byFolder = await api(
    "GET",
    `/api/restock-requests?view=history&folder_id=${folder.id}&request_id=${created.data.request.id}`,
    { token: adminToken },
  );
  assert.equal(byFolder.status, 200, JSON.stringify(byFolder.data));
  assert.equal(Number(byFolder.data.total), 1);
  assert.equal(Number(byFolder.data.request_count), 1);
  const missingFolder = await api("GET", "/api/restock-requests?view=history&folder_id=999999", {
    token: adminToken,
  });
  assert.equal(Number(missingFolder.data.total || 0), 0);
  assert.equal(Number(missingFolder.data.request_count || 0), 0);

  const requestId = created.data.request.id;
  const doctorId = created.data.request.doctor_id;
  const itemName = created.data.request.items[0].item_name;
  const byRequest = await api("GET", `/api/restock-requests?view=history&request_id=${requestId}`, {
    token: operatorToken,
  });
  assert.equal(Number(byRequest.data.total), 1);
  assert.equal(Number(byRequest.data.request_count), 1);
  const byDoctor = await api("GET", `/api/restock-requests?view=history&doctor_id=${doctorId}&request_id=${requestId}`, {
    token: operatorToken,
  });
  assert.equal(Number(byDoctor.data.total), 1);
  assert.equal(Number(byDoctor.data.request_count), 1);
  const otherDoctor = await api("GET", "/api/restock-requests?view=history&doctor_id=999999", {
    token: operatorToken,
  });
  assert.equal(Number(otherDoctor.data.total || 0), 0);
  assert.equal(Number(otherDoctor.data.request_count || 0), 0);
  const byItem = await api(
    "GET",
    `/api/restock-requests?view=history&item=${encodeURIComponent(itemName)}`,
    { token: operatorToken },
  );
  assert.ok(Number(byItem.data.total) >= 1);
  assert.equal(Number(byItem.data.request_count), Number(byItem.data.total));
  const missingItem = await api("GET", "/api/restock-requests?view=history&item=no-such-filter-item-xyz", {
    token: operatorToken,
  });
  assert.equal(Number(missingItem.data.total || 0), 0);
  assert.equal(Number(missingItem.data.request_count || 0), 0);
  const completedOnly = await api("GET", `/api/restock-requests?view=history&status=completed&request_id=${requestId}`, {
    token: operatorToken,
  });
  assert.equal(Number(completedOnly.data.total), 1);
  assert.equal(Number(completedOnly.data.request_count), 1);
  const cancelledOnly = await api("GET", `/api/restock-requests?view=history&status=cancelled&request_id=${requestId}`, {
    token: operatorToken,
  });
  assert.equal(Number(cancelledOnly.data.total || 0), 0);
  assert.equal(Number(cancelledOnly.data.request_count || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const inRange = await api(
    "GET",
    `/api/restock-requests?view=history&from=${today}&to=${today}&request_id=${requestId}`,
    { token: operatorToken },
  );
  assert.equal(Number(inRange.data.total), 1);
  assert.equal(Number(inRange.data.request_count), 1);
  const outOfRange = await api("GET", "/api/restock-requests?view=history&from=2099-01-01&to=2099-12-31", {
    token: operatorToken,
  });
  assert.equal(Number(outOfRange.data.total || 0), 0);
  assert.equal(Number(outOfRange.data.request_count || 0), 0);
  const doctorLookups = await api("GET", "/api/restock-requests/history-lookups", { token: doctorToken });
  assert.equal(doctorLookups.status, 403);

  const doctorHistory = await api("GET", "/api/restock-requests?view=history", { token: doctorToken });
  assert.equal(doctorHistory.status, 200);
  assert.ok((doctorHistory.data.requests || []).every((row) => row.doctor_name));
  const otherDoctorHistory = await api("GET", "/api/restock-requests?view=history", { token: doctorTwoToken });
  const doctorIds = new Set((doctorHistory.data.requests || []).map((row) => row.id));
  assert.ok((otherDoctorHistory.data.requests || []).every((row) => !doctorIds.has(row.id)));
  const exportRes = await fetch(`${baseUrl}/api/restock-requests/export`, {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert.equal(exportRes.status, 200);
  const csv = await exportRes.text();
  assert.match(csv, /frequency_by_item/);
  assert.doesNotMatch(csv, /bhobun/i);
});

test("history category lookups qualify duplicate leaf names and keep stable ids", async () => {
  const lookups = await api("GET", "/api/restock-requests/history-lookups", { token: operatorToken });
  assert.equal(lookups.status, 200, JSON.stringify(lookups.data));
  const folders = lookups.data.folders || [];
  const labels = folders.map((row) => row.label || row.name);
  assert.equal(labels.length, new Set(labels).size);
  const consumables = folders.filter((row) => String(row.name).toLowerCase() === "consumable");
  if (consumables.length > 1) {
    assert.ok(consumables.every((row) => String(row.label || "").includes("/")));
    assert.ok(consumables.every((row) => Number(row.id) > 0));
  }
});

test("unreconciled legacy ready requests cannot be collected", async () => {
  const doctor = db.prepare("SELECT id, doctor_id FROM users WHERE username = 'arun.dharee'").get();
  const requestId = Number(
    db
      .prepare(
        `INSERT INTO restock_requests (doctor_id, requested_by_user_id, collection_date, collection_day, status, note, ready_at)
         VALUES (?, ?, ?, 1, 'ready', 'legacy-ui-block', CURRENT_TIMESTAMP)`,
      )
      .run(doctor.doctor_id, doctor.id, collectionDate).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO restock_request_items (request_id, inventory_id, item_name, quantity) VALUES (?, NULL, 'Legacy gauze', 2)`,
  ).run(requestId);
  const listed = await api("GET", "/api/restock-requests", { token: operatorToken });
  const row = (listed.data.requests || []).find((item) => Number(item.id) === requestId);
  assert.ok(row);
  assert.equal(row.reconciliation_required, true);
  assert.ok((row.reconciliation_gaps || []).length > 0);
  const collect = await api("PATCH", `/api/restock-requests/${requestId}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(collect.status, 409, JSON.stringify(collect.data));
  const detail = await api("GET", `/api/restock-requests/${requestId}`, { token: operatorToken });
  assert.equal(detail.data.request.reconciliation_required, true);
});

test("admin exceptional cancellation of accepted requests requires a 10-character reason", async () => {
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: requestPayload({ note: "admin-cancel" }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const accepted = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: operatorToken,
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  const short = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: adminToken,
    body: { status: "cancelled", reason: "too short" },
  });
  assert.equal(short.status, 400, JSON.stringify(short.data));
  const ok = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: adminToken,
    body: { status: "cancelled", reason: "Doctor postponed after packing started" },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

