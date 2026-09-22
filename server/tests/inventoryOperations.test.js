"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

const TMP_DB = path.join(os.tmpdir(), `ocs-inventory-ops-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = process.env.API_RATE_LIMIT_PER_MINUTE || "5000";
delete process.env.ENABLE_DOCTOR_EMERGENCY_RESTOCK;

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const ExcelJS = require("exceljs");
const { createApp } = require("../src/app");
const { db, ensureInventoryOperationsSchema } = require("../src/db");
const { isValidCollectionDate } = require("../src/lib/collectionDays");
const { availableToPromise } = require("../src/lib/restockFulfilment");
const { shipmentQueueStats, stocktakeQueueStats } = require("../src/lib/inventoryOperations");
const { decorateInventoryItems, summarizeLocationValuation, isAtOrBelowPar, isOutOfStock } = require("../src/lib/inventoryStockState");
const { getTodayLocal, offsetLocalDate } = require("../src/lib/utils");
const { upsertOcsMasterStockDataset } = require("../src/lib/ocsMasterStockUpsert");

test("inventory cadence summaries remain flexible and use recorded activity", () => {
  const now = Date.parse("2026-09-14T12:00:00.000Z");
  const shipmentStats = shipmentQueueStats(
    [
      { id: 1, in_incoming_queue: false, released_at: "2026-09-12 08:00:00", lines: [] },
      {
        id: 2,
        in_incoming_queue: false,
        released_at: null,
        lines: [{ released_at: "2026-08-28 09:30:00" }],
      },
      { id: 3, in_incoming_queue: true, pending_rows: 2, pending_value: 20, lines: [] },
    ],
    { now },
  );
  assert.equal(shipmentStats.received_this_month, 1);
  assert.equal(shipmentStats.last_received_at, "2026-09-12T08:00:00.000Z");

  const countStats = stocktakeQueueStats(
    [
      { id: 1, status: "applied", applied_at: "2026-09-10 10:00:00" },
      { id: 2, status: "applied", applied_at: "2026-09-01 10:00:00" },
      { id: 3, status: "submitted", submitted_at: "2026-09-13 10:00:00", open_variance_value: 5 },
    ],
    { now },
  );
  assert.equal(countStats.completed_last_7_days, 1);
  assert.equal(countStats.last_completed_at, "2026-09-10T10:00:00.000Z");
});

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
  let requestBody = body;
  if (method === "POST" && urlPath === "/api/inventory/staging/import-csv" && body) {
    requestBody = {
      delivery_note: `TEST-DN-${randomUUID()}`,
      operation_id: `test-shipment-${randomUUID()}`,
      ...body,
    };
  }
  if (method === "POST" && /\/ocs-actions$/.test(urlPath) && body?.action_type === "stock_in") {
    requestBody = {
      supplier_name: "Test Supplier",
      received_date: getTodayLocal(),
      ...body,
    };
  }
  const headers = {};
  if (requestBody !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: requestBody !== undefined ? JSON.stringify(requestBody) : undefined,
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

function insertOcsItem({ name, qty, expiry = "2028-06-01", nonExpiring = 0, folder = folderId }) {
  const id = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope)
         VALUES (?, ?, ?, 0, 'unit', 5, 10, 'ocs')`,
      )
      .run(name, folder, qty).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, ?, ?, 5, ?)`,
  ).run(id, qty, nonExpiring ? null : expiry, nonExpiring);
  return id;
}

async function startStocktakeSession(body = {}, token = operatorToken) {
  const itemIds = Array.isArray(body.item_ids) ? body.item_ids : [];
  const folderIdValue = body.folder_id || null;
  const doctorIdValue = body.doctor_id || body.owner_doctor_id || null;
  const qs = new URLSearchParams();
  if (folderIdValue) qs.set("folder_id", String(folderIdValue));
  if (doctorIdValue) qs.set("doctor_id", String(doctorIdValue));
  if (itemIds.length) qs.set("item_ids", itemIds.join(","));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const preview = await api("GET", `/api/inventory/stocktake/scope${suffix}`, { token: operatorToken });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  return api("POST", "/api/inventory/stocktake/sessions", {
    token,
    body: { ...body, scope_token: body.scope_token || preview.data.scope_token },
  });
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

test("catalogue synchronization preserves live quantities and batches and rolls back archived collisions", () => {
  const categoryRow = db.prepare("SELECT id, name FROM inventory_folders WHERE name = 'Consumable' LIMIT 1").get();
  assert.ok(categoryRow);
  const category = categoryRow.name;
  const existingName = `Sync preserve ${Date.now()}`;
  const existingId = insertOcsItem({ name: existingName, qty: 5, expiry: "2031-04-30" });
  const originalBatch = db.prepare("SELECT * FROM inventory_batches WHERE item_id = ?").get(existingId);
  upsertOcsMasterStockDataset([{
    name: existingName,
    category,
    current_quantity: 999,
    par_level: 7,
    nearest_expiry: "2040-01-01",
  }], { skipInit: true });
  const preserved = db.prepare("SELECT quantity, minimum_quantity FROM inventory WHERE id = ?").get(existingId);
  const preservedBatch = db.prepare("SELECT * FROM inventory_batches WHERE id = ?").get(originalBatch.id);
  assert.equal(preserved.quantity, 5);
  assert.equal(preserved.minimum_quantity, 7);
  assert.equal(preservedBatch.quantity_remaining, originalBatch.quantity_remaining);
  assert.equal(preservedBatch.expiry_date, originalBatch.expiry_date);
  assert.equal(preservedBatch.unit_cost, originalBatch.unit_cost);

  const archivedName = `Archived sync collision ${Date.now()}`;
  db.prepare(`INSERT INTO inventory (
    item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price,
    stock_scope, archived_at
  ) VALUES (?, ?, 0, 0, 'unit', 0, 0, 'ocs', CURRENT_TIMESTAMP)`).run(archivedName, categoryRow.id);
  const rolledBackName = `Atomic sync rollback ${Date.now()}`;
  assert.throws(() => upsertOcsMasterStockDataset([
    { name: rolledBackName, category, current_quantity: 0, par_level: 0, nearest_expiry: null },
    { name: archivedName, category, current_quantity: 0, par_level: 0, nearest_expiry: null },
  ], { skipInit: true }), /archived warehouse item/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory WHERE item_name = ?").get(rolledBackName).count, 0);
});

test("active doctor bags enforce one row per doctor and item name", () => {
  const itemName = `Unique bag item ${Date.now()}`;
  db.prepare(`INSERT INTO inventory (
    item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price,
    stock_scope, owner_doctor_id
  ) VALUES (?, ?, 0, 0, 'unit', 5, 10, 'doctor', ?)`).run(itemName, folderId, doctorId);
  assert.throws(() => db.prepare(`INSERT INTO inventory (
    item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price,
    stock_scope, owner_doctor_id
  ) VALUES (?, ?, 0, 0, 'unit', 5, 10, 'doctor', ?)`).run(itemName.toUpperCase(), folderId, doctorId), /UNIQUE constraint failed/i);
});

test("inventory list payload skips completeness scoring and still audits exception ownership", async () => {
  const payload = await api("GET", "/api/inventory", { token: operatorToken });
  assert.equal(payload.status, 200, JSON.stringify(payload.data));
  assert.equal(payload.data.data_quality, undefined);
  assert.equal(payload.data.ocs_stock.every((row) => row.lots === undefined), true);
  const selectedBag = await api("GET", `/api/inventory?doctorId=${doctorId}`, { token: operatorToken });
  assert.equal(selectedBag.status, 200, JSON.stringify(selectedBag.data));
  assert.equal(selectedBag.data.data_quality, undefined);
  assert.equal(selectedBag.data.selected_doctor_stock.every((row) => row.lots === undefined), true);
  const stockView = await api("GET", "/api/inventory?view=stock", { token: operatorToken });
  assert.equal(stockView.status, 200, JSON.stringify(stockView.data));
  assert.deepEqual(stockView.data.shipments, []);
  assert.deepEqual(stockView.data.stocktake_sessions, []);
  assert.deepEqual(stockView.data.compare_rows, []);
  assert.ok(stockView.data.tab_summaries?.shipments);
  assert.ok(stockView.data.tab_summaries?.count);
  const shipmentView = await api("GET", "/api/inventory?view=shipments", { token: operatorToken });
  assert.equal(shipmentView.status, 200, JSON.stringify(shipmentView.data));
  assert.ok(Array.isArray(shipmentView.data.shipments));
  assert.deepEqual(shipmentView.data.stocktake_sessions, []);
  assert.deepEqual(shipmentView.data.movements, []);
  assert.deepEqual(shipmentView.data.compare_rows, []);
  const stockedBagItems = selectedBag.data.selected_doctor_stock.filter(
    (item) => String(item.item_kind || "stock") === "stock" && Number(item.quantity || 0) > 0,
  );
  assert.ok(Array.isArray(stockedBagItems));

  const operator = db.prepare("SELECT id, full_name FROM users WHERE username = 'operator01'").get();
  const operationId = `exception-owner-${randomUUID()}`;
  const assigned = await api("PATCH", "/api/inventory/exception-owner", {
    token: operatorToken,
    body: { assigned_to_user_id: operator.id, operation_id: operationId },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
  assert.equal(assigned.data.data_quality_owner.assigned_to_user_id, operator.id);
  assert.equal(assigned.data.data_quality_owner.assigned_to_name, operator.full_name);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM inventory_exception_assignments WHERE business_date = ?").get(getTodayLocal()).count,
    1,
  );
  const audit = db
    .prepare("SELECT meta_json FROM inventory_audit_logs WHERE action_type = 'exception_owner_assigned' ORDER BY id DESC LIMIT 1")
    .get();
  assert.equal(JSON.parse(audit.meta_json).assigned_to_user_id, operator.id);

  const forbidden = await api("PATCH", "/api/inventory/exception-owner", {
    token: doctorToken,
    body: { assigned_to_user_id: operator.id, operation_id: `forbidden-owner-${randomUUID()}` },
  });
  assert.equal(forbidden.status, 403, JSON.stringify(forbidden.data));
});

test("low stock is running low only; empty catalogue is not out of stock", () => {
  assert.equal(isAtOrBelowPar({ quantity: 10, minimum_quantity: 4, available_to_use: 3 }), true);
  assert.equal(isAtOrBelowPar({ quantity: 10, minimum_quantity: 4, available_to_use: 5 }), false);
  assert.equal(isAtOrBelowPar({ quantity: 3, minimum_quantity: 4 }), true);
  assert.equal(isAtOrBelowPar({ quantity: 5, minimum_quantity: 4 }), false);
  assert.equal(isAtOrBelowPar({ quantity: 0, minimum_quantity: 4 }), false);
  assert.equal(isOutOfStock({ quantity: 0, minimum_quantity: 4 }), false);
  assert.equal(isOutOfStock({ quantity: 0, minimum_quantity: 4, ever_stocked: true }), true);
  assert.equal(isOutOfStock({ quantity: 2, minimum_quantity: 4, available_to_use: 0 }), true);
  assert.equal(isOutOfStock({ quantity: 0, minimum_quantity: 0, ever_stocked: true }), false);
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
  const reservedBatch = db.prepare("SELECT * FROM inventory_batches WHERE item_id = ?").get(itemId);
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
  const transferMovements = db.prepare(`
    SELECT id, unit_cost_snapshot FROM inventory_movements
    WHERE json_extract(meta_json, '$.transaction_id') = ? ORDER BY id
  `).all(completed.data.request.transfer_transaction_id);
  assert.equal(transferMovements.length, 2);
  for (const movement of transferMovements) {
    const allocation = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) AS quantity,
             COALESCE(SUM(quantity * unit_cost) / SUM(quantity), 0) AS unit_cost
      FROM inventory_movement_allocations WHERE movement_id = ?
    `).get(movement.id);
    assert.equal(Number(allocation.quantity), 2);
    assert.equal(Number(allocation.unit_cost), 5);
    assert.equal(Number(movement.unit_cost_snapshot), 5);
  }
  assert.equal(
    Number(db.prepare("SELECT row_version FROM inventory_batches WHERE id = ?").get(reservedBatch.id).row_version),
    Number(reservedBatch.row_version || 1) + 1,
  );
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
    body: { items: [{ ocs_item_id: itemId, quantity: 1, expected_version: 1 }], confirm: true, reason: "short" },
  });
  assert.equal(missing.status, 400);
  const operationId = `emergency-restock-${Date.now()}`;
  const payload = {
    operation_id: operationId,
    items: [{
      ocs_item_id: itemId,
      quantity: 1,
      expected_version: db.prepare("SELECT row_version FROM inventory WHERE id = ?").get(itemId).row_version,
    }],
    confirm: true,
    reason: "Clinic bag empty before an urgent home visit",
  };
  const ok = await api("POST", "/api/inventory/restock/my-inventory", {
    token: doctorToken,
    body: payload,
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.emergency_override, true);
  const replay = await api("POST", "/api/inventory/restock/my-inventory", { token: doctorToken, body: payload });
  assert.equal(replay.status, 201, JSON.stringify(replay.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 4);
  delete process.env.ENABLE_DOCTOR_EMERGENCY_RESTOCK;
});

test("doctors cannot change quantity through item editing and operators can edit catalogue details", async () => {
  const itemId = insertOcsItem({ name: `Edit ${Date.now()}`, qty: 4 });
  const operatorFolderId = Number(
    db.prepare("INSERT INTO inventory_folders (name, parent_id) VALUES (?, ?)")
      .run(`Operator Catalogue ${Date.now()}`, folderId).lastInsertRowid,
  );
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
  const parBlocked = await api("PUT", `/api/inventory/items/${bagId}`, {
    token: doctorToken,
    body: { minimum_quantity: 3 },
  });
  assert.equal(parBlocked.status, 400, JSON.stringify(parBlocked.data));
  const operatorCreated = await api("POST", "/api/inventory/items", {
    token: operatorToken,
    body: {
      item_name: `Operator Catalogue ${Date.now()}`,
      folder_id: folderId,
      quantity: 0,
      minimum_quantity: 1,
      unit: "box",
      cost_price: 2,
      selling_price: 5,
    },
  });
  assert.equal(operatorCreated.status, 201, JSON.stringify(operatorCreated.data));
  const unauditedPricePut = await api("PUT", `/api/inventory/items/${itemId}`, {
    token: operatorToken,
    body: {
      cost_price: 6,
      selling_price: 12,
    },
  });
  assert.equal(unauditedPricePut.status, 400, JSON.stringify(unauditedPricePut.data));
  const overlongPricePut = await api("PUT", `/api/inventory/items/${itemId}`, {
    token: operatorToken,
    body: {
      cost_price: 6,
      selling_price: 12,
      adjustment_note: "x".repeat(501),
    },
  });
  assert.equal(overlongPricePut.status, 400, JSON.stringify(overlongPricePut.data));
  const operatorPut = await api("PUT", `/api/inventory/items/${itemId}`, {
    token: operatorToken,
    body: {
      cost_price: 6,
      selling_price: 12,
      minimum_quantity: 3,
      item_name: "Operator Updated Catalogue Item",
      folder_id: operatorFolderId,
      unit: "box",
      attributes: "Operator-managed attributes",
      moa_notes: "Operator-managed MOA notes",
      adjustment_note: "Supplier price list verified by operator",
    },
  });
  assert.equal(operatorPut.status, 200, JSON.stringify(operatorPut.data));
  const operatorEdited = db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId);
  assert.equal(operatorEdited.item_name, "Operator Updated Catalogue Item");
  assert.equal(operatorEdited.folder_id, operatorFolderId);
  assert.equal(operatorEdited.minimum_quantity, 3);
  assert.equal(operatorEdited.unit, "box");
  assert.equal(operatorEdited.cost_price, 6);
  assert.equal(operatorEdited.selling_price, 12);
  assert.equal(operatorEdited.attributes, "Operator-managed attributes");
  assert.equal(operatorEdited.moa_notes, "Operator-managed MOA notes");
  const priceAudit = db.prepare(`
    SELECT * FROM inventory_audit_logs
    WHERE item_id = ? AND action_type = 'update_catalogue_pricing'
    ORDER BY id DESC LIMIT 1
  `).get(itemId);
  assert.ok(priceAudit);
  assert.equal(priceAudit.performed_by_role, "operator");
  assert.match(priceAudit.reason, /supplier price list/i);

  const operatorQuantityPut = await api("PUT", `/api/inventory/items/${itemId}`, {
    token: operatorToken,
    body: { quantity: 99 },
  });
  assert.equal(operatorQuantityPut.status, 403, JSON.stringify(operatorQuantityPut.data));
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
  const created = await startStocktakeSession({ item_ids: [itemId] });
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
    body: { lines: [{ id: lineId, surplus_expiry_date: "2029-03-15", surplus_supplier_name: "Test Supplier", surplus_received_date: "2026-01-10" }] },
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.session.status, "applied");
  const qty = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  assert.equal(qty, 7);
  const batches = db.prepare(`
    SELECT * FROM inventory_batches
    WHERE item_id = ?
    ORDER BY id ASC
  `).all(itemId);
  assert.equal(batches.length, 2);
  assert.equal(Number(batches[0].quantity_remaining), 5);
  assert.equal(String(batches[0].expiry_date || "").slice(0, 10), "2028-06-01");
  const surplusBatch = batches[1];
  assert.ok(surplusBatch);
  assert.equal(String(surplusBatch.status || "usable"), "usable");
  assert.equal(Number(surplusBatch.quantity_remaining), 2);
  assert.equal(Number(surplusBatch.unit_cost), 5);
  assert.equal(String(surplusBatch.expiry_date || "").slice(0, 10), "2029-03-15");
  assert.equal(String(surplusBatch.supplier_name || ""), "Test Supplier");
  assert.equal(String(surplusBatch.received_date || "").slice(0, 10), "2026-01-10");
  const stockState = decorateInventoryItems([db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId)])[0];
  assert.equal(Number(stockState.available_to_use), 7);
  const stocktakeMovement = db.prepare(`
    SELECT id FROM inventory_movements
    WHERE item_id = ? AND json_extract(meta_json, '$.stocktake_session_id') = ?
    ORDER BY id DESC LIMIT 1
  `).get(itemId, created.data.session.id);
  assert.equal(Number(db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity
    FROM inventory_movement_allocations WHERE movement_id = ?
  `).get(stocktakeMovement.id).quantity), 2);
  const again = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(again.data.idempotent, true);
});

test("stocktake apply refuses extra counted stock without a new-lot expiry", async () => {
  const itemId = insertOcsItem({ name: `Count no lot ${Date.now()}`, qty: 5 });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 7 }] },
  });
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(applied.status, 400, JSON.stringify(applied.data));
  assert.match(String(applied.data.error || ""), /new lot|expiry/i);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 5);
});

test("stocktake surplus keeps the old lot and records a new expiry for extra counted stock", async () => {
  const itemId = insertOcsItem({ name: `Alcohol pads ${Date.now()}`, qty: 50, expiry: "2027-01-01" });
  const request = await createAcceptedRequest({ itemId, itemName: "Alcohol pads", quantity: 20 });
  await pickAndReady(request.id);
  const collected = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(collected.status, 200, JSON.stringify(collected.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 30);

  const created = await startStocktakeSession({ item_ids: [itemId] });
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 80 }] },
  });
  const counting = await api("GET", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
  });
  assert.equal(counting.status, 200, JSON.stringify(counting.data));
  assert.equal(counting.data.session.items[0].needs_new_lot, true);
  assert.equal(counting.data.session.items[0].system_quantity, null);
  assert.equal(counting.data.session.items[0].variance, null);
  const earlyLot = await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}/new-lots`, {
    token: operatorToken,
    body: {
      lines: [{
        id: lineId,
        surplus_expiry_date: "2028-01-01",
        surplus_supplier_name: "MedSupply Ltd",
        surplus_received_date: "2026-01-10",
        surplus_unit_cost: 7,
      }],
    },
  });
  assert.equal(earlyLot.status, 200, JSON.stringify(earlyLot.data));
  assert.equal(earlyLot.data.session.items[0].needs_new_lot, true);
  assert.equal(earlyLot.data.session.items[0].variance, null);
  const submitted = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  assert.equal(Number(submitted.data.session.items[0].variance), 50);
  const saved = await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}/new-lots`, {
    token: operatorToken,
    body: {
      lines: [{
        id: lineId,
        surplus_expiry_date: "2028-01-01",
        surplus_supplier_name: "MedSupply Ltd",
        surplus_received_date: "2026-01-10",
        surplus_unit_cost: 7,
      }],
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(String(saved.data.session.items[0].surplus_expiry_date || "").slice(0, 10), "2028-01-01");
  assert.equal(String(saved.data.session.items[0].surplus_supplier_name || ""), "MedSupply Ltd");
  assert.equal(String(saved.data.session.items[0].surplus_received_date || "").slice(0, 10), "2026-01-10");
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 80);
  const batches = db
    .prepare(
      `SELECT quantity_remaining, expiry_date, supplier_name, received_date FROM inventory_batches WHERE item_id = ? AND quantity_remaining > 0 ORDER BY expiry_date ASC`,
    )
    .all(itemId);
  assert.equal(batches.length, 2);
  assert.equal(Number(batches[0].quantity_remaining), 30);
  assert.equal(String(batches[0].expiry_date || "").slice(0, 10), "2027-01-01");
  assert.equal(Number(batches[1].quantity_remaining), 50);
  assert.equal(String(batches[1].expiry_date || "").slice(0, 10), "2028-01-01");
  assert.equal(String(batches[1].supplier_name || ""), "MedSupply Ltd");
  assert.equal(String(batches[1].received_date || "").slice(0, 10), "2026-01-10");
  const surplusBatch = db.prepare(
    "SELECT unit_cost FROM inventory_batches WHERE item_id = ? AND expiry_date LIKE '2028-01-01%'",
  ).get(itemId);
  assert.equal(Number(surplusBatch.unit_cost), 7);
  const movement = db.prepare(
    "SELECT unit_cost_snapshot, valuation_basis FROM inventory_movements WHERE item_id = ? AND action_type = 'adjustment' ORDER BY id DESC LIMIT 1",
  ).get(itemId);
  assert.equal(movement.valuation_basis, "stocktake");
  assert.equal(Number(movement.unit_cost_snapshot), 7);
  const { stockFinancials } = require("../src/lib/inventoryFinancials");
  const counted = stockFinancials([db.prepare(
    "SELECT * FROM inventory_movements WHERE item_id = ? AND action_type = 'adjustment' ORDER BY id DESC LIMIT 1",
  ).get(itemId)]);
  assert.equal(counted.total_value_cost_rs, 0);
  assert.equal(counted.unclassified_movement_count, 0);
  assert.equal(counted.stocktake_surplus_rs, 350);
});

test("a received delivery is valued at the sheet cost, not the older catalogue cost", async () => {
  const consumable = db.prepare("SELECT id, name FROM inventory_folders WHERE name = 'Consumable'").get();
  const name = `Sheet cost ${Date.now()}`;
  const itemId = insertOcsItem({ name, qty: 4, folder: consumable.id, expiry: "2027-01-01" });
  const csv = [
    "folder,item_name,quantity,cost_price,expiry_date",
    `${consumable.name},${name},6,9.00,2028-04-01`,
  ].join("\n");
  const imported = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: {
      csv_text: csv,
      supplier: "Sheet Supplier",
      received_date: "2026-02-02",
      delivery_note: `DN-COST-${Date.now()}`,
    },
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  const shipmentId = imported.data.import_summary.shipment_id;
  const released = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "all_valid" },
  });
  assert.ok([200, 201].includes(released.status), JSON.stringify(released.data));
  const movement = db.prepare(
    "SELECT unit_cost_snapshot, valuation_basis FROM inventory_movements WHERE item_id = ? AND action_type = 'add' ORDER BY id DESC LIMIT 1",
  ).get(itemId);
  assert.equal(movement.valuation_basis, "delivery_cost");
  assert.equal(Number(movement.unit_cost_snapshot), 9);
  assert.equal(Number(db.prepare("SELECT cost_price FROM inventory WHERE id = ?").get(itemId).cost_price), 5);
  const invoiceLines = await api("GET", `/api/finance/supplier-shipments/${shipmentId}`, { token: adminToken });
  assert.equal(invoiceLines.status, 200, JSON.stringify(invoiceLines.data));
  assert.equal(invoiceLines.data.shipment.lines.length, 1);
  assert.equal(Number(invoiceLines.data.shipment.lines[0].cost_price), 9);
});

test("extra counted stock waits for an incoming shipment instead of becoming a second lot", async () => {
  const consumable = db.prepare("SELECT id, name FROM inventory_folders WHERE name = 'Consumable'").get();
  const name = `Pads incoming ${Date.now()}`;
  const itemId = insertOcsItem({ name, qty: 30, folder: consumable.id, expiry: "2027-01-01" });
  const csv = [
    "folder,item_name,quantity,cost_price,expiry_date",
    `${consumable.name},${name},50,5,2028-01-01`,
  ].join("\n");
  const imported = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: {
      csv_text: csv,
      supplier: "MedSupply Ltd",
      received_date: "2026-01-10",
      delivery_note: `DN-HOLD-${Date.now()}`,
    },
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  const shipmentId = imported.data.import_summary.shipment_id;

  const created = await startStocktakeSession({ item_ids: [itemId] });
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 80 }] },
  });
  const submitted = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  assert.equal(submitted.data.session.items[0].delivery_in_count, true);
  assert.equal(submitted.data.session.items[0].needs_new_lot, false);
  assert.equal(Number(submitted.data.session.items[0].pending_shipment_quantity), 50);
  assert.equal(Number(submitted.data.session.items[0].pending_shipments[0].shipment_id), shipmentId);

  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.session.status, "applied");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 80);
  assert.equal(db.prepare("SELECT status FROM inventory_shipments WHERE id = ?").get(shipmentId).status, "released");
  const batches = db
    .prepare("SELECT quantity_remaining, supplier_name FROM inventory_batches WHERE item_id = ? AND quantity_remaining > 0")
    .all(itemId);
  assert.equal(batches.length, 2);
  assert.equal(batches.filter((batch) => String(batch.supplier_name || "") === "MedSupply Ltd").length, 1);
});

test("a lower stock count records waste separately from a count difference", async () => {
  const itemId = insertOcsItem({ name: `Count waste ${Date.now()}`, qty: 10, expiry: "2027-06-01" });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 6 }] },
  });
  const counting = await api("GET", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
  });
  assert.equal(counting.data.session.items[0].needs_shortage, true);
  assert.equal(counting.data.session.items[0].variance, null);
  const saved = await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}/new-lots`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, shortage_reason: "wasted" }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.session.items[0].shortage_reason, "wasted");
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, { token: operatorToken });
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  const movement = db.prepare(
    "SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY id DESC LIMIT 1",
  ).get(itemId);
  assert.equal(movement.action_type, "stock_out");
  assert.equal(JSON.parse(movement.meta_json).stock_out_reason, "Wasted");
  const { stockFinancials } = require("../src/lib/inventoryFinancials");
  const totals = stockFinancials([movement]);
  assert.equal(totals.wastage_value_rs, 20);
  assert.equal(totals.stocktake_shortage_rs, 0);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 6);
});

