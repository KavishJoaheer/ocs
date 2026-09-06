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
        item_name: "Test Gauze Pad",
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

  inventoryId = Number(
    db
      .prepare(`
        INSERT INTO inventory (
          item_name, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope
        )
        VALUES (?, 40, 2, 'unit', 1, 2, 'ocs')
      `)
      .run(`Restock Test Gauze ${Date.now()}`).lastInsertRowid,
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
    `/api/restock-requests?view=history&item=${encodeURIComponent("Test Gauze Pad")}&doctor_id=${doctor.doctor_id}`,
    { token: adminToken },
  );
  assert.equal(history.status, 200, JSON.stringify(history.data));
  assert.ok(history.data.requests.length >= 1);
  assert.ok(
    history.data.requests.every((row) =>
      (row.items || []).some((item) => String(item.item_name).includes("Test Gauze Pad")),
    ),
  );
  const doctorCount = (history.data.doctor_counts || []).find(
    (row) => Number(row.doctor_id) === Number(doctor.doctor_id),
  );
  assert.ok(doctorCount);
  assert.ok(Number(doctorCount.request_count) >= 1);
  const itemCount = (history.data.item_counts || []).find((row) =>
    String(row.item_name).includes("Test Gauze Pad"),
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
