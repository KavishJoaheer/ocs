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
const { saveUserPushSubscription } = require("../src/lib/push");

let server;
let baseUrl;
let doctorToken;
let otherDoctorToken;
let operatorToken;
let accountantToken;
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
  db.prepare("INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, 'accountant')")
    .run("billing.lite.accountant", "Billing Accountant", hashPassword("BillingLite!2026"));

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
  accountantToken = await login("billing.lite.accountant");
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("Billing Lite exposes full patient names only for visits belonging to the signed-in doctor", async () => {
  const today = await api("GET", "/billing/quick/visits");
  assert.equal(today.status, 200, JSON.stringify(today.data));
  const visit = today.data.visits.find((row) => row.consultation_id === consultationId);
  assert.ok(visit);
  assert.equal(visit.patient_identifier, patientIdentifier);
  assert.equal(visit.patient_name, "Patient Example");
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

test("Billing Lite offers a patient-first picker scoped to the signed-in doctor's billable visits", async () => {
  const picker = await api("GET", "/billing/quick/picker-options");
  assert.equal(picker.status, 200, JSON.stringify(picker.data));

  const patient = picker.data.patients.find((row) => row.patient_identifier === patientIdentifier);
  assert.ok(patient);
  assert.equal(patient.patient_name, "Patient Example");
  assert.ok(patient.visits.some((visit) => visit.consultation_id === consultationId));
  assert.ok(patient.visits.every((visit) => visit.can_submit));

  const otherDoctor = await api("GET", "/billing/quick/picker-options", otherDoctorToken);
  assert.equal(otherDoctor.status, 200, JSON.stringify(otherDoctor.data));
  assert.equal(otherDoctor.data.patients.some((row) => row.patient_identifier === patientIdentifier), false);

  const operator = await api("GET", "/billing/quick/picker-options", operatorToken);
  assert.equal(operator.status, 200, JSON.stringify(operator.data));
  assert.ok(operator.data.doctors.some((row) => row.id === doctorId));
  assert.deepEqual(operator.data.patients, []);

  const operatorDoctor = await api(
    "GET",
    `/billing/quick/picker-options?doctorId=${doctorId}`,
    operatorToken,
  );
  assert.equal(operatorDoctor.status, 200, JSON.stringify(operatorDoctor.data));
  assert.ok(operatorDoctor.data.patients.some((row) => row.patient_identifier === patientIdentifier));
});

test("finance roles cannot issue quick billing or deduct doctor stock", async () => {
  const beforeQuantity = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  const denied = await api("POST", `/billing/quick/visits/${consultationId}/capture`, accountantToken, {
    operation_id: randomUUID(),
    consultation_fee: { type: "Night Consultation", amount: 3000 },
    items: [{ inventory_item_id: itemId, quantity: 1, unit_price: 75 }],
  });
  assert.equal(denied.status, 403, JSON.stringify(denied.data));
  assert.equal(denied.data.code, "QUICK_BILLING_ROLE_FORBIDDEN");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, beforeQuantity);
});

test("a reviewed quick bill stops when a supply price changed before sync", async () => {
  const beforeQuantity = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  const denied = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    consultation_fee: { type: "Night Consultation", amount: 3000 },
    items: [{ inventory_item_id: itemId, quantity: 1, unit_price: 70 }],
  });
  assert.equal(denied.status, 409, JSON.stringify(denied.data));
  assert.equal(denied.data.code, "BILLING_PRICE_CHANGED");
  assert.equal(denied.data.changed_prices[0].reviewed_price, 70);
  assert.equal(denied.data.changed_prices[0].current_price, 75);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, beforeQuantity);
});