test("a short count cannot be submitted or recorded without wasted or expired", async () => {
  const itemId = insertOcsItem({ name: `Unexplained short ${Date.now()}`, qty: 8 });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const sessionId = created.data.session.id;
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 5 }] },
  });
  const finished = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, {
    token: operatorToken,
    body: { finish_counted: true },
  });
  assert.equal(finished.status, 400, JSON.stringify(finished.data));
  assert.match(String(finished.data.error || ""), /wasted or expired/i);
  assert.equal(db.prepare("SELECT status FROM inventory_stocktake_sessions WHERE id = ?").get(sessionId).status, "in_progress");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 8);

  const saved = await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}/new-lots`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, shortage_reason: "expired" }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const submitted = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, {
    token: operatorToken,
    body: { finish_counted: true },
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  db.prepare("UPDATE inventory_stocktake_session_items SET shortage_reason = '' WHERE id = ?").run(lineId);
  await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/apply`, {
    token: adminToken,
  });
  assert.equal(applied.status, 400, JSON.stringify(applied.data));
  assert.match(String(applied.data.error || ""), /wasted or expired/i);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 8);
});

test("a short count records wastage for stock that has no lot", async () => {
  const itemId = insertOcsItem({ name: `No lot short ${Date.now()}`, qty: 6, expiry: "2027-06-01" });
  db.prepare("UPDATE inventory SET quantity = 10, cost_price = 5 WHERE id = ?").run(itemId);
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const sessionId = created.data.session.id;
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 0 }] },
  });
  const saved = await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}/new-lots`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, shortage_reason: "expired" }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, { token: operatorToken });
  const reviewed = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.equal(reviewed.data.session.status, "applied");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 0);
  assert.equal(Number(db.prepare("SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM inventory_batches WHERE item_id = ?").get(itemId).total), 0);
  const movements = db.prepare("SELECT * FROM inventory_movements WHERE item_id = ? AND action_type = 'stock_out'").all(itemId);
  assert.equal(movements.length, 2);
  assert.ok(movements.some((row) => JSON.parse(row.meta_json).legacy_unknown_lot === true));
  const { stockFinancials } = require("../src/lib/inventoryFinancials");
  const totals = stockFinancials(movements);
  assert.equal(totals.wastage_value_rs, 50);
  assert.equal(totals.stocktake_shortage_rs, 0);
});

test("a short count of stock with no lot and no cost waits for a cost before it is recorded", async () => {
  const itemId = insertOcsItem({ name: `No cost short ${Date.now()}`, qty: 0 });
  db.prepare("DELETE FROM inventory_batches WHERE item_id = ?").run(itemId);
  db.prepare("UPDATE inventory SET quantity = 4, cost_price = 0 WHERE id = ?").run(itemId);
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const sessionId = created.data.session.id;
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 0 }] },
  });
  const saved = await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}/new-lots`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, shortage_reason: "expired" }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.session.items[0].needs_shortage_cost, true);
  await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, { token: operatorToken });
  const blocked = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.match(blocked.data.error, /cost/i);
  assert.equal(db.prepare("SELECT status FROM inventory_stocktake_sessions WHERE id = ?").get(sessionId).status, "submitted");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 4);
  const priced = await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}/new-lots`, {
    token: adminToken,
    body: { lines: [{ id: lineId, shortage_reason: "expired", shortage_unit_cost: 8 }] },
  });
  assert.equal(priced.status, 200, JSON.stringify(priced.data));
  assert.equal(priced.data.session.items[0].needs_shortage_cost, true);
  assert.equal(priced.data.session.items[0].shortage_unit_cost, 8);
  const reviewed = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  assert.equal(reviewed.data.session.status, "applied");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 0);
  const legacy = db
    .prepare("SELECT unit_cost_snapshot, meta_json, quantity FROM inventory_movements WHERE item_id = ? AND action_type = 'stock_out'")
    .all(itemId)
    .find((row) => JSON.parse(row.meta_json).legacy_unknown_lot === true);
  assert.ok(legacy);
  assert.equal(Number(legacy.unit_cost_snapshot), 8);
  assert.equal(Number(legacy.quantity), 4);
  const { stockFinancials } = require("../src/lib/inventoryFinancials");
  const totals = stockFinancials(
    db.prepare("SELECT * FROM inventory_movements WHERE item_id = ?").all(itemId),
  );
  assert.equal(totals.wastage_value_rs, 32);
});

test("accepting a count below reserved units leaves the count awaiting approval", async () => {
  const name = `Reserved short ${Date.now()}`;
  const itemId = insertOcsItem({ name, qty: 10 });
  await createAcceptedRequest({ itemId, itemName: name, quantity: 4 });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const sessionId = created.data.session.id;
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 2 }] },
  });
  await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}/new-lots`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, shortage_reason: "wasted" }] },
  });
  await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, { token: operatorToken });
  const reviewed = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  assert.equal(reviewed.status, 409, JSON.stringify(reviewed.data));
  assert.match(reviewed.data.error, /collect or cancel/i);
  assert.equal(db.prepare("SELECT status FROM inventory_stocktake_sessions WHERE id = ?").get(sessionId).status, "submitted");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 10);
});

test("a shipment cannot add a delivery that a stock count already recorded", async () => {
  const consumable = db.prepare("SELECT id, name FROM inventory_folders WHERE name = 'Consumable'").get();
  const name = `Pads twice ${Date.now()}`;
  const itemId = insertOcsItem({ name, qty: 30, folder: consumable.id, expiry: "2027-01-01" });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 80 }] },
  });
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, { token: operatorToken });
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}/new-lots`, {
    token: operatorToken,
    body: {
      lines: [{
        id: lineId,
        surplus_expiry_date: "2028-01-01",
        surplus_supplier_name: "MedSupply Ltd",
        surplus_received_date: "2026-01-10",
      }],
    },
  });
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 80);

  async function importAndRelease({ quantity, receivedDate }) {
    const csv = [
      "folder,item_name,quantity,cost_price,expiry_date",
      `${consumable.name},${name},${quantity},5,2028-01-01`,
    ].join("\n");
    const imported = await api("POST", "/api/inventory/staging/import-csv", {
      token: operatorToken,
      body: {
        csv_text: csv,
        supplier: "MedSupply Ltd",
        received_date: receivedDate,
        delivery_note: `DN-${quantity}-${receivedDate}-${randomUUID()}`,
      },
    });
    assert.equal(imported.status, 201, JSON.stringify(imported.data));
    return api("POST", `/api/inventory/shipments/${imported.data.import_summary.shipment_id}/release`, {
      token: operatorToken,
      body: { mode: "all_valid" },
    });
  }

  const sameDelivery = await importAndRelease({ quantity: 50, receivedDate: "2026-01-10" });
  assert.equal(sameDelivery.status, 409, JSON.stringify(sameDelivery.data));
  assert.match(String(sameDelivery.data.error || ""), /same delivery/i);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 80);

  const differentQuantity = await importAndRelease({ quantity: 40, receivedDate: "2026-01-10" });
  assert.ok([200, 201].includes(differentQuantity.status), JSON.stringify(differentQuantity.data));
  const laterDelivery = await importAndRelease({ quantity: 50, receivedDate: "2026-02-02" });
  assert.ok([200, 201].includes(laterDelivery.status), JSON.stringify(laterDelivery.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 170);
});

test("admin stock count review compares this count with the last official count", async () => {
  const itemId = insertOcsItem({ name: `CountCompare ${Date.now()}`, qty: 100 });
  const first = await startStocktakeSession({ item_ids: [itemId] });
  const firstLineId = first.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${first.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: firstLineId, physical_quantity: 100 }] },
  });
  const firstSubmit = await api("POST", `/api/inventory/stocktake/sessions/${first.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(firstSubmit.status, 200, JSON.stringify(firstSubmit.data));
  assert.equal(firstSubmit.data.session.status, "submitted");
  assert.equal(firstSubmit.data.session.items[0].previous_count_quantity, null);
  assert.equal(Number(firstSubmit.data.session.items[0].system_quantity), 100);
  const firstReview = await api("POST", `/api/inventory/stocktake/sessions/${first.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  assert.equal(firstReview.status, 200, JSON.stringify(firstReview.data));
  assert.equal(firstReview.data.session.status, "applied");

  const issued = await api("POST", "/api/inventory/restock", {
    token: operatorToken,
    body: { ocs_item_id: itemId, doctor_id: doctorId, quantity: 10 },
  });
  assert.equal(issued.status, 201, JSON.stringify(issued.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 90);

  const second = await startStocktakeSession({ item_ids: [itemId] });
  const counting = await api("GET", `/api/inventory/stocktake/sessions/${second.data.session.id}`, {
    token: operatorToken,
  });
  assert.equal(counting.data.session.items[0].previous_count_quantity, null);
  assert.equal(counting.data.session.items[0].system_quantity, null);
  await api("PATCH", `/api/inventory/stocktake/sessions/${second.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: second.data.session.items[0].id, physical_quantity: 90 }] },
  });
  const secondSubmit = await api("POST", `/api/inventory/stocktake/sessions/${second.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(secondSubmit.status, 200, JSON.stringify(secondSubmit.data));
  assert.equal(secondSubmit.data.session.status, "submitted");
  const reviewLine = secondSubmit.data.session.items[0];
  assert.equal(Number(reviewLine.previous_count_quantity), 100);
  assert.equal(Number(reviewLine.system_quantity), 90);
  assert.equal(Number(reviewLine.expected_quantity), 90);
  assert.equal(Number(reviewLine.movement_since_quantity), -10);
  assert.equal(Number(reviewLine.physical_quantity), 90);
  assert.equal(Number(reviewLine.variance), 0);
  assert.equal((reviewLine.movements_since || []).length, 1);
  assert.equal(Number(reviewLine.movements_since[0].signed_quantity), -10);
  assert.match(String(reviewLine.movements_since[0].summary), /Dispatched 10/i);
  assert.equal(Number(reviewLine.explained_movement_quantity), -10);
  assert.equal(Number(reviewLine.unexplained_movement_quantity), 0);
  const csv = await api("GET", `/api/inventory/stocktake/sessions/${second.data.session.id}/export.csv`, {
    token: adminToken,
  });
  assert.match(String(csv.data), /Last count/);
  assert.match(String(csv.data), /This count/);
  assert.match(String(csv.data), /What moved/);
  assert.match(String(csv.data), /Dispatched 10/);

  const secondReview = await api("POST", `/api/inventory/stocktake/sessions/${second.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  assert.equal(secondReview.status, 200, JSON.stringify(secondReview.data));
  assert.equal(secondReview.data.session.status, "applied");

  const mismatch = await startStocktakeSession({ item_ids: [itemId] });
  await api("PATCH", `/api/inventory/stocktake/sessions/${mismatch.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: mismatch.data.session.items[0].id, physical_quantity: 80 }] },
  });
  await api("PATCH", `/api/inventory/stocktake/sessions/${mismatch.data.session.id}/new-lots`, {
    token: operatorToken,
    body: { lines: [{ id: mismatch.data.session.items[0].id, shortage_reason: "wasted" }] },
  });
  const mismatchSubmit = await api("POST", `/api/inventory/stocktake/sessions/${mismatch.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(mismatchSubmit.status, 200, JSON.stringify(mismatchSubmit.data));
  const mismatchLine = mismatchSubmit.data.session.items[0];
  assert.equal(Number(mismatchLine.previous_count_quantity), 90);
  assert.equal(Number(mismatchLine.expected_quantity), 90);
  assert.equal(Number(mismatchLine.physical_quantity), 80);
  assert.equal(Number(mismatchLine.variance), -10);
  assert.equal((mismatchLine.movements_since || []).length, 0);
});

test("shipment bulk release is atomic and idempotent", async () => {
  const consumable = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable'").get().id;
  const name = `Bulk ${Date.now()}`;
  insertOcsItem({ name, qty: 0, folder: consumable });
  const csv = [
    "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
    `Consumable,${name},3,0,unit,1,2,2029-01-01`,
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
  const receiptMovement = db.prepare(`
    SELECT * FROM inventory_movements
    WHERE json_extract(meta_json, '$.shipment_id') = ?
    ORDER BY id DESC LIMIT 1
  `).get(shipmentId);
  assert.equal(Number(receiptMovement.unit_cost_snapshot), 1);
  const receiptAllocation = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity,
           COALESCE(SUM(quantity * unit_cost) / SUM(quantity), 0) AS unit_cost
    FROM inventory_movement_allocations WHERE movement_id = ?
  `).get(receiptMovement.id);
  assert.equal(Number(receiptAllocation.quantity), 3);
  assert.equal(Number(receiptAllocation.unit_cost), 1);
  const releasedBatch = db.prepare(`
    SELECT supplier_name, received_date FROM inventory_batches
    WHERE item_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(receiptMovement.item_id);
  assert.equal(String(releasedBatch.supplier_name || ""), "Test Supplier");
  assert.equal(String(releasedBatch.received_date || "").slice(0, 10), String(getTodayLocal()));
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
  const itemId = insertOcsItem({ name: `Arch ${Date.now()}`, qty: 1 });
  const blocked = await api("DELETE", `/api/inventory/items/${itemId}`, {
    token: adminToken,
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, "INVENTORY_ARCHIVE_NOT_EMPTY");
  db.prepare("UPDATE inventory SET quantity = 0 WHERE id = ?").run(itemId);
  db.prepare("UPDATE inventory_batches SET quantity_remaining = 0 WHERE item_id = ?").run(itemId);
  const archived = await api("DELETE", `/api/inventory/items/${itemId}`, {
    token: adminToken,
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.data.archived, true);
  const bagId = Number(db.prepare(`
    INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
    VALUES (?, ?, 0, 0, 'unit', 1, 2, 'doctor', ?)
  `).run(`Bag archive blocked ${Date.now()}`, folderId, doctorId).lastInsertRowid);
  const bagBlocked = await api("DELETE", `/api/inventory/items/${bagId}`, { token: adminToken });
  assert.equal(bagBlocked.status, 409);
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

test("fulfilled quantity of zero cannot mark a non-zero request ready", async () => {
  const itemName = `ZeroFill ${Date.now()}`;
  const itemId = insertOcsItem({ name: itemName, qty: 8 });
  const request = await createAcceptedRequest({ itemId, itemName, quantity: 3 });
  const detail = await api("GET", `/api/restock-requests/${request.id}/fulfilment`, { token: operatorToken });
  const lines = (detail.data.fulfilment?.items || []).map((line) => ({
    id: line.id,
    picked_quantity: 0,
    fulfilled_quantity: 0,
  }));
  const picked = await api("PATCH", `/api/restock-requests/${request.id}/fulfilment`, {
    token: operatorToken,
    body: {
      lines,
      partial_approved: true,
      partial_reason: "Partial pack approved after a warehouse shortage",
    },
  });
  assert.equal(picked.status, 200, JSON.stringify(picked.data));
  const ready = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: operatorToken,
    body: { status: "ready" },
  });
  assert.equal(ready.status, 400, JSON.stringify(ready.data));
});

test("approved partial fulfilment can collect when one line is intentionally zero", async () => {
  const firstName = `PartialKeep ${Date.now()}`;
  const secondName = `PartialZero ${Date.now()}`;
  const firstId = insertOcsItem({ name: firstName, qty: 5 });
  const secondId = insertOcsItem({ name: secondName, qty: 5 });
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: {
      collection_date: collectionDate,
      note: "partial line test",
      items: [
        { inventory_id: firstId, item_name: firstName, quantity: 2 },
        { inventory_id: secondId, item_name: secondName, quantity: 2 },
      ],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const requestId = created.data.request.id;
  const accepted = await api("PATCH", `/api/restock-requests/${requestId}`, {
    token: operatorToken,
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  const lines = accepted.data.request.fulfilment.items;
  const picked = await api("PATCH", `/api/restock-requests/${requestId}/fulfilment`, {
    token: operatorToken,
    body: {
      lines: lines.map((line, index) => ({
        id: line.id,
        picked_quantity: index === 0 ? 2 : 0,
        fulfilled_quantity: index === 0 ? 2 : 0,
      })),
      partial_approved: true,
      partial_reason: "Second requested line unavailable after final warehouse check",
    },
  });
  assert.equal(picked.status, 200, JSON.stringify(picked.data));
  const ready = await api("PATCH", `/api/restock-requests/${requestId}`, {
    token: operatorToken,
    body: { status: "ready" },
  });
  assert.equal(ready.status, 200, JSON.stringify(ready.data));
  const completed = await api("PATCH", `/api/restock-requests/${requestId}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(firstId).quantity, 3);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(secondId).quantity, 5);
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
  const created = await startStocktakeSession({ item_ids: [first, second] });
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
  const blankSession = await startStocktakeSession({ item_ids: [third] });
  const blankLine = blankSession.data.session.items[0].id;
  for (const value of ["", "  ", null, 1.5, -1]) {
    const bad = await api("PATCH", `/api/inventory/stocktake/sessions/${blankSession.data.session.id}`, {
      token: operatorToken,
      body: { lines: [{ id: blankLine, physical_quantity: value }] },
    });
    if (value === null || value === "" || value === "  ") {
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
  const zeroVar = await startStocktakeSession({ item_ids: [equal] });
  const counted = await api("PATCH", `/api/inventory/stocktake/sessions/${zeroVar.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: zeroVar.data.session.items[0].id, physical_quantity: 3 }] },
  });
  assert.equal(counted.status, 200);
  const closed = await api("POST", `/api/inventory/stocktake/sessions/${zeroVar.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  assert.equal(closed.data.session.status, "submitted");
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

test("past expiry receipt is rejected and future or non-expiring receipts are accepted", async () => {
  const itemId = insertOcsItem({ name: `Recv ${Date.now()}`, qty: 2 });
  const past = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: offsetLocalDate(-1) },
  });
  assert.equal(past.status, 400, JSON.stringify(past.data));
  const future = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 2, expiry_date: offsetLocalDate(14) },
  });
  assert.equal(future.status, 201, JSON.stringify(future.data));
  const today = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: getTodayLocal() },
  });
  assert.equal(today.status, 201, JSON.stringify(today.data));
  const nonExpiring = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 3, is_non_expiring: true },
  });
  assert.equal(nonExpiring.status, 201, JSON.stringify(nonExpiring.data));
  const missingVarianceReason = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: offsetLocalDate(30), cost_price: 6 },
  });
  assert.equal(missingVarianceReason.status, 400, JSON.stringify(missingVarianceReason.data));
  const actualCost = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: {
      action_type: "stock_in",
      quantity: 1,
      expiry_date: offsetLocalDate(30),
      cost_price: 6,
      cost_variance_reason: "Supplier invoice confirms revised batch cost",
    },
  });
  assert.equal(actualCost.status, 201, JSON.stringify(actualCost.data));
  const qty = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  assert.equal(qty, 9);
  const receivedBatch = db.prepare("SELECT unit_cost FROM inventory_batches WHERE item_id = ? ORDER BY id DESC LIMIT 1").get(itemId);
  assert.equal(receivedBatch.unit_cost, 6);
});

test("admin cannot receive stock without an operational override", async () => {
  const itemId = insertOcsItem({ name: `Perm ${Date.now()}`, qty: 2 });
  const adminReceive = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: adminToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: offsetLocalDate(30) },
  });
  assert.equal(adminReceive.status, 403, JSON.stringify(adminReceive.data));
  const adminOverride = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: adminToken,
    body: {
      action_type: "stock_in",
      quantity: 1,
      expiry_date: offsetLocalDate(30),
      operational_override: true,
      override_reason: "Emergency weekend receiving while no operator is on duty",
    },
  });
  assert.equal(adminOverride.status, 201, JSON.stringify(adminOverride.data));
  const doctorReceive = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: doctorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: offsetLocalDate(30) },
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
      batch_cost: 5,
      batch_expiry_date: offsetLocalDate(90),
      batch_reference: "COUNT-SHEET-001",
      confirm_batch_evidence: true,
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
  const allocation = db.prepare("SELECT unit_cost FROM inventory_movement_allocations WHERE movement_id = ?").get(movement.id);
  assert.equal(allocation.unit_cost, 5);
  const locked = db.prepare("SELECT quantity, row_version FROM inventory WHERE id = ?").get(itemId);
  const reduction = await api("POST", `/api/inventory/items/${itemId}/exceptional-correction`, {
    token: adminToken,
    body: {
      next_quantity: 6,
      expected_quantity: locked.quantity,
      expected_row_version: locked.row_version,
      reason: "Count sheet confirms two fewer units on shelf",
      note: "COUNT-SHEET-002",
      confirm: true,
    },
  });
  assert.equal(reduction.status, 201, JSON.stringify(reduction.data));
  const negativeMovement = db.prepare("SELECT * FROM inventory_movements WHERE item_id = ? AND action_type = 'exceptional_correction' ORDER BY id DESC LIMIT 1").get(itemId);
  const negativeAllocations = db.prepare("SELECT quantity, unit_cost FROM inventory_movement_allocations WHERE movement_id = ?").all(negativeMovement.id);
  assert.equal(negativeAllocations.reduce((sum, row) => sum + Number(row.quantity), 0), 2);
  assert.equal(negativeAllocations.every((row) => Number(row.unit_cost) === 5), true);
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
  const consumable = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable'").get().id;
  const keepName = `Keep ${Date.now()}`;
  const dropName = `Drop ${Date.now()}`;
  insertOcsItem({ name: keepName, qty: 0, folder: consumable });
  insertOcsItem({ name: dropName, qty: 0, folder: consumable });
  const csv = [
    "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
    `Consumable,${keepName},2,0,unit,1,2,2029-01-01`,
    `Consumable,${dropName},4,0,unit,1,2,2029-01-01`,
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
  assert.equal(accidental.status, 400, JSON.stringify(accidental.data));
  assert.equal(
    after.data.shipment.lines.find((line) => Number(line.id) === Number(drop.id)).status,
    "excluded",
  );
});

test("explicit zero stocktake can be submitted and blank stocktake cannot", async () => {
  const itemId = insertOcsItem({ name: `ZeroSub ${Date.now()}`, qty: 4 });
  const created = await startStocktakeSession({ item_ids: [itemId] });
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
  const unexplained = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(unexplained.status, 400, JSON.stringify(unexplained.data));
  const explained = await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}/new-lots`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, shortage_reason: "wasted" }] },
  });
  assert.equal(explained.status, 200, JSON.stringify(explained.data));
  const submitted = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  assert.equal(submitted.data.session.status, "submitted");
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

test("new human movements return the acting user name, not Staff or System", async () => {
  const itemId = insertOcsItem({ name: `ActorHuman ${Date.now()}`, qty: 1 });
  const received = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: "2029-01-01" },
  });
  assert.equal(received.status, 201, JSON.stringify(received.data));
  const operatorName = db.prepare("SELECT full_name FROM users WHERE username = 'operator01'").get().full_name;
  const payload = await api("GET", "/api/inventory", { token: adminToken });
  assert.equal(payload.status, 200);
  const movement = (payload.data.movements || []).find(
    (row) => Number(row.item_id) === itemId && row.action_type === "stock_in",
  );
  assert.ok(movement, "stock_in movement should be listed");
  assert.equal(movement.actor_name, operatorName);
  assert.notEqual(movement.actor_name, "Staff");
  assert.notEqual(movement.actor_name, "System");
});

