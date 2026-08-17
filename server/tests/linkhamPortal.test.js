"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const TMP_DB = path.join(os.tmpdir(), `ocs-linkham-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = "test";

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { db } = require("../src/db");

let server;
let baseUrl;
let linkhamToken;
let fixture;

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
        INSERT INTO billing (consultation_id, patient_id, items, total_amount, status, payment_method, payment_date)
        VALUES (?, ?, '[{"description":"Nebulizer kit","amount":2500}]', 2500, 'paid', 'cash', date('now'))
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
          consultation_id, patient_id, items, total_amount, status, payment_method, payment_date
        ) VALUES (?, ?, ?, ?, ?, ?, ${status === "paid" ? "date('now')" : "NULL"})
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

  return { patientId, billingId };
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
    body: {},
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
    body: { payment_method: "cash" },
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
});