test("operator quick billing requires the matching consultation doctor and paper reference", async () => {
  const patient = db.prepare("SELECT id FROM patients WHERE patient_identifier = ?").get(patientIdentifier);
  const today = getTodayLocal();
  const appointmentId = Number(
    db.prepare("INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status) VALUES (?, ?, ?, '18:00', 'completed')")
      .run(patient.id, doctorId, today).lastInsertRowid,
  );
  const operatorConsultationId = Number(
    db.prepare("INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes) VALUES (?, ?, ?, ?, 'Operator quick billing test')")
      .run(appointmentId, patient.id, doctorId, today).lastInsertRowid,
  );
  ensureBillingForConsultation(operatorConsultationId, patient.id, null, "Day Consultation");

  const missingDoctor = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    { operation_id: randomUUID(), source_reference: "PAPER-QB-1", items: [] },
  );
  assert.equal(missingDoctor.status, 400);
  assert.equal(missingDoctor.data.code, "BILLING_DOCTOR_REQUIRED");

  const wrongDoctor = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    { operation_id: randomUUID(), doctor_id: otherDoctorId, source_reference: "PAPER-QB-1", items: [] },
  );
  assert.equal(wrongDoctor.status, 409);
  assert.equal(wrongDoctor.data.code, "BILLING_DOCTOR_MISMATCH");

  const missingReference = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    { operation_id: randomUUID(), doctor_id: doctorId, items: [] },
  );
  assert.equal(missingReference.status, 400);

  const issued = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    {
      operation_id: randomUUID(),
      doctor_id: doctorId,
      source_reference: "PAPER-QB-1",
      consultation_fee: { type: "Day Consultation", amount: 2000 },
      items: [],
    },
  );
  assert.equal(issued.status, 201, JSON.stringify(issued.data));
  assert.equal(issued.data.visit.submission_status, "ready_for_payment");
  const bill = db.prepare("SELECT source_reference, issued_by_role FROM billing WHERE consultation_id = ?").get(operatorConsultationId);
  assert.equal(bill.source_reference, "PAPER-QB-1");
  assert.equal(bill.issued_by_role, "operator");

  const repeatedIssue = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    {
      operation_id: randomUUID(),
      doctor_id: doctorId,
      source_reference: "PAPER-QB-2",
      consultation_fee: { type: "Day Consultation", amount: 2000 },
      items: [],
    },
  );
  assert.equal(repeatedIssue.status, 409, JSON.stringify(repeatedIssue.data));
  assert.equal(repeatedIssue.data.code, "QUICK_BILLING_ALREADY_SUBMITTED");
  const pickerAfterIssue = await api(
    "GET",
    `/billing/quick/picker-options?doctorId=${doctorId}`,
    operatorToken,
  );
  assert.equal(pickerAfterIssue.status, 200, JSON.stringify(pickerAfterIssue.data));
  assert.equal(
    pickerAfterIssue.data.patients.flatMap((entry) => entry.visits || [])
      .some((visit) => visit.consultation_id === operatorConsultationId),
    false,
  );
});

test("Billing Lite atomically appends supplies, deducts stock, and prevents retry duplication", async () => {
  const catalog = await api("GET", `/billing/quick/catalog/${consultationId}`);
  assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
  assert.ok(catalog.data.items.some((item) => item.id === itemId));

  const operationId = randomUUID();
  const body = {
    operation_id: operationId,
    consultation_fee: {
      type: "Review Consultation",
      amount: 1750,
      adjustment_reason: "Reduced review tariff approved for this visit",
    },
    items: [{ inventory_item_id: itemId, quantity: 2 }],
  };
  const captured = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, body);
  assert.equal(captured.status, 201, JSON.stringify(captured.data));
  assert.equal(captured.data.submission.item_count, 2);
  assert.equal(captured.data.submission.amount_added, 150);
  assert.equal(captured.data.submission.consultation_fee.type, "Review Consultation");
  assert.equal(captured.data.submission.consultation_fee.amount, 1750);
  assert.equal(captured.data.submission.consultation_fee.changed, true);
  assert.equal(captured.data.visit.consultation_fee.type, "Review Consultation");
  assert.equal(captured.data.visit.consultation_fee.amount, 1750);
  assert.equal(captured.data.visit.bill_total, 1900);
  assert.equal(captured.data.visit.submission_status, "awaiting_operator");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 6);
  const billEvent = db.prepare("SELECT reason FROM billing_events WHERE bill_id = ? ORDER BY id DESC LIMIT 1").get(captured.data.submission.bill_id);
  assert.match(billEvent.reason, /Consultation fee adjusted/);
  const quickEvent = db.prepare("SELECT details_json FROM billing_quick_events WHERE submission_id = ? AND event_type = 'submitted'").get(captured.data.submission.submission_id);
  assert.equal(JSON.parse(quickEvent.details_json).consultation_fee.amount, 1750);

  const retried = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, body);
  assert.equal(retried.status, 201, JSON.stringify(retried.data));
  assert.equal(retried.data.submission.submission_id, captured.data.submission.submission_id);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 6);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM billing_lite_submissions WHERE consultation_id = ?").get(consultationId).count,
    1,
  );

  const filteredUpdates = await api(
    "GET",
    `/billing/quick/submissions?search=${encodeURIComponent(patientIdentifier)}&status=awaiting_operator&limit=10&offset=0`,
    doctorToken,
  );
  assert.equal(filteredUpdates.status, 200, JSON.stringify(filteredUpdates.data));
  assert.ok(filteredUpdates.data.total >= 1);
  assert.ok(filteredUpdates.data.submissions.every((entry) => entry.status === "awaiting_operator"));
  assert.ok(filteredUpdates.data.submissions.some((entry) => entry.consultation_id === consultationId));

  const duplicateOperation = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, {
    ...body,
    operation_id: randomUUID(),
  });
  assert.equal(duplicateOperation.status, 409, JSON.stringify(duplicateOperation.data));
  assert.equal(duplicateOperation.data.code, "QUICK_BILLING_ALREADY_SUBMITTED");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 6);
});