test("automated movements display System", async () => {
  const itemId = insertOcsItem({ name: `ActorSys ${Date.now()}`, qty: 2 });
  db.prepare(
    `INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity,
      recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
    ) VALUES (?, 'in', 1, 2, 3, NULL, 'auto', 'adjustment', '', NULL, ?)`,
  ).run(itemId, JSON.stringify({ automated: true }));
  const payload = await api("GET", "/api/inventory", { token: adminToken });
  const movement = (payload.data.movements || []).find(
    (row) => Number(row.item_id) === itemId && String(row.note || "") === "auto",
  );
  assert.ok(movement);
  assert.equal(movement.actor_name, "System");
});

test("legacy movements with no actor data display Legacy staff record", async () => {
  const itemId = insertOcsItem({ name: `ActorLegacy ${Date.now()}`, qty: 2 });
  db.prepare(
    `INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity,
      recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
    ) VALUES (?, 'out', 1, 2, 1, NULL, 'legacy-adjust', 'adjustment', '', NULL, '{}')`,
  ).run(itemId);
  const payload = await api("GET", "/api/inventory", { token: adminToken });
  const movement = (payload.data.movements || []).find(
    (row) => Number(row.item_id) === itemId && String(row.note || "") === "legacy-adjust",
  );
  assert.ok(movement);
  assert.equal(movement.actor_name, "Legacy staff record");
  assert.notEqual(movement.actor_name, "Staff");
  assert.notEqual(movement.actor_name, "System");
});

test("stocktake approval and application record the responsible admin", async () => {
  const itemId = insertOcsItem({ name: `CountActor ${Date.now()}`, qty: 4 });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 6 }] },
  });
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  const approved = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const adminName = db.prepare("SELECT full_name FROM users WHERE username = 'shravan.joaheer'").get().full_name;
  assert.equal(approved.data.session.reviewed_by_name, adminName);
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
    body: { lines: [{ id: lineId, surplus_expiry_date: "2029-06-01", surplus_supplier_name: "Count Actor Supplier", surplus_received_date: "2026-01-10" }] },
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal(applied.data.session.applied_by_name, adminName);
  const movement = db
    .prepare(
      `SELECT meta_json FROM inventory_movements WHERE action_type = 'adjustment' AND item_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(itemId);
  const meta = JSON.parse(movement.meta_json || "{}");
  assert.equal(meta.performed_by_name, adminName);
  assert.equal(Number(meta.performed_by_user_id), Number(db.prepare("SELECT id FROM users WHERE username = 'shravan.joaheer'").get().id));
});

test("catalogue metadata edits cannot change batch expiry or nearest expiry", async () => {
  const itemId = insertOcsItem({ name: `CatExp ${Date.now()}`, qty: 3, expiry: "2028-06-01" });
  db.prepare("UPDATE inventory SET expiry_date = '2019-01-01' WHERE id = ?").run(itemId);
  const beforeBatches = db
    .prepare("SELECT id, expiry_date FROM inventory_batches WHERE item_id = ? ORDER BY id")
    .all(itemId);
  const edited = await api("PUT", `/api/inventory/items/${itemId}`, {
    token: adminToken,
    body: {
      item_name: db.prepare("SELECT item_name FROM inventory WHERE id = ?").get(itemId).item_name,
      folder_id: folderId,
      minimum_quantity: 0,
      unit: "unit",
      cost_price: 5,
      selling_price: 10,
      expiry_date: "2020-02-02",
    },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  const afterBatches = db
    .prepare("SELECT id, expiry_date FROM inventory_batches WHERE item_id = ? ORDER BY id")
    .all(itemId);
  assert.deepEqual(
    afterBatches.map((row) => row.expiry_date),
    beforeBatches.map((row) => row.expiry_date),
  );
  const listed = (edited.data.ocs_stock || []).find((row) => Number(row.id) === itemId);
  assert.ok(listed);
  assert.equal(String(listed.expiry_date).startsWith("2028-06-01"), true);
  const storedCatalogue = db.prepare("SELECT expiry_date FROM inventory WHERE id = ?").get(itemId);
  assert.equal(storedCatalogue.expiry_date, "2019-01-01");
});

test("bags pricing summary uses verified batch costs and distinguishes products from bag instances", async () => {
  const baselineResponse = await api("GET", "/api/inventory", { token: adminToken });
  const baseline = baselineResponse.data.tab_summaries?.bags;
  const product = `UnpricedSKU ${Date.now()}`;
  const second = `PricedSKU ${Date.now()}`;
  const doctorTwoId = db.prepare("SELECT doctor_id FROM users WHERE username = 'bhobun.muneshwarshing'").get().doctor_id;
  const firstId = Number(db.prepare(
    `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
     VALUES (?, ?, 2, 0, 'unit', 0, 10, 'doctor', ?)`,
  ).run(product, folderId, doctorId).lastInsertRowid);
  const secondBagId = Number(db.prepare(
    `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
     VALUES (?, ?, 3, 0, 'unit', 0, 10, 'doctor', ?)`,
  ).run(product, folderId, doctorTwoId).lastInsertRowid);
  const pricedCatalogueId = Number(db.prepare(
    `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
     VALUES (?, ?, 1, 0, 'unit', 12, 20, 'doctor', ?)`,
  ).run(second, folderId, doctorId).lastInsertRowid);

  const incomplete = await api("GET", "/api/inventory", { token: adminToken });
  assert.equal(incomplete.status, 200);
  const bags = incomplete.data.tab_summaries?.bags;
  assert.ok(bags);
  assert.equal(bags.unpriced_catalogue_items, Number(baseline.unpriced_catalogue_items || 0) + 2);
  assert.equal(bags.unpriced_bag_item_instances, Number(baseline.unpriced_bag_item_instances || 0) + 3);
  assert.ok(bags.unpriced_bag_item_instances > bags.unpriced_catalogue_items);
  assert.ok(bags.affected_doctor_bags >= 2);
  assert.equal(bags.valuation_complete, false);
  const productKey = product.trim().toLowerCase();
  assert.ok(Array.isArray(bags.unpriced_product_keys));
  assert.equal(bags.unpriced_product_keys.filter((key) => key === productKey).length, 1);

  const insertBatch = db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
    VALUES (?, ?, '2031-12-31', ?, 0)
  `);
  insertBatch.run(firstId, 2, 9.5);
  insertBatch.run(secondBagId, 3, 9.5);
  insertBatch.run(pricedCatalogueId, 1, 12);
  const complete = await api("GET", "/api/inventory", { token: adminToken });
  const priced = complete.data.tab_summaries.bags;
  assert.equal(priced.unpriced_catalogue_items, baseline.unpriced_catalogue_items);
  assert.equal(priced.unpriced_bag_item_instances, baseline.unpriced_bag_item_instances);
  assert.equal(priced.affected_doctor_bags, baseline.affected_doctor_bags);
  assert.equal(priced.valuation_complete, baseline.valuation_complete);
  assert.equal(
    Number((Number(priced.total_bag_value) - Number(baseline.total_bag_value || 0)).toFixed(2)),
    59.5,
  );
});

test("invalid calendar expiry dates are rejected on receipt", async () => {
  const itemId = insertOcsItem({ name: `Exp ${Date.now()}`, qty: 1 });
  for (const expiry of ["2027-02-29", "2027-02-31", "2027-13-01", "2027-00-10"]) {
    const res = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
      token: operatorToken,
      body: { action_type: "stock_in", quantity: 1, expiry_date: expiry },
    });
    assert.equal(res.status, 400, expiry);
  }
});

