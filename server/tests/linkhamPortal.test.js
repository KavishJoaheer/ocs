"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const TMP_DB = path.join(os.tmpdir(), `ocs-linkham-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = "test";
process.env.LINKHAM_BILLING_ENABLED = "true";

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { db } = require("../src/db");
const { snapshotBillingLinkhamCoverage } = require("../src/lib/linkhamCoverageWorkflow");

let server;
let baseUrl;
let linkhamToken;
let operatorToken;
let adminToken;
let fixture;

function todayInMauritius() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Indian/Mauritius",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  const login = await api("POST", "/api/auth/login", {
    body: { username: "linkham01", password: "Welcome@123" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  linkhamToken = login.data.token;
  const operatorLogin = await api("POST", "/api/auth/login", {
    body: { username: "operator01", password: "Welcome@123" },
  });
  assert.equal(operatorLogin.status, 200, JSON.stringify(operatorLogin.data));
  operatorToken = operatorLogin.data.token;
  const adminLogin = await api("POST", "/api/auth/login", {
    body: { username: "shravan.joaheer", password: "Welcome@123" },
  });
  assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.data));
  adminToken = adminLogin.data.token;
  fixture = seedLinkhamVisit();
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(`${TMP_DB}${suffix}`);
    } catch {
      /* ignore */
    }
  }
});

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
  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text };
        }
      })()
    : null;
  return { status: res.status, data, text };
}

function seedLinkhamVisit() {
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
  const stamp = Date.now();
  const patientId = Number(
    db
      .prepare(`
        INSERT INTO patients (
          full_name, first_name, last_name, patient_identifier, patient_id_number,
          age, date_of_birth, gender, contact_number, patient_contact_number,
          address, insurance_provider, insurance_policy_number, link_status,
          consultation_notes, ongoing_treatment
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Linkham', '', 'staff_created', ?, ?)
      `)
      .run(
        "Lisa Soobrayen",
        "Lisa",
        "Soobrayen",
        `OCS-LH-${stamp}`,
        `B280668${String(stamp).slice(-6)}F`,
        58,
        "1968-06-28",
        "F",
        "52524388",
        "52524388",
        "Coromandel",
        "BP 140/85. Secret chart note. Rx metformin.",
        "Weekly glucose monitoring. Do not show this.",
      ).lastInsertRowid,
  );

  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now'), '09:00', 'completed')
    `)
    .run(patientId, doctorId).lastInsertRowid;

  const consultationId = db
    .prepare(`
      INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
      VALUES (?, ?, ?, date('now'), ?)
    `)
    .run(
      appointmentId,
      patientId,
      doctorId,
      "BP 140/85. T 38. SpO2 99%.\nImpression: Type 2 diabetes mellitus\nRx: metformin 500mg bd",
    ).lastInsertRowid;

  const billingId = Number(
    db
      .prepare(`
        INSERT INTO billing (consultation_id, patient_id, items, total_amount, status, payment_method, payment_date, finalized_at)
        VALUES (?, ?, '[{"description":"Nebulizer kit","amount":2500}]', 2500, 'paid', 'cash', date('now'), CURRENT_TIMESTAMP)
      `)
      .run(consultationId, patientId).lastInsertRowid,
  );

  return { patientId, billingId, caseNumber: `OCS-LH-${stamp}` };
}

function seedLinkhamVisitWithBill({ name, amount, status }) {
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const [firstName, lastName] = String(name).split(" ");
  const patientId = Number(
    db
      .prepare(`
        INSERT INTO patients (
          full_name, first_name, last_name, patient_identifier, patient_id_number,
          age, date_of_birth, gender, contact_number, patient_contact_number,
          address, insurance_provider, insurance_policy_number, link_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Linkham', 'LH-SYNC-001', 'staff_created')
      `)
      .run(
        name,
        firstName,
        lastName,
        `OCS-LH-SYNC-${stamp}`,
        `B280669${String(stamp).replace(/\D/g, "").slice(-6)}F`,
        41,
        "1985-01-12",
        "M",
        "52520001",
        "52520001",
        "Port Louis",
      ).lastInsertRowid,
  );

  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now'), '10:00', 'completed')
    `)
    .run(patientId, doctorId).lastInsertRowid;

  const consultationId = db
    .prepare(`
      INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
      VALUES (?, ?, ?, date('now'), 'Impression: Coverage sync check')
    `)
    .run(appointmentId, patientId, doctorId).lastInsertRowid;

  const billingId = Number(
    db
      .prepare(`
        INSERT INTO billing (
          consultation_id, patient_id, items, total_amount, status, payment_method, payment_date, finalized_at
        ) VALUES (?, ?, ?, ?, ?, ?, ${status === "paid" ? "date('now')" : "NULL"}, CURRENT_TIMESTAMP)
      `)
      .run(
        consultationId,
        patientId,
        JSON.stringify([{ description: "Home visit", amount }]),
        amount,
        status,
        status === "paid" ? "cash" : null,
      ).lastInsertRowid,
  );

  return { patientId, consultationId, billingId };
}