test("operator review status is independent from paid or unpaid bill status", async () => {
  const queue = await api("GET", "/billing/quick/operator-queue", operatorToken);
  assert.equal(queue.status, 200, JSON.stringify(queue.data));
  const submission = queue.data.submissions.find((row) => row.consultation_id === consultationId);
  assert.ok(submission);
  assert.equal(submission.bill_status, "unpaid");
  assert.equal(submission.workflow_status, "awaiting_operator");

  const webpush = require("web-push");
  const originalSend = webpush.sendNotification;
  const notifications = [];
  const doctorUserId = db.prepare("SELECT id FROM users WHERE username = 'billing.lite.doctor'").get().id;
  saveUserPushSubscription(doctorUserId, {
    endpoint: "https://example.invalid/billing-doctor",
    keys: { p256dh: "test", auth: "test" },
  });
  webpush.sendNotification = async (_subscription, payload) => {
    notifications.push(JSON.parse(payload));
    return { statusCode: 201 };
  };

  try {
    const needsDoctor = await api(
      "PATCH",
      `/billing/quick/operator-queue/${consultationId}/status`,
      operatorToken,
      {
        submission_id: submission.submission_id,
        expected_workflow_status: "awaiting_operator",
        status: "needs_doctor",
        note: "Confirm the saline quantity",
      },
    );
    assert.equal(needsDoctor.status, 200, JSON.stringify(needsDoctor.data));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].title, "Billing clarification needed");
    assert.match(notifications[0].body, /Confirm the saline quantity/);
  } finally {
    webpush.sendNotification = originalSend;
  }

  const visits = await api("GET", "/billing/quick/visits", doctorToken);
  const visit = visits.data.visits.find((row) => row.consultation_id === consultationId);
  assert.equal(visit.submission_status, "needs_doctor");
  assert.equal(visit.workflow_note, "Confirm the saline quantity");

  const ready = await api(
    "PATCH",
    `/billing/quick/operator-queue/${consultationId}/status`,
    operatorToken,
    {
      submission_id: submission.submission_id,
      expected_workflow_status: "needs_doctor",
      status: "ready_for_payment",
    },
  );
  assert.equal(ready.status, 200, JSON.stringify(ready.data));

  const forbidden = await api(
    "PATCH",
    `/billing/quick/operator-queue/${consultationId}/status`,
    otherDoctorToken,
    {
      submission_id: submission.submission_id,
      expected_workflow_status: "ready_for_payment",
      status: "ready_for_payment",
    },
  );
  assert.equal(forbidden.status, 403);
});

test("incorrect quick-billing supplies reverse stock and bill lines with an immutable audit trail", async () => {
  const submission = db.prepare("SELECT * FROM billing_lite_submissions WHERE consultation_id = ? ORDER BY id DESC LIMIT 1").get(consultationId);
  const operationId = randomUUID();
  const reversed = await api(
    "POST",
    `/billing/quick/submissions/${submission.id}/reverse`,
    operatorToken,
    { operation_id: operationId, reason: "Saline was entered twice" },
  );
  assert.equal(reversed.status, 200, JSON.stringify(reversed.data));
  assert.equal(reversed.data.reversed, 1);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 8);

  const bill = db.prepare("SELECT total_amount FROM billing WHERE id = ?").get(submission.billing_id);
  assert.equal(bill.total_amount, 1750);
  const audit = db.prepare("SELECT * FROM billing_quick_events WHERE submission_id = ? AND event_type = 'supplies_reversed'").get(submission.id);
  assert.ok(audit);
  assert.equal(audit.reason, "Saline was entered twice");
  assert.equal(audit.actor_role, "operator");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE action_type = 'reversal' AND item_id = ?").get(itemId).count, 1);
  const queueAfterReversal = await api("GET", "/billing/quick/operator-queue", operatorToken);
  assert.equal(queueAfterReversal.status, 200, JSON.stringify(queueAfterReversal.data));
  assert.equal(queueAfterReversal.data.submissions.some((row) => row.id === submission.id), false);
  const pickerAfterReversal = await api("GET", "/billing/quick/picker-options", doctorToken);
  const reopenedVisit = pickerAfterReversal.data.patients
    .flatMap((patient) => patient.visits || [])
    .find((visit) => visit.consultation_id === consultationId);
  assert.equal(reopenedVisit?.submission_status, "ready");

  const retry = await api(
    "POST",
    `/billing/quick/submissions/${submission.id}/reverse`,
    operatorToken,
    { operation_id: operationId, reason: "Saline was entered twice" },
  );
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 8);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE action_type = 'reversal' AND item_id = ?").get(itemId).count, 1);
});