test("selected shipment release rejects an empty selection", async () => {
  const consumable = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable'").get().id;
  const name = `Sel ${Date.now()}`;
  insertOcsItem({ name, qty: 0, folder: consumable });
  const csv = [
    "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
    `Consumable,${name},2,0,unit,1,2,2029-01-01`,
  ].join("\n");
  const imported = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: { csv_text: csv, supplier: "Select Co" },
  });
  const empty = await api("POST", `/api/inventory/shipments/${imported.data.import_summary.shipment_id}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [] },
  });
  assert.equal(empty.status, 400, JSON.stringify(empty.data));
  const zeroQty = await api("POST", "/api/inventory/staging/preview-csv", {
    token: operatorToken,
    body: {
      csv_text: [
        "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
        `Consumable,${name},0,0,unit,1,2,2029-01-01`,
      ].join("\n"),
    },
  });
  assert.equal(zeroQty.status, 200);
  assert.ok(zeroQty.data.rows[0].errors.some((msg) => /positive/i.test(msg)));
  const zeroCost = await api("POST", "/api/inventory/staging/preview-csv", {
    token: operatorToken,
    body: {
      csv_text: [
        "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
        `Consumable,${name},2,0,unit,0,2,2029-01-01`,
      ].join("\n"),
    },
  });
  assert.equal(zeroCost.status, 200);
  assert.ok(zeroCost.data.rows[0].errors.some((msg) => /cost must be greater than zero/i.test(msg)));
});

test("csv catalogue matching is case-insensitive and unknown items need admin action", async () => {
  const consumable = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable'").get().id;
  const name = `Case Match ${Date.now()}`;
  insertOcsItem({ name, qty: 0, folder: consumable });
  const preview = await api("POST", "/api/inventory/staging/preview-csv", {
    token: operatorToken,
    body: {
      csv_text: [
        "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
        `Consumable,${name.toUpperCase()},2,0,unit,1,2,2029-01-01`,
        `Consumable,Unknown ${Date.now()},2,0,unit,1,2,2029-01-01`,
      ].join("\n"),
    },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.rows[0].errors.length, 0);
  assert.equal(preview.data.rows[0].item_name, name);
  assert.ok(preview.data.rows[1].errors.some((msg) => /catalogue action required/i.test(msg)));
});

test("excel delivery upload skips the template hint row and keeps the expiry date", async () => {
  const consumable = db.prepare("SELECT id, name FROM inventory_folders WHERE name = 'Consumable'").get();
  const name = `Excel Pads ${Date.now()}`;
  insertOcsItem({ name, qty: 0, folder: consumable.id });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Delivery");
  sheet.addRow(["folder", "item_name", "quantity", "minimum_quantity", "unit", "cost_price", "selling_price", "expiry_date", "non_expiring"]);
  sheet.addRow(["Pick the shelf folder", "Exact name from the catalogue", "How many arrived", "Low-stock level, or 0", "unit, pack, box…", "Cost per unit (Rs)", "Sell price per unit (Rs)", "YYYY-MM-DD, or blank if it does not expire", "yes only if it does not expire"]);
  const data = sheet.addRow([consumable.name, name, 50, 12, "box", 150, 150, new Date(Date.UTC(2028, 0, 1)), ""]);
  data.getCell(8).numFmt = "YYYY-MM-DD";
  sheet.addRow(["", "", "", "", "", "", "", "", ""]);
  const buffer = await workbook.xlsx.writeBuffer();
  const preview = await api("POST", "/api/inventory/staging/preview-csv", {
    token: operatorToken,
    body: { workbook_base64: Buffer.from(buffer).toString("base64"), supplier: "Excel Co", delivery_note: "DN-XLSX" },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.rows.length, 1);
  assert.equal(preview.data.rows[0].line, 3);
  assert.equal(preview.data.rows[0].item_name, name);
  assert.equal(preview.data.rows[0].quantity, 50);
  assert.equal(preview.data.rows[0].expiry_date, "2028-01-01");
  assert.equal(preview.data.rows[0].errors.length, 0);
  assert.equal(preview.data.preview.valid_rows, 1);
});

test("a short delivery sheet copies unit and selling price from the catalogue", async () => {
  const consumable = db.prepare("SELECT id, name FROM inventory_folders WHERE name = 'Consumable'").get();
  const name = `Short Sheet ${Date.now()}`;
  insertOcsItem({ name, qty: 0, folder: consumable.id });
  const preview = await api("POST", "/api/inventory/staging/preview-csv", {
    token: operatorToken,
    body: {
      csv_text: [
        "folder,item_name,quantity,cost_price,expiry_date",
        `${consumable.name},${name},4,8,2029-04-01`,
      ].join("\n"),
    },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.rows.length, 1);
  assert.equal(preview.data.rows[0].errors.length, 0);
  assert.equal(preview.data.rows[0].unit, "unit");
  assert.equal(preview.data.rows[0].selling_price, 10);
  assert.equal(preview.data.rows[0].cost_price, 8);
  assert.equal(preview.data.rows[0].minimum_quantity, 0);
});

test("shipment delivery date is the date on the note", async () => {
  const consumable = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable'").get().id;
  const name = `Dated ${Date.now()}`;
  insertOcsItem({ name, qty: 0, folder: consumable });
  const imported = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: {
      csv_text: [
        "folder,item_name,quantity,cost_price,expiry_date",
        `Consumable,${name},2,8,2029-04-01`,
      ].join("\n"),
      supplier: "Dated Supplier",
      delivery_note: `DN-${Date.now()}`,
      received_date: "2026-02-02",
    },
  });
  assert.equal(imported.status, 201, JSON.stringify(imported.data));
  const shipmentId = imported.data.import_summary.shipment_id;
  const released = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "all_valid" },
  });
  assert.ok([200, 201].includes(released.status), JSON.stringify(released.data));
  const batch = db.prepare(`
    SELECT supplier_name, received_date FROM inventory_batches
    WHERE item_id = (SELECT id FROM inventory WHERE item_name = ?)
    ORDER BY id DESC LIMIT 1
  `).get(name);
  assert.equal(batch.supplier_name, "Dated Supplier");
  assert.equal(String(batch.received_date || "").slice(0, 10), "2026-02-02");
});

test("one-item receive stores supplier and delivery date", async () => {
  const itemId = insertOcsItem({ name: `Direct ${Date.now()}`, qty: 1 });
  const missing = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: {
      action_type: "stock_in",
      quantity: 1,
      expiry_date: "2029-06-01",
      supplier_name: "",
      received_date: "",
    },
  });
  assert.equal(missing.status, 400, JSON.stringify(missing.data));
  const received = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: {
      action_type: "stock_in",
      quantity: 1,
      expiry_date: "2029-06-01",
      supplier_name: "MedSupply Ltd",
      received_date: "2026-01-10",
    },
  });
  assert.equal(received.status, 201, JSON.stringify(received.data));
  const batch = db.prepare(`
    SELECT supplier_name, received_date FROM inventory_batches WHERE item_id = ? ORDER BY id DESC LIMIT 1
  `).get(itemId);
  assert.equal(batch.supplier_name, "MedSupply Ltd");
  assert.equal(String(batch.received_date || "").slice(0, 10), "2026-01-10");
});

test("blind stocktake hides expected quantities from operators until submission", async () => {
  const itemId = insertOcsItem({ name: `Blind ${Date.now()}`, qty: 6 });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const counting = await api("GET", `/api/inventory/stocktake/sessions/${created.data.session.id}?reveal=1`, {
    token: operatorToken,
  });
  assert.equal(counting.data.session.items[0].system_quantity, null);
  assert.equal(counting.data.session.items[0].previous_count_quantity, null);
  assert.equal(counting.data.session.items[0].movement_since_quantity, null);
  const exportCounting = await api("GET", `/api/inventory/stocktake/sessions/${created.data.session.id}/export.csv`, {
    token: operatorToken,
  });
  assert.doesNotMatch(String(exportCounting.data), /System qty/);
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 6 }] },
  });
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  const submitted = await api("GET", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
  });
  assert.equal(submitted.data.session.items[0].system_quantity, 6);
});

test("stocktake apply rejects a line after an intervening receipt", async () => {
  const itemId = insertOcsItem({ name: `Conflict ${Date.now()}`, qty: 4 });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 5 }] },
  });
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, { token: operatorToken });
  await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  const received = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 2, expiry_date: "2029-06-01" },
  });
  assert.equal(received.status, 201, JSON.stringify(received.data));
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(applied.status, 409, JSON.stringify(applied.data));
  assert.ok(applied.data.conflicts?.length);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 6);
});

test("stocktake apply rejects intervening write-off, collection and batch adjustment", async () => {
  async function approvedCount(itemId, physical) {
    const created = await startStocktakeSession({ item_ids: [itemId] });
    await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
      token: operatorToken,
      body: { lines: [{ id: created.data.session.items[0].id, physical_quantity: physical }] },
    });
    await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
      token: operatorToken,
    });
    await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/review`, {
      token: adminToken,
      body: { decision: "approved" },
    });
    return created.data.session.id;
  }

  const writeOffId = insertOcsItem({ name: `ST WO ${Date.now()}`, qty: 6 });
  const writeOffSession = await approvedCount(writeOffId, 7);
  const writeOff = await api("POST", `/api/inventory/items/${writeOffId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "remove", quantity: 1, reason: "Damaged", note: "torn pack", confirm: true },
  });
  assert.equal(writeOff.status, 201, JSON.stringify(writeOff.data));
  const writeOffApply = await api("POST", `/api/inventory/stocktake/sessions/${writeOffSession}/apply`, {
    token: adminToken,
  });
  assert.equal(writeOffApply.status, 409, JSON.stringify(writeOffApply.data));

  const collectId = insertOcsItem({ name: `ST Col ${Date.now()}`, qty: 6 });
  const collectSession = await approvedCount(collectId, 7);
  const request = await createAcceptedRequest({ itemId: collectId, itemName: "ST Col", quantity: 1 });
  await pickAndReady(request.id);
  const collected = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(collected.status, 200, JSON.stringify(collected.data));
  const collectApply = await api("POST", `/api/inventory/stocktake/sessions/${collectSession}/apply`, {
    token: adminToken,
  });
  assert.equal(collectApply.status, 409, JSON.stringify(collectApply.data));

  const adjustId = insertOcsItem({ name: `ST Adj ${Date.now()}`, qty: 6 });
  const adjustSession = await approvedCount(adjustId, 7);
  const adjust = await api("POST", `/api/inventory/items/${adjustId}/exceptional-correction`, {
    token: adminToken,
    body: {
      next_quantity: 5,
      reason: "Batch adjustment after a counting error was confirmed by two staff",
      confirm: true,
    },
  });
  assert.ok([200, 201].includes(adjust.status), JSON.stringify(adjust.data));
  const adjustApply = await api("POST", `/api/inventory/stocktake/sessions/${adjustSession}/apply`, {
    token: adminToken,
  });
  assert.equal(adjustApply.status, 409, JSON.stringify(adjustApply.data));
});

test("write-off cannot consume reserved stock", async () => {
  const itemId = insertOcsItem({ name: `ATP ${Date.now()}`, qty: 5 });
  await createAcceptedRequest({ itemId, itemName: "ATP", quantity: 4 });
  const blocked = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "remove", quantity: 5, reason: "Damaged", note: "broken box", confirm: true },
  });
  assert.equal(blocked.status, 400);
  const ok = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "remove", quantity: 1, reason: "Damaged", note: "broken box", confirm: true },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

test("receipt lookup remains available beyond the latest 500 movements", async () => {
  const itemId = insertOcsItem({ name: `OldTx ${Date.now()}`, qty: 2 });
  const request = await createAcceptedRequest({ itemId, itemName: "OldTx", quantity: 1 });
  await pickAndReady(request.id);
  const completed = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  const tx = completed.data.request.transfer_transaction_id;
  assert.ok(tx);
  const filler = db.prepare(
    `INSERT INTO inventory_movements (item_id, movement_type, quantity, previous_quantity, next_quantity, recorded_by_user_id, note, action_type, meta_json)
     VALUES (?, 'out', 1, 1, 0, NULL, 'filler', 'adjustment', '{}')`,
  );
  for (let i = 0; i < 510; i += 1) filler.run(itemId);
  const receipt = await api("GET", `/api/inventory/receipts/${tx}`, { token: operatorToken });
  assert.equal(receipt.status, 200, JSON.stringify(receipt.data));
  assert.equal(receipt.data.transaction_id, tx);
  assert.ok(receipt.data.items.some((row) => row.batch_id || row.batch_number !== `B${row.batch_id}`));
  const history = await api("GET", "/api/inventory/activity-history", { token: doctorToken });
  const transfer = (history.data.rows || []).find((row) => row.transaction_id === tx);
  assert.ok(transfer);
  assert.equal(Number(transfer.quantity), 1);
});

test("emergency restock rejects reserved and expired stock", async () => {
  process.env.ENABLE_DOCTOR_EMERGENCY_RESTOCK = "true";
  const reservedItem = insertOcsItem({ name: `EmergRes ${Date.now()}`, qty: 2 });
  await createAcceptedRequest({ itemId: reservedItem, itemName: "EmergRes", quantity: 2 });
  const reservedVersion = Number(db.prepare("SELECT row_version FROM inventory WHERE id = ?").get(reservedItem).row_version);
  const reserved = await api("POST", "/api/inventory/restock/my-inventory", {
    token: doctorToken,
    body: {
      operation_id: randomUUID(),
      items: [{ ocs_item_id: reservedItem, quantity: 1, expected_version: reservedVersion }],
      confirm: true,
      reason: "Clinic bag empty before an urgent home visit",
    },
  });
  assert.equal(reserved.status, 409);
  const expiredId = insertOcsItem({ name: `EmergExp ${Date.now()}`, qty: 3, expiry: "2020-01-01" });
  db.prepare("UPDATE inventory_batches SET expiry_date = '2020-01-01' WHERE item_id = ?").run(expiredId);
  const expiredVersion = Number(db.prepare("SELECT row_version FROM inventory WHERE id = ?").get(expiredId).row_version);
  const expired = await api("POST", "/api/inventory/restock/my-inventory", {
    token: doctorToken,
    body: {
      operation_id: randomUUID(),
      items: [{ ocs_item_id: expiredId, quantity: 1, expected_version: expiredVersion }],
      confirm: true,
      reason: "Clinic bag empty before an urgent home visit",
    },
  });
  assert.equal(expired.status, 409);
  delete process.env.ENABLE_DOCTOR_EMERGENCY_RESTOCK;
});

test("correction against an unpicked accepted request can reduce reservations atomically", async () => {
  const itemId = insertOcsItem({ name: `CorrUnpicked ${Date.now()}`, qty: 5 });
  const request = await createAcceptedRequest({ itemId, itemName: "CorrUnpicked", quantity: 4 });
  assert.equal(Number(request.fulfilment.items[0].picked_quantity || 0), 0);
  const blocked = await api("POST", `/api/inventory/items/${itemId}/exceptional-correction`, {
    token: adminToken,
    body: { next_quantity: 1, reason: "Found a warehouse count error after receiving", confirm: true },
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.ok((blocked.data.impacted_requests || []).length);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 5);
  const ok = await api("POST", `/api/inventory/items/${itemId}/exceptional-correction`, {
    token: adminToken,
    body: {
      next_quantity: 1,
      reason: "Found a warehouse count error after receiving",
      confirm: true,
      affect_reservations: true,
    },
  });
  assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.data));
  const qty = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  const batches = db
    .prepare("SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM inventory_batches WHERE item_id = ?")
    .get(itemId).total;
  assert.equal(qty, 1);
  assert.equal(batches, 1);
  const reserved = db
    .prepare(
      "SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory_reservations WHERE inventory_id = ? AND status = 'active'",
    )
    .get(itemId).total;
  assert.equal(Number(reserved), 1);
});

test("correction is rejected against picked and ready requests", async () => {
  const pickedItem = insertOcsItem({ name: `CorrPicked ${Date.now()}`, qty: 6 });
  const pickedReq = await createAcceptedRequest({ itemId: pickedItem, itemName: "CorrPicked", quantity: 3 });
  const detail = await api("GET", `/api/restock-requests/${pickedReq.id}/fulfilment`, { token: operatorToken });
  const lineId = detail.data.fulfilment.items[0].id;
  await api("PATCH", `/api/restock-requests/${pickedReq.id}/fulfilment`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, picked_quantity: 2, fulfilled_quantity: 2 }] },
  });
  const pickedCorr = await api("POST", `/api/inventory/items/${pickedItem}/exceptional-correction`, {
    token: adminToken,
    body: {
      next_quantity: 1,
      reason: "Found a warehouse count error after receiving",
      confirm: true,
      affect_reservations: true,
    },
  });
  assert.equal(pickedCorr.status, 409, JSON.stringify(pickedCorr.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(pickedItem).quantity, 6);

  const readyItem = insertOcsItem({ name: `CorrReady ${Date.now()}`, qty: 6 });
  const readyReq = await createAcceptedRequest({ itemId: readyItem, itemName: "CorrReady", quantity: 2 });
  await pickAndReady(readyReq.id);
  const readyCorr = await api("POST", `/api/inventory/items/${readyItem}/exceptional-correction`, {
    token: adminToken,
    body: {
      next_quantity: 1,
      reason: "Found a warehouse count error after receiving",
      confirm: true,
      affect_reservations: true,
    },
  });
  assert.equal(readyCorr.status, 409, JSON.stringify(readyCorr.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(readyItem).quantity, 6);
});

test("selected shipment release rejects duplicates and is concurrent-safe", async () => {
  const consumable = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable'").get().id;
  const name = `DupRel ${Date.now()}`;
  insertOcsItem({ name, qty: 0, folder: consumable });
  const csv = [
    "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
    `Consumable,${name},4,0,unit,1,2,2029-01-01`,
  ].join("\n");
  const imported = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: { csv_text: csv, supplier: "Dup Co" },
  });
  const shipmentId = imported.data.import_summary.shipment_id;
  const lineId = imported.data.shipment.lines[0].id;
  const dup = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [lineId, lineId] },
  });
  assert.equal(dup.status, 400, JSON.stringify(dup.data));
  const [first, second] = await Promise.all([
    api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
      token: operatorToken,
      body: { mode: "selected", row_ids: [lineId] },
    }),
    api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
      token: operatorToken,
      body: { mode: "selected", row_ids: [lineId] },
    }),
  ]);
  assert.ok(first.status < 500 && second.status < 500, JSON.stringify({ first: first.data, second: second.data }));
  const qty = db
    .prepare("SELECT quantity FROM inventory WHERE item_name = ? AND stock_scope = 'ocs' AND owner_doctor_id IS NULL")
    .get(name).quantity;
  assert.equal(Number(qty), 4);
});

test("zero-variance stocktake after an intervening receipt requires recount", async () => {
  const itemId = insertOcsItem({ name: `ZeroMove ${Date.now()}`, qty: 5 });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const lineId = created.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 5 }] },
  });
  const received = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: "2029-06-01" },
  });
  assert.equal(received.status, 201, JSON.stringify(received.data));
  const submitted = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(submitted.status, 409, JSON.stringify(submitted.data));
  assert.equal(submitted.data.session.status, "recount_required");
  const ordinarySave = await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 6 }] },
  });
  assert.equal(ordinarySave.status, 409, JSON.stringify(ordinarySave.data));
  const conflicted = submitted.data.session.items[0];
  const recount = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/recount`, {
    token: operatorToken,
    body: {
      lines: [
        {
          id: lineId,
          physical_quantity: 6,
          conflict_detected_at: conflicted.conflict_detected_at,
          expected_row_version: conflicted.live_row_version,
        },
      ],
    },
  });
  assert.equal(recount.status, 200, JSON.stringify(recount.data));
  const resubmit = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(resubmit.status, 200, JSON.stringify(resubmit.data));
  assert.ok(["submitted", "applied"].includes(resubmit.data.session.status));
});

test("admin cannot start a routine stocktake without an operational override", async () => {
  const itemId = insertOcsItem({ name: `AdminST ${Date.now()}`, qty: 2 });
  const denied = await api("POST", "/api/inventory/stocktake/sessions", {
    token: adminToken,
    body: { item_ids: [itemId] },
  });
  assert.equal(denied.status, 403);
  const legacy = await api("POST", "/api/inventory/stocktake", {
    token: operatorToken,
    body: { item_id: itemId, physical_quantity: 2 },
  });
  assert.equal(legacy.status, 410);
});

test("multi-item collection receipt keeps line-specific identities", async () => {
  const first = insertOcsItem({ name: `RcptA ${Date.now()}`, qty: 5 });
  const second = insertOcsItem({ name: `RcptB ${Date.now()}`, qty: 5 });
  const created = await api("POST", "/api/restock-requests", {
    token: doctorToken,
    body: {
      collection_date: collectionDate,
      note: "multi receipt",
      items: [
        { inventory_id: first, item_name: "RcptA", quantity: 2 },
        { inventory_id: second, item_name: "RcptB", quantity: 1 },
      ],
    },
  });
  const accepted = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: operatorToken,
    body: { status: "accepted" },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  await pickAndReady(created.data.request.id);
  const collected = await api("PATCH", `/api/restock-requests/${created.data.request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(collected.status, 200, JSON.stringify(collected.data));
  const tx = collected.data.request.transfer_transaction_id;
  const receipt = await api("GET", `/api/inventory/receipts/${tx}`, { token: operatorToken });
  assert.equal(receipt.status, 200, JSON.stringify(receipt.data));
  const sourceIds = new Set((receipt.data.items || []).map((row) => Number(row.source_inventory_id)));
  assert.ok(sourceIds.has(first));
  assert.ok(sourceIds.has(second));
});

test("history pagination returns frequency totals beyond the first page", async () => {
  const itemId = insertOcsItem({ name: `HistPage ${Date.now()}`, qty: 20 });
  for (let i = 0; i < 3; i += 1) {
    const request = await createAcceptedRequest({
      itemId,
      itemName: "HistPage",
      quantity: 1,
      note: `hist ${i}`,
    });
    await pickAndReady(request.id);
    await api("PATCH", `/api/restock-requests/${request.id}`, {
      token: doctorToken,
      body: { status: "completed" },
    });
  }
  const page = await api("GET", "/api/restock-requests?view=history&limit=1&offset=0", { token: operatorToken });
  assert.equal(page.status, 200, JSON.stringify(page.data));
  assert.equal(page.data.requests.length, 1);
  assert.ok(Number(page.data.total) >= 3);
  const next = await api("GET", "/api/restock-requests?view=history&limit=1&offset=1", { token: operatorToken });
  assert.equal(next.data.requests.length, 1);
  assert.notEqual(next.data.requests[0].id, page.data.requests[0].id);
  assert.ok((page.data.item_counts || []).length >= 1);
});

test("stocktake keeps the session baseline until an explicit recount", async () => {
  const itemId = insertOcsItem({ name: `BaseKeep ${Date.now()}`, qty: 4 });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const sessionId = created.data.session.id;
  const lineId = created.data.session.items[0].id;
  const baselineVersion = db.prepare("SELECT row_version FROM inventory WHERE id = ?").get(itemId).row_version;

  await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 2, expiry_date: "2029-06-01" },
  });
  const savedAfterMove = await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}`, {
    token: operatorToken,
    body: { lines: [{ id: lineId, physical_quantity: 4 }] },
  });
  assert.equal(savedAfterMove.status, 200, JSON.stringify(savedAfterMove.data));
  const savedRow = db
    .prepare("SELECT expected_quantity, expected_row_version, conflict_status FROM inventory_stocktake_session_items WHERE id = ?")
    .get(lineId);
  assert.equal(Number(savedRow.expected_quantity), 4);
  assert.equal(Number(savedRow.expected_row_version), Number(baselineVersion));
  assert.equal(savedRow.conflict_status, "");
  const submitAfterCountMove = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, {
    token: operatorToken,
  });
  assert.equal(submitAfterCountMove.status, 409, JSON.stringify(submitAfterCountMove.data));

  const itemB = insertOcsItem({ name: `SaveThenMove ${Date.now()}`, qty: 3 });
  const createdB = await startStocktakeSession({ item_ids: [itemB] });
  const lineB = createdB.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${createdB.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineB, physical_quantity: 3 }] },
  });
  await api("POST", `/api/inventory/items/${itemB}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: "2029-06-01" },
  });
  const submitAfterSave = await api("POST", `/api/inventory/stocktake/sessions/${createdB.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(submitAfterSave.status, 409);

  const itemC = insertOcsItem({ name: `ApplyMove ${Date.now()}`, qty: 5 });
  const createdC = await startStocktakeSession({ item_ids: [itemC] });
  const lineC = createdC.data.session.items[0].id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${createdC.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: lineC, physical_quantity: 6 }] },
  });
  await api("POST", `/api/inventory/stocktake/sessions/${createdC.data.session.id}/submit`, { token: operatorToken });
  await api("POST", `/api/inventory/stocktake/sessions/${createdC.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  await api("POST", `/api/inventory/items/${itemC}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: "2029-06-01" },
  });
  const applyBlocked = await api("POST", `/api/inventory/stocktake/sessions/${createdC.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(applyBlocked.status, 409, JSON.stringify(applyBlocked.data));
  assert.equal(applyBlocked.data.session.status, "recount_required");
});

test("stocktake recount is required, scoped, and rejects stale tokens", async () => {
  const keep = insertOcsItem({ name: `KeepCount ${Date.now()}`, qty: 4 });
  const conflict = insertOcsItem({ name: `NeedRecount ${Date.now()}`, qty: 4 });
  const created = await startStocktakeSession({ item_ids: [keep, conflict] });
  const sessionId = created.data.session.id;
  const keepLine = created.data.session.items.find((row) => Number(row.inventory_id) === keep);
  const conflictLine = created.data.session.items.find((row) => Number(row.inventory_id) === conflict);
  await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}`, {
    token: operatorToken,
    body: {
      lines: [
        { id: keepLine.id, physical_quantity: 4 },
        { id: conflictLine.id, physical_quantity: 5 },
      ],
    },
  });
  await api("POST", `/api/inventory/items/${conflict}/ocs-actions`, {
    token: operatorToken,
    body: { action_type: "stock_in", quantity: 1, expiry_date: "2029-06-01" },
  });
  const submitted = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, {
    token: operatorToken,
  });
  assert.equal(submitted.status, 409);
  const again = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, { token: operatorToken });
  assert.equal(again.status, 409, JSON.stringify(again.data));
  const conflicted = again.data.session.items.find((row) => Number(row.id) === Number(conflictLine.id));
  const kept = db
    .prepare("SELECT physical_quantity, expected_quantity FROM inventory_stocktake_session_items WHERE id = ?")
    .get(keepLine.id);
  assert.equal(Number(kept.physical_quantity), 4);
  assert.equal(Number(kept.expected_quantity), 4);

  const staleToken = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/recount`, {
    token: operatorToken,
    body: {
      lines: [
        {
          id: conflictLine.id,
          physical_quantity: 6,
          conflict_detected_at: "not-the-token",
          expected_row_version: conflicted.live_row_version,
        },
      ],
    },
  });
  assert.equal(staleToken.status, 409, JSON.stringify(staleToken.data));
  const staleVersion = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/recount`, {
    token: operatorToken,
    body: {
      lines: [
        {
          id: conflictLine.id,
          physical_quantity: 6,
          conflict_detected_at: conflicted.conflict_detected_at,
          expected_row_version: Number(conflicted.live_row_version) - 1,
        },
      ],
    },
  });
  assert.equal(staleVersion.status, 409, JSON.stringify(staleVersion.data));
  const recounted = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/recount`, {
    token: operatorToken,
    body: {
      lines: [
        {
          id: conflictLine.id,
          physical_quantity: 6,
          conflict_detected_at: conflicted.conflict_detected_at,
          expected_row_version: conflicted.live_row_version,
        },
      ],
    },
  });
  assert.equal(recounted.status, 200, JSON.stringify(recounted.data));
  const after = recounted.data.session.items.find((row) => Number(row.id) === Number(conflictLine.id));
  assert.notEqual(String(after.conflict_status || ""), "recount_required");
  const keepAfter = recounted.data.session.items.find((row) => Number(row.id) === Number(keepLine.id));
  assert.equal(Number(keepAfter.physical_quantity), 4);
  assert.equal(Number(keepAfter.expected_quantity), 4);
  const resubmit = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, {
    token: operatorToken,
  });
  assert.equal(resubmit.status, 200, JSON.stringify(resubmit.data));
});

test("zero-variance stocktake without movement still closes and apply rolls back unsafe lines", async () => {
  const itemId = insertOcsItem({ name: `ZeroClean ${Date.now()}`, qty: 2 });
  const created = await startStocktakeSession({ item_ids: [itemId] });
  await api("PATCH", `/api/inventory/stocktake/sessions/${created.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: created.data.session.items[0].id, physical_quantity: 2 }] },
  });
  const closed = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/submit`, {
    token: operatorToken,
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  assert.equal(closed.data.session.status, "submitted");
  const recorded = await api("POST", `/api/inventory/stocktake/sessions/${created.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  assert.equal(recorded.status, 200, JSON.stringify(recorded.data));
  assert.equal(recorded.data.session.status, "applied");

  const reservedItem = insertOcsItem({ name: `UnsafeApply ${Date.now()}`, qty: 2 });
  await createAcceptedRequest({ itemId: reservedItem, itemName: "UnsafeApply", quantity: 2 });
  const unsafe = await startStocktakeSession({ item_ids: [reservedItem] });
  await api("PATCH", `/api/inventory/stocktake/sessions/${unsafe.data.session.id}`, {
    token: operatorToken,
    body: { lines: [{ id: unsafe.data.session.items[0].id, physical_quantity: 0 }] },
  });
  await api("PATCH", `/api/inventory/stocktake/sessions/${unsafe.data.session.id}/new-lots`, {
    token: operatorToken,
    body: { lines: [{ id: unsafe.data.session.items[0].id, shortage_reason: "wasted" }] },
  });
  await api("POST", `/api/inventory/stocktake/sessions/${unsafe.data.session.id}/submit`, { token: operatorToken });
  const reviewed = await api("POST", `/api/inventory/stocktake/sessions/${unsafe.data.session.id}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  assert.equal(reviewed.status, 409, JSON.stringify(reviewed.data));
  assert.match(reviewed.data.error, /collect or cancel/i);
  assert.equal(
    db.prepare("SELECT status FROM inventory_stocktake_sessions WHERE id = ?").get(unsafe.data.session.id).status,
    "submitted",
  );
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${unsafe.data.session.id}/apply`, {
    token: adminToken,
  });
  assert.equal(applied.status, 400, JSON.stringify(applied.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(reservedItem).quantity, 2);
});

