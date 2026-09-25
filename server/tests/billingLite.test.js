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
let accountantToken;
let doctorId;
let otherDoctorId;
let consultationId;
let patientIdentifier;
let itemId;
let quickIssueSequence = 0;

function quickIssueFields(prefix = "QB") {
  quickIssueSequence += 1;
  return {
    source_reference: `${prefix}-${quickIssueSequence}`,
    payment_method: "cash",
    payment_date: getTodayLocal(),
  };
}

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

test("a reviewed quick bill requires an audited reason when a supply price is adjusted", async () => {
  const beforeQuantity = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity;
  const denied = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    ...quickIssueFields("PRICE-CHANGE"),
    consultation_fee: { type: "Night Consultation", amount: 3000 },
    items: [{ inventory_item_id: itemId, quantity: 1, unit_price: 70 }],
  });
  assert.equal(denied.status, 400, JSON.stringify(denied.data));
  assert.equal(denied.data.code, "SUPPLY_PRICE_REASON_REQUIRED");
  assert.equal(denied.data.reviewed_price, 70);
  assert.equal(denied.data.standard_price, 75);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, beforeQuantity);
});

test("doctor quick billing requires the receipt and payment details before issue", async () => {
  const today = getTodayLocal();
  const missingReceipt = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    payment_method: "cash",
    payment_date: today,
    consultation_fee: { type: "Day Consultation", amount: 2000 },
    items: [],
  });
  assert.equal(missingReceipt.status, 400, JSON.stringify(missingReceipt.data));
  assert.equal(missingReceipt.data.code, "BILLING_SOURCE_REFERENCE_REQUIRED");

  const missingMethod = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    source_reference: "RECEIPT-REQUIRED-1",
    payment_date: today,
    consultation_fee: { type: "Day Consultation", amount: 2000 },
    items: [],
  });
  assert.equal(missingMethod.status, 400, JSON.stringify(missingMethod.data));
  assert.equal(missingMethod.data.code, "BILLING_PAYMENT_METHOD_REQUIRED");

  const missingProviderReference = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    source_reference: "RECEIPT-REQUIRED-2",
    payment_method: "juice",
    payment_date: today,
    consultation_fee: { type: "Day Consultation", amount: 2000 },
    items: [],
  });
  assert.equal(missingProviderReference.status, 400, JSON.stringify(missingProviderReference.data));
  assert.equal(missingProviderReference.data.code, "BILLING_PAYMENT_REFERENCE_REQUIRED");
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
  const folderId = Number(db.prepare("SELECT id FROM inventory_folders ORDER BY id DESC LIMIT 1").get().id);
  const operatorItemId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, folder_id, owner_doctor_id, stock_scope, quantity,
      minimum_quantity, unit, cost_price, selling_price
    ) VALUES ('Operator adjusted-price item', ?, ?, 'doctor', 2, 0, 'unit', 20, 50)
  `).run(folderId, doctorId).lastInsertRowid);
  db.prepare("INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status) VALUES (?, 2, '2032-12-31', 20, 0, 'usable')")
    .run(operatorItemId);

  const missingDoctor = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    { operation_id: randomUUID(), source_reference: "PAPER-QB-1", payment_method: "cash", payment_date: today, raised_by_doctor: true, items: [] },
  );
  assert.equal(missingDoctor.status, 400);
  assert.equal(missingDoctor.data.code, "BILLING_DOCTOR_REQUIRED");

  const wrongDoctor = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    { operation_id: randomUUID(), doctor_id: otherDoctorId, source_reference: "PAPER-QB-1", payment_method: "cash", payment_date: today, raised_by_doctor: true, items: [] },
  );
  assert.equal(wrongDoctor.status, 409);
  assert.equal(wrongDoctor.data.code, "BILLING_DOCTOR_MISMATCH");

  const missingReference = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    { operation_id: randomUUID(), doctor_id: doctorId, payment_method: "cash", payment_date: today, raised_by_doctor: true, items: [] },
  );
  assert.equal(missingReference.status, 400);

  const missingDoctorConfirmation = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    {
      operation_id: randomUUID(),
      doctor_id: doctorId,
      source_reference: "PAPER-QB-1",
      payment_method: "cash",
      payment_date: today,
      items: [],
    },
  );
  assert.equal(missingDoctorConfirmation.status, 400);
  assert.equal(missingDoctorConfirmation.data.code, "OPERATOR_DOCTOR_CONFIRMATION_REQUIRED");

  const issued = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    {
      operation_id: randomUUID(),
      doctor_id: doctorId,
      source_reference: "PAPER-QB-1",
      payment_method: "cash",
      payment_date: today,
      raised_by_doctor: true,
      consultation_fee: { type: "Day Consultation", amount: 2000 },
      items: [{
        inventory_item_id: operatorItemId,
        quantity: 1,
        unit_price: 45,
        price_adjustment_reason: "Approved patient discount",
      }],
    },
  );
  assert.equal(issued.status, 201, JSON.stringify(issued.data));
  assert.equal(issued.data.visit.submission_status, "completed");
  const bill = db.prepare("SELECT source_reference, issued_by_role, status, payment_method FROM billing WHERE consultation_id = ?").get(operatorConsultationId);
  assert.equal(bill.source_reference, "PAPER-QB-1");
  assert.equal(bill.issued_by_role, "operator");
  assert.equal(bill.status, "paid");
  assert.equal(bill.payment_method, "cash");
  assert.equal(issued.data.submission.workflow_status, "completed");
  assert.equal(issued.data.submission.payment.state, "paid");
  assert.equal(issued.data.submission.amount_added, 45);
  const operatorBill = JSON.parse(db.prepare("SELECT items FROM billing WHERE consultation_id = ?").get(operatorConsultationId).items);
  const adjustedOperatorLine = operatorBill.find((item) => Number(item.inventory_item_id) === operatorItemId);
  assert.equal(adjustedOperatorLine.unit_price, 45);
  assert.equal(adjustedOperatorLine.catalog_unit_price, 50);
  assert.equal(adjustedOperatorLine.price_adjustment_reason, "Approved patient discount");
  assert.equal(adjustedOperatorLine.price_adjusted_by_role, "operator");

  const repeatedIssue = await api(
    "POST",
    `/billing/quick/visits/${operatorConsultationId}/capture`,
    operatorToken,
    {
      operation_id: randomUUID(),
      doctor_id: doctorId,
      source_reference: "PAPER-QB-2",
      payment_method: "cash",
      payment_date: today,
      raised_by_doctor: true,
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
    ...quickIssueFields("DOCTOR-DIRECT"),
    consultation_fee: {
      type: "Review Consultation",
      amount: 1750,
      adjustment_reason: "Reduced review tariff approved for this visit",
    },
    items: [{
      inventory_item_id: itemId,
      quantity: 2,
      unit_price: 70,
      price_adjustment_reason: "Approved supply discount",
    }],
  };
  const captured = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, body);
  assert.equal(captured.status, 201, JSON.stringify(captured.data));
  assert.equal(captured.data.submission.item_count, 2);
  assert.equal(captured.data.submission.amount_added, 140);
  assert.equal(captured.data.submission.consultation_fee.type, "Review Consultation");
  assert.equal(captured.data.submission.consultation_fee.amount, 1750);
  assert.equal(captured.data.submission.consultation_fee.changed, true);
  assert.equal(captured.data.visit.consultation_fee.type, "Review Consultation");
  assert.equal(captured.data.visit.consultation_fee.amount, 1750);
  assert.equal(captured.data.visit.bill_total, 1890);
  assert.equal(captured.data.visit.submission_status, "completed");
  assert.equal(captured.data.submission.workflow_status, "completed");
  assert.equal(captured.data.submission.payment.state, "paid");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 6);
  const paidBill = db.prepare("SELECT status, payment_method, source_reference FROM billing WHERE id = ?").get(captured.data.submission.bill_id);
  assert.deepEqual(paidBill, {
    status: "paid",
    payment_method: "cash",
    source_reference: body.source_reference,
  });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM billing_payment_transactions WHERE billing_id = ?").get(captured.data.submission.bill_id).count,
    1,
  );
  const billEvent = db.prepare(`
    SELECT reason FROM billing_events
    WHERE bill_id = ? AND reason LIKE 'Consultation fee adjusted%'
    ORDER BY id DESC LIMIT 1
  `).get(captured.data.submission.bill_id);
  assert.match(billEvent.reason, /Consultation fee adjusted/);
  const quickEvent = db.prepare("SELECT details_json FROM billing_quick_events WHERE submission_id = ? AND event_type = 'submitted'").get(captured.data.submission.submission_id);
  const quickEventDetails = JSON.parse(quickEvent.details_json);
  assert.equal(quickEventDetails.consultation_fee.amount, 1750);
  assert.deepEqual(quickEventDetails.supply_price_adjustments.map((item) => ({
    original_unit_price: item.original_unit_price,
    adjusted_unit_price: item.adjusted_unit_price,
    reason: item.reason,
    adjusted_by_role: item.adjusted_by_role,
  })), [{
    original_unit_price: 75,
    adjusted_unit_price: 70,
    reason: "Approved supply discount",
    adjusted_by_role: "doctor",
  }]);

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
    `/billing/quick/submissions?search=${encodeURIComponent(patientIdentifier)}&status=completed&limit=10&offset=0`,
    doctorToken,
  );
  assert.equal(filteredUpdates.status, 200, JSON.stringify(filteredUpdates.data));
  assert.ok(filteredUpdates.data.total >= 1);
  assert.ok(filteredUpdates.data.submissions.every((entry) => entry.status === "completed"));
  assert.ok(filteredUpdates.data.submissions.some((entry) => entry.consultation_id === consultationId));

  const duplicateOperation = await api("POST", `/billing/quick/visits/${consultationId}/capture`, doctorToken, {
    ...body,
    operation_id: randomUUID(),
  });
  assert.equal(duplicateOperation.status, 409, JSON.stringify(duplicateOperation.data));
  assert.equal(duplicateOperation.data.code, "QUICK_BILLING_ALREADY_SUBMITTED");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId).quantity, 6);
});

test("quick billing treats a non-stock service without inventory deduction", async () => {
  const patientId = Number(db.prepare("SELECT patient_id FROM consultations WHERE id = ?").get(consultationId).patient_id);
  const today = getTodayLocal();
  const appointmentId = Number(db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, '15:00', 'completed')
  `).run(patientId, doctorId, today).lastInsertRowid);
  const serviceConsultationId = Number(db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, ?, 'Non-stock service test')
  `).run(appointmentId, patientId, doctorId, today).lastInsertRowid);
  ensureBillingForConsultation(serviceConsultationId, patientId, null, "Day Consultation");
  let oxygenFolder = db.prepare("SELECT id FROM inventory_folders WHERE name = 'O2 & Nebuliser' LIMIT 1").get();
  if (!oxygenFolder) {
    oxygenFolder = {
      id: Number(db.prepare("INSERT INTO inventory_folders (name) VALUES ('O2 & Nebuliser')").run().lastInsertRowid),
    };
  }
  const folderId = Number(oxygenFolder.id);
  const serviceId = Number(db.prepare(`
    INSERT INTO inventory (
      item_name, item_kind, folder_id, owner_doctor_id, stock_scope, quantity,
      minimum_quantity, unit, cost_price, selling_price
    ) VALUES ('Non-stock service (test)', 'service', ?, ?, 'doctor', 0, 0, 'service', 0, 350)
  `).run(folderId, doctorId).lastInsertRowid);

  const catalog = await api("GET", `/billing/quick/catalog/${serviceConsultationId}`);
  assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
  const service = catalog.data.items.find((item) => Number(item.id) === serviceId);
  assert.ok(service);
  assert.equal(service.is_service_charge, true);
  assert.equal(service.available_to_use, null);

  const captured = await api("POST", `/billing/quick/visits/${serviceConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    ...quickIssueFields("NONSTOCK-SERVICE"),
    items: [{ inventory_item_id: serviceId, quantity: 2, unit_price: 350 }],
  });
  assert.equal(captured.status, 201, JSON.stringify(captured.data));
  const bill = db.prepare("SELECT items FROM billing WHERE id = ?").get(captured.data.submission.bill_id);
  const lines = JSON.parse(bill.items);
  const serviceLine = lines.find((line) => line.description === "Non-stock service (test)");
  assert.ok(serviceLine);
  assert.equal(serviceLine.is_service_charge, true);
  assert.equal(serviceLine.amount, 700);
  assert.equal(serviceLine.inventory_item_id, null);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(serviceId).quantity, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE item_id = ?").get(serviceId).count, 0);
});