test("a corrected doctor submission supersedes and clears an older clarification", async () => {
  const today = getTodayLocal();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const patientId = Number(db.prepare(`
    INSERT INTO patients (
      full_name, first_name, last_name, patient_identifier, age,
      contact_number, patient_contact_number, address, assigned_doctor_id
    ) VALUES (?, 'Clarification', 'Correction', ?, 35, '57000002', '57000002', 'Test address', ?)
  `).run(`Clarification correction ${suffix}`, `OCS-CLAR-${suffix}`, doctorId).lastInsertRowid);
  const appointmentId = Number(db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, '11:00', 'completed')
  `).run(patientId, doctorId, today).lastInsertRowid);
  const correctedConsultationId = Number(db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, ?, 'Clarification correction test')
  `).run(appointmentId, patientId, doctorId, today).lastInsertRowid);
  const baseInvoice = await api("POST", "/billing/test-support/create", doctorToken, {
    consultation_id: correctedConsultationId,
    patient_id: patientId,
    items: [{ description: "Day Consultation", type: "Sale", amount: 2000, quantity: 1, is_consultation_fee: true }],
    status: "unpaid",
    operation_id: randomUUID(),
  });
  assert.equal(baseInvoice.status, 201, JSON.stringify(baseInvoice.data));

  const first = await api("POST", `/billing/quick/visits/${correctedConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    consultation_fee: { type: "Day Consultation", amount: 2000 },
    items: [{ inventory_item_id: itemId, quantity: 1 }],
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const requested = await api(
    "PATCH",
    `/billing/quick/operator-queue/${correctedConsultationId}/status`,
    operatorToken,
    {
      submission_id: first.data.submission.submission_id,
      expected_workflow_status: "awaiting_operator",
      status: "needs_doctor",
      note: "Confirm the corrected supply quantity",
    },
  );
  assert.equal(requested.status, 200, JSON.stringify(requested.data));
  const corrected = await api("POST", `/billing/quick/visits/${correctedConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    consultation_fee: { type: "Day Consultation", amount: 2000 },
    items: [],
  });
  assert.equal(corrected.status, 201, JSON.stringify(corrected.data));
  assert.notEqual(corrected.data.submission.submission_id, first.data.submission.submission_id);
  const staleApproval = await api(
    "PATCH",
    `/billing/quick/operator-queue/${correctedConsultationId}/status`,
    operatorToken,
    {
      submission_id: first.data.submission.submission_id,
      expected_workflow_status: "needs_doctor",
      status: "ready_for_payment",
    },
  );
  assert.equal(staleApproval.status, 409, JSON.stringify(staleApproval.data));
  assert.equal(staleApproval.data.code, "STALE_BILLING_SUBMISSION");
  assert.equal(staleApproval.data.latest_submission_id, corrected.data.submission.submission_id);
  assert.equal(
    db.prepare("SELECT workflow_status FROM billing_lite_submissions WHERE id = ?").get(corrected.data.submission.submission_id).workflow_status,
    "awaiting_operator",
  );
  const superseded = db.prepare("SELECT workflow_status, workflow_note, reversed_at FROM billing_lite_submissions WHERE id = ?").get(first.data.submission.submission_id);
  assert.equal(superseded.workflow_status, "superseded");
  assert.equal(superseded.workflow_note, "");
  assert.ok(superseded.reversed_at);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 8);
  const correctedBill = db.prepare("SELECT items, total_amount FROM billing WHERE id = ?").get(baseInvoice.data.id);
  assert.equal(JSON.parse(correctedBill.items).filter((item) => Number(item.inventory_item_id) === itemId).length, 0);
  assert.equal(correctedBill.total_amount, 2000);
  assert.ok(db.prepare("SELECT 1 FROM billing_quick_events WHERE submission_id = ? AND event_type = 'clarification_superseded'").get(first.data.submission.submission_id));
});