test("exceptional correction preview and stale inventory are enforced", async () => {
  const free = insertOcsItem({ name: `CorrFree ${Date.now()}`, qty: 8 });
  const previewFree = await api("POST", `/api/inventory/items/${free}/exceptional-correction/preview`, {
    token: adminToken,
    body: { next_quantity: 7 },
  });
  assert.equal(previewFree.status, 200, JSON.stringify(previewFree.data));
  assert.equal(previewFree.data.preview.requires_affect_reservations, false);
  const appliedFree = await api("POST", `/api/inventory/items/${free}/exceptional-correction`, {
    token: adminToken,
    body: {
      next_quantity: 7,
      reason: "Warehouse recount found extra units",
      confirm: true,
      expected_row_version: previewFree.data.preview.row_version,
      expected_quantity: previewFree.data.preview.quantity,
    },
  });
  assert.ok([200, 201].includes(appliedFree.status), JSON.stringify(appliedFree.data));

  const reservedItem = insertOcsItem({ name: `CorrPrev ${Date.now()}`, qty: 5 });
  await createAcceptedRequest({ itemId: reservedItem, itemName: "CorrPrev", quantity: 4 });
  const previewReserved = await api("POST", `/api/inventory/items/${reservedItem}/exceptional-correction/preview`, {
    token: adminToken,
    body: { next_quantity: 1 },
  });
  assert.equal(previewReserved.status, 200, JSON.stringify(previewReserved.data));
  assert.equal(previewReserved.data.preview.requires_affect_reservations, true);
  assert.ok((previewReserved.data.preview.impacted_requests || []).length);

  const stale = await api("POST", `/api/inventory/items/${reservedItem}/exceptional-correction`, {
    token: adminToken,
    body: {
      next_quantity: 1,
      reason: "Warehouse recount found extra units",
      confirm: true,
      affect_reservations: true,
      expected_row_version: 1,
      expected_quantity: 99,
    },
  });
  assert.equal(stale.status, 409, JSON.stringify(stale.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(reservedItem).quantity, 5);

  const pickedItem = insertOcsItem({ name: `CorrPrevPick ${Date.now()}`, qty: 6 });
  const pickedReq = await createAcceptedRequest({ itemId: pickedItem, itemName: "CorrPrevPick", quantity: 3 });
  const pickedDetail = await api("GET", `/api/restock-requests/${pickedReq.id}/fulfilment`, {
    token: operatorToken,
  });
  await api("PATCH", `/api/restock-requests/${pickedReq.id}/fulfilment`, {
    token: operatorToken,
    body: {
      lines: [{ id: pickedDetail.data.fulfilment.items[0].id, picked_quantity: 2, fulfilled_quantity: 2 }],
    },
  });
  const previewPicked = await api("POST", `/api/inventory/items/${pickedItem}/exceptional-correction/preview`, {
    token: adminToken,
    body: { next_quantity: 1 },
  });
  assert.equal(previewPicked.status, 200, JSON.stringify(previewPicked.data));
  assert.equal(previewPicked.data.preview.requires_affect_reservations, false);
  assert.ok((previewPicked.data.preview.blocking_requests || []).length);

  const readyItem = insertOcsItem({ name: `CorrPrevReady ${Date.now()}`, qty: 6 });
  const readyReq = await createAcceptedRequest({ itemId: readyItem, itemName: "CorrPrevReady", quantity: 2 });
  await pickAndReady(readyReq.id);
  const previewReady = await api("POST", `/api/inventory/items/${readyItem}/exceptional-correction/preview`, {
    token: adminToken,
    body: { next_quantity: 1 },
  });
  assert.equal(previewReady.status, 200, JSON.stringify(previewReady.data));
  assert.ok((previewReady.data.preview.blocking_requests || []).some((row) => Number(row.request_id) === Number(readyReq.id)));
});

test("partial shipment releases keep per-transaction receipts", async () => {
  const consumable = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable'").get().id;
  const firstName = `PartA ${Date.now()}`;
  const secondName = `PartB ${Date.now()}`;
  const fullName = `PartFull ${Date.now()}`;
  insertOcsItem({ name: firstName, qty: 0, folder: consumable });
  insertOcsItem({ name: secondName, qty: 0, folder: consumable });
  insertOcsItem({ name: fullName, qty: 0, folder: consumable });

  const fullImport = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: {
      csv_text: [
        "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
        `Consumable,${fullName},3,0,unit,1,2,2029-01-01`,
      ].join("\n"),
      supplier: "Full Co",
    },
  });
  const fullId = fullImport.data.import_summary.shipment_id;
  const fullLine = fullImport.data.shipment.lines[0].id;
  const fullRelease = await api("POST", `/api/inventory/shipments/${fullId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [fullLine] },
  });
  assert.ok([200, 201].includes(fullRelease.status), JSON.stringify(fullRelease.data));
  assert.equal(fullRelease.data.receipt.kind, "release_receipt");
  assert.equal(fullRelease.data.receipt.total_quantity, 3);
  const fullRetry = await api("POST", `/api/inventory/shipments/${fullId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [fullLine] },
  });
  assert.equal(fullRetry.data.idempotent, true);
  assert.equal(fullRetry.data.receipt.transaction_id, fullRelease.data.receipt.transaction_id);

  const csv = [
    "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
    `Consumable,${firstName},2,0,unit,3,4,2029-01-01`,
    `Consumable,${secondName},5,0,unit,2,3,2029-01-01`,
  ].join("\n");
  const imported = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: { csv_text: csv, supplier: "Split Co", delivery_note: "DN-77" },
  });
  const shipmentId = imported.data.import_summary.shipment_id;
  const first = imported.data.shipment.lines.find((line) => line.item_name === firstName);
  const second = imported.data.shipment.lines.find((line) => line.item_name === secondName);

  const firstRelease = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [first.id] },
  });
  assert.ok([200, 201].includes(firstRelease.status), JSON.stringify(firstRelease.data));
  assert.equal(firstRelease.data.receipt.total_quantity, 2);
  assert.equal(firstRelease.data.receipt.total_value, 6);
  assert.equal(firstRelease.data.receipt.lines.length, 1);
  assert.equal(firstRelease.data.summary.total_quantity, 2);
  const firstRetry = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [first.id] },
  });
  assert.equal(firstRetry.data.idempotent, true);
  assert.equal(firstRetry.data.receipt.transaction_id, firstRelease.data.receipt.transaction_id);
  assert.equal(firstRetry.data.receipt.total_quantity, 2);

  const secondRelease = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [second.id] },
  });
  assert.ok([200, 201].includes(secondRelease.status), JSON.stringify(secondRelease.data));
  assert.equal(secondRelease.data.receipt.total_quantity, 5);
  assert.notEqual(secondRelease.data.receipt.transaction_id, firstRelease.data.receipt.transaction_id);
  assert.equal(secondRelease.data.summary.total_quantity, 7);
  assert.equal(secondRelease.data.summary.kind, "shipment_summary");
  const qty = db
    .prepare("SELECT quantity FROM inventory WHERE item_name = ? AND stock_scope = 'ocs'")
    .get(firstName).quantity;
  const qtyB = db
    .prepare("SELECT quantity FROM inventory WHERE item_name = ? AND stock_scope = 'ocs'")
    .get(secondName).quantity;
  assert.equal(Number(qty), 2);
  assert.equal(Number(qtyB), 5);
});

test("mixed pending, excluded and released shipment rows cannot be released together", async () => {
  const consumable = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable'").get().id;
  const pendingName = `MixPend ${Date.now()}`;
  const releasedName = `MixRel ${Date.now()}`;
  const excludedName = `MixEx ${Date.now()}`;
  insertOcsItem({ name: pendingName, qty: 0, folder: consumable });
  insertOcsItem({ name: releasedName, qty: 0, folder: consumable });
  insertOcsItem({ name: excludedName, qty: 0, folder: consumable });
  const imported = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: {
      csv_text: [
        "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
        `Consumable,${releasedName},2,0,unit,1,2,2029-01-01`,
        `Consumable,${pendingName},3,0,unit,1,2,2029-01-01`,
        `Consumable,${excludedName},4,0,unit,1,2,2029-01-01`,
      ].join("\n"),
      supplier: "Mix Co",
    },
  });
  const shipmentId = imported.data.import_summary.shipment_id;
  const pending = imported.data.shipment.lines.find((line) => line.item_name === pendingName);
  const releasedLine = imported.data.shipment.lines.find((line) => line.item_name === releasedName);
  const excludedLine = imported.data.shipment.lines.find((line) => line.item_name === excludedName);

  const excluded = await api("POST", `/api/inventory/shipments/${shipmentId}/exclude`, {
    token: operatorToken,
    body: { lines: [{ id: excludedLine.id, reason: "Wrong product on delivery note" }] },
  });
  assert.equal(excluded.status, 200, JSON.stringify(excluded.data));
  const first = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [releasedLine.id] },
  });
  assert.ok([200, 201].includes(first.status), JSON.stringify(first.data));

  const mixed = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [releasedLine.id, pending.id, excludedLine.id] },
  });
  assert.equal(mixed.status, 400, JSON.stringify(mixed.data));
  assert.equal(
    db.prepare("SELECT quantity FROM inventory WHERE item_name = ? AND stock_scope = 'ocs'").get(pendingName)
      .quantity,
    0,
  );

  const remaining = await api("POST", `/api/inventory/shipments/${shipmentId}/release`, {
    token: operatorToken,
    body: { mode: "selected", row_ids: [releasedLine.id, pending.id] },
  });
  assert.ok([200, 201].includes(remaining.status), JSON.stringify(remaining.data));
  assert.equal(remaining.data.receipt.total_quantity, 3);
  assert.equal(remaining.data.receipt.kind, "release_receipt");
  assert.equal(remaining.data.summary.total_quantity, 5);
  assert.equal(
    db.prepare("SELECT quantity FROM inventory WHERE item_name = ? AND stock_scope = 'ocs'").get(pendingName)
      .quantity,
    3,
  );
  assert.equal(
    db.prepare("SELECT quantity FROM inventory WHERE item_name = ? AND stock_scope = 'ocs'").get(releasedName)
      .quantity,
    2,
  );
  const after = await api("GET", `/api/inventory/shipments/${shipmentId}`, { token: operatorToken });
  assert.equal(
    after.data.shipment.lines.find((line) => Number(line.id) === Number(excludedLine.id)).status,
    "excluded",
  );
});

test("inventory operations schema adds release and recount columns on clean and upgraded databases", () => {
  ensureInventoryOperationsSchema();
  const staging = db.prepare("PRAGMA table_info(inventory_staging)").all().map((row) => row.name);
  const stocktakeItems = db
    .prepare("PRAGMA table_info(inventory_stocktake_session_items)")
    .all()
    .map((row) => row.name);
  assert.ok(staging.includes("release_transaction_id"));
  assert.ok(staging.includes("released_inventory_id"));
  assert.ok(staging.includes("released_batch_id"));
  assert.ok(stocktakeItems.includes("recounted_by_user_id"));
  assert.ok(stocktakeItems.includes("recounted_at"));
  assert.ok(stocktakeItems.includes("previous_count_quantity"));
  assert.ok(stocktakeItems.includes("previous_count_at"));
  assert.ok(stocktakeItems.includes("previous_count_session_id"));
  const stocktakeSessions = db
    .prepare("PRAGMA table_info(inventory_stocktake_sessions)")
    .all()
    .map((row) => row.name);
  assert.ok(stocktakeSessions.includes("movement_id_watermark"));
  assert.ok(stocktakeSessions.includes("owner_doctor_id"));
  assert.ok(stocktakeSessions.includes("scope_token"));
  ensureInventoryOperationsSchema();
  assert.ok(
    db
      .prepare("PRAGMA table_info(inventory_staging)")
      .all()
      .some((row) => row.name === "release_transaction_id"),
  );
});

test("derived stock fields exclude expired units from available-to-use and distinguish missing vs non-expiring", async () => {
  const mixedName = `ExpMix ${Date.now()}`;
  const mixedId = insertOcsItem({ name: mixedName, qty: 4, expiry: "2020-01-01" });
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, 6, '2029-06-01', 5, 0)`,
  ).run(mixedId);
  db.prepare("UPDATE inventory SET quantity = 10 WHERE id = ?").run(mixedId);
  const missingId = insertOcsItem({ name: `MissExp ${Date.now()}`, qty: 3, expiry: null, nonExpiring: 0 });
  const nonExpId = insertOcsItem({ name: `NonExp ${Date.now()}`, qty: 2, nonExpiring: 1 });
  const unpricedId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope)
         VALUES (?, ?, 5, 0, 'unit', 0, 0, 'ocs')`,
      )
      .run(`Unpriced ${Date.now()}`, folderId).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, 5, '2029-06-01', 0, 0)`,
  ).run(unpricedId);

  const payload = await api("GET", "/api/inventory", { token: operatorToken });
  assert.equal(payload.status, 200, JSON.stringify(payload.data));
  const mixed = payload.data.ocs_stock.find((row) => Number(row.id) === mixedId);
  assert.ok(mixed);
  assert.equal(Number(mixed.on_hand_quantity), 10);
  assert.equal(Number(mixed.expired_quantity), 4);
  assert.equal(Number(mixed.available_to_use), 6);
  assert.equal(mixed.has_expired, true);
  assert.equal(mixed.nearest_usable_expiry, "2029-06-01");
  assert.ok(payload.data.expired_items.some((row) => Number(row.id) === mixedId));

  const missing = payload.data.ocs_stock.find((row) => Number(row.id) === missingId);
  assert.equal(missing.missing_expiry, true);
  assert.equal(Number(missing.available_to_use), 3);
  assert.equal(missing.has_non_expiring, false);
  assert.equal(missing.is_non_expiring_only, false);

  const nonExp = payload.data.ocs_stock.find((row) => Number(row.id) === nonExpId);
  assert.equal(nonExp.has_non_expiring, true);
  assert.equal(nonExp.missing_expiry, false);
  assert.equal(nonExp.is_non_expiring_only, true);

  const batches = await api("GET", `/api/inventory/items/${mixedId}/batches`, { token: operatorToken });
  if (batches.status === 200) {
    const labels = (batches.data.batches || []).map((row) => row.expiry_label);
    assert.ok(labels.includes("Expired"));
  }

  const unpriced = payload.data.ocs_stock.find((row) => Number(row.id) === unpricedId);
  assert.ok(unpriced);
  assert.equal(Number(unpriced.available_to_use), 5);
  assert.ok(Number(unpriced.unpriced_units) >= 5);
  assert.equal(payload.data.tab_summaries.stock.valuation_complete, false);
  assert.ok(Number(payload.data.tab_summaries.stock.unpriced_count) >= 1);

  const bag = await api("GET", `/api/inventory?doctorId=${doctorId}`, { token: operatorToken });
  assert.equal(bag.status, 200, JSON.stringify(bag.data));
  const bagItems = bag.data.selected_doctor_stock || [];
  assert.equal(Number(bag.data.tab_summaries.stock.missing_expiry), bagItems.filter((row) => row.missing_expiry).length);
  assert.equal(Number(bag.data.tab_summaries.stock.expired), bagItems.filter((row) => row.has_expired).length);
  assert.equal(bag.data.tab_summaries.stock.location_kind, "bag");
  assert.match(String(bag.data.tab_summaries.stock.location_heading), /bag/i);
  assert.doesNotMatch(String(bag.data.tab_summaries.stock.location_heading), /My Stock/i);
});

test("doctor inventory metrics match dashboard and exclude zero-quantity missing expiry", async () => {
  const parName = `ParZero ${Date.now()}`;
  const missingName = `MissZero ${Date.now()}`;
  const lowName = `LowBag ${Date.now()}`;
  db.prepare(
    `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
     VALUES (?, ?, 0, 0, 'unit', 5, 10, 'doctor', ?)`,
  ).run(parName, folderId, doctorId);
  db.prepare(
    `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
     VALUES (?, ?, 0, 2, 'unit', 5, 10, 'doctor', ?)`,
  ).run(missingName, folderId, doctorId);
  const lowId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
         VALUES (?, ?, 1, 4, 'unit', 5, 10, 'doctor', ?)`,
      )
      .run(lowName, folderId, doctorId).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, 1, '2029-01-01', 5, 0)`,
  ).run(lowId);

  const inventory = await api("GET", "/api/inventory?context=my", { token: doctorToken });
  assert.equal(inventory.status, 200, JSON.stringify(inventory.data));
  const metrics = inventory.data.doctor_metrics;
  assert.ok(metrics);
  const bag = inventory.data.my_stock || [];
  const atOrBelow = bag.filter((row) => isAtOrBelowPar(row));
  assert.equal(metrics.at_or_below_par, atOrBelow.length);
  const zeroMissing = bag.find((row) => row.item_name === missingName);
  assert.ok(zeroMissing);
  assert.equal(isAtOrBelowPar(zeroMissing), false);
  assert.equal(isOutOfStock(zeroMissing), false);
  assert.equal(zeroMissing.missing_expiry, false);
  assert.ok(!metrics.item_ids.missing_expiry.includes(Number(zeroMissing.id)));

  const dash = await api("GET", "/api/dashboard", { token: doctorToken });
  assert.equal(dash.status, 200, JSON.stringify(dash.data));
  assert.equal(Number(dash.data.doctor_low_stock_alert.total_items), metrics.at_or_below_par);

  const depot = await api("GET", "/api/inventory?context=ocs", { token: doctorToken });
  assert.equal(depot.status, 200, JSON.stringify(depot.data));
  assert.equal(depot.data.doctor_metrics.at_or_below_par, metrics.at_or_below_par);
  assert.equal(depot.data.doctor_metrics.missing_expiry, metrics.missing_expiry);
  assert.equal(depot.data.doctor_metrics.expired, metrics.expired);
  assert.equal(depot.data.doctor_metrics.ocs_can_fill, metrics.ocs_can_fill);
});

test("doctor activity CSV is scoped and wastage requires a reason and lot", async () => {
  const csv = await api("GET", "/api/inventory/activity-history/export.csv", { token: doctorToken });
  assert.equal(csv.status, 200, JSON.stringify(csv.data).slice(0, 200));
  const otherHistory = await api("GET", "/api/inventory/activity-history", { token: doctorTwoToken });
  assert.equal(otherHistory.status, 200);
  const names = (otherHistory.data.rows || []).map((row) => String(row.item_name || ""));
  assert.equal(names.some((name) => name.includes("Hist ")), false);

  const bagName = `WasteLot ${Date.now()}`;
  const bagId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
         VALUES (?, ?, 3, 0, 'unit', 5, 10, 'doctor', ?)`,
      )
      .run(bagName, folderId, doctorId).lastInsertRowid,
  );
  const lotId = Number(
    db
      .prepare(
        `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
         VALUES (?, 3, '2029-01-01', 5, 0)`,
      )
      .run(bagId).lastInsertRowid,
  );
  const missingNote = await api("POST", `/api/inventory/items/${bagId}/actions`, {
    token: doctorToken,
    body: { action_type: "stock_out", quantity: 1, reason: "Wasted" },
  });
  assert.equal(missingNote.status, 400, JSON.stringify(missingNote.data));
  const ok = await api("POST", `/api/inventory/items/${bagId}/actions`, {
    token: doctorToken,
    body: {
      action_type: "stock_out",
      quantity: 1,
      reason: "Wasted",
      note: "Dropped during home visit",
      batch_id: lotId,
    },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
});

