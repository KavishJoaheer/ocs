"use strict";

// Use an isolated, throwaway SQLite database for the whole suite. This MUST be
// set before requiring the app, because db.js opens the database at load time.
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const TMP_DB = path.join(
  os.tmpdir(),
  `ocs-test-${process.pid}-${Date.now()}.db`,
);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { db } = require("../src/db");

let server;
let baseUrl;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
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

function uniqueEmail(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.local`;
}

let adminToken;

test("staff admin can log in", async () => {
  const res = await api("POST", "/api/auth/login", {
    body: { username: "shravan.joaheer", password: "Welcome@123" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.ok(res.data.token, "expected an auth token");
  adminToken = res.data.token;
});

test("patient registration returns a normalized profile", async () => {
  const email = uniqueEmail("profile");
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email,
      password: "secret123",
      full_name: "Profile Tester",
      phone: "57001122",
      date_of_birth: "1990-05-05",
      gender: "M",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const token = reg.data.token;

  const profile = await api("GET", "/api/patient-portal/profile", { token });
  assert.equal(profile.status, 200);
  assert.ok(profile.data.profile, "expected a normalized profile object");
  assert.equal(profile.data.profile.phone, "57001122");
  assert.equal(profile.data.profile.date_of_birth, "1990-05-05");
  assert.equal(profile.data.profile.gender, "M");
  assert.ok(
    String(profile.data.profile.ocs_care_number || "").startsWith("OCS-"),
    "expected an OCS care number",
  );
});

test("PATCH /profile persists contact + next-of-kin details", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("patch"),
      password: "secret123",
      full_name: "Patch Tester",
      phone: "57003344",
      date_of_birth: "1985-01-01",
      gender: "F",
    },
  });
  const token = reg.data.token;

  const updated = await api("PATCH", "/api/patient-portal/profile", {
    token,
    body: {
      address: "12 Test Road",
      next_of_kin_name: "Jane Doe",
      next_of_kin_phone: "59990000",
    },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.profile.address, "12 Test Road");
  assert.equal(updated.data.profile.next_of_kin_phone, "59990000");
});

test("self-registration links to an existing staff record via national ID", async () => {
  // Seed a staff-created patient with a national ID.
  const nationalId = `NID-${Date.now()}`;
  const insert = db
    .prepare(`
      INSERT INTO patients (
        full_name, first_name, last_name, patient_identifier, patient_id_number,
        age, date_of_birth, gender, contact_number, patient_contact_number,
        address, link_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created')
    `)
    .run(
      "Linked Patient",
      "Linked",
      "Patient",
      `OCS-NID-${Date.now()}`,
      nationalId,
      40,
      "1984-02-02",
      "M",
      "57009999",
      "57009999",
      "Sky Garden, Quatre Bornes",
    );
  const staffPatientId = Number(insert.lastInsertRowid);

  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("link"),
      password: "secret123",
      full_name: "Linked Patient",
      phone: "57005566",
      national_id: nationalId,
      date_of_birth: "1984-02-02",
      gender: "M",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));

  // The portal account should now read the staff record's data (same row).
  const profile = await api("GET", "/api/patient-portal/profile", {
    token: reg.data.token,
  });
  assert.equal(profile.data.profile.id, staffPatientId, "should link to staff row");
  assert.equal(profile.data.profile.address, "Sky Garden, Quatre Bornes");

  // The staff record should be flagged as pending review.
  const row = db.prepare("SELECT link_status FROM patients WHERE id = ?").get(staffPatientId);
  assert.equal(row.link_status, "pending_review");

  // A second account claiming the same national ID must be rejected.
  const dup = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("link2"),
      password: "secret123",
      full_name: "Imposter",
      phone: "57007788",
      national_id: nationalId,
      date_of_birth: "1984-02-02",
      gender: "M",
    },
  });
  assert.equal(dup.status, 409, JSON.stringify(dup.data));

  // Staff can verify the link.
  const verified = await api("PATCH", `/api/patients/${staffPatientId}/verify-link`, {
    token: adminToken,
    body: { verified: true },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  assert.equal(verified.data.link_status, "verified");
});

test("staff can merge a duplicate patient into the canonical record", async () => {
  // Canonical staff record.
  const targetInsert = db
    .prepare(`
      INSERT INTO patients (
        full_name, first_name, last_name, patient_identifier, patient_id_number,
        age, date_of_birth, gender, contact_number, patient_contact_number,
        address, link_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created')
    `)
    .run(
      "Merge Target",
      "Merge",
      "Target",
      `OCS-MERGE-${Date.now()}`,
      `NID-TARGET-${Date.now()}`,
      50,
      "1974-01-01",
      "F",
      "57001111",
      "57001111",
      "Real Chart Address",
    );
  const targetId = Number(targetInsert.lastInsertRowid);

  // A self-registered duplicate (separate patient + portal account).
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("dup"),
      password: "secret123",
      full_name: "Merge Target",
      phone: "57002222",
      date_of_birth: "1974-01-01",
      gender: "F",
    },
  });
  const dupToken = reg.data.token;
  const dupProfile = await api("GET", "/api/patient-portal/profile", { token: dupToken });
  const sourceId = dupProfile.data.profile.id;
  assert.notEqual(sourceId, targetId);

  const merged = await api("POST", `/api/patients/${targetId}/merge`, {
    token: adminToken,
    body: { source_id: sourceId },
  });
  assert.equal(merged.status, 200, JSON.stringify(merged.data));
  assert.equal(merged.data.link_status, "verified");

  // Source is soft-deleted and flagged merged.
  const sourceRow = db
    .prepare("SELECT deleted_at, link_status FROM patients WHERE id = ?")
    .get(sourceId);
  assert.ok(sourceRow.deleted_at, "source should be soft-deleted");
  assert.equal(sourceRow.link_status, "merged");

  // The duplicate's portal account now resolves to the canonical chart.
  const after = await api("GET", "/api/patient-portal/profile", { token: dupToken });
  assert.equal(after.data.profile.id, targetId);
  assert.equal(after.data.profile.address, "Real Chart Address");

  // Merging into self is rejected.
  const selfMerge = await api("POST", `/api/patients/${targetId}/merge`, {
    token: adminToken,
    body: { source_id: targetId },
  });
  assert.equal(selfMerge.status, 400);
});

test("home-visit request flows patient -> staff -> patient", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("visit"),
      password: "secret123",
      full_name: "Visit Tester",
      phone: "57001234",
      date_of_birth: "1992-03-03",
      gender: "F",
    },
  });
  const token = reg.data.token;

  const created = await api("POST", "/api/patient-portal/visit-requests", {
    token,
    body: { address: "5 Clinic Ave", reason: "Fever", urgency: "urgent" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const requestId = created.data.visit_request.id;

  // Duplicate active request is rejected.
  const dup = await api("POST", "/api/patient-portal/visit-requests", {
    token,
    body: { address: "x", reason: "y" },
  });
  assert.equal(dup.status, 409);

  // Staff sees it and assigns a doctor.
  const list = await api("GET", "/api/visit-requests?status=active", {
    token: adminToken,
  });
  assert.equal(list.status, 200);
  assert.ok(list.data.visit_requests.some((r) => r.id === requestId));

  const doctors = await api("GET", "/api/doctors", { token: adminToken });
  const doctorId = (doctors.data.doctors || doctors.data)[0].id;

  const assigned = await api("PATCH", `/api/visit-requests/${requestId}`, {
    token: adminToken,
    body: { status: "en_route", assigned_doctor_id: doctorId, eta_minutes: 15 },
  });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.data));

  // Patient sees the live doctor + status.
  const active = await api("GET", "/api/patient-portal/visit-requests/active", {
    token,
  });
  assert.equal(active.data.visit_request.status, "en_route");
  assert.equal(active.data.visit_request.eta_minutes, 15);
  assert.ok(active.data.visit_request.doctor_name);
});

test("patient can cancel a pending visit request", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("cancel"),
      password: "secret123",
      full_name: "Cancel Tester",
      phone: "57007777",
      date_of_birth: "1991-01-01",
      gender: "F",
    },
  });
  const token = reg.data.token;

  const created = await api("POST", "/api/patient-portal/visit-requests", {
    token,
    body: { address: "Rose Hill", reason: "Headache", urgency: "routine" },
  });
  assert.equal(created.status, 201);
  const requestId = created.data.visit_request.id;

  const cancelled = await api("PATCH", `/api/patient-portal/visit-requests/${requestId}/cancel`, {
    token,
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.visit_request.status, "cancelled");

  const active = await api("GET", "/api/patient-portal/visit-requests/active", { token });
  assert.equal(active.data.visit_request, null);
});

test("patient cannot cancel a visit after the doctor has arrived", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("no-cancel"),
      password: "secret123",
      full_name: "No Cancel Tester",
      phone: "57008888",
      date_of_birth: "1990-02-02",
      gender: "M",
    },
  });
  const token = reg.data.token;

  const created = await api("POST", "/api/patient-portal/visit-requests", {
    token,
    body: { address: "Quatre Bornes", reason: "Check-up", urgency: "routine" },
  });
  const requestId = created.data.visit_request.id;

  const doctors = await api("GET", "/api/doctors", { token: adminToken });
  const doctorId = (doctors.data.doctors || doctors.data)[0].id;

  const arrived = await api("PATCH", `/api/visit-requests/${requestId}`, {
    token: adminToken,
    body: { status: "arrived", assigned_doctor_id: doctorId },
  });
  assert.equal(arrived.status, 200);

  const denied = await api("PATCH", `/api/patient-portal/visit-requests/${requestId}/cancel`, {
    token,
  });
  assert.equal(denied.status, 400);
});

test("doctors only see assigned visit requests and can complete consultation", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("doctor-visit"),
      password: "secret123",
      full_name: "Doctor Visit Tester",
      phone: "57009999",
      date_of_birth: "1988-08-08",
      gender: "M",
    },
  });
  const patientToken = reg.data.token;

  const created = await api("POST", "/api/patient-portal/visit-requests", {
    token: patientToken,
    body: { address: "12 Home Lane", reason: "Cough", urgency: "routine" },
  });
  assert.equal(created.status, 201);
  const requestId = created.data.visit_request.id;

  const doctorLogin = await api("POST", "/api/auth/login", {
    body: { username: "arun.dharee", password: "Welcome@123" },
  });
  assert.equal(doctorLogin.status, 200);
  const doctorToken = doctorLogin.data.token;

  const doctorBeforeAssign = await api("GET", "/api/visit-requests?status=active", {
    token: doctorToken,
  });
  assert.equal(doctorBeforeAssign.status, 200);
  assert.equal(
    doctorBeforeAssign.data.visit_requests.some((row) => row.id === requestId),
    false,
    "unassigned requests must not appear for doctors",
  );

  const doctors = await api("GET", "/api/doctors", { token: adminToken });
  const doctorId = (doctors.data.doctors || doctors.data).find(
    (doctor) => doctor.full_name === "Arun Dharee",
  )?.id;
  assert.ok(doctorId);

  const assigned = await api("PATCH", `/api/visit-requests/${requestId}`, {
    token: adminToken,
    body: { status: "arrived", assigned_doctor_id: doctorId },
  });
  assert.equal(assigned.status, 200);

  const doctorAfterAssign = await api("GET", "/api/visit-requests?status=active", {
    token: doctorToken,
  });
  assert.ok(doctorAfterAssign.data.visit_requests.some((row) => row.id === requestId));

  const deniedReassign = await api("PATCH", `/api/visit-requests/${requestId}`, {
    token: doctorToken,
    body: { assigned_doctor_id: doctorId },
  });
  assert.equal(deniedReassign.status, 403);

  const started = await api("PATCH", `/api/visit-requests/${requestId}`, {
    token: doctorToken,
    body: { status: "in_consultation" },
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.visit_request.status, "in_consultation");

  const completed = await api("PATCH", `/api/visit-requests/${requestId}`, {
    token: doctorToken,
    body: { status: "completed" },
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.data.visit_request.status, "completed");
});

test("staff long-term review surfaces as an upcoming patient appointment", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("review"),
      password: "secret123",
      full_name: "Review Tester",
      phone: "57004321",
      date_of_birth: "1979-09-09",
      gender: "M",
    },
  });
  const token = reg.data.token;
  const patientId = (await api("GET", "/api/patient-portal/profile", { token })).data.profile.id;

  const flagged = await api("PATCH", `/api/patients/${patientId}/long-term-review`, {
    token: adminToken,
    body: {
      is_under_review: true,
      review_reason_note: "Check up by Dr Joaheer",
      review_due_date: "2026-07-19",
    },
  });
  assert.equal(flagged.status, 200, JSON.stringify(flagged.data));

  const appts = await api("GET", "/api/patient-portal/appointments", { token });
  const review = (appts.data.appointments || []).find((a) => a.kind === "review");
  assert.ok(review, "expected a review item in appointments");
  assert.equal(review.appointment_date, "2026-07-19");
  assert.equal(review.status, "scheduled");
});

test("patient dashboard returns stats and recent activity", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("dashboard"),
      password: "secret123",
      full_name: "Dashboard Tester",
      phone: "57005555",
      date_of_birth: "1985-04-04",
      gender: "F",
    },
  });
  const token = reg.data.token;
  const patientId = (await api("GET", "/api/patient-portal/profile", { token })).data.profile.id;
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;

  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now', '+3 day'), '11:00', 'scheduled')
    `)
    .run(patientId, doctorId).lastInsertRowid;

  db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, date('now', '-1 day'), 'Patient improving.\nImp: Seasonal allergy')
  `).run(appointmentId, patientId, doctorId);

  const dashboard = await api("GET", "/api/patient-portal/dashboard", { token });
  assert.equal(dashboard.status, 200, JSON.stringify(dashboard.data));
  assert.equal(dashboard.data.stats.upcoming_appointments, 1);
  assert.equal(dashboard.data.stats.total_visits, 1);
  assert.ok(Array.isArray(dashboard.data.recent_activity));
  assert.equal(dashboard.data.recent_activity.length, 1);
  assert.match(dashboard.data.recent_activity[0].description, /Seasonal allergy/i);
});

test("patient billing returns bills and summary totals", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("billing"),
      password: "secret123",
      full_name: "Billing Tester",
      phone: "57006666",
      date_of_birth: "1983-02-02",
      gender: "M",
    },
  });
  const token = reg.data.token;
  const patientId = (await api("GET", "/api/patient-portal/profile", { token })).data.profile.id;
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;

  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now', '-2 day'), '09:00', 'completed')
    `)
    .run(patientId, doctorId).lastInsertRowid;

  const consultationId = db
    .prepare(`
      INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
      VALUES (?, ?, ?, date('now', '-2 day'), 'Routine review')
    `)
    .run(appointmentId, patientId, doctorId).lastInsertRowid;

  db.prepare(`
    INSERT INTO billing (consultation_id, patient_id, items, total_amount, status, payment_method, payment_date)
    VALUES (?, ?, ?, ?, 'paid', 'cash', date('now', '-2 day'))
  `).run(
    consultationId,
    patientId,
    JSON.stringify([{ description: "General Consultation", amount: 95 }]),
    95,
  );

  db.prepare(`
    INSERT INTO billing (consultation_id, patient_id, items, total_amount, status)
    VALUES (?, ?, ?, ?, 'unpaid')
  `).run(
    consultationId,
    patientId,
    JSON.stringify([{ description: "Lab coordination", amount: 35 }]),
    35,
  );

  const billing = await api("GET", "/api/patient-portal/billing", { token });
  assert.equal(billing.status, 200, JSON.stringify(billing.data));
  assert.equal(billing.data.bills.length, 2);
  assert.equal(billing.data.summary.total_billed, 130);
  assert.equal(billing.data.summary.total_paid, 95);
  assert.equal(billing.data.summary.outstanding, 35);
  assert.match(billing.data.bills[0].items_summary, /Consultation|Lab/i);
});