test("a mixed reused and newly deducted supply line reverses completely without restoring dispensed stock", async () => {
  const today = getTodayLocal();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const patientId = Number(db.prepare(`
    INSERT INTO patients (
      full_name, first_name, last_name, patient_identifier, age,
      contact_number, patient_contact_number, address, assigned_doctor_id
    ) VALUES (?, 'Mixed', 'Reversal', ?, 35, '57000001', '57000001', 'Test address', ?)
  `).run(`Mixed reversal ${suffix}`, `OCS-MIX-${suffix}`, doctorId).lastInsertRowid);
  const appointmentId = Number(db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, '10:00', 'completed')
  `).run(patientId, doctorId, today).lastInsertRowid);
  const mixedConsultationId = Number(db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, ?, 'Mixed reversal regression')
  `).run(appointmentId, patientId, doctorId, today).lastInsertRowid);

  const folderId = Number(db.prepare("SELECT id FROM inventory_folders ORDER BY id DESC LIMIT 1").get().id);
  const mixedItemId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, owner_doctor_id, stock_scope, quantity,
      minimum_quantity, unit, cost_price, selling_price
    ) VALUES (?, ?, ?, 'doctor', 5, 0, 'unit', 20, 50)
  `).run(`Mixed reversal item ${suffix}`, folderId, doctorId).lastInsertRowid);
  db.prepare(`
    INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status)
    VALUES (?, 5, '2032-12-31', 20, 0, 'usable')
  `).run(mixedItemId);

  const fieldSale = await api("POST", `/inventory/items/${mixedItemId}/actions`, doctorToken, {
    action_type: "stock_out",
    reason: "Sale",
    quantity: 2,
    patient_id: patientId,
    consultation_id: mixedConsultationId,
    dispensed_on: today,
    expected_version: db.prepare("SELECT row_version FROM inventory WHERE id = ?").get(mixedItemId).row_version,
    operation_id: randomUUID(),
  });
  assert.equal(fieldSale.status, 201, JSON.stringify(fieldSale.data));
  const dispensing = db.prepare(`
    SELECT * FROM inventory_movements
    WHERE item_id = ? AND action_type = 'stock_out'
    ORDER BY id DESC LIMIT 1
  `).get(mixedItemId);
  assert.ok(dispensing);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(mixedItemId).quantity, 3);
  const feeItems = [{
    description: "Day Consultation",
    amount: 2000,
    type: "Sale",
    quantity: 1,
    inventory_item_id: null,
    is_consultation_fee: true,
  }];
  db.prepare(`
    INSERT INTO billing (consultation_id, patient_id, items, total_amount, status)
    VALUES (?, ?, ?, 2000, 'unpaid')
  `).run(mixedConsultationId, patientId, JSON.stringify(feeItems));

  const captured = await api("POST", `/billing/quick/visits/${mixedConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    items: [{ inventory_item_id: mixedItemId, quantity: 3 }],
  });
  assert.equal(captured.status, 201, JSON.stringify(captured.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(mixedItemId).quantity, 2);
  const submission = db.prepare("SELECT * FROM billing_lite_submissions WHERE id = ?").get(captured.data.submission.submission_id);
  const submissionLine = JSON.parse(submission.items_json)[0];
  assert.deepEqual(submissionLine.dispensing_movement_ids, [Number(dispensing.id)]);
  assert.equal(submissionLine.inventory_movement_ids.length, 1);

  const reversed = await api("POST", `/billing/quick/submissions/${submission.id}/reverse`, operatorToken, {
    operation_id: randomUUID(),
    reason: "Mixed supply quantity was entered incorrectly",
  });
  assert.equal(reversed.status, 200, JSON.stringify(reversed.data));
  assert.equal(reversed.data.stock_movements_reversed, 1);
  assert.equal(reversed.data.dispensing_links_reopened, 1);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(mixedItemId).quantity, 3);
  const dispensingMeta = JSON.parse(db.prepare("SELECT meta_json FROM inventory_movements WHERE id = ?").get(dispensing.id).meta_json);
  assert.equal(dispensingMeta.billing_status, "Pending Manual Entry");
  assert.equal(Object.hasOwn(dispensingMeta, "billing_id"), false);
  const bill = await api("GET", `/billing/${submission.billing_id}`, doctorToken);
  assert.equal(bill.status, 200, JSON.stringify(bill.data));
  assert.equal(bill.data.items.some((line) => Number(line.inventory_item_id) === mixedItemId), false);
  assert.equal(bill.data.total_amount, 2000);
});