test("full-catalogue stocktake requires explicit confirmation and a scope fingerprint", async () => {
  const denied = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: {},
  });
  assert.equal(denied.status, 400, JSON.stringify(denied.data));
  const preview = await api("GET", "/api/inventory/stocktake/scope", { token: operatorToken });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const stale = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { confirm_all: true, scope_token: "not-the-current-scope" },
  });
  assert.equal(stale.status, 409, JSON.stringify(stale.data));
  assert.equal(stale.data.code, "STOCKTAKE_SCOPE_STALE");
  const created = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { confirm_all: true, scope_token: preview.data.scope_token },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.session.items.length, preview.data.item_count);
});

test("activity history correction filter and blank actors are excluded from the user filter", async () => {
  db.prepare(`
    INSERT INTO inventory_activity_history (
      movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type, item_name,
      quantity, direction, source_text, destination_text, batch_id, meta_json
    ) VALUES
      (NULL, CURRENT_TIMESTAMP, ?, 'Operator One', 'operator', 'exceptional_correction', 'HistCorr', 1, 'adjustment', 'OCS', 'OCS', '', '{}'),
      (NULL, CURRENT_TIMESTAMP, NULL, '', 'staff', 'stock_in', 'HistBlank', 1, 'in', 'OCS', 'OCS', '', '{}'),
      (NULL, CURRENT_TIMESTAMP, NULL, 'System', 'system', 'stock_in', 'HistSys', 2, 'in', 'OCS', 'OCS', '', '{"automated":true}')
  `).run(db.prepare("SELECT id FROM users WHERE username = 'operator01'").get().id);
  const history = await api("GET", "/api/inventory/activity-history?actions=correction", { token: operatorToken });
  assert.equal(history.status, 200, JSON.stringify(history.data));
  assert.ok(history.data.actions.includes("correction"));
  assert.ok(history.data.rows.some((row) => String(row.action_type).includes("correction")));
  assert.ok(history.data.actors.every((actor) => String(actor.actor_name || "").trim()));
  const doctorHistory = await api("GET", "/api/inventory/activity-history?userId=1", { token: doctorToken });
  assert.equal(doctorHistory.status, 200, JSON.stringify(doctorHistory.data));
  assert.deepEqual(doctorHistory.data.actors, []);
});

test("top performer excludes System and automated movements", async () => {
  db.prepare(`
    INSERT INTO inventory_activity_history (
      movement_id, timestamp, actor_user_id, actor_name, actor_role, action_type, item_name,
      quantity, direction, source_text, destination_text, batch_id, meta_json
    ) VALUES
      (NULL, CURRENT_TIMESTAMP, NULL, 'System', 'system', 'stock_in', 'AutoOnly', 9, 'in', 'OCS', 'OCS', '', '{"automated":true}')
  `).run();
  const history = await api("GET", "/api/inventory/activity-history?search=AutoOnly", { token: operatorToken });
  assert.equal(history.status, 200, JSON.stringify(history.data));
  const performer = history.data.analytics?.top_performer;
  if (performer) {
    assert.notEqual(String(performer.name).toLowerCase(), "system");
  } else {
    assert.equal(history.data.analytics.no_human_activity, true);
  }
});

function seedDoctorBillableItem({ name, batches }) {
  const itemId = Number(
    db
      .prepare(
        `INSERT INTO inventory (
           item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id
         ) VALUES (?, ?, ?, 0, 'unit', 8, 20, 'doctor', ?)`,
      )
      .run(
        name,
        folderId,
        batches.reduce((sum, batch) => sum + Number(batch.qty), 0),
        doctorId,
      ).lastInsertRowid,
  );
  const batchIds = [];
  for (const batch of batches) {
    batchIds.push(
      Number(
        db
          .prepare(
            `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status)
             VALUES (?, ?, ?, 8, 0, ?)`,
          )
          .run(itemId, batch.qty, batch.expiry || null, batch.status || "usable").lastInsertRowid,
      ),
    );
  }
  return { itemId, batchIds };
}

function seedConsultationForBilling() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const patientId = Number(
    db
      .prepare(
        `INSERT INTO patients (
           full_name, first_name, last_name, patient_identifier, age, date_of_birth, gender,
           contact_number, patient_contact_number, address, link_status
         ) VALUES (?, ?, 'Patient', ?, 40, '1985-01-01', 'F', '57001111', '57001111', '1 Test Road', 'staff_created')`,
      )
      .run(`Bill ${stamp}`, `Bill${stamp}`, `BILL-${stamp}`).lastInsertRowid,
  );
  const appointmentId = Number(
    db
      .prepare(
        `INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
         VALUES (?, ?, date('now'), '09:00', 'completed')`,
      )
      .run(patientId, doctorId).lastInsertRowid,
  );
  const consultationId = Number(
    db
      .prepare(
        `INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
         VALUES (?, ?, ?, date('now'), 'Billing integrity')`,
      )
      .run(appointmentId, patientId, doctorId).lastInsertRowid,
  );
  return { patientId, appointmentId, consultationId };
}

test("billing rejects expired quarantined and insufficient ATP stock without mutation", async () => {
  const { patientId, consultationId } = seedConsultationForBilling();
  const expired = seedDoctorBillableItem({
    name: `Bill Expired ${Date.now()}`,
    batches: [{ qty: 4, expiry: "2020-01-01" }],
  });
  const mixed = seedDoctorBillableItem({
    name: `Bill Mixed ${Date.now()}`,
    batches: [
      { qty: 2, expiry: "2020-01-01" },
      { qty: 3, expiry: "2029-01-01" },
    ],
  });
  const quarantined = seedDoctorBillableItem({
    name: `Bill Quarantine ${Date.now()}`,
    batches: [{ qty: 5, expiry: "2029-01-01" }],
  });
  db.prepare("UPDATE inventory_batches SET status = 'quarantined' WHERE id = ?").run(quarantined.batchIds[0]);
  const onHandOnly = seedDoctorBillableItem({
    name: `Bill Reserved ${Date.now()}`,
    batches: [{ qty: 4, expiry: "2029-01-01" }],
  });
  db.prepare("UPDATE inventory SET quantity = 4 WHERE id = ?").run(onHandOnly.itemId);
  db.prepare(
    `UPDATE inventory_batches SET quantity_remaining = 2, expiry_date = '2020-01-01' WHERE id = ?`,
  ).run(onHandOnly.batchIds[0]);
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, 2, '2029-01-01', 8, 0)`,
  ).run(onHandOnly.itemId);

  const expiredBill = await api("POST", "/api/billing/test-support/create", {
    token: doctorToken,
    body: {
      consultation_id: consultationId,
      patient_id: patientId,
      items: [{ description: "expired", amount: 20, type: "Sale", quantity: 1, inventory_item_id: expired.itemId }],
    },
  });
  assert.equal(expiredBill.status, 409, JSON.stringify(expiredBill.data));

  const mixedBill = await api("POST", "/api/billing/test-support/create", {
    token: doctorToken,
    body: {
      consultation_id: consultationId,
      patient_id: patientId,
      items: [{ description: "mixed", amount: 80, type: "Sale", quantity: 4, inventory_item_id: mixed.itemId }],
    },
  });
  assert.equal(mixedBill.status, 409, JSON.stringify(mixedBill.data));
  const mixedOk = await api("POST", "/api/billing/test-support/create", {
    token: doctorToken,
    body: {
      consultation_id: consultationId,
      patient_id: patientId,
      items: [{ description: "mixed-ok", amount: 60, type: "Sale", quantity: 3, inventory_item_id: mixed.itemId }],
    },
  });
  assert.equal(mixedOk.status, 201, JSON.stringify(mixedOk.data));
  const mixedItem = db.prepare("SELECT quantity, row_version FROM inventory WHERE id = ?").get(mixed.itemId);
  assert.equal(Number(mixedItem.quantity), 2);
  assert.ok(Number(mixedItem.row_version) >= 2);
  const mixedBatches = db.prepare("SELECT expiry_date, quantity_remaining FROM inventory_batches WHERE item_id = ? ORDER BY expiry_date").all(mixed.itemId);
  assert.equal(Number(mixedBatches.find((row) => row.expiry_date === "2020-01-01").quantity_remaining), 2);
  assert.equal(Number(mixedBatches.find((row) => row.expiry_date === "2029-01-01").quantity_remaining), 0);
  const billedQty = Number(
    db.prepare("SELECT quantity FROM inventory_movements WHERE item_id = ? ORDER BY id DESC LIMIT 1").get(mixed.itemId).quantity,
  );
  assert.equal(billedQty, 3);
  const allocSum = Number(
    db
      .prepare(
        `SELECT COALESCE(SUM(a.quantity), 0) AS total
         FROM inventory_movement_allocations a
         JOIN inventory_movements m ON m.id = a.movement_id
         WHERE m.item_id = ?`,
      )
      .get(mixed.itemId).total,
  );
  assert.equal(allocSum, 3);

  const quarantinedBill = await api("POST", "/api/billing/test-support/create", {
    token: doctorToken,
    body: {
      consultation_id: consultationId,
      patient_id: patientId,
      items: [{ description: "q", amount: 20, type: "Sale", quantity: 1, inventory_item_id: quarantined.itemId }],
    },
  });
  assert.equal(quarantinedBill.status, 409, JSON.stringify(quarantinedBill.data));

  const reservedBill = await api("POST", "/api/billing/test-support/create", {
    token: doctorToken,
    body: {
      consultation_id: consultationId,
      patient_id: patientId,
      items: [{ description: "expired-share", amount: 60, type: "Sale", quantity: 3, inventory_item_id: onHandOnly.itemId }],
    },
  });
  assert.equal(reservedBill.status, 409, JSON.stringify(reservedBill.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(onHandOnly.itemId).quantity, 4);
});

test("consultation reversal keeps original movements and restores original batches", async () => {
  const { patientId, consultationId } = seedConsultationForBilling();
  const stock = seedDoctorBillableItem({
    name: `Reverse Mix ${Date.now()}`,
    batches: [
      { qty: 2, expiry: "2028-01-01" },
      { qty: 2, expiry: "2030-01-01" },
    ],
  });
  const billed = await api("POST", "/api/billing/test-support/create", {
    token: doctorToken,
    body: {
      consultation_id: consultationId,
      patient_id: patientId,
      items: [{ description: "mix", amount: 40, type: "Sale", quantity: 2, inventory_item_id: stock.itemId }],
    },
  });
  assert.equal(billed.status, 201, JSON.stringify(billed.data));
  const originalMovements = db.prepare("SELECT * FROM inventory_movements WHERE item_id = ?").all(stock.itemId);
  assert.equal(originalMovements.length, 1);
  const originalHistory = db.prepare("SELECT COUNT(*) AS count FROM inventory_activity_history WHERE movement_id = ?").get(originalMovements[0].id).count;
  assert.ok(originalHistory >= 1);
  const voided = await api("DELETE", `/api/consultations/${consultationId}`, {
    token: adminToken,
    body: { reason: "Duplicate unpaid consultation regression" },
  });
  assert.equal(voided.status, 204, JSON.stringify(voided.data));
  const stillThere = db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE id = ?").get(originalMovements[0].id).count;
  assert.equal(stillThere, 1);
  const reversal = db.prepare("SELECT * FROM inventory_movements WHERE action_type = 'reversal' AND item_id = ?").get(stock.itemId);
  assert.ok(reversal);
  const restored = db.prepare("SELECT id, quantity_remaining, expiry_date FROM inventory_batches WHERE item_id = ? ORDER BY expiry_date").all(stock.itemId);
  assert.equal(Number(restored[0].quantity_remaining), 2);
  assert.equal(Number(restored[1].quantity_remaining), 2);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(stock.itemId).quantity, 4);
  const again = await api("DELETE", `/api/consultations/${consultationId}`, {
    token: adminToken,
    body: { reason: "Duplicate unpaid consultation regression" },
  });
  assert.equal(again.status, 204, JSON.stringify(again.data));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE action_type = 'reversal' AND item_id = ?").get(stock.itemId).count, 1);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(stock.itemId).quantity, 4);
});

test("legacy consultation reversal without allocations does not invent a usable batch", async () => {
  const { patientId, consultationId } = seedConsultationForBilling();
  const stock = seedDoctorBillableItem({
    name: `Legacy Reverse ${Date.now()}`,
    batches: [{ qty: 3, expiry: "2029-08-01" }],
  });
  db.prepare("UPDATE inventory SET quantity = 1, row_version = COALESCE(row_version, 1) + 1 WHERE id = ?").run(stock.itemId);
  db.prepare("UPDATE inventory_batches SET quantity_remaining = 1 WHERE id = ?").run(stock.batchIds[0]);
  const movementId = Number(
    db
      .prepare(
        `INSERT INTO inventory_movements (
           item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
           recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
         ) VALUES (?, 'out', 2, 3, 1, ?, NULL, 'legacy sale', 'sell', 'appointment', ?, ?)`,
      )
      .run(
        stock.itemId,
        doctorId,
        db.prepare("SELECT appointment_id FROM consultations WHERE id = ?").get(consultationId).appointment_id,
        JSON.stringify({ consultation_id: consultationId }),
      ).lastInsertRowid,
  );
  const blocked = await api("DELETE", `/api/consultations/${consultationId}`, {
    token: adminToken,
    body: { reason: "Legacy reversal requires correction" },
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, "LEGACY_REVERSAL_REQUIRES_CORRECTION");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(stock.itemId).quantity, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE id = ?").get(movementId).count, 1);
  const allowed = await api("DELETE", `/api/consultations/${consultationId}`, {
    token: adminToken,
    body: { confirm_legacy_exception: true, reason: "Authorised legacy reversal without original lots" },
  });
  assert.equal(allowed.status, 204, JSON.stringify(allowed.data));
  const exceptionBatch = db
    .prepare("SELECT * FROM inventory_batches WHERE item_id = ? AND COALESCE(status, 'usable') = 'quarantined'")
    .get(stock.itemId);
  assert.ok(exceptionBatch);
  const listed = decorateLookup(stock.itemId);
  assert.equal(Number(listed.available_to_promise), Number(listed.available_to_use));
  assert.ok(Number(listed.quarantined_quantity) >= 2);
});

function decorateLookup(itemId) {
  const { decorateInventoryItems } = require("../src/lib/inventoryStockState");
  return decorateInventoryItems([db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId)])[0];
}

test("quarantine excludes ATP and cannot be billed reserved or allocated", async () => {
  const itemId = insertOcsItem({ name: `Quarantine ATP ${Date.now()}`, qty: 6, expiry: "2029-04-01" });
  const batchId = db.prepare("SELECT id FROM inventory_batches WHERE item_id = ?").get(itemId).id;
  const before = decorateLookup(itemId);
  void before;
  const quarantined = await api("POST", `/api/inventory/batches/${batchId}/quarantine`, {
    token: adminToken,
    body: { reason: "Manufacturer recall pending investigation", confirm: true },
  });
  assert.ok(quarantined.status === 201 || quarantined.status === 200, JSON.stringify(quarantined.data));
  const decorated = decorateLookup(itemId);
  assert.equal(Number(decorated.quarantined_quantity), 6);
  assert.equal(Number(decorated.available_to_promise), 0);
  assert.equal(Number(decorated.on_hand_quantity), 6);
  const { availableToPromise, allocateFefo } = require("../src/lib/restockFulfilment");
  assert.equal(availableToPromise(itemId), 0);
  assert.equal(allocateFefo(itemId, 1).length, 0);
  const again = await api("POST", `/api/inventory/batches/${batchId}/quarantine`, {
    token: adminToken,
    body: { reason: "Manufacturer recall pending investigation", confirm: true },
  });
  assert.equal(again.status, 200);
  const released = await api("POST", `/api/inventory/batches/${batchId}/release-quarantine`, {
    token: adminToken,
    body: { reason: "Recall cleared by quality review", confirm: true },
  });
  assert.ok(released.status === 201 || released.status === 200, JSON.stringify(released.data));
  const after = decorateLookup(itemId);
  assert.equal(Number(after.quarantined_quantity), 0);
  assert.equal(Number(after.available_to_promise), 6);
});

test("restock ATP excluding own reservation does not count quarantined lots", async () => {
  const itemId = insertOcsItem({ name: `ATP Quarantine Cap ${Date.now()}`, qty: 6, expiry: "2029-04-01" });
  const request = await createAcceptedRequest({
    itemId,
    itemName: "ATP Quarantine Cap",
    quantity: 4,
    note: "quarantine-atp",
  });
  const batchId = db.prepare("SELECT id FROM inventory_batches WHERE item_id = ?").get(itemId).id;
  const quarantined = await api("POST", `/api/inventory/batches/${batchId}/quarantine`, {
    token: adminToken,
    body: { reason: "Manufacturer recall pending investigation", confirm: true },
  });
  assert.ok(quarantined.status === 201 || quarantined.status === 200, JSON.stringify(quarantined.data));
  const { availableToPromise: atpFor } = require("../src/lib/restockFulfilment");
  assert.equal(atpFor(itemId), 0);
  assert.equal(atpFor(itemId, { exceptRequestId: request.id }), 0);
});

test("stocktake scope token detects membership swaps with the same count", async () => {
  const preview = await api("GET", "/api/inventory/stocktake/scope", { token: operatorToken });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  const first = db.prepare("SELECT id FROM inventory WHERE stock_scope = 'ocs' AND owner_doctor_id IS NULL AND archived_at IS NULL ORDER BY id LIMIT 1").get();
  db.prepare("UPDATE inventory SET archived_at = CURRENT_TIMESTAMP WHERE id = ?").run(first.id);
  const added = insertOcsItem({ name: `Scope Swap ${Date.now()}`, qty: 1 });
  const stale = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { confirm_all: true, scope_token: preview.data.scope_token },
  });
  assert.equal(stale.status, 409, JSON.stringify(stale.data));
  assert.equal(stale.data.code, "STOCKTAKE_SCOPE_STALE");
  const fresh = await api("GET", "/api/inventory/stocktake/scope", { token: operatorToken });
  const created = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { confirm_all: true, scope_token: fresh.data.scope_token },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.ok(created.data.session.items.some((row) => Number(row.inventory_id) === added));
  assert.ok(!created.data.session.items.some((row) => Number(row.inventory_id) === first.id));
});

test("billing rolls back the first line when a later line cannot be allocated", async () => {
  const { patientId, consultationId } = seedConsultationForBilling();
  const good = seedDoctorBillableItem({
    name: `Bill Rollback Good ${Date.now()}`,
    batches: [{ qty: 4, expiry: "2029-01-01" }],
  });
  const bad = seedDoctorBillableItem({
    name: `Bill Rollback Bad ${Date.now()}`,
    batches: [{ qty: 4, expiry: "2020-01-01" }],
  });
  const billed = await api("POST", "/api/billing/test-support/create", {
    token: doctorToken,
    body: {
      consultation_id: consultationId,
      patient_id: patientId,
      items: [
        { description: "good", amount: 40, type: "Sale", quantity: 2, inventory_item_id: good.itemId },
        { description: "bad", amount: 40, type: "Sale", quantity: 2, inventory_item_id: bad.itemId },
      ],
    },
  });
  assert.equal(billed.status, 409, JSON.stringify(billed.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(good.itemId).quantity, 4);
  assert.equal(db.prepare("SELECT quantity_remaining FROM inventory_batches WHERE id = ?").get(good.batchIds[0]).quantity_remaining, 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing WHERE consultation_id = ?").get(consultationId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id = ?").get(good.itemId).count, 0);
});

test("concurrent billing cannot oversell the same doctor batch", async () => {
  const first = seedConsultationForBilling();
  const second = seedConsultationForBilling();
  const stock = seedDoctorBillableItem({
    name: `Bill Concurrent ${Date.now()}`,
    batches: [{ qty: 4, expiry: "2029-03-01" }],
  });
  const payload = (consultationId, patientId) => ({
    token: doctorToken,
    body: {
      consultation_id: consultationId,
      patient_id: patientId,
      items: [{ description: "concurrent", amount: 60, type: "Sale", quantity: 3, inventory_item_id: stock.itemId }],
    },
  });
  const [a, b] = await Promise.all([
    api("POST", "/api/billing/test-support/create", payload(first.consultationId, first.patientId)),
    api("POST", "/api/billing/test-support/create", payload(second.consultationId, second.patientId)),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  const item = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(stock.itemId);
  const batchQty = Number(
    db.prepare("SELECT COALESCE(SUM(quantity_remaining), 0) AS total FROM inventory_batches WHERE item_id = ?").get(stock.itemId).total,
  );
  assert.equal(Number(item.quantity), 1);
  assert.equal(batchQty, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id = ?").get(stock.itemId).count, 1);
});

test("consultation reversal rolls back when a later movement cannot be restored", async () => {
  const { patientId, consultationId } = seedConsultationForBilling();
  const stock = seedDoctorBillableItem({
    name: `Reverse Rollback ${Date.now()}`,
    batches: [{ qty: 3, expiry: "2029-05-01" }],
  });
  const billed = await api("POST", "/api/billing/test-support/create", {
    token: doctorToken,
    body: {
      consultation_id: consultationId,
      patient_id: patientId,
      items: [{ description: "ok", amount: 20, type: "Sale", quantity: 1, inventory_item_id: stock.itemId }],
    },
  });
  assert.equal(billed.status, 201, JSON.stringify(billed.data));
  db.prepare(
    `INSERT INTO inventory_movements (
       item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
       recorded_by_user_id, note, action_type, reference_type, reference_id, meta_json
     ) VALUES (?, 'out', 1, 2, 1, ?, NULL, 'legacy extra', 'sell', 'appointment', ?, ?)`,
  ).run(
    stock.itemId,
    doctorId,
    db.prepare("SELECT appointment_id FROM consultations WHERE id = ?").get(consultationId).appointment_id,
    JSON.stringify({ consultation_id: consultationId }),
  );
  const blocked = await api("DELETE", `/api/consultations/${consultationId}`, {
    token: adminToken,
    body: { reason: "Rollback incomplete legacy reversal" },
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, "LEGACY_REVERSAL_REQUIRES_CORRECTION");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(stock.itemId).quantity, 2);
  assert.equal(db.prepare("SELECT quantity_remaining FROM inventory_batches WHERE id = ?").get(stock.batchIds[0]).quantity_remaining, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE action_type = 'reversal' AND item_id = ?").get(stock.itemId).count, 0);
  assert.equal(db.prepare("SELECT voided_at FROM consultations WHERE id = ?").get(consultationId).voided_at, null);
});

test("stocktake scope token detects folder membership and row-version changes", async () => {
  const otherFolder = Number(
    db.prepare("INSERT INTO inventory_folders (name, parent_id) VALUES (?, ?)").run(`Scope Folder ${Date.now()}`, folderId).lastInsertRowid,
  );
  const itemId = insertOcsItem({ name: `Folder Scope ${Date.now()}`, qty: 2, folder: folderId });
  const preview = await api("GET", `/api/inventory/stocktake/scope?folder_id=${folderId}`, { token: operatorToken });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  db.prepare("UPDATE inventory SET folder_id = ? WHERE id = ?").run(otherFolder, itemId);
  const staleFolder = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { folder_id: folderId, scope_token: preview.data.scope_token },
  });
  assert.equal(staleFolder.status, 409, JSON.stringify(staleFolder.data));
  assert.equal(staleFolder.data.code, "STOCKTAKE_SCOPE_STALE");

  const scoped = insertOcsItem({ name: `Version Scope ${Date.now()}`, qty: 2 });
  const versionPreview = await api("GET", `/api/inventory/stocktake/scope?item_ids=${scoped}`, { token: operatorToken });
  db.prepare("UPDATE inventory SET row_version = COALESCE(row_version, 1) + 1 WHERE id = ?").run(scoped);
  const staleVersion = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { item_ids: [scoped], scope_token: versionPreview.data.scope_token },
  });
  assert.equal(staleVersion.status, 409, JSON.stringify(staleVersion.data));
  assert.equal(staleVersion.data.code, "STOCKTAKE_SCOPE_STALE");

  const fresh = await api("GET", `/api/inventory/stocktake/scope?item_ids=${scoped}`, { token: operatorToken });
  const first = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { item_ids: [scoped], scope_token: fresh.data.scope_token },
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const repeated = await api("POST", "/api/inventory/stocktake/sessions", {
    token: operatorToken,
    body: { item_ids: [scoped], scope_token: fresh.data.scope_token },
  });
  assert.equal(repeated.status, 201, JSON.stringify(repeated.data));
  assert.notEqual(Number(repeated.data.session.id), Number(first.data.session.id));
});

test("opening batches stay usable while cost and expiry are still missing", async () => {
  const itemId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price,
      stock_scope, owner_doctor_id
    ) VALUES (?, ?, 5, 0, 'unit', 0, 20, 'ocs', NULL)
  `).run(`Opening data ${Date.now()}`, folderId).lastInsertRowid);
  const batchId = Number(db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
    VALUES (?, 5, NULL, 0, 0)
  `).run(itemId).lastInsertRowid);

  const before = decorateInventoryItems([db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId)])[0];
  assert.equal(before.available_to_use, 5);
  assert.equal(before.missing_expiry_quantity, 5);
  assert.equal(before.missing_cost_quantity, 5);
  assert.equal(before.valuation_complete, false);

  const operationId = `opening-data-${Date.now()}`;
  const payload = {
    operation_id: operationId,
    unit_cost: 12.5,
    expiry_date: "2031-06-30",
    is_non_expiring: false,
    expected_row_version: 1,
    reason: "Supplier invoice INV-OPEN-01 and package label checked",
    confirm: true,
  };
  const verified = await api("PATCH", `/api/inventory/batches/${batchId}/opening-data`, {
    token: adminToken,
    body: payload,
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  const replay = await api("PATCH", `/api/inventory/batches/${batchId}/opening-data`, {
    token: adminToken,
    body: payload,
  });
  assert.equal(replay.status, 200, JSON.stringify(replay.data));
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE action_type = 'verify_opening_batch_data' AND item_id = ?").get(itemId).count,
    1,
  );

  const after = decorateInventoryItems([db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId)])[0];
  assert.equal(after.available_to_use, 5);
  assert.equal(after.current_cost_value, 62.5);
  assert.equal(after.valuation_complete, true);
});

test("unbatched legacy quantity is usable before opening-batch details are added", async () => {
  const itemId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price,
      stock_scope, owner_doctor_id
    ) VALUES (?, ?, 3, 0, 'unit', 0, 20, 'ocs', NULL)
  `).run(`Unbatched opening ${Date.now()}`, folderId).lastInsertRowid);
  const before = decorateInventoryItems([db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId)])[0];
  assert.equal(before.unbatched_quantity, 3);
  assert.equal(before.available_to_use, 3);

  const payload = {
    operation_id: `create-opening-batch-${Date.now()}`,
    unit_cost: 8,
    expiry_date: "2032-04-30",
    is_non_expiring: false,
    expected_row_version: Number(before.row_version || 1),
    reason: "Opening count sheet and package expiry label checked",
    confirm: true,
  };
  const created = await api("POST", `/api/inventory/items/${itemId}/opening-batch-data`, {
    token: adminToken,
    body: payload,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const replay = await api("POST", `/api/inventory/items/${itemId}/opening-batch-data`, {
    token: adminToken,
    body: payload,
  });
  assert.equal(replay.status, 201, JSON.stringify(replay.data));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_batches WHERE item_id = ?").get(itemId).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE action_type = 'create_opening_batch_data' AND item_id = ?").get(itemId).count, 1);
  const after = decorateInventoryItems([db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId)])[0];
  assert.equal(after.unbatched_quantity, 0);
  assert.equal(after.available_to_use, 3);
  assert.equal(after.current_cost_value, 24);
});

