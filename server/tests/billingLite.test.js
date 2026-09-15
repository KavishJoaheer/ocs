"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-billing-lite-"));
process.env.DB_PATH = path.join(tempDir, "test.db");
process.env.NODE_ENV = "test";

const { createApp } = require("../src/app");
const { db, ensureBillingForConsultation } = require("../src/db");
const { hashPassword } = require("../src/lib/security");
const { getTodayLocal } = require("../src/lib/utils");

let server;
let baseUrl;
let doctorToken;
let otherDoctorToken;
let operatorToken;
let doctorId;
let otherDoctorId;
let consultationId;
let patientIdentifier;
let itemId;

async function api(method, route, token = doctorToken, body) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

function createDoctor(username, fullName) {
  const created = db
    .prepare("INSERT INTO doctors (full_name, specialization) VALUES (?, 'General Practice')")
    .run(fullName);
  const nextDoctorId = Number(created.lastInsertRowid);
  db.prepare("INSERT INTO users (username, full_name, password_hash, role, doctor_id) VALUES (?, ?, ?, 'doctor', ?)")
    .run(username, fullName, hashPassword("BillingLite!2026"), nextDoctorId);
  return nextDoctorId;
}

async function login(username) {
  const result = await api("POST", "/auth/login", null, {
    username,
    password: "BillingLite!2026",
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.token;
}

before(async () => {
  const app = createApp();
  doctorId = createDoctor("billing.lite.doctor", "Priya Xavier");
  otherDoctorId = createDoctor("billing.lite.other", "Other Clinician");
  db.prepare("INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, 'operator')")
    .run("billing.lite.operator", "Billing Operator", hashPassword("BillingLite!2026"));

  const today = getTodayLocal();
  patientIdentifier = `OCS-${800000 + Math.floor(Math.random() * 10000)}`;
  const patientId = Number(
    db.prepare(`
      INSERT INTO patients (
        full_name, first_name, last_name, patient_identifier, age,
        contact_number, patient_contact_number, address, assigned_doctor_id
      ) VALUES ('Patient Example', 'Patient', 'Example', ?, 42, '57000000', '57000000', 'Test address', ?)
    `).run(patientIdentifier, doctorId).lastInsertRowid,
  );
  const appointmentId = Number(
    db.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status) VALUES (?, ?, ?, '21:30', 'completed')")
      .run(patientId, doctorId, today).lastInsertRowid,
  );
  consultationId = Number(
    db.prepare("INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes) VALUES (?, ?, ?, ?, 'Billing Lite test')")
      .run(appointmentId, patientId, doctorId, today).lastInsertRowid,
  );
  ensureBillingForConsultation(consultationId, patientId, null, "Night Consultation");

  const folderId = Number(db.prepare("SELECT id FROM inventory_folders ORDER BY id DESC LIMIT 1").get().id);
  itemId = Number(
    db.prepare(`
      INSERT INTO inventory (
        item_name, folder_id, owner_doctor_id, stock_scope, quantity,
        minimum_quantity, unit, cost_price, selling_price
      ) VALUES ('Normal saline test', ?, ?, 'doctor', 8, 1, 'bag', 30, 75)
    `).run(folderId, doctorId).lastInsertRowid,
  );
  db.prepare("INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status) VALUES (?, 8, '2032-12-31', 30, 0, 'usable')")
    .run(itemId);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  doctorToken = await login("billing.lite.doctor");
  otherDoctorToken = await login("billing.lite.other");
  operatorToken = await login("billing.lite.operator");
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("Billing Lite exposes only masked visits belonging to the signed-in doctor", async () => {
  const today = await api("GET", "/billing/quick/visits");
  assert.equal(today.status, 200, JSON.stringify(today.data));
  const visit = today.data.visits.find((row) => row.consultation_id === consultationId);
  assert.ok(visit);
  assert.equal(visit.patient_identifier, patientIdentifier);
  assert.match(visit.patient_masked_name, /^P•+ E•+$/);
  assert.equal(JSON.stringify(visit).includes("Patient Example"), false);
  assert.equal(visit.consultation_fee.type, "Night Consultation");
  assert.equal(visit.consultation_fee.amount, 3000);

  const denied = await api("GET", `/billing/quick/lookup?reference=V-${consultationId}`, otherDoctorToken);
  assert.equal(denied.status, 404);
});

test("Billing Lite resolves OCS numbers without requiring a hyphen", async () => {
  const compact = patientIdentifier.replace("-", "");
  const lookup = await api("GET", `/billing/quick/lookup?reference=${compact}`);
  assert.equal(lookup.status, 200, JSON.stringify(lookup.data));
  assert.equal(lookup.data.visits[0].consultation_id, consultationId);
});

test("Billing Lite atomically appends supplies, deducts stock, and prevents retry duplication", async () => {
  const catalog = await api("GET", `/billing/quick/catalog/${consultationId}`);
  assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
  assert.ok(catalog.data.items.some((item) => item.id === itemId));

  const operationId = randomUUID();
  const body = {
    operation_id: operationId,
    items: [{ inventory_item_id: itemId, quantity: 2 }],
  };
  const captured = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, body);
  assert.equal(captured.status, 201, JSON.stringify(captured.data));
  assert.equal(captured.data.submission.item_count, 2);
  assert.equal(captured.data.submission.amount_added, 150);
  assert.equal(captured.data.visit.bill_total, 3150);
  assert.equal(captured.data.visit.submission_status, "awaiting_operator");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 6);

  const retried = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, body);
  assert.equal(retried.status, 201, JSON.stringify(retried.data));
  assert.equal(retried.data.submission.submission_id, captured.data.submission.submission_id);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 6);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM billing_lite_submissions WHERE consultation_id = ?").get(consultationId).count,
    1,
  );
});

test("operator review status is independent from paid or unpaid bill status", async () => {
  const queue = await api("GET", "/billing/quick/operator-queue", operatorToken);
  assert.equal(queue.status, 200, JSON.stringify(queue.data));
  const submission = queue.data.submissions.find((row) => row.consultation_id === consultationId);
  assert.ok(submission);
  assert.equal(submission.bill_status, "unpaid");
  assert.equal(submission.workflow_status, "awaiting_operator");

  const needsDoctor = await api(
    "PATCH",
    `/billing/quick/operator-queue/${consultationId}/status`,
    operatorToken,
    { status: "needs_doctor", note: "Confirm the saline quantity" },
  );
  assert.equal(needsDoctor.status, 200, JSON.stringify(needsDoctor.data));

  const visits = await api("GET", "/billing/quick/visits", doctorToken);
  const visit = visits.data.visits.find((row) => row.consultation_id === consultationId);
  assert.equal(visit.submission_status, "needs_doctor");
  assert.equal(visit.workflow_note, "Confirm the saline quantity");

  const ready = await api(
    "PATCH",
    `/billing/quick/operator-queue/${consultationId}/status`,
    operatorToken,
    { status: "ready_for_payment" },
  );
  assert.equal(ready.status, 200, JSON.stringify(ready.data));

  const forbidden = await api(
    "PATCH",
    `/billing/quick/operator-queue/${consultationId}/status`,
    otherDoctorToken,
    { status: "ready_for_payment" },
  );
  assert.equal(forbidden.status, 403);
});