test("Billing Lite rejects consultation prices with fractional cents", async () => {
  const result = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    consultation_fee: { type: "Day Consultation", amount: 2000.001 },
    items: [],
  });
  assert.equal(result.status, 400, JSON.stringify(result.data));
  assert.match(result.data.error, /two decimal places/i);
});

test("quick billing requires an audited reason for overrides and caps consultation fees at Rs 4,500", async () => {
  const today = getTodayLocal();
  const patientId = Number(db.prepare(`
    INSERT INTO patients (full_name, first_name, last_name, patient_identifier, age, contact_number, patient_contact_number, address, assigned_doctor_id)
    VALUES ('Fee Control', 'Fee', 'Control', ?, 40, '57111112', '57111112', 'Test address', ?)
  `).run(`OCS-FEE-${Date.now()}`, doctorId).lastInsertRowid);
  const appointmentId = Number(db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, '14:15', 'completed')
  `).run(patientId, doctorId, today).lastInsertRowid);
  const controlledConsultationId = Number(db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, ?, 'Fee control test')
  `).run(appointmentId, patientId, doctorId, today).lastInsertRowid);
  ensureBillingForConsultation(controlledConsultationId, patientId, null, "Day Consultation");

  const missingReason = await api("POST", `/billing/quick/visits/${controlledConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(), consultation_fee: { type: "Day Consultation", amount: 2500 }, items: [],
  });
  assert.equal(missingReason.status, 400, JSON.stringify(missingReason.data));
  assert.equal(missingReason.data.code, "CONSULTATION_FEE_REASON_REQUIRED");

  const overCap = await api("POST", `/billing/quick/visits/${controlledConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(), consultation_fee: {
      type: "Day Consultation", amount: 4500.01, adjustment_reason: "Approved exceptional consultation fee",
    }, items: [],
  });
  assert.equal(overCap.status, 400, JSON.stringify(overCap.data));

  const accepted = await api("POST", `/billing/quick/visits/${controlledConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(), consultation_fee: {
      type: "Day Consultation", amount: 4500, adjustment_reason: "Extended emergency consultation approved",
    }, items: [],
  });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  assert.equal(accepted.data.visit.consultation_fee.amount, 4500);
  const event = db.prepare("SELECT details_json FROM billing_quick_events WHERE submission_id = ? AND event_type = 'submitted'")
    .get(accepted.data.submission.submission_id);
  assert.equal(JSON.parse(event.details_json).consultation_fee.adjustment_reason, "Extended emergency consultation approved");
});

test("the legacy invoice creation endpoint is retired", async () => {
  const result = await api("POST", "/billing", operatorToken, {});
  assert.equal(result.status, 410, JSON.stringify(result.data));
  assert.equal(result.data.code, "LEGACY_BILLING_CREATE_RETIRED");
});

test("operators can report completed prior-day visits that still lack final billing", async () => {
  const today = new Date(`${getTodayLocal()}T12:00:00`);
  today.setDate(today.getDate() - 1);
  const yesterday = today.toISOString().slice(0, 10);
  const patientId = Number(db.prepare(`
    INSERT INTO patients (full_name, first_name, last_name, patient_identifier, age, contact_number, patient_contact_number, address, assigned_doctor_id)
    VALUES ('Unbilled Patient', 'Unbilled', 'Patient', ?, 40, '57111111', '57111111', 'Test address', ?)
  `).run(`OCS-${900000 + Math.floor(Math.random() * 10000)}`, doctorId).lastInsertRowid);
  const appointmentId = Number(db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, '14:00', 'completed')
  `).run(patientId, doctorId, yesterday).lastInsertRowid);
  const missingConsultationId = Number(db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, ?, 'Awaiting final billing')
  `).run(appointmentId, patientId, doctorId, yesterday).lastInsertRowid);
  ensureBillingForConsultation(missingConsultationId, patientId, null, "Day Consultation");

  const report = await api(
    "GET",
    `/billing/quick/unbilled-report?dateFrom=${yesterday}&dateTo=${yesterday}`,
    operatorToken,
  );
  assert.equal(report.status, 200, JSON.stringify(report.data));
  assert.ok(report.data.visits.some((visit) => visit.consultation_id === missingConsultationId));
  assert.ok(!report.data.visits.some((visit) => visit.consultation_id === consultationId));
});

test("patient picker search runs on the server before result limiting", async () => {
  const today = getTodayLocal();
  const createBillableVisit = (name, identifier, index) => {
    const patientId = Number(db.prepare(`
      INSERT INTO patients (full_name, first_name, last_name, patient_identifier, age, contact_number, patient_contact_number, address, assigned_doctor_id)
      VALUES (?, ?, 'Search', ?, 40, '57000000', '57000000', 'Search test address', ?)
    `).run(name, name.split(' ')[0], identifier, doctorId).lastInsertRowid);
    const appointmentId = Number(db.prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, ?, ?, 'completed')
    `).run(patientId, doctorId, today, `${String(10 + (index % 10)).padStart(2,'0')}:00`).lastInsertRowid);
    const nextConsultationId = Number(db.prepare(`
      INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
      VALUES (?, ?, ?, ?, 'Server-side picker search')
    `).run(appointmentId, patientId, doctorId, today).lastInsertRowid);
    ensureBillingForConsultation(nextConsultationId, patientId, null, 'Day Consultation');
    return {patientId,nextConsultationId};
  };
  const targetIdentifier=`OCS-NEEDLE-${Date.now()}`;
  const target=createBillableVisit('Needle Patient',targetIdentifier,0);
  for (let index=0; index<105; index+=1) {
    createBillableVisit(`Recent Decoy ${index}`,`OCS-DECOY-${Date.now()}-${index}`,index);
  }

  const defaultPicker=await api('GET','/billing/quick/picker-options?limit=100',doctorToken);
  assert.equal(defaultPicker.status,200,JSON.stringify(defaultPicker.data));
  assert.equal(defaultPicker.data.has_more,true);
  assert.equal(defaultPicker.data.patients.some(patient=>patient.patient_id===target.patientId),false);
  const nextPicker=await api('GET','/billing/quick/picker-options?limit=100&offset=100',doctorToken);
  assert.equal(nextPicker.status,200,JSON.stringify(nextPicker.data));
  assert.equal(nextPicker.data.has_more,false);
  assert.equal(nextPicker.data.patients.some(patient=>patient.patient_id===target.patientId),true);
  const firstVisitIds=new Set(defaultPicker.data.patients.flatMap(patient=>patient.visits).map(visit=>visit.consultation_id));
  assert.equal(nextPicker.data.patients.flatMap(patient=>patient.visits).some(visit=>firstVisitIds.has(visit.consultation_id)),false);

  const searched=await api('GET',`/billing/quick/picker-options?search=${encodeURIComponent(targetIdentifier)}&limit=20`,doctorToken);
  assert.equal(searched.status,200,JSON.stringify(searched.data));
  assert.equal(searched.data.patients.length,1);
  assert.equal(searched.data.patients[0].patient_id,target.patientId);
  assert.ok(searched.data.patients[0].visits.some(visit=>visit.consultation_id===target.nextConsultationId));
});