test("inventory valuation uses each remaining batch cost rather than the catalogue estimate", () => {
  const itemId = Number(db.prepare(`
    INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope)
    VALUES (?, ?, 5, 0, 'unit', 999, 25, 'ocs')
  `).run(`Lot valuation ${Date.now()}`, folderId).lastInsertRowid);
  db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
    VALUES (?, 2, '2031-01-31', 4, 0), (?, 3, '2032-01-31', 7, 0)
  `).run(itemId, itemId);
  const decorated = decorateInventoryItems([db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId)]);
  const valuation = summarizeLocationValuation(decorated);
  assert.equal(valuation.known_value, 29);
  assert.equal(valuation.unpriced_units, 0);
  assert.equal(valuation.valuation_complete, true);
});

test("bag write-offs require exact evidence, replay once, and reverse by compensating entry", async () => {
  const itemId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price,
      stock_scope, owner_doctor_id
    ) VALUES (?, ?, 5, 0, 'unit', 9, 18, 'doctor', ?)
  `).run(`Reversible write-off ${Date.now()}`, folderId, doctorId).lastInsertRowid);
  const batchId = Number(db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
    VALUES (?, 5, '2031-08-31', 9, 0)
  `).run(itemId).lastInsertRowid);

  const missingEvidence = await api("POST", `/api/inventory/items/${itemId}/bag-actions`, {
    token: adminToken,
    body: { action_type: "remove", quantity: 2, reason: "Damaged", note: "Package was visibly damaged", confirm: true },
  });
  assert.equal(missingEvidence.status, 400);

  const writeOperation = `bag-write-off-${Date.now()}`;
  const writePayload = {
    operation_id: writeOperation,
    action_type: "remove",
    quantity: 2,
    reason: "Wasted",
    note: "Medication was prepared but could not be administered",
    batch_id: batchId,
    confirm: true,
  };
  const writtenOff = await api("POST", `/api/inventory/items/${itemId}/bag-actions`, {
    token: adminToken,
    body: writePayload,
  });
  assert.equal(writtenOff.status, 201, JSON.stringify(writtenOff.data));
  const replay = await api("POST", `/api/inventory/items/${itemId}/bag-actions`, {
    token: adminToken,
    body: writePayload,
  });
  assert.equal(replay.status, 201, JSON.stringify(replay.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 3);
  assert.equal(db.prepare("SELECT quantity_remaining FROM inventory_batches WHERE id = ?").get(batchId).quantity_remaining, 3);
  const movement = db.prepare("SELECT * FROM inventory_movements WHERE item_id = ? AND action_type = 'wastage'").get(itemId);
  assert.ok(movement?.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movement_allocations WHERE movement_id = ?").get(movement.id).count, 1);

  const reversePayload = {
    operation_id: `reverse-write-off-${Date.now()}`,
    reason: "Write-off was posted against the wrong physical package",
    confirm: true,
  };
  const reversed = await api("POST", `/api/inventory/movements/${movement.id}/reverse-write-off`, {
    token: adminToken,
    body: reversePayload,
  });
  assert.equal(reversed.status, 201, JSON.stringify(reversed.data));
  const reverseReplay = await api("POST", `/api/inventory/movements/${movement.id}/reverse-write-off`, {
    token: adminToken,
    body: reversePayload,
  });
  assert.equal(reverseReplay.status, 201, JSON.stringify(reverseReplay.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 5);
  assert.equal(db.prepare("SELECT quantity_remaining FROM inventory_batches WHERE id = ?").get(batchId).quantity_remaining, 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id = ? AND action_type = 'reversal'").get(itemId).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_audit_logs WHERE action_type = 'reverse_write_off' AND item_id = ?").get(itemId).count, 1);
});

test("expired warehouse stock can be written off at exact batch cost and reversed", async () => {
  const itemId = insertOcsItem({ name: `Expired reconcile ${Date.now()}`, qty: 4, expiry: "2020-01-01" });
  db.prepare("UPDATE inventory SET cost_price = 999 WHERE id = ?").run(itemId);
  db.prepare("UPDATE inventory_batches SET unit_cost = 13 WHERE item_id = ?").run(itemId);
  const writtenOff = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
    token: operatorToken,
    body: {
      operation_id: `expired-write-off-${Date.now()}`,
      action_type: "remove",
      quantity: 2,
      reason: "Expired",
      confirm: true,
    },
  });
  assert.equal(writtenOff.status, 201, JSON.stringify(writtenOff.data));
  const movement = db.prepare("SELECT * FROM inventory_movements WHERE item_id = ? AND action_type = 'remove' ORDER BY id DESC LIMIT 1").get(itemId);
  assert.equal(Number(movement.unit_cost_snapshot), 13);
  assert.equal(db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movement_allocations WHERE movement_id = ?").get(movement.id).quantity, 2);
  const reversed = await api("POST", `/api/inventory/movements/${movement.id}/reverse-write-off`, {
    token: adminToken,
    body: {
      operation_id: `expired-reversal-${Date.now()}`,
      reason: "Expired write-off selected the wrong physical units",
      confirm: true,
    },
  });
  assert.equal(reversed.status, 201, JSON.stringify(reversed.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 4);
});

test("bulk write-off is admin-only explicit versioned evidenced and batch-valued", async () => {
  const itemId = insertOcsItem({ name: `Bulk safe ${Date.now()}`, qty: 5, expiry: "2020-02-01" });
  db.prepare("UPDATE inventory SET cost_price = 250 WHERE id = ?").run(itemId);
  db.prepare("UPDATE inventory_batches SET unit_cost = 6.5 WHERE item_id = ?").run(itemId);
  const row = db.prepare("SELECT row_version FROM inventory WHERE id = ?").get(itemId);
  const payload = {
    operation_id: `bulk-safe-${Date.now()}`,
    items: [{ item_id: itemId, quantity: 2, expected_version: Number(row.row_version) }],
    reason: "Expired",
    note: "Expired units isolated during the monthly physical count",
    override_reason: "Administrator approved the documented bulk reconciliation",
    confirm: true,
  };
  const operatorDenied = await api("POST", "/api/inventory/bulk/remove", { token: operatorToken, body: payload });
  assert.equal(operatorDenied.status, 403);
  const removed = await api("POST", "/api/inventory/bulk/remove", { token: adminToken, body: payload });
  assert.equal(removed.status, 201, JSON.stringify(removed.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 3);
  const movement = db.prepare("SELECT * FROM inventory_movements WHERE item_id = ? AND action_type = 'remove' ORDER BY id DESC LIMIT 1").get(itemId);
  assert.equal(Number(movement.unit_cost_snapshot), 6.5);
  assert.equal(db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movement_allocations WHERE movement_id = ?").get(movement.id).quantity, 2);
});

test("depot transfers preserve actual batch cost on both movement sides", async () => {
  const itemId = insertOcsItem({ name: `Transfer value ${Date.now()}`, qty: 5, expiry: "2031-03-01" });
  db.prepare("UPDATE inventory SET cost_price = 777 WHERE id = ?").run(itemId);
  db.prepare("UPDATE inventory_batches SET unit_cost = 7.25 WHERE item_id = ?").run(itemId);
  const transferred = await api("POST", "/api/inventory/restock", {
    token: operatorToken,
    body: {
      operation_id: `transfer-value-${Date.now()}`,
      ocs_item_id: itemId,
      doctor_id: doctorId,
      quantity: 2,
      note: "Verified cost transfer",
    },
  });
  assert.equal(transferred.status, 201, JSON.stringify(transferred.data));
  const movements = db.prepare(`
    SELECT * FROM inventory_movements
    WHERE action_type IN ('restock_out', 'restock_in')
      AND json_extract(meta_json, '$.transaction_id') = ?
    ORDER BY id
  `).all(transferred.data.restock_receipt.transaction_id);
  assert.equal(movements.length, 2);
  assert.deepEqual(movements.map((movement) => Number(movement.unit_cost_snapshot)), [7.25, 7.25]);
  for (const movement of movements) {
    assert.equal(db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM inventory_movement_allocations WHERE movement_id = ?").get(movement.id).quantity, 2);
  }
  const sourceBatch = db.prepare("SELECT id FROM inventory_batches WHERE item_id = ? ORDER BY id LIMIT 1").get(itemId);
  const doctorBatch = db.prepare(`
    SELECT batch.source_batch_id
    FROM inventory_batches batch
    JOIN inventory item ON item.id = batch.item_id
    WHERE item.stock_scope = 'doctor'
      AND item.owner_doctor_id = ?
      AND batch.source_batch_id = ?
    ORDER BY batch.id DESC
    LIMIT 1
  `).get(doctorId, sourceBatch.id);
  assert.equal(Number(doctorBatch.source_batch_id), Number(sourceBatch.id));
});

test("depot transfer never restores stock into an archived doctor-bag row", async () => {
  const name = `Archived destination ${Date.now()}`;
  const sourceId = insertOcsItem({ name, qty: 3, expiry: "2032-04-01" });
  const source = db.prepare("SELECT * FROM inventory WHERE id = ?").get(sourceId);
  const archivedId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, stock_scope, owner_doctor_id, quantity, minimum_quantity,
      unit, cost_price, selling_price, archived_at
    ) VALUES (?, ?, 'doctor', ?, 0, 0, 'unit', 5, 10, CURRENT_TIMESTAMP)
  `).run(name, source.folder_id, doctorId).lastInsertRowid);

  const transferred = await api("POST", "/api/inventory/restock", {
    token: operatorToken,
    body: {
      operation_id: `archived-destination-${randomUUID()}`,
      ocs_item_id: sourceId,
      doctor_id: doctorId,
      quantity: 1,
      note: "Create a visible active destination",
    },
  });
  assert.equal(transferred.status, 201, JSON.stringify(transferred.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(archivedId).quantity, 0);
  const active = db.prepare(`
    SELECT id, quantity FROM inventory
    WHERE stock_scope = 'doctor' AND owner_doctor_id = ? AND folder_id = ? AND item_name = ?
      AND archived_at IS NULL
  `).get(doctorId, source.folder_id, name);
  assert.ok(active);
  assert.notEqual(Number(active.id), archivedId);
  assert.equal(Number(active.quantity), 1);
});