describe("linkham portal", { concurrency: false }, () => {

test("linkham admin cannot open staff clinical, booking, billing, lab or inventory APIs", async () => {
  const forbidden = [
    "/api/patients",
    `/api/patients/${fixture.patientId}`,
    "/api/consultations",
    "/api/appointments",
    "/api/billing",
    "/api/inventory",
    "/api/lab-reports",
    "/api/hcm-news",
  ];

  for (const pathName of forbidden) {
    const response = await api("GET", pathName, { token: linkhamToken });
    assert.equal(
      response.status,
      403,
      `${pathName} should be closed to Linkham: ${JSON.stringify(response.data)}`,
    );
  }
});

test("dashboard shows unpaid 80% totals and a work queue instead of HCM news", async () => {
  const response = await api("GET", "/api/linkham/dashboard", { token: linkhamToken });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.hcmNews, undefined);
  assert.ok(Number(response.data.outstandingEightyLedger) >= 2000);
  assert.ok(Number(response.data.pendingClaimsCount) >= 1);
  assert.ok(Number(response.data.missingPolicyCount) >= 1);
  assert.ok(Number(response.data.totalInsuredClients) >= 1);
});

test("patient detail is diagnosis-only and never verified without a policy number", async () => {
  const response = await api("GET", `/api/linkham/patients/${fixture.patientId}`, {
    token: linkhamToken,
  });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const patient = response.data.patient;
  assert.equal(patient.coverage_status, "needs_policy");
  assert.equal(patient.has_policy_number, false);
  assert.equal(patient.case_history_records, undefined);
  assert.equal(patient.treatment_summary, undefined);
  assert.equal(patient.consultation_notes, undefined);
  assert.equal(patient.ongoing_treatment, undefined);
  assert.equal(patient.doctor_notes, undefined);
  const blob = JSON.stringify(patient);
  assert.equal(blob.includes("BP 140/85"), false);
  assert.equal(blob.includes("SpO2"), false);
  assert.equal(blob.includes("metformin"), false);
  assert.equal(blob.includes("Do not show this"), false);
  assert.equal(blob.includes("Nebulizer"), false);
  const summaries = patient.treatment_summaries || [];
  assert.ok(summaries.length >= 1);
  assert.match(summaries[0].diagnosis, /diabetes/i);
});

test("insured directory search matches OCS number", async () => {
  const response = await api(
    "GET",
    `/api/linkham/patients?search=${encodeURIComponent(fixture.caseNumber)}`,
    { token: linkhamToken },
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.ok(response.data.patients.some((row) => row.id === fixture.patientId));
});

test("insurer policy flags are matched against both policy number and Mauritius ID", async () => {
  const created = await api("POST", "/api/linkham/policies", {
    token: linkhamToken,
    body: {
      policy_number: "12345",
      national_id: "J0605914619061",
      holder_name: "Jean Policyholder",
      coverage_status: "green",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.policy.coverage_status, "green");

  const green = await api(
    "GET",
    "/api/patients/insurance/coverage?policy_number=12345&national_id=J0605914619061",
    { token: operatorToken },
  );
  assert.equal(green.status, 200, JSON.stringify(green.data));
  assert.equal(green.data.coverage.allowed, true);
  assert.equal(green.data.coverage.holder_name, "Jean Policyholder");

  const mismatch = await api(
    "GET",
    "/api/patients/insurance/coverage?policy_number=12345&national_id=J0705914619062",
    { token: operatorToken },
  );
  assert.equal(mismatch.status, 200, JSON.stringify(mismatch.data));
  assert.equal(mismatch.data.coverage.coverage_status, "identity_mismatch");
  assert.equal(mismatch.data.coverage.holder_name, undefined);

  const updated = await api("PUT", `/api/linkham/policies/${created.data.policy.id}`, {
    token: linkhamToken,
    body: {
      ...created.data.policy,
      coverage_status: "red",
      status_reason: "Coverage suspended",
    },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));

  const red = await api(
    "GET",
    "/api/patients/insurance/coverage?policy_number=12345&national_id=J0605914619061",
    { token: operatorToken },
  );
  assert.equal(red.data.coverage.allowed, false);
  assert.equal(red.data.coverage.coverage_status, "red");
  assert.equal(red.data.coverage.status_reason, "Coverage suspended");

  const doctorId = Number(db.prepare("SELECT id FROM doctors WHERE is_active = 1 LIMIT 1").get().id);
  const patientPayload = {
    first_name: "Jean",
    last_name: "Policyholder",
    patient_id_number: "J0605914619061",
    date_of_birth: "1991-05-06",
    gender: "M",
    assigned_doctor_id: doctorId,
    patient_contact_number: "59001234",
    address: "Flacq",
    location: "Flacq",
    location_tags: [
      { category: "Village", name: "Flacq" },
      { category: "Insurance", name: "Linkham" },
    ],
    insurance_provider: "Linkham",
    insurance_policy_number: "12345",
    status: "active",
  };
  const blockedPatient = await api("POST", "/api/patients", {
    token: operatorToken,
    body: patientPayload,
  });
  assert.equal(blockedPatient.status, 409, JSON.stringify(blockedPatient.data));
  assert.equal(blockedPatient.data.code, "INSURANCE_COVERAGE_NOT_ALLOWED");

  const restored = await api("PUT", `/api/linkham/policies/${created.data.policy.id}`, {
    token: linkhamToken,
    body: {
      ...updated.data.policy,
      coverage_status: "green",
      status_reason: "",
    },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));

  const allowedPatient = await api("POST", "/api/patients", {
    token: operatorToken,
    body: patientPayload,
  });
  assert.equal(allowedPatient.status, 201, JSON.stringify(allowedPatient.data));
  assert.equal(allowedPatient.data.insurance_policy_number, "12345");

  const auditCount = Number(
    db.prepare("SELECT COUNT(*) AS count FROM linkham_policy_audit_log WHERE policy_id = ?")
      .get(created.data.policy.id)?.count || 0,
  );
  assert.ok(auditCount >= 7);
});

test("a returning patient's profile updates and dispatch rechecks green status before assignment and en route", async () => {
  const policy = db.prepare("SELECT * FROM linkham_policies WHERE policy_number = '12345'").get();
  const patient = db.prepare("SELECT * FROM patients WHERE insurance_policy_number = '12345' ORDER BY id DESC LIMIT 1").get();
  const doctor = db.prepare("SELECT id FROM doctors WHERE is_active = 1 AND deleted_at IS NULL LIMIT 1").get();
  assert.ok(policy && patient && doctor);

  const greenProfile = await api("GET", `/api/patients/${patient.id}`, { token: operatorToken });
  assert.equal(greenProfile.status, 200, JSON.stringify(greenProfile.data));
  assert.equal(greenProfile.data.patient.linkham_coverage.coverage_status, "green");

  const visitId = Number(db.prepare(`
    INSERT INTO visit_requests (patient_id, address, reason, urgency, status)
    VALUES (?, 'Flacq', 'Coverage recheck', 'routine', 'pending')
  `).run(patient.id).lastInsertRowid);

  const red = await api("PUT", `/api/linkham/policies/${policy.id}`, {
    token: linkhamToken,
    body: { ...policy, coverage_status: "red", status_reason: "Policy suspended overnight" },
  });
  assert.equal(red.status, 200, JSON.stringify(red.data));

  const redProfile = await api("GET", `/api/patients/${patient.id}`, { token: operatorToken });
  assert.equal(redProfile.data.patient.linkham_coverage.coverage_status, "red");
  assert.match(redProfile.data.patient.linkham_coverage.status_reason, /overnight/);

  const blockedAssignment = await api("PATCH", `/api/visit-requests/${visitId}`, {
    token: operatorToken,
    body: { assigned_doctor_id: doctor.id, status: "assigned" },
  });
  assert.equal(blockedAssignment.status, 409, JSON.stringify(blockedAssignment.data));
  assert.equal(blockedAssignment.data.code, "INSURANCE_DISPATCH_NOT_ALLOWED");

  const green = await api("PUT", `/api/linkham/policies/${policy.id}`, {
    token: linkhamToken,
    body: { ...red.data.policy, coverage_status: "green", status_reason: "Coverage restored" },
  });
  assert.equal(green.status, 200, JSON.stringify(green.data));

  const assigned = await api("PATCH", `/api/visit-requests/${visitId}`, {
    token: operatorToken,
    body: { assigned_doctor_id: doctor.id, status: "assigned" },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
  assert.equal(assigned.data.visit_request.dispatch_authorization.coverage_status, "green");

  const redAgain = await api("PUT", `/api/linkham/policies/${policy.id}`, {
    token: linkhamToken,
    body: { ...green.data.policy, coverage_status: "red", status_reason: "New service hold" },
  });
  assert.equal(redAgain.status, 200, JSON.stringify(redAgain.data));

  const blockedEnRoute = await api("PATCH", `/api/visit-requests/${visitId}`, {
    token: operatorToken,
    body: { status: "en_route" },
  });
  assert.equal(blockedEnRoute.status, 409, JSON.stringify(blockedEnRoute.data));

  const restored = await api("PUT", `/api/linkham/policies/${policy.id}`, {
    token: linkhamToken,
    body: { ...redAgain.data.policy, coverage_status: "green", status_reason: "Hold cleared" },
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  const enRoute = await api("PATCH", `/api/visit-requests/${visitId}`, {
    token: operatorToken,
    body: { status: "en_route" },
  });
  assert.equal(enRoute.status, 200, JSON.stringify(enRoute.data));

  await api("PUT", `/api/linkham/policies/${policy.id}`, {
    token: linkhamToken,
    body: { ...restored.data.policy, coverage_status: "red", status_reason: "Future visits blocked" },
  });
  const arrived = await api("PATCH", `/api/visit-requests/${visitId}`, {
    token: operatorToken,
    body: { status: "arrived" },
  });
  assert.equal(arrived.status, 200, JSON.stringify(arrived.data));

  const completed = await api("PATCH", `/api/visit-requests/${visitId}`, {
    token: operatorToken,
    body: { status: "completed" },
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));

  await api("PUT", `/api/linkham/policies/${policy.id}`, {
    token: linkhamToken,
    body: { ...restored.data.policy, coverage_status: "green", status_reason: "" },
  });
});

test("green finalized invoices split patient 20% from Linkham 80% and settlement closes the receivable", async () => {
  const patient = db.prepare("SELECT * FROM patients WHERE insurance_policy_number = '12345' ORDER BY id DESC LIMIT 1").get();
  const doctor = db.prepare("SELECT id FROM doctors WHERE is_active = 1 AND deleted_at IS NULL LIMIT 1").get();
  const appointmentId = Number(db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, date('now', '+4 hours'), '11:00', 'completed')
  `).run(patient.id, doctor.id).lastInsertRowid);
  const consultationId = Number(db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, date('now', '+4 hours'), 'Impression: insured workflow test')
  `).run(appointmentId, patient.id, doctor.id).lastInsertRowid);
  const billingId = Number(db.prepare(`
    INSERT INTO billing (
      consultation_id, patient_id, items, total_amount, status, finalized_at,
      partner_category_snapshot, fee_review_required
    ) VALUES (?, ?, ?, 5000, 'unpaid', CURRENT_TIMESTAMP, 'Linkham', 0)
  `).run(
    consultationId,
    patient.id,
    JSON.stringify([{ description: "Day Consultation", amount: 5000, is_consultation_fee: true }]),
  ).lastInsertRowid);

  const allocation = snapshotBillingLinkhamCoverage(billingId, null);
  assert.equal(allocation.eligible, true);
  assert.equal(allocation.patientShare, 1000);
  assert.equal(allocation.linkhamShare, 4000);

  const pending = await api("GET", "/api/linkham/claims?status=pending", { token: linkhamToken });
  assert.ok((pending.data.claims || []).some((claim) => claim.id === billingId));

  const version = db.prepare("SELECT row_version FROM billing WHERE id = ?").get(billingId).row_version;
  const patientPayment = await api("PATCH", `/api/billing/${billingId}/pay`, {
    token: operatorToken,
    body: {
      amount: 1000,
      payment_method: "cash",
      payment_date: todayInMauritius(),
      expected_version: version,
      operation_id: `linkham-copay-${billingId}`,
    },
  });
  assert.equal(patientPayment.status, 200, JSON.stringify(patientPayment.data));
  assert.equal(patientPayment.data.payment_state, "partial");
  assert.equal(patientPayment.data.patient_payment_balance_amount, 0);
  assert.equal(patientPayment.data.linkham_payment_balance_amount, 4000);

  const extraPatientPayment = await api("PATCH", `/api/billing/${billingId}/pay`, {
    token: operatorToken,
    body: {
      amount: 1,
      payment_method: "cash",
      payment_date: todayInMauritius(),
      expected_version: patientPayment.data.row_version,
      operation_id: `linkham-overpay-${billingId}`,
    },
  });
  assert.equal(extraPatientPayment.status, 409, JSON.stringify(extraPatientPayment.data));
  assert.equal(extraPatientPayment.data.code, "LINKHAM_PATIENT_SHARE_EXCEEDED");

  const approved = await api("PATCH", `/api/linkham/claims/${billingId}/approve`, {
    token: linkhamToken,
    body: {},
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const settled = await api("PATCH", `/api/linkham/claims/${billingId}/settle`, {
    token: linkhamToken,
    body: {
      amount: 4000,
      payment_date: todayInMauritius(),
      remittance_reference: `LKH-TEST-${billingId}`,
    },
  });
  assert.equal(settled.status, 200, JSON.stringify(settled.data));
  assert.equal(settled.data.linkham_claim_status, "settled");
  assert.equal(settled.data.settlement_amount, 4000);

  const paidBill = await api("GET", `/api/billing/${billingId}`, { token: operatorToken });
  assert.equal(paidBill.status, 200, JSON.stringify(paidBill.data));
  assert.equal(paidBill.data.payment_state, "paid");
  assert.equal(paidBill.data.payment_received_amount, 5000);
  assert.equal(paidBill.data.linkham_payment_received_amount, 4000);

  const settlementPayment = db.prepare(`
    SELECT id
    FROM billing_payment_transactions
    WHERE billing_id = ? AND operation_id LIKE 'linkham-settlement:%'
  `).get(billingId);
  assert.ok(settlementPayment?.id);
  const blockedReversal = await api("POST", `/api/billing/${billingId}/payments/${settlementPayment.id}/reverse`, {
    token: operatorToken,
    body: {
      reason: "Incorrect insurer payment",
      reversal_date: todayInMauritius(),
      external_reference: `REV-LKH-${billingId}`,
      operation_id: `reverse-linkham-${billingId}`,
    },
  });
  assert.equal(blockedReversal.status, 409, JSON.stringify(blockedReversal.data));
  assert.equal(blockedReversal.data.code, "LINKHAM_SETTLEMENT_LOCKED");

  const blockedRefund = await api("POST", `/api/billing/${billingId}/refunds`, {
    token: adminToken,
    body: {
      amount: 100,
      refund_method: "cash",
      refund_date: todayInMauritius(),
      reason: "Incorrect insured invoice",
      operation_id: `refund-linkham-${billingId}`,
    },
  });
  assert.equal(blockedRefund.status, 409, JSON.stringify(blockedRefund.data));
  assert.equal(blockedRefund.data.code, "LINKHAM_CLAIM_LOCKED");
});

test("flag requires a reason, then approve and settle keep an audit trail", async () => {
  const missing = await api("PATCH", `/api/linkham/claims/${fixture.billingId}/dispute`, {
    token: linkhamToken,
    body: { dispute_status: "Flagged_Review" },
  });
  assert.equal(missing.status, 400, JSON.stringify(missing.data));

  const flagged = await api("PATCH", `/api/linkham/claims/${fixture.billingId}/dispute`, {
    token: linkhamToken,
    body: { dispute_status: "Flagged_Review", reason: "Confirm visit was a covered home visit." },
  });
  assert.equal(flagged.status, 200, JSON.stringify(flagged.data));
  assert.equal(flagged.data.dispute_status, "Flagged_Review");
  assert.match(flagged.data.dispute_reason, /covered home visit/);
  assert.ok(flagged.data.flagged_by_name);

  const blocked = await api("PATCH", `/api/linkham/claims/${fixture.billingId}/approve`, {
    token: linkhamToken,
    body: {},
  });
  assert.equal(blocked.status, 404);

  const cleared = await api("PATCH", `/api/linkham/claims/${fixture.billingId}/dispute`, {
    token: linkhamToken,
    body: { dispute_status: "Clean" },
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));

  const approved = await api("PATCH", `/api/linkham/claims/${fixture.billingId}/approve`, {
    token: linkhamToken,
    body: {},
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.linkham_claim_status, "approved");
  assert.ok(approved.data.reviewed_by_name);

  const settled = await api("PATCH", `/api/linkham/claims/${fixture.billingId}/settle`, {
    token: linkhamToken,
    body: {
      payment_date: todayInMauritius(),
      remittance_reference: "LKH-LEGACY-001",
      amount: 2000,
    },
  });
  assert.equal(settled.status, 200, JSON.stringify(settled.data));
  assert.equal(settled.data.linkham_claim_status, "settled");
  assert.ok(settled.data.settled_by_name);
});

test("statement CSV is finance lines only", async () => {
  const response = await api("GET", "/api/linkham/claims/statement.csv?status=all", {
    token: linkhamToken,
  });
  assert.equal(response.status, 200);
  assert.match(response.text, /Linkham share 80%/);
  assert.match(response.text, /Lisa Soobrayen/);
  assert.equal(response.text.includes("Nebulizer"), false);
  assert.equal(response.text.includes("metformin"), false);
});

test("home pending and flagged counts match the claim tabs they open", async () => {
  const dashboard = await api("GET", "/api/linkham/dashboard", { token: linkhamToken });
  const pending = await api("GET", "/api/linkham/claims?status=pending", { token: linkhamToken });
  const flagged = await api("GET", "/api/linkham/claims?status=flagged", { token: linkhamToken });
  const approved = await api(
    "GET",
    `/api/linkham/claims?status=approved&month=${encodeURIComponent(dashboard.data.currentMonthKey)}`,
    { token: linkhamToken },
  );

  assert.equal(dashboard.status, 200, JSON.stringify(dashboard.data));
  assert.equal(pending.status, 200);
  assert.equal(flagged.status, 200);
  assert.equal(Number(dashboard.data.pendingCleanCount), pending.data.claims.length);
  assert.equal(Number(dashboard.data.flaggedClaimsCount), flagged.data.claims.length);
  const approvedShare = (approved.data.claims || []).reduce(
    (sum, claim) => sum + Number(claim.linkham_share_amount || 0),
    0,
  );
  assert.equal(
    Number(dashboard.data.monthlyApprovedAmount),
    Number(approvedShare.toFixed(2)),
  );
});

test("staff payment of a Linkham bill becomes a claim, and a flag reason reaches staff billing", async () => {
  const staffLogin = await api("POST", "/api/auth/login", {
    body: { username: "shravan.joaheer", password: "Welcome@123" },
  });
  assert.equal(staffLogin.status, 200, JSON.stringify(staffLogin.data));
  const staffToken = staffLogin.data.token;

  const unpaid = seedLinkhamVisitWithBill({
    name: "Ravi Synccheck",
    amount: 4000,
    status: "unpaid",
  });

  const beforePay = await api("GET", "/api/linkham/claims?status=pending", { token: linkhamToken });
  assert.equal(
    (beforePay.data.claims || []).some((claim) => claim.id === unpaid.billingId),
    false,
    "unpaid bills must stay off the insurer ledger",
  );

  const paid = await api("PATCH", `/api/billing/${unpaid.billingId}/pay`, {
    token: staffToken,
    body: { payment_method: "cash", payment_date: "2026-09-09", expected_version: db.prepare("SELECT row_version FROM billing WHERE id=?").get(unpaid.billingId).row_version },
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));

  const afterPay = await api("GET", "/api/linkham/claims?status=pending", { token: linkhamToken });
  const pendingClaim = (afterPay.data.claims || []).find((claim) => claim.id === unpaid.billingId);
  assert.ok(pendingClaim, "paid Linkham bill should appear on the pending tab");
  assert.equal(Number(pendingClaim.linkham_share_amount), 3200);

  const flagged = await api("PATCH", `/api/linkham/claims/${unpaid.billingId}/dispute`, {
    token: linkhamToken,
    body: { dispute_status: "Flagged_Review", reason: "Need referral letter for this visit." },
  });
  assert.equal(flagged.status, 200, JSON.stringify(flagged.data));

  const pendingAfterFlag = await api("GET", "/api/linkham/claims?status=pending", {
    token: linkhamToken,
  });
  const flaggedList = await api("GET", "/api/linkham/claims?status=flagged", { token: linkhamToken });
  assert.equal(
    (pendingAfterFlag.data.claims || []).some((claim) => claim.id === unpaid.billingId),
    false,
  );
  assert.ok((flaggedList.data.claims || []).some((claim) => claim.id === unpaid.billingId));

  const staffBill = await api("GET", `/api/billing/${unpaid.billingId}`, { token: staffToken });
  assert.equal(staffBill.status, 200, JSON.stringify(staffBill.data));
  assert.equal(staffBill.data.dispute_status, "Flagged_Review");
  assert.match(staffBill.data.dispute_reason, /referral letter/);
});

test("claim eligibility is frozen on the invoice and voided visits stay off the insurer ledger", async () => {
  const snapshotted = seedLinkhamVisitWithBill({
    name: "Snapshot Cover",
    amount: 3000,
    status: "paid",
  });
  db.prepare("UPDATE billing SET partner_category_snapshot='Linkham' WHERE id=?").run(snapshotted.billingId);
  db.prepare("UPDATE patients SET insurance_provider='Self-pay' WHERE id=?").run(snapshotted.patientId);

  const afterPatientChange = await api("GET", "/api/linkham/claims?status=pending", { token: linkhamToken });
  assert.equal(afterPatientChange.status, 200, JSON.stringify(afterPatientChange.data));
  assert.ok(
    (afterPatientChange.data.claims || []).some((claim) => claim.id === snapshotted.billingId),
    "changing the patient's current insurer must not rewrite an issued claim",
  );

  db.prepare("UPDATE consultations SET voided_at=CURRENT_TIMESTAMP WHERE id=?").run(snapshotted.consultationId);
  const afterVoid = await api("GET", "/api/linkham/claims?status=pending", { token: linkhamToken });
  assert.equal(
    (afterVoid.data.claims || []).some((claim) => claim.id === snapshotted.billingId),
    false,
    "voided visits must not remain claimable",
  );
});
});
