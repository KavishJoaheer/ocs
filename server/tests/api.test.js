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