test("reserved batches are revalidated for quarantine expiry and optimistic version at collection", async () => {
  const itemName = `Reserved safety ${Date.now()}`;
  const itemId = insertOcsItem({ name: itemName, qty: 3, expiry: "2032-03-01" });
  const request = await createAcceptedRequest({ itemId, itemName, quantity: 1 });
  await pickAndReady(request.id);
  const batchId = Number(request.fulfilment.items[0].allocations[0].batch_id);
  const before = db.prepare("SELECT * FROM inventory_batches WHERE id = ?").get(batchId);
  db.prepare(`
    UPDATE inventory_batches
    SET status = 'quarantined', quarantined_reason = 'Supplier recall', row_version = row_version + 1
    WHERE id = ?
  `).run(batchId);
  const quarantined = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(quarantined.status, 409, JSON.stringify(quarantined.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 3);
  assert.equal(db.prepare("SELECT status FROM restock_requests WHERE id = ?").get(request.id).status, "ready");

  db.prepare(`
    UPDATE inventory_batches
    SET status = 'usable', expiry_date = '2020-01-01', row_version = row_version + 1
    WHERE id = ?
  `).run(batchId);
  const expired = await api("PATCH", `/api/restock-requests/${request.id}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(expired.status, 409, JSON.stringify(expired.data));
  assert.equal(db.prepare("SELECT quantity_remaining FROM inventory_batches WHERE id = ?").get(batchId).quantity_remaining, before.quantity_remaining);
});

test("negative stocktake reconciles unusable batches at their exact recorded cost", async () => {
  const itemId = insertOcsItem({ name: `Count expired ${Date.now()}`, qty: 4, expiry: "2020-01-01" });
  db.prepare("UPDATE inventory SET cost_price = 999 WHERE id = ?").run(itemId);
  db.prepare("UPDATE inventory_batches SET unit_cost = 13, status = 'quarantined' WHERE item_id = ?").run(itemId);
  const created = await startStocktakeSession({ item_ids: [itemId] });
  const sessionId = created.data.session.id;
  await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}`, {
    token: operatorToken,
    body: { lines: [{ id: created.data.session.items[0].id, physical_quantity: 2, reason: "Expired units missing during count" }] },
  });
  const explained = await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}/new-lots`, {
    token: operatorToken,
    body: { lines: [{ id: created.data.session.items[0].id, shortage_reason: "expired" }] },
  });
  assert.equal(explained.status, 200, JSON.stringify(explained.data));
  await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, { token: operatorToken });
  await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/review`, {
    token: adminToken,
    body: { decision: "approved" },
  });
  const applied = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/apply`, {
    token: adminToken,
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  const movement = db.prepare(`
    SELECT * FROM inventory_movements
    WHERE item_id = ? AND json_extract(meta_json, '$.stocktake_session_id') = ?
  `).get(itemId, sessionId);
  assert.equal(Number(movement.unit_cost_snapshot), 13);
  assert.equal(Number(db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity
    FROM inventory_movement_allocations WHERE movement_id = ?
  `).get(movement.id).quantity), 2);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 2);
});

test("inventory summaries are location-scoped and activity filters use Mauritius dates", async () => {
  const warehouseBefore = await api("GET", "/api/inventory", { token: adminToken });
  const doctorBefore = await api("GET", `/api/inventory?doctorId=${doctorId}`, { token: adminToken });
  const warehouseItemId = insertOcsItem({ name: `Scoped warehouse ${Date.now()}`, qty: 1 });
  const doctorItemId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price,
      stock_scope, owner_doctor_id
    ) VALUES (?, ?, 1, 0, 'unit', 222, 300, 'doctor', ?)
  `).run(`Scoped bag ${Date.now()}`, folderId, doctorId).lastInsertRowid);
  db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity,
      action_type, unit_cost_snapshot, created_at
    ) VALUES (?, 'in', 1, 0, 1, 'add', 111, '2026-09-17 21:30:00')
  `).run(warehouseItemId);
  db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity,
      action_type, unit_cost_snapshot, created_at
    ) VALUES (?, 'in', 1, 0, 1, 'restock_in', 222, '2026-09-17 21:30:00')
  `).run(doctorItemId);
  const warehouseAfter = await api("GET", "/api/inventory", { token: adminToken });
  const doctorAfter = await api("GET", `/api/inventory?doctorId=${doctorId}`, { token: adminToken });
  assert.equal(
    Number(warehouseAfter.data.summary.total_monthly_replenishments_rs) - Number(warehouseBefore.data.summary.total_monthly_replenishments_rs),
    111,
  );
  assert.equal(
    Number(doctorAfter.data.summary.total_monthly_replenishments_rs) - Number(doctorBefore.data.summary.total_monthly_replenishments_rs),
    222,
  );
  const localDay = await api("GET", "/api/inventory?dateFrom=2026-09-18&dateTo=2026-09-18", {
    token: adminToken,
  });
  assert.equal(localDay.status, 200, JSON.stringify(localDay.data));
  assert.ok(localDay.data.movements.some((row) => Number(row.item_id) === warehouseItemId));
});

test("doctor comparison reports net sale reversals on the original business date", async () => {
  const businessDate = offsetLocalDate(-1);
  const before = await api("GET", `/api/inventory?doctorId=${doctorId}&dateFrom=${businessDate}&dateTo=${businessDate}`, {
    token: adminToken,
  });
  assert.equal(before.status, 200, JSON.stringify(before.data));
  const beforeRow = before.data.compare_rows.find((row) => Number(row.doctor_id) === Number(doctorId));
  const baselineQty = Number(beforeRow?.consumed_sales_qty || 0);
  const baselineValue = Number(beforeRow?.consumed_sales || 0);

  const stock = seedDoctorBillableItem({
    name: `Reversal report ${Date.now()}`,
    batches: [{ qty: 2, expiry: "2032-05-01" }],
  });
  const original = db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
      action_type, meta_json, unit_cost_snapshot, unit_price_snapshot
    ) VALUES (?, 'out', 1, 2, 1, ?, 'stock_out', ?, 8, 12)
  `).run(stock.itemId, doctorId, JSON.stringify({ stock_out_reason: "Sale", dispensed_on: businessDate }));
  db.prepare(`
    INSERT INTO inventory_movements (
      item_id, movement_type, quantity, previous_quantity, next_quantity, doctor_id,
      action_type, meta_json, unit_cost_snapshot, unit_price_snapshot
    ) VALUES (?, 'in', 1, 1, 2, ?, 'reversal', ?, 8, 12)
  `).run(stock.itemId, doctorId, JSON.stringify({
    reversed_movement_id: Number(original.lastInsertRowid),
    original_action_type: "stock_out",
    stock_out_reason: "Sale",
  }));

  const after = await api("GET", `/api/inventory?doctorId=${doctorId}&dateFrom=${businessDate}&dateTo=${businessDate}`, {
    token: adminToken,
  });
  assert.equal(after.status, 200, JSON.stringify(after.data));
  const afterRow = after.data.compare_rows.find((row) => Number(row.doctor_id) === Number(doctorId));
  assert.equal(Number(afterRow?.consumed_sales_qty || 0), baselineQty);
  assert.equal(Number(afterRow?.consumed_sales || 0), baselineValue);
});

test("nearest usable expiry ignores quarantined lots and includes unpriced dated lots", () => {
  const itemId = insertOcsItem({ name: `Expiry display ${Date.now()}`, qty: 0 });
  db.prepare("UPDATE inventory SET quantity = 3 WHERE id = ?").run(itemId);
  db.prepare("DELETE FROM inventory_batches WHERE item_id = ?").run(itemId);
  db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status)
    VALUES (?, 1, '2027-01-01', 5, 0, 'quarantined'),
           (?, 1, '2027-02-01', 0, 0, 'usable'),
           (?, 1, '2027-03-01', 5, 0, 'usable')
  `).run(itemId, itemId, itemId);
  const decorated = decorateInventoryItems([db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId)])[0];
  assert.equal(decorated.nearest_usable_expiry, "2027-02-01");
  assert.equal(Number(decorated.available_to_use), 2);
});

test("direct sale accepts a billable visit and rejects it after payment without another deduction", async () => {
  const { patientId, consultationId } = seedConsultationForBilling();
  const stock = seedDoctorBillableItem({
    name: `Paid visit direct sale ${Date.now()}`,
    batches: [{ qty: 3, expiry: "2031-05-01" }],
  });
  const before = db.prepare("SELECT quantity, row_version FROM inventory WHERE id = ?").get(stock.itemId);
  const accepted = await api("POST", `/api/inventory/items/${stock.itemId}/actions`, {
    token: doctorToken,
    body: {
      operation_id: `billable-visit-sale-${Date.now()}`,
      action_type: "stock_out",
      quantity: 1,
      reason: "Sale",
      patient_id: patientId,
      consultation_id: consultationId,
      expected_version: Number(before.row_version),
    },
  });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(stock.itemId).quantity, 2);
  db.prepare(`
    INSERT INTO billing (consultation_id, patient_id, items, total_amount, status, finalized_at)
    VALUES (?, ?, '[]', 0, 'paid', CURRENT_TIMESTAMP)
  `).run(consultationId, patientId);
  const afterFirstSale = db.prepare("SELECT row_version FROM inventory WHERE id = ?").get(stock.itemId);
  const rejected = await api("POST", `/api/inventory/items/${stock.itemId}/actions`, {
    token: doctorToken,
    body: {
      operation_id: `paid-visit-sale-${Date.now()}`,
      action_type: "stock_out",
      quantity: 1,
      reason: "Sale",
      patient_id: patientId,
      consultation_id: consultationId,
      expected_version: Number(afterFirstSale.row_version),
    },
  });
  assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
  assert.equal(rejected.data.code, "CONSULTATION_NOT_BILLABLE");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(stock.itemId).quantity, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id = ?").get(stock.itemId).count, 1);
});

test("direct sale date is bound to the consultation, cutover and open finance day", async () => {
  const { patientId, consultationId } = seedConsultationForBilling();
  const consultationDate = db.prepare("SELECT consultation_date FROM consultations WHERE id = ?").get(consultationId).consultation_date;
  const stock = seedDoctorBillableItem({
    name: `Date-bound direct sale ${Date.now()}`,
    batches: [{ qty: 3, expiry: "2031-06-01" }],
  });
  const version = () => Number(db.prepare("SELECT row_version FROM inventory WHERE id = ?").get(stock.itemId).row_version);
  const wrongDate = offsetLocalDate(-1);
  const mismatch = await api("POST", `/api/inventory/items/${stock.itemId}/actions`, {
    token: doctorToken,
    body: {
      operation_id: `date-mismatch-${randomUUID()}`,
      action_type: "stock_out",
      quantity: 1,
      reason: "Sale",
      patient_id: patientId,
      consultation_id: consultationId,
      dispensed_on: wrongDate,
      expected_version: version(),
    },
  });
  assert.equal(mismatch.status, 409, JSON.stringify(mismatch.data));
  assert.equal(mismatch.data.code, "DIRECT_SALE_DATE_MISMATCH");

  const previousCutover = db.prepare("SELECT cutover_date FROM billing_system_settings WHERE id = 1").get()?.cutover_date || "";
  db.prepare(`
    INSERT INTO billing_system_settings (id, cutover_date)
    VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET cutover_date = excluded.cutover_date
  `).run(offsetLocalDate(1));
  try {
    const beforeCutover = await api("POST", `/api/inventory/items/${stock.itemId}/actions`, {
      token: doctorToken,
      body: {
        operation_id: `cutover-block-${randomUUID()}`,
        action_type: "stock_out",
        quantity: 1,
        reason: "Sale",
        patient_id: patientId,
        consultation_id: consultationId,
        dispensed_on: consultationDate,
        expected_version: version(),
      },
    });
    assert.equal(beforeCutover.status, 409, JSON.stringify(beforeCutover.data));
    assert.equal(beforeCutover.data.code, "BILLING_CUTOVER_NOT_REACHED");
  } finally {
    if (previousCutover) {
      db.prepare("UPDATE billing_system_settings SET cutover_date = ? WHERE id = 1").run(previousCutover);
    } else {
      db.prepare("DELETE FROM billing_system_settings WHERE id = 1").run();
    }
  }
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(stock.itemId).quantity, 3);
});

test("shipment import replays one operation and rejects a duplicate supplier delivery note", async () => {
  const consumable = db.prepare("SELECT id FROM inventory_folders WHERE name = 'Consumable'").get().id;
  const name = `Import replay ${Date.now()}`;
  insertOcsItem({ name, qty: 0, folder: consumable });
  const body = {
    operation_id: `shipment-replay-${randomUUID()}`,
    supplier: "Replay Supplier",
    delivery_note: `REPLAY-DN-${Date.now()}`,
    csv_text: [
      "folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date",
      `Consumable,${name},2,0,unit,1,2,2029-01-01`,
    ].join("\n"),
  };
  const first = await api("POST", "/api/inventory/staging/import-csv", { token: operatorToken, body });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const replay = await api("POST", "/api/inventory/staging/import-csv", { token: operatorToken, body });
  assert.equal(replay.status, 201, JSON.stringify(replay.data));
  assert.equal(replay.data.import_summary.shipment_id, first.data.import_summary.shipment_id);
  const duplicate = await api("POST", "/api/inventory/staging/import-csv", {
    token: operatorToken,
    body: { ...body, operation_id: `shipment-duplicate-${randomUUID()}` },
  });
  assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));
  assert.equal(duplicate.data.code, "DUPLICATE_SHIPMENT_DELIVERY_NOTE");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_shipments WHERE supplier = ? AND delivery_note = ?").get(body.supplier, body.delivery_note).count, 1);
});

test("inventory mutation and idempotency receipt roll back together", async () => {
  const itemId = insertOcsItem({ name: `Atomic receipt ${Date.now()}`, qty: 2 });
  const before = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  const operationId = `forced-receipt-failure-${Date.now()}`;
  db.exec(`
    CREATE TRIGGER fail_selected_inventory_receipt
    BEFORE INSERT ON operation_receipts
    WHEN NEW.operation_id = '${operationId}'
    BEGIN
      SELECT RAISE(ABORT, 'forced receipt failure');
    END;
  `);
  try {
    const failed = await api("POST", `/api/inventory/items/${itemId}/ocs-actions`, {
      token: operatorToken,
      body: {
        operation_id: operationId,
        action_type: "stock_in",
        quantity: 1,
        expiry_date: "2032-01-01",
      },
    });
    assert.equal(failed.status, 400, JSON.stringify(failed.data));
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, before);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id = ? AND action_type = 'stock_in'").get(itemId).count, 0);
  } finally {
    db.exec("DROP TRIGGER IF EXISTS fail_selected_inventory_receipt");
  }
});

test("doctors cannot write off bag stock through the doctor action API", async () => {
  const bagId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
         VALUES (?, ?, 4, 0, 'unit', 5, 10, 'doctor', ?)`,
      )
      .run(`NoRemove ${Date.now()}`, folderId, doctorId).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, 4, '2029-01-01', 5, 0)`,
  ).run(bagId);
  const denied = await api("POST", `/api/inventory/items/${bagId}/actions`, {
    token: doctorToken,
    body: { action_type: "remove", quantity: 1, reason: "Damaged", confirm: true, note: "trying to write off" },
  });
  assert.equal(denied.status, 400, JSON.stringify(denied.data));
  assert.match(String(denied.data.error || ""), /sale, wastage, or expiry/i);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(bagId).quantity, 4);
});

test("operators can count a doctor bag with the stocktake flow", async () => {
  const bagId = Number(
    db
      .prepare(
        `INSERT INTO inventory (item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price, stock_scope, owner_doctor_id)
         VALUES (?, ?, 7, 0, 'unit', 5, 10, 'doctor', ?)`,
      )
      .run(`BagCount ${Date.now()}`, folderId, doctorId).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
     VALUES (?, 7, '2029-01-01', 5, 0)`,
  ).run(bagId);
  const preview = await api("GET", `/api/inventory/stocktake/scope?doctor_id=${doctorId}`, { token: operatorToken });
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(Number(preview.data.owner_doctor_id), Number(doctorId));
  assert.ok(Number(preview.data.item_count) >= 1);
  const created = await startStocktakeSession({ doctor_id: doctorId, confirm_all: true });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(Number(created.data.session.owner_doctor_id), Number(doctorId));
  assert.ok((created.data.session.items || []).some((row) => Number(row.inventory_id) === bagId));
  const listed = await api("GET", "/api/inventory", { token: operatorToken });
  const session = (listed.data.stocktake_sessions || []).find((row) => Number(row.id) === Number(created.data.session.id));
  assert.ok(session);
  assert.match(String(session.folder_name || ""), /bag/i);
});

test("operators can add expiry and cost to opening lots", async () => {
  const itemId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, quantity, minimum_quantity, unit, cost_price, selling_price,
      stock_scope, owner_doctor_id
    ) VALUES (?, ?, 2, 0, 'unit', 0, 20, 'ocs', NULL)
  `).run(`Operator opening ${Date.now()}`, folderId).lastInsertRowid);
  const batchId = Number(db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring)
    VALUES (?, 2, NULL, 0, 0)
  `).run(itemId).lastInsertRowid);
  const verified = await api("PATCH", `/api/inventory/batches/${batchId}/opening-data`, {
    token: operatorToken,
    body: {
      operation_id: `operator-opening-${Date.now()}`,
      unit_cost: 9,
      expiry_date: "2031-12-31",
      is_non_expiring: false,
      expected_row_version: 1,
      reason: "Operator verified invoice and pack label",
      confirm: true,
    },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  const after = decorateInventoryItems([db.prepare("SELECT * FROM inventory WHERE id = ?").get(itemId)])[0];
  assert.equal(after.available_to_use, 2);
  assert.equal(after.valuation_complete, true);
});

test("a completed batch expiry and cost can be corrected", async () => {
  const itemId = insertOcsItem({ name: `Correct expiry ${Date.now()}`, qty: 10, expiry: "2027-03-21" });
  const batch = db.prepare("SELECT id, row_version FROM inventory_batches WHERE item_id = ?").get(itemId);
  const corrected = await api("PATCH", `/api/inventory/batches/${batch.id}/opening-data`, {
    token: operatorToken,
    body: {
      operation_id: `correct-expiry-${Date.now()}`,
      unit_cost: 18,
      expiry_date: "2028-01-01",
      is_non_expiring: false,
      expected_row_version: Number(batch.row_version || 1),
      reason: "Package label shows 1 Jan 2028 and invoice cost 18",
      confirm: true,
    },
  });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
  const stored = db.prepare("SELECT expiry_date, unit_cost FROM inventory_batches WHERE id = ?").get(batch.id);
  assert.equal(String(stored.expiry_date || "").slice(0, 10), "2028-01-01");
  assert.equal(Number(stored.unit_cost), 18);
  const audit = db.prepare(`
    SELECT meta_json FROM inventory_audit_logs
    WHERE action_type = 'verify_opening_batch_data' AND item_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(itemId);
  const meta = JSON.parse(audit.meta_json);
  assert.equal(String(meta.previous_expiry_date || "").slice(0, 10), "2027-03-21");
  assert.equal(String(meta.verified_expiry_date || "").slice(0, 10), "2028-01-01");
});

test("an open stock count can be cancelled or finished without counting every item", async () => {
  const keep = insertOcsItem({ name: `Partial keep ${Date.now()}`, qty: 4 });
  const skip = insertOcsItem({ name: `Partial skip ${Date.now()}`, qty: 7 });
  const started = await startStocktakeSession({ item_ids: [keep, skip] });
  assert.equal(started.status, 201, JSON.stringify(started.data));
  const sessionId = started.data.session.id;
  const keepLine = started.data.session.items.find((line) => Number(line.inventory_id) === keep);

  const blocked = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, {
    token: operatorToken,
  });
  assert.equal(blocked.status, 400);

  const emptyFinish = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, {
    token: operatorToken,
    body: { finish_counted: true },
  });
  assert.equal(emptyFinish.status, 400);

  const saved = await api("PATCH", `/api/inventory/stocktake/sessions/${sessionId}`, {
    token: operatorToken,
    body: { lines: [{ id: keepLine.id, physical_quantity: 4 }] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const finished = await api("POST", `/api/inventory/stocktake/sessions/${sessionId}/submit`, {
    token: operatorToken,
    body: { finish_counted: true },
  });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(finished.data.session.status, "submitted");
  assert.equal(finished.data.session.left_unchanged_count, 1);
  const skippedLine = finished.data.session.items.find((line) => Number(line.inventory_id) === skip);
  assert.equal(skippedLine.left_unchanged, true);
  assert.equal(skippedLine.physical_quantity, null);
  assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(skip).quantity), 7);
  assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(keep).quantity), 4);

  const otherA = insertOcsItem({ name: `Cancel A ${Date.now()}`, qty: 2 });
  const otherB = insertOcsItem({ name: `Cancel B ${Date.now()}`, qty: 9 });
  const open = await startStocktakeSession({ item_ids: [otherA, otherB] });
  assert.equal(open.status, 201, JSON.stringify(open.data));
  const cancelled = await api("POST", `/api/inventory/stocktake/sessions/${open.data.session.id}/cancel`, {
    token: operatorToken,
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.session.status, "cancelled");
  assert.match(String(cancelled.data.session.review_reason || ""), /not applied to stock/i);
  assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(otherA).quantity), 2);
  assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(otherB).quantity), 9);
  const again = await api("POST", `/api/inventory/stocktake/sessions/${open.data.session.id}/cancel`, {
    token: operatorToken,
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.session.status, "cancelled");

  db.prepare("UPDATE inventory_stocktake_sessions SET status = 'applied' WHERE id = ?").run(open.data.session.id);
  const late = await api("POST", `/api/inventory/stocktake/sessions/${open.data.session.id}/cancel`, {
    token: operatorToken,
  });
  assert.equal(late.status, 400);
});