test("patient picker and capture remain available when a reset cutover is stored as audit metadata", async () => {
  const previous = db.prepare("SELECT * FROM billing_system_settings WHERE id = 1").get();
  try {
    db.prepare("DELETE FROM billing_system_settings WHERE id = 1").run();
    const today = getTodayLocal();
    const futurePatientId = Number(db.prepare(`
      INSERT INTO patients (full_name, first_name, last_name, patient_identifier, age, contact_number, patient_contact_number, address, assigned_doctor_id)
      VALUES ('Future Cutover Patient', 'Future', 'Patient', ?, 40, '57000000', '57000000', 'Future test address', ?)
    `).run(`OCS-FUTURE-${Date.now()}`, doctorId).lastInsertRowid);
    const futureAppointmentId = Number(db.prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, ?, '10:00', 'completed')
    `).run(futurePatientId, doctorId, today).lastInsertRowid);
    const futureConsultationId = Number(db.prepare(`
      INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
      VALUES (?, ?, ?, ?, 'Cutover metadata regression')
    `).run(futureAppointmentId, futurePatientId, doctorId, today).lastInsertRowid);
    db.prepare(`
      INSERT INTO billing_system_settings (id, cutover_date, reset_at, reset_reason)
      VALUES (1, '2099-01-01', CURRENT_TIMESTAMP, 'Picker cutover regression test')
      ON CONFLICT(id) DO UPDATE SET
        cutover_date = excluded.cutover_date,
        reset_at = excluded.reset_at,
        reset_reason = excluded.reset_reason
    `).run();
    const picker = await api("GET", `/billing/quick/picker-options?search=${encodeURIComponent(`OCS-FUTURE-`)}&limit=20`, doctorToken);
    assert.equal(picker.status, 200, JSON.stringify(picker.data));
    assert.equal(picker.data.cutover_date, null);
    assert.equal(picker.data.billing_active, true);
    assert.ok(picker.data.patients.some((patient) => patient.patient_id === futurePatientId));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing WHERE consultation_id = ? AND voided_at IS NULL").get(futureConsultationId).count, 0);
    const captured = await api("POST", `/billing/quick/visits/${futureConsultationId}/capture`, doctorToken, {
      operation_id: randomUUID(),
      consultation_fee: { type: "Day Consultation", amount: 2000 },
      items: [],
    });
    assert.equal(captured.status, 201, JSON.stringify(captured.data));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing WHERE consultation_id = ? AND voided_at IS NULL").get(futureConsultationId).count, 1);
  } finally {
    if (previous) {
      db.prepare(`
        INSERT INTO billing_system_settings (id, cutover_date, reset_at, reset_reason)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          cutover_date = excluded.cutover_date,
          reset_at = excluded.reset_at,
          reset_reason = excluded.reset_reason
      `).run(previous.cutover_date, previous.reset_at, previous.reset_reason);
    } else {
      db.prepare("DELETE FROM billing_system_settings WHERE id = 1").run();
    }
  }
});

test("operator action queue is searchable and reports stable pagination totals", async () => {
  const today = getTodayLocal();
  const identifier = `OCS-QUEUE-${Date.now()}`;
  const patientId = Number(db.prepare(`
    INSERT INTO patients (full_name, first_name, last_name, patient_identifier, age, contact_number, patient_contact_number, address, assigned_doctor_id)
    VALUES ('Queue Search Patient', 'Queue', 'Patient', ?, 40, '57000000', '57000000', 'Queue test address', ?)
  `).run(identifier, doctorId).lastInsertRowid);
  const appointmentId = Number(db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, '11:45', 'completed')
  `).run(patientId, doctorId, today).lastInsertRowid);
  const queueConsultationId = Number(db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, ?, 'Operator queue pagination test')
  `).run(appointmentId, patientId, doctorId, today).lastInsertRowid);
  ensureBillingForConsultation(queueConsultationId, patientId, null, "Day Consultation");
  const captured = await api("POST", `/billing/quick/visits/${queueConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    consultation_fee: { type: "Day Consultation", amount: 2000 },
    items: [],
  });
  assert.equal(captured.status, 201, JSON.stringify(captured.data));

  const queue = await api(
    "GET",
    `/billing/quick/operator-queue?status=actionable&search=${encodeURIComponent(identifier)}&limit=10&offset=0`,
    operatorToken,
  );
  assert.equal(queue.status, 200, JSON.stringify(queue.data));
  assert.equal(queue.data.total, 1);
  assert.equal(queue.data.has_more, false);
  assert.equal(queue.data.submissions[0].consultation_id, queueConsultationId);
  const invoiceNumber = db.prepare("SELECT invoice_number FROM billing WHERE id = ?").get(captured.data.submission.bill_id).invoice_number;
  const invoiceSearch = await api(
    "GET",
    `/billing/quick/operator-queue?status=actionable&search=${encodeURIComponent(invoiceNumber)}&limit=10&offset=0`,
    operatorToken,
  );
  assert.equal(invoiceSearch.status, 200, JSON.stringify(invoiceSearch.data));
  assert.equal(invoiceSearch.data.total, 1);
  assert.equal(invoiceSearch.data.submissions[0].invoice_number, invoiceNumber);

  const approved = await api(
    "PATCH",
    `/billing/quick/operator-queue/${queueConsultationId}/status`,
    operatorToken,
    {
      submission_id: queue.data.submissions[0].submission_id,
      expected_workflow_status: queue.data.submissions[0].workflow_status,
      status: "ready_for_payment",
      note: "Charges verified for collection",
    },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const workspace = await api("GET", "/dashboard/operator-workspace", operatorToken);
  assert.equal(workspace.status, 200, JSON.stringify(workspace.data));
  assert.ok(workspace.data.pendingPayments.some((bill) => Number(bill.id) === Number(captured.data.submission.bill_id)));

  const empty = await api(
    "GET",
    "/billing/quick/operator-queue?status=actionable&search=OCS-NOT-PRESENT&limit=10&offset=0",
    operatorToken,
  );
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.equal(empty.data.total, 0);
  assert.deepEqual(empty.data.submissions, []);
});