test("doctor-issued invoices complete without operator acknowledgement", async () => {
  const queue = await api("GET", "/billing/quick/operator-queue?status=actionable", operatorToken);
  assert.equal(queue.status, 200, JSON.stringify(queue.data));
  const submission = queue.data.submissions.find((row) => row.consultation_id === consultationId);
  assert.equal(submission, undefined);
  const stored = db.prepare("SELECT workflow_status FROM billing_lite_submissions WHERE consultation_id = ? ORDER BY id DESC LIMIT 1").get(consultationId);
  assert.equal(stored.workflow_status, "completed");
  const bill = db.prepare("SELECT status, finalized_at FROM billing WHERE consultation_id = ? AND voided_at IS NULL").get(consultationId);
  assert.equal(bill.status, "paid");
  assert.ok(bill.finalized_at);
});

test("incorrect quick-billing supplies reverse stock and bill lines with an immutable audit trail", async () => {
  const submission = db.prepare("SELECT * FROM billing_lite_submissions WHERE consultation_id = ? ORDER BY id DESC LIMIT 1").get(consultationId);
  const payment = db.prepare(`
    SELECT id FROM billing_payment_transactions
    WHERE billing_id = ? ORDER BY id DESC LIMIT 1
  `).get(submission.billing_id);
  const paymentReversal = await api(
    "POST",
    `/billing/${submission.billing_id}/payments/${payment.id}/reverse`,
    operatorToken,
    {
      operation_id: randomUUID(),
      reversal_date: getTodayLocal(),
      reason: "Reverse receipt before correcting duplicated supplies",
    },
  );
  assert.equal(paymentReversal.status, 201, JSON.stringify(paymentReversal.data));
  assert.equal(paymentReversal.data.bill.payment_state, "unpaid");

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

test("completed doctor invoices bypass the obsolete operator acknowledgement workflow", async () => {
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
    ...quickIssueFields("DIRECT-NO-ACK"),
    consultation_fee: { type: "Day Consultation", amount: 2000 },
    items: [],
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.submission.workflow_status, "completed");
  assert.equal(first.data.submission.payment.state, "paid");

  const queue = await api(
    "GET",
    `/billing/quick/operator-queue?status=actionable&search=${encodeURIComponent(`OCS-CLAR-${suffix}`)}`,
    operatorToken,
  );
  assert.equal(queue.status, 200, JSON.stringify(queue.data));
  assert.equal(queue.data.total, 0);

  const obsoleteAcknowledgement = await api(
    "PATCH",
    `/billing/quick/operator-queue/${correctedConsultationId}/status`,
    operatorToken,
    {
      submission_id: first.data.submission.submission_id,
      expected_workflow_status: "completed",
      status: "needs_doctor",
      note: "Confirm the corrected supply quantity",
    },
  );
  assert.equal(obsoleteAcknowledgement.status, 400, JSON.stringify(obsoleteAcknowledgement.data));
  const stored = db.prepare("SELECT workflow_status, reversed_at FROM billing_lite_submissions WHERE id = ?")
    .get(first.data.submission.submission_id);
  assert.equal(stored.workflow_status, "completed");
  assert.equal(stored.reversed_at, null);
  const issuedBill = db.prepare("SELECT status FROM billing WHERE id = ?").get(baseInvoice.data.id);
  assert.equal(issuedBill.status, "paid");
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
    ...quickIssueFields("MIXED-REVERSAL"),
    items: [{ inventory_item_id: mixedItemId, quantity: 3 }],
  });
  assert.equal(captured.status, 201, JSON.stringify(captured.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(mixedItemId).quantity, 2);
  const submission = db.prepare("SELECT * FROM billing_lite_submissions WHERE id = ?").get(captured.data.submission.submission_id);
  const submissionLine = JSON.parse(submission.items_json)[0];
  assert.deepEqual(submissionLine.dispensing_movement_ids, [Number(dispensing.id)]);
  assert.equal(submissionLine.inventory_movement_ids.length, 1);

  const payment = db.prepare(`
    SELECT id FROM billing_payment_transactions
    WHERE billing_id = ? ORDER BY id DESC LIMIT 1
  `).get(submission.billing_id);
  const paymentReversal = await api(
    "POST",
    `/billing/${submission.billing_id}/payments/${payment.id}/reverse`,
    operatorToken,
    {
      operation_id: randomUUID(),
      reversal_date: today,
      reason: "Reverse receipt before correcting mixed supply quantity",
    },
  );
  assert.equal(paymentReversal.status, 201, JSON.stringify(paymentReversal.data));
  assert.equal(paymentReversal.data.bill.payment_state, "unpaid");

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
    ...quickIssueFields("FRACTIONAL-FEE"),
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
    operation_id: randomUUID(), ...quickIssueFields("FEE-REASON"), consultation_fee: { type: "Day Consultation", amount: 2500 }, items: [],
  });
  assert.equal(missingReason.status, 400, JSON.stringify(missingReason.data));
  assert.equal(missingReason.data.code, "CONSULTATION_FEE_REASON_REQUIRED");

  const overCap = await api("POST", `/billing/quick/visits/${controlledConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(), ...quickIssueFields("FEE-CAP"), consultation_fee: {
      type: "Day Consultation", amount: 4500.01, adjustment_reason: "Approved exceptional consultation fee",
    }, items: [],
  });
  assert.equal(overCap.status, 400, JSON.stringify(overCap.data));

  const accepted = await api("POST", `/billing/quick/visits/${controlledConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(), ...quickIssueFields("FEE-ACCEPTED"), consultation_fee: {
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

test("patient picker and capture enforce the configured live billing cutover", async () => {
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
    assert.equal(picker.data.cutover_date, "2099-01-01");
    assert.equal(picker.data.billing_active, false);
    assert.equal(picker.data.patients.some((patient) => patient.patient_id === futurePatientId), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing WHERE consultation_id = ? AND voided_at IS NULL").get(futureConsultationId).count, 0);
    const captured = await api("POST", `/billing/quick/visits/${futureConsultationId}/capture`, doctorToken, {
      operation_id: randomUUID(),
      ...quickIssueFields("CUTOVER"),
      consultation_fee: { type: "Day Consultation", amount: 2000 },
      items: [],
    });
    assert.equal(captured.status, 409, JSON.stringify(captured.data));
    assert.equal(captured.data.code, "BILLING_CUTOVER_NOT_REACHED");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing WHERE consultation_id = ? AND voided_at IS NULL").get(futureConsultationId).count, 0);
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

test("directly issued invoices appear in searchable history and not the operator action queue", async () => {
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
    ...quickIssueFields("HISTORY"),
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
  assert.equal(queue.data.total, 0);
  assert.equal(queue.data.has_more, false);

  const history = await api(
    "GET",
    `/billing/quick/submissions?status=completed&search=${encodeURIComponent(identifier)}&limit=10&offset=0`,
    operatorToken,
  );
  assert.equal(history.status, 200, JSON.stringify(history.data));
  assert.equal(history.data.total, 1);
  assert.equal(history.data.has_more, false);
  assert.equal(history.data.submissions[0].consultation_id, queueConsultationId);
  assert.equal(history.data.submissions[0].status, "completed");

  const workspace = await api("GET", "/dashboard/operator-workspace", operatorToken);
  assert.equal(workspace.status, 200, JSON.stringify(workspace.data));
  assert.equal(
    workspace.data.pendingPayments.some((bill) => Number(bill.id) === Number(captured.data.submission.bill_id)),
    false,
  );

  const empty = await api(
    "GET",
    "/billing/quick/operator-queue?status=actionable&search=OCS-NOT-PRESENT&limit=10&offset=0",
    operatorToken,
  );
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.equal(empty.data.total, 0);
  assert.deepEqual(empty.data.submissions, []);
});

test("a billed nebulizer takes the chosen mask and nebule from the bag without charging them", async () => {
  const patientId = Number(db.prepare("SELECT patient_id FROM consultations WHERE id = ?").get(consultationId).patient_id);
  const today = getTodayLocal();
  function visit() {
    const appointmentId = Number(db.prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, ?, '16:10', 'completed')
    `).run(patientId, doctorId, today).lastInsertRowid);
    const nextConsultationId = Number(db.prepare(`
      INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
      VALUES (?, ?, ?, ?, 'Treatment supply test')
    `).run(appointmentId, patientId, doctorId, today).lastInsertRowid);
    ensureBillingForConsultation(nextConsultationId, patientId, null, "Day Consultation");
    return nextConsultationId;
  }

  const catalogConsultationId = visit();
  const catalog = await api("GET", `/billing/quick/catalog/${catalogConsultationId}`);
  assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
  const nebulizer = catalog.data.items.find((item) => item.item_name === "Nebulizer ( incl mask and 1 Dulopro nebule)");
  const extraOxygen = catalog.data.items.find((item) => item.item_name === "Each additional 30 mins O2");
  assert.ok(nebulizer);
  assert.equal(nebulizer.is_service_charge, true);
  assert.equal(nebulizer.requires_mask, true);
  assert.equal(nebulizer.included_label, "1 face mask and 1 Dulopro nebule");
  assert.equal(nebulizer.category, "Services");
  const administration = catalog.data.items.find((item) => item.item_name === "Administration Fees (only when administration is done)");
  const ear = catalog.data.items.find((item) => item.item_name === "Ear Syringing");
  assert.ok(administration);
  assert.equal(administration.is_service_charge, true);
  assert.equal(administration.category, "Services");
  assert.equal(administration.selling_price, 500);
  assert.equal(administration.requires_mask, false);
  assert.ok(ear);
  assert.equal(ear.selling_price, 800);
  assert.equal(ear.category, "Services");
  assert.equal(catalog.data.items.some((item) => item.item_name === "Adult Face Mask"), false);
  assert.ok(extraOxygen);
  assert.equal(extraOxygen.requires_mask, false);

  function bagItem(name) {
    return db.prepare(`
      SELECT id, quantity
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND lower(trim(item_name)) = lower(trim(?))
    `).get(doctorId, name);
  }
  function stock(name, quantity) {
    const row = bagItem(name);
    assert.ok(row, name);
    db.prepare("UPDATE inventory SET quantity = ?, cost_price = 12, selling_price = 0 WHERE id = ?").run(quantity, row.id);
    db.prepare("UPDATE inventory_batches SET quantity_remaining = 0 WHERE item_id = ?").run(row.id);
    db.prepare(`
      INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status)
      VALUES (?, ?, '2032-12-31', 12, 0, 'usable')
    `).run(row.id, quantity);
    return row.id;
  }
  const maskId = stock("Adult Face Mask", 4);
  const paediatricId = stock("Paediatric Face Mask", 3);
  const duloproId = stock("Dulopro nebule", 5);
  const pulmicortId = stock("Pulmicort nebule", 5);
  db.prepare("UPDATE inventory SET selling_price = 1800 WHERE id = ?").run(nebulizer.id);
  db.prepare("UPDATE inventory SET selling_price = 600 WHERE id = ?").run(extraOxygen.id);

  const missingMask = await api("POST", `/billing/quick/visits/${catalogConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    ...quickIssueFields("NEB-MASK"),
    items: [{ inventory_item_id: nebulizer.id, quantity: 1, unit_price: 1800 }],
  });
  assert.equal(missingMask.status, 400, JSON.stringify(missingMask.data));
  assert.equal(missingMask.data.code, "TREATMENT_MASK_REQUIRED");
  assert.equal(bagItem("Adult Face Mask").quantity, 4);

  const billed = await api("POST", `/billing/quick/visits/${catalogConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    ...quickIssueFields("NEB-OK"),
    items: [{ inventory_item_id: nebulizer.id, quantity: 1, unit_price: 1800, mask_size: "adult" }],
  });
  assert.equal(billed.status, 201, JSON.stringify(billed.data));
  const lines = JSON.parse(db.prepare("SELECT items FROM billing WHERE id = ?").get(billed.data.submission.bill_id).items);
  const serviceLine = lines.find((line) => line.description === nebulizer.item_name);
  assert.ok(serviceLine);
  assert.equal(serviceLine.amount, 1800);
  assert.equal(serviceLine.inventory_item_id, null);
  assert.equal(serviceLine.mask_size, "adult");
  assert.equal(lines.some((line) => line.description === "Adult Face Mask" || line.description === "Dulopro nebule"), false);
  assert.ok(serviceLine.inventory_movement_ids.length >= 2);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(maskId).quantity, 3);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(duloproId).quantity, 4);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(paediatricId).quantity, 3);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(pulmicortId).quantity, 5);

  const shortConsultationId = visit();
  db.prepare("UPDATE inventory SET quantity = 0 WHERE id = ?").run(duloproId);
  db.prepare("UPDATE inventory_batches SET quantity_remaining = 0 WHERE item_id = ?").run(duloproId);
  const blocked = await api("POST", `/billing/quick/visits/${shortConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    ...quickIssueFields("NEB-SHORT"),
    items: [{ inventory_item_id: nebulizer.id, quantity: 1, unit_price: 1800, mask_size: "paediatric" }],
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, "INSUFFICIENT_ATP");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(paediatricId).quantity, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_lite_submissions WHERE consultation_id = ?").get(shortConsultationId).count, 0);

  const oxygenConsultationId = visit();
  const oxygen = await api("POST", `/billing/quick/visits/${oxygenConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    ...quickIssueFields("O2-EXTRA"),
    items: [{ inventory_item_id: extraOxygen.id, quantity: 2, unit_price: 600 }],
  });
  assert.equal(oxygen.status, 201, JSON.stringify(oxygen.data));
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(maskId).quantity, 3);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(pulmicortId).quantity, 5);
});

test("enema and staple-removal services deduct the chosen bag supply", async () => {
  const patientId = Number(db.prepare("SELECT patient_id FROM consultations WHERE id = ?").get(consultationId).patient_id);
  const today = getTodayLocal();
  const appointmentId = Number(db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, '16:40', 'completed')
  `).run(patientId, doctorId, today).lastInsertRowid);
  const nextConsultationId = Number(db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, ?, 'Procedure supply test')
  `).run(appointmentId, patientId, doctorId, today).lastInsertRowid);
  ensureBillingForConsultation(nextConsultationId, patientId, null, "Day Consultation");

  const catalog = await api("GET", `/billing/quick/catalog/${nextConsultationId}`);
  assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
  const prEnema = catalog.data.items.find((item) => item.item_name === "PR + Atomic enema");
  const manualEnema = catalog.data.items.find((item) => item.item_name === "Manual Evac + Atomic enema");
  const stapleService = catalog.data.items.find((item) => item.item_name === "Removal of sutures or staples removing + Dressing");
  assert.ok(prEnema);
  assert.equal(prEnema.requires_enema, true);
  assert.equal(prEnema.included_label, "1 atomic enema");
  assert.equal(prEnema.selling_price, 1000);
  assert.ok(manualEnema);
  assert.equal(manualEnema.requires_enema, true);
  assert.equal(manualEnema.selling_price, 2000);
  assert.ok(stapleService);
  assert.equal(stapleService.requires_enema, false);
  assert.equal(stapleService.included_label, "1 Staple remover");
  assert.equal(stapleService.selling_price, 1500);
  for (const name of ["Atomic enema (Adult)", "Atomic enema (Paediatric)", "Staple remover"]) {
    assert.equal(catalog.data.items.some((item) => item.item_name === name), false, name);
  }

  function bagItem(name) {
    return db.prepare(`
      SELECT id, quantity
      FROM inventory
      WHERE stock_scope = 'doctor'
        AND owner_doctor_id = ?
        AND lower(trim(item_name)) = lower(trim(?))
    `).get(doctorId, name);
  }
  function stock(name, quantity) {
    const row = bagItem(name);
    assert.ok(row, name);
    db.prepare("UPDATE inventory SET quantity = ?, cost_price = 12, selling_price = 0 WHERE id = ?").run(quantity, row.id);
    db.prepare("UPDATE inventory_batches SET quantity_remaining = 0 WHERE item_id = ?").run(row.id);
    db.prepare(`
      INSERT INTO inventory_batches (item_id, quantity_remaining, expiry_date, unit_cost, is_non_expiring, status)
      VALUES (?, ?, '2032-12-31', 12, 0, 'usable')
    `).run(row.id, quantity);
    return row.id;
  }
  stock("Atomic enema (Adult)", 3);
  stock("Atomic enema (Paediatric)", 2);
  stock("Staple remover", 4);

  const missingSize = await api("POST", `/billing/quick/visits/${nextConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    ...quickIssueFields("PR-ENEMA"),
    items: [{ inventory_item_id: prEnema.id, quantity: 1, unit_price: 1000 }],
  });
  assert.equal(missingSize.status, 400, JSON.stringify(missingSize.data));
  assert.equal(missingSize.data.code, "TREATMENT_ENEMA_REQUIRED");
  assert.equal(bagItem("Atomic enema (Adult)").quantity, 3);

  const billed = await api("POST", `/billing/quick/visits/${nextConsultationId}/capture`, doctorToken, {
    operation_id: randomUUID(),
    ...quickIssueFields("PR-ENEMA-OK"),
    items: [
      { inventory_item_id: prEnema.id, quantity: 1, unit_price: 1000, enema_size: "adult" },
      { inventory_item_id: stapleService.id, quantity: 1, unit_price: 1500 },
    ],
  });
  assert.equal(billed.status, 201, JSON.stringify(billed.data));
  const lines = JSON.parse(db.prepare("SELECT items FROM billing WHERE id = ?").get(billed.data.submission.bill_id).items);
  assert.equal(lines.some((line) => line.description === "PR + Atomic enema" && line.enema_size === "adult"), true);
  assert.equal(lines.some((line) => line.description === "Atomic enema (Adult)"), false);
  assert.equal(lines.some((line) => line.description === "Staple remover"), false);
  assert.equal(bagItem("Atomic enema (Adult)").quantity, 2);
  assert.equal(bagItem("Atomic enema (Paediatric)").quantity, 2);
  assert.equal(bagItem("Staple remover").quantity, 3);
});
