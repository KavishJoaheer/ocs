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
const { db, labReportAttachmentsDir } = require("../src/db");
const { parseMauritianID } = require("../src/lib/nicParser");
const { getTodayLocal } = require("../src/lib/utils");

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

async function api(method, urlPath, { token, body, headers: extraHeaders } = {}) {
  const headers = { ...(extraHeaders || {}) };
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

function uniqueNationalId(prefix) {
  return `TEST-${prefix}-${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function uniqueMauritianNic() {
  const serial = `${String(Date.now()).slice(-5)}${Math.floor(Math.random() * 10)}`;
  return `B290493${serial}F`;
}

async function verifyPortalPatientForVisits(reg) {
  const patientId = reg.data.user.patient_id;
  assert.ok(patientId, JSON.stringify(reg.data));

  const verified = await api("PATCH", `/api/patients/${patientId}/verify-link`, {
    token: adminToken,
    body: { verified: true },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
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
      national_id: uniqueNationalId("api"),
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
  assert.equal(reg.data.user.link_status, "self_registered");
  assert.ok(
    String(profile.data.profile.ocs_care_number || "").startsWith("OCS-"),
    "expected an OCS care number",
  );
});

test("patient registration derives DOB and age from a Mauritian NIC", async () => {
  const nationalId = uniqueMauritianNic();
  const parsed = parseMauritianID(nationalId);
  assert.ok(parsed, `expected ${nationalId} to parse`);
  assert.equal(parsed.isoDob, "1993-04-29");

  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("nic"),
      password: "secret123",
      full_name: "Nic Tester",
      phone: "57001122",
      national_id: nationalId.toLowerCase(),
      gender: "F",
      date_of_birth: "2000-01-01",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  assert.equal(reg.data.user.date_of_birth, "1993-04-29");
  assert.equal(reg.data.user.gender, "F");

  const profile = await api("GET", "/api/patient-portal/profile", { token: reg.data.token });
  assert.equal(profile.status, 200);
  assert.equal(profile.data.profile.date_of_birth, "1993-04-29");
  assert.equal(profile.data.profile.age, parsed.age);
  assert.equal(profile.data.profile.gender, "F");
  assert.equal(profile.data.profile.patient_id_number, nationalId);
});

test("patient registration rejects an invalid 14-character NIC", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("badnic"),
      password: "secret123",
      full_name: "Bad Nic",
      phone: "57001122",
      national_id: "B320493310239F",
      gender: "M",
    },
  });
  assert.equal(reg.status, 400, JSON.stringify(reg.data));
  assert.match(String(reg.data.error || ""), /national id/i);
});

test("self-registration does not overwrite staff DOB or gender when linking", async () => {
  const nationalId = uniqueMauritianNic();
  const insert = db
    .prepare(`
      INSERT INTO patients (
        full_name, first_name, last_name, patient_identifier, patient_id_number,
        age, date_of_birth, gender, contact_number, patient_contact_number,
        address, link_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created')
    `)
    .run(
      "Staff Chart",
      "Staff",
      "Chart",
      `OCS-${900000 + (Date.now() % 100000)}`,
      nationalId,
      46,
      "1980-01-15",
      "M",
      "57009999",
      "57009999",
      "Quatre Bornes",
    );

  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("staffnic"),
      password: "secret123",
      full_name: "Staff Chart",
      phone: "57005566",
      national_id: nationalId,
      gender: "F",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  assert.equal(reg.data.user.date_of_birth, "1980-01-15");
  assert.equal(reg.data.user.gender, "M");

  // The chart itself stays closed until staff confirm the link, so assert the
  // staff values on the row rather than through the portal.
  const linkedRow = db
    .prepare("SELECT date_of_birth, gender FROM patients WHERE id = ?")
    .get(Number(insert.lastInsertRowid));
  assert.equal(linkedRow.date_of_birth, "1980-01-15");
  assert.equal(linkedRow.gender, "M");

  const linkedUser = db
    .prepare("SELECT patient_id FROM patient_users WHERE lower(email) = lower(?)")
    .get(reg.data.user.email);
  assert.equal(Number(linkedUser.patient_id), Number(insert.lastInsertRowid));
});

test("PATCH /profile persists contact + next-of-kin details", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("patch"),
      password: "secret123",
      full_name: "Patch Tester",
      phone: "57003344",
      national_id: uniqueNationalId("api"),
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
  assert.equal(reg.data.user.link_status, "pending_review");

  // The account points at the staff row, but the chart stays closed until staff
  // confirm the link, so the address is checked after verification below.
  const linkedUser = db
    .prepare("SELECT patient_id FROM patient_users WHERE lower(email) = lower(?)")
    .get(reg.data.user.email);
  assert.equal(Number(linkedUser.patient_id), staffPatientId, "should link to staff row");

  // The staff record should be flagged as pending review.
  const row = db.prepare("SELECT link_status FROM patients WHERE id = ?").get(staffPatientId);
  assert.equal(row.link_status, "pending_review");

  // A second account claiming the same national ID must not lock the real
  // patient out. It gets its own self-registered chart instead of 409.
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
  assert.equal(dup.status, 201, JSON.stringify(dup.data));
  assert.equal(dup.data.user.link_status, "self_registered");
  assert.notEqual(Number(dup.data.user.patient_id), staffPatientId);

  const stillPending = db.prepare("SELECT link_status FROM patients WHERE id = ?").get(staffPatientId);
  assert.equal(stillPending.link_status, "pending_review");

  // Staff can verify the link.
  const verified = await api("PATCH", `/api/patients/${staffPatientId}/verify-link`, {
    token: adminToken,
    body: { verified: true },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));
  assert.equal(verified.data.link_status, "verified");

  const profileAfterVerify = await api("GET", "/api/patient-auth/me", {
    token: reg.data.token,
  });
  assert.equal(profileAfterVerify.data.user.link_status, "verified");

  // Confirming the link is what opens the chart.
  const profile = await api("GET", "/api/patient-portal/profile", {
    token: reg.data.token,
  });
  assert.equal(profile.status, 200, JSON.stringify(profile.data));
  assert.equal(profile.data.profile.id, staffPatientId);
  assert.equal(profile.data.profile.address, "Sky Garden, Quatre Bornes");

  const afterVerifyDup = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("link3"),
      password: "secret123",
      full_name: "Late Claim",
      phone: "57007799",
      national_id: nationalId,
      date_of_birth: "1984-02-02",
      gender: "M",
    },
  });
  assert.equal(afterVerifyDup.status, 409, JSON.stringify(afterVerifyDup.data));
});

test("pending portal link cannot request a home visit until verified", async () => {
  const nationalId = `NID-VISIT-${Date.now()}`;
  db.prepare(`
    INSERT INTO patients (
      full_name, first_name, last_name, patient_identifier, patient_id_number,
      age, date_of_birth, gender, contact_number, patient_contact_number,
      address, link_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created')
  `).run(
    "Visit Gate Patient",
    "Visit",
    "Gate",
    `STAFF-VG-${Date.now()}`,
    nationalId,
    38,
    "1986-03-03",
    "F",
    "57008888",
    "57008888",
    "Rose Hill",
  );

  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("visit-gate"),
      password: "secret123",
      full_name: "Visit Gate Patient",
      phone: "57008889",
      national_id: nationalId,
      date_of_birth: "1986-03-03",
      gender: "F",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  assert.equal(reg.data.user.link_status, "pending_review");

  const blocked = await api("POST", "/api/patient-portal/visit-requests", {
    token: reg.data.token,
    body: { address: "12 Home Lane", reason: "Fever", urgency: "routine" },
  });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(blocked.data.code, "account_link_pending");
});

test("a claimed chart stays closed until staff confirm the link", async () => {
  // Signup matches an existing chart on national ID alone, so until staff
  // confirm the person, none of that chart may be readable or writable.
  const nationalId = `NID-CLAIM-${Date.now()}`;
  const secretAddress = "Villa Konfidansiel, Curepipe";
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;

  const victimId = Number(
    db
      .prepare(`
        INSERT INTO patients (
          full_name, first_name, last_name, patient_identifier, patient_id_number,
          age, date_of_birth, gender, contact_number, patient_contact_number,
          address, link_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created')
      `)
      .run(
        "Claimed Chart",
        "Claimed",
        "Chart",
        `OCS-CLAIM-${Date.now()}`,
        nationalId,
        52,
        "1974-06-06",
        "F",
        "57001010",
        "57001010",
        secretAddress,
      ).lastInsertRowid,
  );

  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now'), '09:00', 'completed')
    `)
    .run(victimId, doctorId).lastInsertRowid;

  const consultationId = db
    .prepare(`
      INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
      VALUES (?, ?, ?, date('now'), 'Impression: hypertension. Rx: amlodipine 5mg.')
    `)
    .run(appointmentId, victimId, doctorId).lastInsertRowid;

  db.prepare(`
    INSERT INTO billing (consultation_id, patient_id, items, total_amount, status)
    VALUES (?, ?, '[]', 1500, 'unpaid')
  `).run(consultationId, victimId);

  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("claim"),
      password: "secret123",
      full_name: "Claimed Chart",
      phone: "57002020",
      national_id: nationalId,
      date_of_birth: "1974-06-06",
      gender: "F",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  assert.equal(reg.data.user.link_status, "pending_review");
  const token = reg.data.token;

  const readPaths = [
    "/api/patient-portal/profile",
    "/api/patient-portal/dashboard",
    "/api/patient-portal/health-records",
    "/api/patient-portal/billing",
    "/api/patient-portal/appointments",
    "/api/patient-portal/dependents",
    "/api/patient-portal/visit-requests/active",
  ];

  for (const path of readPaths) {
    const response = await api("GET", path, { token });
    assert.equal(response.status, 409, `${path} should be gated: ${JSON.stringify(response.data)}`);
    assert.equal(response.data.code, "account_link_pending", path);
    assert.ok(
      !JSON.stringify(response.data).includes(secretAddress),
      `${path} must not leak the claimed chart`,
    );
  }

  // The live-refresh stream stays available so the app notices the moment staff
  // confirm the link. This also proves the gate's exempt paths still match.
  const streamToken = await api("POST", "/api/patient-portal/stream-token", { token });
  assert.equal(streamToken.status, 200, JSON.stringify(streamToken.data));
  const vapid = await api("GET", "/api/patient-portal/push/vapid-public-key", { token });
  assert.notEqual(vapid.status, 409, "push key lookup carries no chart data");

  // Writing into someone else's record must be refused too.
  const write = await api("PATCH", "/api/patient-portal/profile", {
    token,
    body: { address: "Attacker Street 1" },
  });
  assert.equal(write.status, 409, JSON.stringify(write.data));
  const untouched = db.prepare("SELECT address FROM patients WHERE id = ?").get(victimId);
  assert.equal(untouched.address, secretAddress, "a pending account must not edit the chart");

  // Staff confirming the link is what grants access.
  const verified = await api("PATCH", `/api/patients/${victimId}/verify-link`, {
    token: adminToken,
    body: { verified: true },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));

  const afterVerify = await api("GET", "/api/patient-portal/health-records", { token });
  assert.equal(afterVerify.status, 200, JSON.stringify(afterVerify.data));
});

test("a self-registered account still reads the chart its own signup created", async () => {
  // Nothing to protect here: the chart was created by this signup, so gating it
  // would lock a genuine new patient out of their own portal.
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("fresh"),
      password: "secret123",
      full_name: "Fresh Signup",
      phone: "57003030",
      national_id: uniqueNationalId("fresh"),
      date_of_birth: "1996-07-07",
      gender: "M",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  assert.equal(reg.data.user.link_status, "self_registered");
  const token = reg.data.token;

  for (const path of [
    "/api/patient-portal/profile",
    "/api/patient-portal/dashboard",
    "/api/patient-portal/health-records",
    "/api/patient-portal/billing",
  ]) {
    const response = await api("GET", path, { token });
    assert.equal(response.status, 200, `${path} should stay open: ${JSON.stringify(response.data)}`);
  }
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
      national_id: uniqueNationalId("api"),
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
      national_id: uniqueNationalId("api"),
      date_of_birth: "1992-03-03",
      gender: "F",
    },
  });
  const token = reg.data.token;
  await verifyPortalPatientForVisits(reg);

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
      national_id: uniqueNationalId("api"),
      date_of_birth: "1991-01-01",
      gender: "F",
    },
  });
  const token = reg.data.token;
  await verifyPortalPatientForVisits(reg);

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
      national_id: uniqueNationalId("api"),
      date_of_birth: "1990-02-02",
      gender: "M",
    },
  });
  const token = reg.data.token;
  await verifyPortalPatientForVisits(reg);

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
      national_id: uniqueNationalId("api"),
      date_of_birth: "1988-08-08",
      gender: "M",
    },
  });
  const patientToken = reg.data.token;
  await verifyPortalPatientForVisits(reg);

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
      national_id: uniqueNationalId("api"),
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
      national_id: uniqueNationalId("api"),
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
  assert.ok(dashboard.data.next_appointment);
  assert.ok(dashboard.data.next_appointment.date);
  assert.equal(dashboard.data.next_appointment.time, "11:00");
  assert.ok(dashboard.data.next_appointment.doctor_name);
});

test("patient dashboard upcoming uses clinic-local today", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("local-today"),
      password: "secret123",
      full_name: "Local Today Tester",
      phone: "57006666",
      national_id: uniqueNationalId("api"),
      date_of_birth: "1982-02-02",
      gender: "M",
    },
  });
  const token = reg.data.token;
  const patientId = (await api("GET", "/api/patient-portal/profile", { token })).data.profile.id;
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
  const today = getTodayLocal();

  db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, '08:00', 'scheduled')
  `).run(patientId, doctorId, today);

  db.prepare(`
    INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, '1999-01-01', '09:00', 'scheduled')
  `).run(patientId, doctorId);

  const dashboard = await api("GET", "/api/patient-portal/dashboard", { token });
  assert.equal(dashboard.status, 200, JSON.stringify(dashboard.data));
  assert.equal(dashboard.data.stats.upcoming_appointments, 1);
  assert.equal(String(dashboard.data.next_appointment.date).slice(0, 10), today);
});

test("staff booking and cancelling an appointment stays on the patient dashboard", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("staff-book"),
      password: "secret123",
      full_name: "Staff Book Tester",
      phone: "57008888",
      national_id: uniqueNationalId("api"),
      date_of_birth: "1979-09-09",
      gender: "F",
    },
  });
  const token = reg.data.token;
  const patientId = (await api("GET", "/api/patient-portal/profile", { token })).data.profile.id;
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;

  const created = await api("POST", "/api/appointments", {
    token: adminToken,
    body: {
      patient_id: patientId,
      doctor_id: doctorId,
      appointment_date: getTodayLocal(),
      appointment_time: "14:00",
      status: "scheduled",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const afterBook = await api("GET", "/api/patient-portal/dashboard", { token });
  assert.equal(afterBook.data.stats.upcoming_appointments, 1);

  const cancelled = await api("PATCH", `/api/appointments/${created.data.id}/status`, {
    token: adminToken,
    body: { status: "cancelled" },
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.status, "cancelled");

  const afterCancel = await api("GET", "/api/patient-portal/dashboard", { token });
  assert.equal(afterCancel.data.stats.upcoming_appointments, 0);
  assert.equal(afterCancel.data.next_appointment, null);
});

test("patient dashboard prefers structured patient_diagnosis over clinical notes", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("dashboard-structured"),
      password: "secret123",
      full_name: "Structured Dashboard Tester",
      phone: "57007777",
      national_id: uniqueNationalId("api"),
      date_of_birth: "1988-08-08",
      gender: "F",
    },
  });
  const token = reg.data.token;
  const patientId = (await api("GET", "/api/patient-portal/profile", { token })).data.profile.id;
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;

  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now', '-1 day'), '10:30', 'completed')
    `)
    .run(patientId, doctorId).lastInsertRowid;

  db.prepare(`
    INSERT INTO consultations (
      appointment_id,
      patient_id,
      doctor_id,
      consultation_date,
      doctor_notes,
      clinical_note,
      patient_diagnosis,
      patient_prescription
    )
    VALUES (?, ?, ?, date('now', '-1 day'), ?, ?, ?, ?)
  `).run(
    appointmentId,
    patientId,
    doctorId,
    "BP 138/88. Patient febrile.\n\nURTI\nPrescribed: Tab levodenk",
    "BP 138/88. Patient febrile.",
    "URTI",
    "Tab levodenk",
  );

  const dashboard = await api("GET", "/api/patient-portal/dashboard", { token });
  assert.equal(dashboard.status, 200, JSON.stringify(dashboard.data));
  assert.equal(dashboard.data.last_consultation.diagnosis, "URTI");
  assert.match(dashboard.data.recent_activity[0].description, /URTI/i);
  assert.doesNotMatch(dashboard.data.recent_activity[0].description, /138\/88/i);
});

test("staff can add mobile-style consultation notes from patient profile", async () => {
  const doctorLogin = await api("POST", "/api/auth/login", {
    body: { username: "arun.dharee", password: "Welcome@123" },
  });
  assert.equal(doctorLogin.status, 200);
  const doctorId = Number(doctorLogin.data.user?.doctor_id || 0);
  assert.ok(doctorId, "expected a doctor_id on the staff user");

  const patientId = db
    .prepare(`
      INSERT INTO patients (
        full_name, first_name, last_name, patient_identifier, age, date_of_birth, gender,
        contact_number, patient_contact_number, address, link_status, assigned_doctor_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created', ?)
    `)
    .run(
      "Consult Note Patient",
      "Consult",
      "Patient",
      `STAFF-CN-${Date.now()}`,
      35,
      "1990-01-01",
      "M",
      "57001234",
      "57001234",
      "12 Clinic Road",
      doctorId,
    ).lastInsertRowid;

  const created = await api("POST", `/api/patients/${patientId}/consultations`, {
    token: doctorLogin.data.token,
    body: {
      consultation_date: "2026-06-12",
      appointment_time: "10:30",
      doctor_notes: "Patient reviewed. Continue current treatment.",
    },
  });

  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.doctor_notes, "Patient reviewed. Continue current treatment.");
  assert.equal(created.data.clinical_note, "");
  assert.equal(created.data.patient_diagnosis, "");
});

test("staff can add structured desktop consultation notes from patient profile", async () => {
  const patientId = db
    .prepare(`
      INSERT INTO patients (
        full_name, first_name, last_name, patient_identifier, age, date_of_birth, gender,
        contact_number, patient_contact_number, address, link_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created')
    `)
    .run(
      "Structured Consult Patient",
      "Structured",
      "Patient",
      `STAFF-SC-${Date.now()}`,
      42,
      "1983-04-04",
      "F",
      "57005678",
      "57005678",
      "44 Health Street",
    ).lastInsertRowid;

  const created = await api("POST", `/api/patients/${patientId}/consultations`, {
    token: adminToken,
    body: {
      doctor_id: db.prepare("SELECT id FROM doctors LIMIT 1").get().id,
      consultation_date: "2026-06-12",
      appointment_time: "14:00",
      clinical_note: "BP 138/88. Patient febrile.",
      patient_diagnosis: "URTI",
      patient_prescription: "Tab levodenk",
      vital_bp: "138/88",
      vital_temperature: "38.1 °C",
      vital_glycemia: "5.4",
      vital_spo2: "97%",
      vital_pulse: "88",
    },
  });

  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.clinical_note, "BP 138/88. Patient febrile.");
  assert.equal(created.data.patient_diagnosis, "URTI");
  assert.equal(created.data.patient_prescription, "Tab levodenk");
  assert.equal(created.data.vital_bp, "138/88");
  assert.equal(created.data.vital_temperature, "38.1 °C");
  assert.equal(created.data.vital_glycemia, "5.4");
  assert.equal(created.data.vital_spo2, "97%");
  assert.equal(created.data.vital_pulse, "88");
  assert.match(created.data.doctor_notes, /URTI/i);
  assert.match(created.data.doctor_notes, /BP 138\/88/);
  assert.match(created.data.doctor_notes, /Pulse 88/);
});

test("patient billing returns bills and summary totals", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("billing"),
      password: "secret123",
      full_name: "Billing Tester",
      phone: "57006666",
      national_id: uniqueNationalId("api"),
      date_of_birth: "1983-02-02",
      gender: "M",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const token = reg.data.token;
  const profileRes = await api("GET", "/api/patient-portal/profile", { token });
  assert.equal(profileRes.status, 200, JSON.stringify(profileRes.data));
  assert.ok(profileRes.data.profile, JSON.stringify(profileRes.data));
  const patientId = profileRes.data.profile.id;
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

  const billId = billing.data.bills[0].id;
  const detail = await api("GET", `/api/patient-portal/billing/${billId}`, { token });
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.bill.id, billId);
  assert.ok(Array.isArray(detail.data.bill.items));
  assert.ok(detail.data.bill.items.length >= 1);

  const otherReg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("billingother"),
      password: "secret123",
      full_name: "Other Billing",
      phone: "57006667",
      national_id: uniqueNationalId("api"),
      gender: "F",
    },
  });
  assert.equal(otherReg.status, 201, JSON.stringify(otherReg.data));
  const foreign = await api("GET", `/api/patient-portal/billing/${billId}`, {
    token: otherReg.data.token,
  });
  assert.equal(foreign.status, 404, JSON.stringify(foreign.data));
});

test("patient can change password in-app", async () => {
  const email = uniqueEmail("pwd");
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email,
      password: "secret123",
      full_name: "Password Tester",
      phone: "57001123",
      national_id: uniqueNationalId("pwd"),
      gender: "F",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const token = reg.data.token;

  const secondLogin = await api("POST", "/api/patient-auth/login", {
    body: { email, password: "secret123" },
  });
  assert.equal(secondLogin.status, 200, JSON.stringify(secondLogin.data));
  const secondToken = secondLogin.data.token;

  const unauth = await api("POST", "/api/patient-auth/change-password", {
    body: { current_password: "secret123", new_password: "newpass12" },
  });
  assert.equal(unauth.status, 401);

  const wrong = await api("POST", "/api/patient-auth/change-password", {
    token,
    body: { current_password: "wrongpass", new_password: "newpass12" },
  });
  assert.equal(wrong.status, 401);

  const short = await api("POST", "/api/patient-auth/change-password", {
    token,
    body: { current_password: "secret123", new_password: "short" },
  });
  assert.equal(short.status, 400);

  const ok = await api("POST", "/api/patient-auth/change-password", {
    token,
    body: { current_password: "secret123", new_password: "newpass12" },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));

  const stillCurrent = await api("GET", "/api/patient-auth/me", { token });
  assert.equal(stillCurrent.status, 200, JSON.stringify(stillCurrent.data));

  const otherSession = await api("GET", "/api/patient-auth/me", { token: secondToken });
  assert.equal(otherSession.status, 401);

  const loginOld = await api("POST", "/api/patient-auth/login", {
    body: { email, password: "secret123" },
  });
  assert.equal(loginOld.status, 401);

  const loginNew = await api("POST", "/api/patient-auth/login", {
    body: { email, password: "newpass12" },
  });
  assert.equal(loginNew.status, 200, JSON.stringify(loginNew.data));
});

test("patient can reset password with an emailed token", async () => {
  const email = uniqueEmail("reset");
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email,
      password: "secret123",
      full_name: "Reset Tester",
      phone: "57001124",
      national_id: uniqueNationalId("rst"),
      gender: "M",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));

  const unknown = await api("POST", "/api/patient-auth/forgot-password", {
    body: { email: uniqueEmail("missing") },
  });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.ok, true);
  assert.equal(unknown.data.reset_token, undefined);

  const forgot = await api("POST", "/api/patient-auth/forgot-password", { body: { email } });
  assert.equal(forgot.status, 200, JSON.stringify(forgot.data));
  assert.ok(forgot.data.reset_token);

  const short = await api("POST", "/api/patient-auth/reset-password", {
    body: { token: forgot.data.reset_token, new_password: "short" },
  });
  assert.equal(short.status, 400);

  const reset = await api("POST", "/api/patient-auth/reset-password", {
    body: { token: forgot.data.reset_token, new_password: "resetpass1" },
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));

  const reused = await api("POST", "/api/patient-auth/reset-password", {
    body: { token: forgot.data.reset_token, new_password: "resetpass2" },
  });
  assert.equal(reused.status, 400);

  const login = await api("POST", "/api/patient-auth/login", {
    body: { email, password: "resetpass1" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
});

test("patient can add a dependent and request an appointment change", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("family"),
      password: "secret123",
      full_name: "Family Guardian",
      phone: "57001125",
      national_id: uniqueNationalId("fam"),
      gender: "F",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const token = reg.data.token;
  await verifyPortalPatientForVisits(reg);

  const created = await api("POST", "/api/patient-portal/dependents", {
    token,
    body: {
      full_name: "Family Child",
      relationship: "Son",
      date_of_birth: "2018-06-01",
      gender: "M",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.dependent.full_name, "Family Child");

  const listed = await api("GET", "/api/patient-portal/dependents", { token });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.dependents.length, 1);
  const childId = created.data.dependent.id;

  const childDashboard = await api("GET", "/api/patient-portal/dashboard", {
    token,
    headers: { "X-OCS-Patient-Id": String(childId) },
  });
  assert.equal(childDashboard.status, 200, JSON.stringify(childDashboard.data));
  assert.equal(childDashboard.data.patient.id, childId);

  const childVisit = await api("POST", "/api/patient-portal/visit-requests", {
    token,
    headers: { "X-OCS-Patient-Id": String(childId) },
    body: { address: "Family Home", reason: "Fever", urgency: "urgent" },
  });
  assert.equal(childVisit.status, 201, JSON.stringify(childVisit.data));

  const guardianActive = await api("GET", "/api/patient-portal/visit-requests/active", { token });
  assert.equal(guardianActive.status, 200, JSON.stringify(guardianActive.data));
  assert.equal(guardianActive.data.visit_request, null);
  assert.equal(guardianActive.data.family_visit_requests.length, 1);
  assert.equal(guardianActive.data.family_visit_requests[0].id, childVisit.data.visit_request.id);

  const childActive = await api("GET", "/api/patient-portal/visit-requests/active", {
    token,
    headers: { "X-OCS-Patient-Id": String(childId) },
  });
  assert.equal(childActive.data.visit_request.id, childVisit.data.visit_request.id);
  assert.equal(childActive.data.family_visit_requests.length, 0);

  const profile = await api("GET", "/api/patient-portal/profile", { token });
  const patientId = profile.data.profile.id;
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now', '+3 day'), '10:00', 'scheduled')
    `)
    .run(patientId, doctorId).lastInsertRowid;

  const pastChange = await api("POST", "/api/patient-portal/appointment-change-requests", {
    token,
    body: {
      appointment_id: appointmentId,
      request_type: "reschedule",
      preferred_date: "2020-01-01",
    },
  });
  assert.equal(pastChange.status, 400, JSON.stringify(pastChange.data));

  const change = await api("POST", "/api/patient-portal/appointment-change-requests", {
    token,
    body: {
      appointment_id: appointmentId,
      request_type: "reschedule",
      preferred_date: "2030-01-15",
      patient_message: "School morning",
    },
  });
  assert.equal(change.status, 201, JSON.stringify(change.data));

  const inbox = await api("GET", "/api/appointment-change-requests?status=pending", {
    token: adminToken,
  });
  assert.equal(inbox.status, 200, JSON.stringify(inbox.data));
  assert.ok(inbox.data.requests.some((row) => row.appointment_id === Number(appointmentId)));

  const resolved = await api("PATCH", `/api/appointment-change-requests/${change.data.request.id}`, {
    token: adminToken,
    body: { status: "resolved" },
  });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.data));

  const updated = db.prepare("SELECT appointment_date, status FROM appointments WHERE id = ?").get(appointmentId);
  assert.equal(updated.appointment_date, "2030-01-15");
  assert.equal(updated.status, "scheduled");

  const appointmentId2 = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now', '+5 day'), '09:00', 'scheduled')
    `)
    .run(patientId, doctorId).lastInsertRowid;

  const change2 = await api("POST", "/api/patient-portal/appointment-change-requests", {
    token,
    body: {
      appointment_id: appointmentId2,
      request_type: "reschedule",
      preferred_date: "2030-01-20",
      preferred_time: "09:00",
    },
  });
  assert.equal(change2.status, 201, JSON.stringify(change2.data));

  const overridden = await api("PATCH", `/api/appointment-change-requests/${change2.data.request.id}`, {
    token: adminToken,
    body: {
      status: "resolved",
      appointment_date: "2030-02-01",
      appointment_time: "14:30",
    },
  });
  assert.equal(overridden.status, 200, JSON.stringify(overridden.data));
  const staffPicked = db
    .prepare("SELECT appointment_date, appointment_time FROM appointments WHERE id = ?")
    .get(appointmentId2);
  assert.equal(staffPicked.appointment_date, "2030-02-01");
  assert.equal(staffPicked.appointment_time, "14:30");

  const removed = await api("DELETE", `/api/patient-portal/dependents/${childId}`, { token });
  assert.equal(removed.status, 204, JSON.stringify(removed.data));
  const listedAfter = await api("GET", "/api/patient-portal/dependents", { token });
  assert.equal(listedAfter.data.dependents.length, 0);
});

test("marking a bill paid records who changed it and when", async () => {
  const patientId = insertDirectoryPatient("BillingAudit");
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;

  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now', '-1 day'), '10:00', 'completed')
    `)
    .run(patientId, doctorId).lastInsertRowid;

  const consultationId = db
    .prepare(`
      INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
      VALUES (?, ?, ?, date('now', '-1 day'), 'Audit trail check')
    `)
    .run(appointmentId, patientId, doctorId).lastInsertRowid;

  const billId = db
    .prepare(`
      INSERT INTO billing (consultation_id, patient_id, items, total_amount, status)
      VALUES (?, ?, ?, ?, 'unpaid')
    `)
    .run(
      consultationId,
      patientId,
      JSON.stringify([{ description: "General Consultation", amount: 800 }]),
      800,
    ).lastInsertRowid;

  const before = db.prepare("SELECT updated_at, updated_by_user_id FROM billing WHERE id = ?").get(billId);
  assert.equal(before.updated_at, null);
  assert.equal(before.updated_by_user_id, null);

  const paid = await api("PATCH", `/api/billing/${billId}/pay`, {
    token: adminToken,
    body: { payment_method: "cash" },
  });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal(paid.data.status, "paid");

  const adminUserId = db
    .prepare("SELECT id FROM users WHERE username = 'shravan.joaheer'")
    .get().id;
  const after = db.prepare("SELECT updated_at, updated_by_user_id FROM billing WHERE id = ?").get(billId);
  assert.ok(after.updated_at, "expected an updated_at stamp");
  assert.equal(Number(after.updated_by_user_id), Number(adminUserId));
  assert.equal(paid.data.updated_by_name, "Dr Shravan Kumar Joaheer");
});

async function uploadPatientReport({ token, actingPatientId, name }) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from("%PDF-1.4 test report")], { type: "application/pdf" }),
    "report.pdf",
  );
  form.append("name", name);
  form.append("report_date", "2030-03-04");

  const headers = { Authorization: `Bearer ${token}` };
  if (actingPatientId) {
    headers["X-OCS-Patient-Id"] = String(actingPatientId);
  }

  const res = await fetch(`${baseUrl}/api/patient-portal/reports`, {
    method: "POST",
    headers,
    body: form,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function downloadPatientReport(attachmentId, token) {
  return fetch(`${baseUrl}/api/patient-portal/reports/attachments/${attachmentId}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Store an attachment owned outright by the given patient, so download access
// can be tested independently of how the upload route files reports.
function insertStoredAttachment(patientId, title) {
  fs.mkdirSync(labReportAttachmentsDir, { recursive: true });
  const storedName = `test-${patientId}-${Date.now()}.pdf`;
  const contents = "%PDF-1.4 stored report";
  fs.writeFileSync(path.join(labReportAttachmentsDir, storedName), contents);

  const reportId = db
    .prepare(`
      INSERT INTO lab_reports (
        patient_id, consultation_id, report_title, report_date, report_details, created_by_user_id
      )
      VALUES (?, NULL, ?, ?, ?, NULL)
    `)
    .run(patientId, title, "2030-03-04", JSON.stringify({ patient_uploaded: true }))
    .lastInsertRowid;

  return Number(
    db
      .prepare(`
        INSERT INTO lab_report_attachments (
          report_id, patient_id, consultation_id, original_name, stored_name,
          mime_type, file_size, relative_path, uploaded_by_user_id
        )
        VALUES (?, ?, NULL, ?, ?, 'application/pdf', ?, ?, NULL)
      `)
      .run(reportId, patientId, "xray.pdf", storedName, contents.length, storedName)
      .lastInsertRowid,
  );
}

test("a report uploaded for a dependent is filed on the dependent's chart", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("upload"),
      password: "secret123",
      full_name: "Upload Guardian",
      phone: "57001133",
      national_id: uniqueNationalId("upl"),
      gender: "F",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const token = reg.data.token;
  await verifyPortalPatientForVisits(reg);

  const created = await api("POST", "/api/patient-portal/dependents", {
    token,
    body: {
      full_name: "Upload Child",
      relationship: "Daughter",
      date_of_birth: "2016-04-02",
      gender: "F",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const childId = created.data.dependent.id;

  const upload = await uploadPatientReport({
    token,
    actingPatientId: childId,
    name: "Child blood test",
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.data));
  const attachmentId = Number(upload.data.report.id);
  assert.ok(attachmentId, "expected an attachment id");

  const childRecords = await api("GET", "/api/patient-portal/health-records", {
    token,
    headers: { "X-OCS-Patient-Id": String(childId) },
  });
  assert.equal(childRecords.status, 200, JSON.stringify(childRecords.data));
  assert.ok(
    childRecords.data.reports.some((report) => Number(report.id) === attachmentId),
    "expected the report on the dependent's chart",
  );

  const guardianRecords = await api("GET", "/api/patient-portal/health-records", { token });
  assert.equal(guardianRecords.status, 200, JSON.stringify(guardianRecords.data));
  assert.ok(
    !guardianRecords.data.reports.some((report) => Number(report.id) === attachmentId),
    "the guardian's own chart must not show the dependent's report",
  );
});

test("a guardian can open a dependent's report but another patient cannot", async () => {
  const reg = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("download"),
      password: "secret123",
      full_name: "Download Guardian",
      phone: "57001134",
      national_id: uniqueNationalId("dwn"),
      gender: "M",
    },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const token = reg.data.token;
  await verifyPortalPatientForVisits(reg);

  const created = await api("POST", "/api/patient-portal/dependents", {
    token,
    body: {
      full_name: "Download Child",
      relationship: "Son",
      date_of_birth: "2015-01-09",
      gender: "M",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const attachmentId = insertStoredAttachment(created.data.dependent.id, "Child x-ray");

  // The download link carries a token but no acting-profile header, so the
  // guardian must still be able to open a dependent's file.
  const guardianDownload = await downloadPatientReport(attachmentId, token);
  assert.equal(guardianDownload.status, 200);
  assert.equal(guardianDownload.headers.get("content-type"), "application/pdf");

  const stranger = await api("POST", "/api/patient-auth/register", {
    body: {
      email: uniqueEmail("stranger"),
      password: "secret123",
      full_name: "Unrelated Patient",
      phone: "57001135",
      national_id: uniqueNationalId("str"),
      gender: "F",
    },
  });
  assert.equal(stranger.status, 201, JSON.stringify(stranger.data));
  await verifyPortalPatientForVisits(stranger);

  const strangerDownload = await downloadPatientReport(attachmentId, stranger.data.token);
  assert.equal(strangerDownload.status, 404);
});

function insertDirectoryPatient(label) {
  return db
    .prepare(`
      INSERT INTO patients (
        full_name, first_name, last_name, patient_identifier, age, date_of_birth, gender,
        contact_number, patient_contact_number, address, link_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created')
    `)
    .run(
      `${label} Patient`,
      label,
      "Patient",
      `STAFF-${label.toUpperCase()}-${Date.now()}`,
      36,
      "1990-01-01",
      "F",
      "57007777",
      "57007777",
      "9 Directory Street",
    ).lastInsertRowid;
}

test("operator dashboard metrics include visit requests and this-week unpaid", async () => {
  const login = await api("POST", "/api/auth/login", {
    body: { username: "operator01", password: "Welcome@123" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));

  const metrics = await api("GET", "/api/v1/operator/dashboard-metrics", {
    token: login.data.token,
  });
  assert.equal(metrics.status, 200, JSON.stringify(metrics.data));
  assert.equal(typeof metrics.data.visit_requests?.active_count, "number");
  assert.equal(typeof metrics.data.visit_requests?.unassigned_count, "number");
  assert.ok(Array.isArray(metrics.data.visit_requests?.unassigned));
  assert.equal(typeof metrics.data.pending_payment?.unpaid_this_week_count, "number");
  assert.equal(typeof metrics.data.scheduled_visits?.this_week, "number");
  assert.equal(typeof metrics.data.coverage?.doctors_this_week, "number");
  assert.ok(Array.isArray(metrics.data.upcoming_visits));
});

test("operator can delete a patient without admin permission", async () => {
  const login = await api("POST", "/api/auth/login", {
    body: { username: "operator01", password: "Welcome@123" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const operatorToken = login.data.token;

  const patientId = insertDirectoryPatient("OperatorDelete");

  const removed = await api("DELETE", `/api/patients/${patientId}`, { token: operatorToken });
  assert.equal(removed.status, 204, JSON.stringify(removed.data));

  const softDeleted = db
    .prepare("SELECT deleted_at FROM patients WHERE id = ?")
    .get(patientId);
  assert.ok(softDeleted.deleted_at, "expected the patient to be soft-deleted");

  const profile = await api("GET", `/api/patients/${patientId}`, { token: operatorToken });
  assert.equal(profile.status, 404, JSON.stringify(profile.data));
});

test("operator can browse recently deleted patients and restore one", async () => {
  const login = await api("POST", "/api/auth/login", {
    body: { username: "operator01", password: "Welcome@123" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const operatorToken = login.data.token;

  const patientId = insertDirectoryPatient("OperatorRestore");
  const removed = await api("DELETE", `/api/patients/${patientId}`, { token: operatorToken });
  assert.equal(removed.status, 204, JSON.stringify(removed.data));

  const recentlyDeleted = await api("GET", "/api/patients/deleted/recent", {
    token: operatorToken,
  });
  assert.equal(recentlyDeleted.status, 200, JSON.stringify(recentlyDeleted.data));
  assert.ok(
    recentlyDeleted.data.some((patient) => patient.id === Number(patientId)),
    "expected the deleted patient in the recently deleted list",
  );

  const restored = await api("POST", `/api/patients/${patientId}/restore`, {
    token: operatorToken,
  });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal(
    db.prepare("SELECT deleted_at FROM patients WHERE id = ?").get(patientId).deleted_at,
    null,
  );
});

test("operator cannot permanently delete a patient", async () => {
  const login = await api("POST", "/api/auth/login", {
    body: { username: "operator01", password: "Welcome@123" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const operatorToken = login.data.token;

  const patientId = insertDirectoryPatient("OperatorPurge");

  const purged = await api("DELETE", `/api/patients/${patientId}/permanent`, {
    token: operatorToken,
  });
  assert.equal(purged.status, 403, JSON.stringify(purged.data));
  assert.ok(db.prepare("SELECT id FROM patients WHERE id = ?").get(patientId));
});

test("admin can permanently delete a patient from recently deleted", async () => {
  const patientId = insertDirectoryPatient("AdminPurge");

  const removed = await api("DELETE", `/api/patients/${patientId}`, { token: adminToken });
  assert.equal(removed.status, 204, JSON.stringify(removed.data));

  const purged = await api("DELETE", `/api/patients/${patientId}/permanent`, {
    token: adminToken,
  });
  assert.equal(purged.status, 200, JSON.stringify(purged.data));
  assert.equal(db.prepare("SELECT id FROM patients WHERE id = ?").get(patientId), undefined);
});

function insertCompletedVisitContext(patientId, doctorId) {
  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now'), '11:00', 'scheduled')
    `)
    .run(patientId, doctorId).lastInsertRowid;

  const changeRequestId = db
    .prepare(`
      INSERT INTO appointment_change_requests (appointment_id, patient_id, request_type, patient_message)
      VALUES (?, ?, 'reschedule', 'Please move this visit')
    `)
    .run(appointmentId, patientId).lastInsertRowid;

  return { appointmentId, changeRequestId };
}

test("merging a patient moves change requests and family links", async () => {
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
  const targetId = insertDirectoryPatient("MergeTarget");
  const sourceId = insertDirectoryPatient("MergeSource");
  const dependentId = insertDirectoryPatient("MergeDependent");
  db.prepare("UPDATE patients SET parent_patient_id = ? WHERE id = ?").run(sourceId, dependentId);

  const { changeRequestId } = insertCompletedVisitContext(sourceId, doctorId);
  const visitId = db
    .prepare(`
      INSERT INTO visit_requests (patient_id, visit_for, dependent_patient_id, address, reason)
      VALUES (?, 'dependent', ?, 'Family Home', 'Fever')
    `)
    .run(sourceId, dependentId).lastInsertRowid;

  const merged = await api("POST", `/api/patients/${targetId}/merge`, {
    token: adminToken,
    body: { source_id: sourceId },
  });
  assert.equal(merged.status, 200, JSON.stringify(merged.data));

  const changeRequest = db
    .prepare("SELECT patient_id FROM appointment_change_requests WHERE id = ?")
    .get(changeRequestId);
  assert.equal(Number(changeRequest.patient_id), targetId, "change request should follow the merge");

  const dependent = db.prepare("SELECT parent_patient_id FROM patients WHERE id = ?").get(dependentId);
  assert.equal(Number(dependent.parent_patient_id), targetId, "dependent should be reparented");

  const visit = db.prepare("SELECT patient_id, dependent_patient_id FROM visit_requests WHERE id = ?").get(visitId);
  assert.equal(Number(visit.patient_id), targetId);
  assert.equal(Number(visit.dependent_patient_id), dependentId, "the dependent itself did not move");
});

test("purging a guardian keeps the dependent record but clears the link", async () => {
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
  const guardianId = insertDirectoryPatient("PurgeGuardian");
  const dependentId = insertDirectoryPatient("PurgeDependent");
  db.prepare("UPDATE patients SET parent_patient_id = ? WHERE id = ?").run(guardianId, dependentId);

  const { changeRequestId } = insertCompletedVisitContext(guardianId, doctorId);
  const dependentVisitId = db
    .prepare(`
      INSERT INTO visit_requests (patient_id, visit_for, dependent_patient_id, address, reason)
      VALUES (?, 'dependent', ?, 'Family Home', 'Cough')
    `)
    .run(guardianId, dependentId).lastInsertRowid;

  const removed = await api("DELETE", `/api/patients/${guardianId}`, { token: adminToken });
  assert.equal(removed.status, 204, JSON.stringify(removed.data));

  const purged = await api("DELETE", `/api/patients/${guardianId}/permanent`, { token: adminToken });
  assert.equal(purged.status, 200, JSON.stringify(purged.data));
  assert.equal(purged.data.detached_dependents, 1);

  assert.equal(db.prepare("SELECT id FROM patients WHERE id = ?").get(guardianId), undefined);
  assert.equal(
    db.prepare("SELECT id FROM appointment_change_requests WHERE id = ?").get(changeRequestId),
    undefined,
  );
  assert.equal(
    db.prepare("SELECT id FROM visit_requests WHERE id = ?").get(dependentVisitId),
    undefined,
    "a visit booked for the dependent is purged with them",
  );

  const dependent = db.prepare("SELECT parent_patient_id FROM patients WHERE id = ?").get(dependentId);
  assert.ok(dependent, "the dependent's own record must survive");
  assert.equal(dependent.parent_patient_id, null);
});

test("emergency override never drives recorded stock negative", async () => {
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
  const patientId = insertDirectoryPatient("OverrideStock");

  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now'), '12:00', 'completed')
    `)
    .run(patientId, doctorId).lastInsertRowid;

  const consultationId = db
    .prepare(`
      INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
      VALUES (?, ?, ?, date('now'), 'Emergency dispensing')
    `)
    .run(appointmentId, patientId, doctorId).lastInsertRowid;

  const itemId = db
    .prepare(`
      INSERT INTO inventory (
        item_name, quantity, minimum_quantity, unit, cost_price, selling_price,
        stock_scope, owner_doctor_id
      )
      VALUES (?, 2, 0, 'unit', 10, 25, 'doctor', ?)
    `)
    .run(`Override Amoxicillin ${Date.now()}`, doctorId).lastInsertRowid;

  const created = await api("POST", "/api/billing", {
    token: adminToken,
    body: {
      consultation_id: consultationId,
      patient_id: patientId,
      items: [
        {
          description: "Amoxicillin",
          amount: 125,
          type: "Sale",
          quantity: 5,
          inventory_item_id: itemId,
          emergency_override: true,
        },
      ],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const stock = db.prepare("SELECT quantity FROM inventory WHERE id = ?").get(itemId);
  assert.equal(stock.quantity, 0, "recorded stock must stop at zero, not go negative");

  const movement = db
    .prepare(`
      SELECT quantity, previous_quantity, next_quantity, meta_json
      FROM inventory_movements
      WHERE item_id = ?
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(itemId);
  assert.equal(movement.previous_quantity, 2);
  assert.equal(movement.next_quantity, 0);
  assert.equal(movement.quantity, 2, "the ledger records what actually left stock");

  const meta = JSON.parse(movement.meta_json);
  assert.equal(meta.dispensed_quantity, 5);
  assert.equal(meta.batch_shortfall, 3, "the gap is recorded for the auditor");
});

test("deleting a stock item leaves an audit record behind", async () => {
  const doctorId = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
  const itemName = `Deletable Gauze ${Date.now()}`;
  const itemId = db
    .prepare(`
      INSERT INTO inventory (
        item_name, quantity, minimum_quantity, unit, cost_price, selling_price,
        stock_scope, owner_doctor_id
      )
      VALUES (?, 7, 0, 'unit', 5, 12, 'doctor', ?)
    `)
    .run(itemName, doctorId).lastInsertRowid;

  db.prepare(`
    INSERT INTO inventory_movements (item_id, movement_type, quantity, previous_quantity, next_quantity, note)
    VALUES (?, 'out', 3, 10, 7, 'Dispensed in the field')
  `).run(itemId);

  const removed = await api("DELETE", `/api/inventory/items/${itemId}`, { token: adminToken });
  assert.equal(removed.status, 204, JSON.stringify(removed.data));
  assert.equal(db.prepare("SELECT id FROM inventory WHERE id = ?").get(itemId), undefined);

  const audit = db
    .prepare(`
      SELECT item_name, quantity, meta_json
      FROM inventory_audit_logs
      WHERE action_type = 'delete_item' AND item_id = ?
    `)
    .get(itemId);
  assert.ok(audit, "expected a delete_item audit row");
  assert.equal(audit.item_name, itemName);
  assert.equal(audit.quantity, 7);

  const meta = JSON.parse(audit.meta_json);
  assert.equal(meta.movements_discarded, 1, "the discarded ledger depth is recorded");
  assert.equal(meta.quantity_at_deletion, 7);
});

test("doctors still cannot delete patients", async () => {
  const doctorUser = db
    .prepare("SELECT username FROM users WHERE role = 'doctor' AND is_active = 1 LIMIT 1")
    .get();
  assert.ok(doctorUser, "expected a seeded doctor account");

  const login = await api("POST", "/api/auth/login", {
    body: { username: doctorUser.username, password: "Welcome@123" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));

  const patientId = insertDirectoryPatient("DoctorDelete");
  const removed = await api("DELETE", `/api/patients/${patientId}`, { token: login.data.token });
  assert.equal(removed.status, 403, JSON.stringify(removed.data));
});

test("a staff stream token cannot call the inventory API", async () => {
  const minted = await api("POST", "/api/auth/stream-token", { token: adminToken });
  assert.equal(minted.status, 200, JSON.stringify(minted.data));
  assert.ok(minted.data.token);

  const leaked = await api("GET", `/api/inventory?access_token=${encodeURIComponent(minted.data.token)}`);
  assert.equal(leaked.status, 401, JSON.stringify(leaked.data));

  const withBearer = await api("GET", "/api/inventory", { token: adminToken });
  assert.equal(withBearer.status, 200, JSON.stringify(withBearer.data));
});

test("resetting a staff password revokes existing sessions", async () => {
  const login = await api("POST", "/api/auth/login", {
    body: { username: "operator01", password: "Welcome@123" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const operatorToken = login.data.token;
  const operatorId = login.data.user.id;

  const before = await api("GET", "/api/auth/me", { token: operatorToken });
  assert.equal(before.status, 200, JSON.stringify(before.data));

  const reset = await api("PUT", `/api/team-operations/operator/${operatorId}`, {
    token: adminToken,
    body: {
      full_name: login.data.user.full_name,
      username: "operator01",
      password: "Welcome@123",
    },
  });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));

  const after = await api("GET", "/api/auth/me", { token: operatorToken });
  assert.equal(after.status, 401, JSON.stringify(after.data));
});

test("soft-deleted patients do not appear on the visit-request board", async () => {
  const patientId = insertDirectoryPatient("DeletedVisit");
  db.prepare(`
    INSERT INTO visit_requests (patient_id, visit_for, address, reason, status)
    VALUES (?, 'myself', 'Old House', 'Check-up', 'pending')
  `).run(patientId);
  db.prepare("UPDATE patients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(patientId);

  const board = await api("GET", "/api/visit-requests?status=active", { token: adminToken });
  assert.equal(board.status, 200, JSON.stringify(board.data));
  const ids = (board.data.visit_requests || []).map((row) => Number(row.patient_id));
  assert.equal(ids.includes(patientId), false);
});

test("doctors can flag long-term review only for caseload patients", async () => {
  const doctorLogin = await api("POST", "/api/auth/login", {
    body: { username: "arun.dharee", password: "Welcome@123" },
  });
  assert.equal(doctorLogin.status, 200, JSON.stringify(doctorLogin.data));
  const doctorToken = doctorLogin.data.token;
  const doctorId = Number(doctorLogin.data.user?.doctor_id || 0);
  assert.ok(doctorId, "expected a doctor_id on the staff user");

  const caseloadId = db
    .prepare(`
      INSERT INTO patients (
        full_name, first_name, last_name, patient_identifier, age, date_of_birth, gender,
        contact_number, patient_contact_number, address, link_status, assigned_doctor_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created', ?)
    `)
    .run(
      "LTR Caseload Patient",
      "LTR",
      "Caseload",
      `STAFF-LTR-IN-${Date.now()}`,
      48,
      "1978-03-03",
      "F",
      "57008811",
      "57008811",
      "1 Review Lane",
      doctorId,
    ).lastInsertRowid;
  const outsiderId = insertDirectoryPatient("LtrOutsider");

  const allowed = await api("PATCH", `/api/patients/${caseloadId}/long-term-review`, {
    token: doctorToken,
    body: {
      is_under_review: true,
      review_reason_note: "Follow-up blood pressure",
      review_due_date: "2026-09-01",
    },
  });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
  assert.equal(Boolean(allowed.data.is_under_review), true);

  const denied = await api("PATCH", `/api/patients/${outsiderId}/long-term-review`, {
    token: doctorToken,
    body: {
      is_under_review: true,
      review_reason_note: "Should not work",
      review_due_date: "2026-09-01",
    },
  });
  assert.equal(denied.status, 403, JSON.stringify(denied.data));

  const operatorLogin = await api("POST", "/api/auth/login", {
    body: { username: "operator01", password: "Welcome@123" },
  });
  assert.equal(operatorLogin.status, 200, JSON.stringify(operatorLogin.data));
  const operatorToken = operatorLogin.data.token;
  const operatorUpdated = await api("PATCH", `/api/patients/${caseloadId}/long-term-review`, {
    token: operatorToken,
    body: {
      is_under_review: true,
      review_reason_note: "Operator rescheduled the review",
      review_due_date: "2026-09-15",
    },
  });
  assert.equal(operatorUpdated.status, 200, JSON.stringify(operatorUpdated.data));
  assert.equal(operatorUpdated.data.review_due_date, "2026-09-15");

  const operatorProfileEdit = await api("PUT", `/api/patients/${caseloadId}`, {
    token: operatorToken,
    body: { first_name: "ShouldNotSave" },
  });
  assert.equal(operatorProfileEdit.status, 403, JSON.stringify(operatorProfileEdit.data));

  const adminFlag = await api("PATCH", `/api/patients/${outsiderId}/long-term-review`, {
    token: adminToken,
    body: {
      is_under_review: true,
      review_reason_note: "Admin follow-up",
      review_due_date: "2026-09-02",
    },
  });
  assert.equal(adminFlag.status, 200, JSON.stringify(adminFlag.data));

  const doctorQueue = await api("GET", "/api/dashboard/long-term-review", { token: doctorToken });
  assert.equal(doctorQueue.status, 200, JSON.stringify(doctorQueue.data));
  const doctorIds = (doctorQueue.data.patients || []).map((row) => Number(row.id));
  assert.ok(doctorIds.includes(Number(caseloadId)), "doctor should see their caseload review");
  assert.equal(doctorIds.includes(Number(outsiderId)), false, "doctor should not see out-of-caseload reviews");

  const doctorAllQueue = await api("GET", "/api/dashboard/long-term-review?view=all", {
    token: doctorToken,
  });
  assert.equal(doctorAllQueue.status, 200, JSON.stringify(doctorAllQueue.data));
  const doctorAllIds = (doctorAllQueue.data.patients || []).map((row) => Number(row.id));
  assert.ok(doctorAllIds.includes(Number(outsiderId)), "doctors can browse other doctors' reviews");
  const outsiderRow = (doctorAllQueue.data.patients || []).find(
    (row) => Number(row.id) === Number(outsiderId),
  );
  assert.equal(Boolean(outsiderRow?.is_mine), false);
  assert.equal(Boolean(outsiderRow?.can_manage), false);

  const adminQueue = await api("GET", "/api/dashboard/long-term-review", { token: adminToken });
  assert.equal(adminQueue.status, 200, JSON.stringify(adminQueue.data));
  const adminIds = (adminQueue.data.patients || []).map((row) => Number(row.id));
  assert.ok(adminIds.includes(Number(outsiderId)), "admin should see every review patient");
});

test("admin and operators can assign a review doctor and time", async () => {
  const doctorLogin = await api("POST", "/api/auth/login", {
    body: { username: "arun.dharee", password: "Welcome@123" },
  });
  assert.equal(doctorLogin.status, 200, JSON.stringify(doctorLogin.data));
  const firstDoctorId = Number(doctorLogin.data.user?.doctor_id || 0);
  assert.ok(firstDoctorId, "expected a doctor_id on the staff user");

  const secondDoctor = db
    .prepare("SELECT id FROM doctors WHERE id != ? AND deleted_at IS NULL AND is_active = 1 LIMIT 1")
    .get(firstDoctorId);
  assert.ok(secondDoctor?.id, "expected a second active doctor");

  const patientId = db
    .prepare(`
      INSERT INTO patients (
        full_name, first_name, last_name, patient_identifier, age, date_of_birth, gender,
        contact_number, patient_contact_number, address, link_status, assigned_doctor_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created', ?)
    `)
    .run(
      "Review Assign Patient",
      "Review",
      "Assign",
      `STAFF-RA-${Date.now()}`,
      41,
      "1985-02-02",
      "F",
      "57009911",
      "57009911",
      "4 Assignment Road",
      firstDoctorId,
    ).lastInsertRowid;

  const flagged = await api("PATCH", `/api/patients/${patientId}/long-term-review`, {
    token: adminToken,
    body: {
      is_under_review: true,
      review_reason_note: "General check-up",
      review_due_date: "2026-09-20",
    },
  });
  assert.equal(flagged.status, 200, JSON.stringify(flagged.data));

  const doctorDenied = await api("PATCH", `/api/patients/${patientId}/review-assignment`, {
    token: doctorLogin.data.token,
    body: { review_appointment_time: "10:30" },
  });
  assert.equal(doctorDenied.status, 403, JSON.stringify(doctorDenied.data));

  const operatorLogin = await api("POST", "/api/auth/login", {
    body: { username: "operator01", password: "Welcome@123" },
  });
  assert.equal(operatorLogin.status, 200, JSON.stringify(operatorLogin.data));
  const timed = await api("PATCH", `/api/patients/${patientId}/review-assignment`, {
    token: operatorLogin.data.token,
    body: { review_appointment_time: "10:30" },
  });
  assert.equal(timed.status, 200, JSON.stringify(timed.data));
  assert.equal(timed.data.review_appointment_time, "10:30");
  assert.equal(Number(timed.data.assigned_doctor_id), firstDoctorId);

  const reassigned = await api("PATCH", `/api/patients/${patientId}/review-assignment`, {
    token: adminToken,
    body: { review_assigned_doctor_id: secondDoctor.id },
  });
  assert.equal(reassigned.status, 200, JSON.stringify(reassigned.data));
  assert.equal(
    Number(reassigned.data.assigned_doctor_id),
    firstDoctorId,
    "patient's regular assigned doctor should stay the same",
  );
  assert.equal(Number(reassigned.data.review_assigned_doctor_id), Number(secondDoctor.id));
  assert.ok(
    String(reassigned.data.review_assigned_doctor_name || "").trim(),
    "review card should show the newly assigned review doctor",
  );

  const previousDoctorQueue = await api("GET", "/api/dashboard/long-term-review", {
    token: doctorLogin.data.token,
  });
  assert.equal(previousDoctorQueue.status, 200, JSON.stringify(previousDoctorQueue.data));
  const previousIds = (previousDoctorQueue.data.patients || []).map((row) => Number(row.id));
  assert.equal(
    previousIds.includes(Number(patientId)),
    false,
    "previous doctor should no longer see the reassigned review",
  );

  const previousDoctorAllQueue = await api("GET", "/api/dashboard/long-term-review?view=all", {
    token: doctorLogin.data.token,
  });
  assert.equal(previousDoctorAllQueue.status, 200, JSON.stringify(previousDoctorAllQueue.data));
  const previousAllReview = (previousDoctorAllQueue.data.patients || []).find(
    (row) => Number(row.id) === Number(patientId),
  );
  assert.ok(previousAllReview, "previous doctor can still view the review under All doctors");
  assert.equal(Boolean(previousAllReview.is_mine), false);

  const secondDoctorUser = db
    .prepare(`
      SELECT username
      FROM users
      WHERE doctor_id = ?
        AND role = 'doctor'
        AND deleted_at IS NULL
        AND is_active = 1
      LIMIT 1
    `)
    .get(secondDoctor.id);
  assert.ok(secondDoctorUser?.username, "expected a login for the newly assigned doctor");
  const secondDoctorLogin = await api("POST", "/api/auth/login", {
    body: { username: secondDoctorUser.username, password: "Welcome@123" },
  });
  assert.equal(secondDoctorLogin.status, 200, JSON.stringify(secondDoctorLogin.data));

  const nextDoctorQueue = await api("GET", "/api/dashboard/long-term-review", {
    token: secondDoctorLogin.data.token,
  });
  assert.equal(nextDoctorQueue.status, 200, JSON.stringify(nextDoctorQueue.data));
  const nextReview = (nextDoctorQueue.data.patients || []).find(
    (row) => Number(row.id) === Number(patientId),
  );
  assert.ok(nextReview, "newly assigned doctor should see the review on their card");
  assert.equal(Number(nextReview.assigned_doctor_id), firstDoctorId);
  assert.equal(Number(nextReview.review_assigned_doctor_id), Number(secondDoctor.id));
  assert.equal(
    String(nextReview.review_assigned_doctor_name || "").trim(),
    String(reassigned.data.review_assigned_doctor_name || "").trim(),
  );

  const nextDoctorHome = await api("GET", "/api/dashboard", { token: secondDoctorLogin.data.token });
  assert.equal(nextDoctorHome.status, 200, JSON.stringify(nextDoctorHome.data));
  assert.equal(
    Number(nextDoctorHome.data.summary?.longTermReviewCount || 0),
    Number(nextDoctorQueue.data.count || 0),
    "doctor home review card should match their assigned review queue",
  );

  const slot = db
    .prepare(`
      SELECT doctor_id, appointment_time, status
      FROM appointments
      WHERE patient_id = ? AND appointment_date = '2026-09-20' AND status = 'scheduled'
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(patientId);
  assert.ok(slot, "expected a scheduled review slot");
  assert.equal(Number(slot.doctor_id), Number(secondDoctor.id));
  assert.equal(String(slot.appointment_time).slice(0, 5), "10:30");
});

test("OCS VP directory is shared; only doctors see consultation notes and lab reports", async () => {
  const doctorLogin = await api("POST", "/api/auth/login", {
    body: { username: "arun.dharee", password: "Welcome@123" },
  });
  assert.equal(doctorLogin.status, 200, JSON.stringify(doctorLogin.data));
  const doctorToken = doctorLogin.data.token;
  const viewingDoctorId = Number(doctorLogin.data.user?.doctor_id || 0);
  assert.ok(viewingDoctorId, "expected a doctor_id on the staff user");

  const otherDoctor = db
    .prepare("SELECT id FROM doctors WHERE id != ? AND deleted_at IS NULL AND is_active = 1 LIMIT 1")
    .get(viewingDoctorId);
  assert.ok(otherDoctor?.id, "expected a second active doctor");

  const stamp = Date.now();
  const identifier = `STAFF-VPDIR-${stamp}`;
  const patientId = db
    .prepare(`
      INSERT INTO patients (
        full_name, first_name, last_name, patient_identifier, age, date_of_birth, gender,
        contact_number, patient_contact_number, address, link_status, assigned_doctor_id,
        consultation_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_created', ?, ?)
    `)
    .run(
      `Vp Directory ${stamp}`,
      "Vp",
      "Directory",
      identifier,
      41,
      "1985-02-02",
      "M",
      "57009911",
      "57009911",
      "9 Shared Street",
      otherDoctor.id,
      "Registration note: keep this clinical.",
    ).lastInsertRowid;

  const appointmentId = db
    .prepare(`
      INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, date('now'), '09:00', 'completed')
    `)
    .run(patientId, otherDoctor.id).lastInsertRowid;

  db.prepare(`
    INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes)
    VALUES (?, ?, ?, date('now'), ?)
  `).run(appointmentId, patientId, otherDoctor.id, "Private consult: hypertension follow-up.");

  db.prepare(`
    INSERT INTO lab_reports (patient_id, report_title, report_date, report_details)
    VALUES (?, ?, date('now'), ?)
  `).run(patientId, "FBC", "Hb 13.2; keep this lab result private.");

  const directory = await api("GET", `/api/patients?search=${encodeURIComponent(identifier)}&limit=15`, {
    token: doctorToken,
  });
  assert.equal(directory.status, 200, JSON.stringify(directory.data));
  const directoryIds = (directory.data.items || []).map((row) => Number(row.id));
  assert.ok(directoryIds.includes(Number(patientId)), "doctors should see patients assigned to other doctors");

  const doctorProfile = await api("GET", `/api/patients/${patientId}`, { token: doctorToken });
  assert.equal(doctorProfile.status, 200, JSON.stringify(doctorProfile.data));
  assert.equal(doctorProfile.data.consultations?.length > 0, true);
  assert.match(String(doctorProfile.data.consultations[0].doctor_notes || ""), /hypertension/i);
  assert.equal(doctorProfile.data.labReports?.length > 0, true);
  assert.match(String(doctorProfile.data.labReports[0].report_details || ""), /Hb 13.2/i);
  assert.match(String(doctorProfile.data.patient.consultation_notes || ""), /Registration note/i);

  const operatorLogin = await api("POST", "/api/auth/login", {
    body: { username: "operator01", password: "Welcome@123" },
  });
  assert.equal(operatorLogin.status, 200, JSON.stringify(operatorLogin.data));
  const operatorToken = operatorLogin.data.token;

  const operatorDirectory = await api("GET", `/api/patients?search=${encodeURIComponent(identifier)}&limit=15`, {
    token: operatorToken,
  });
  assert.equal(operatorDirectory.status, 200, JSON.stringify(operatorDirectory.data));
  const operatorIds = (operatorDirectory.data.items || []).map((row) => Number(row.id));
  assert.ok(operatorIds.includes(Number(patientId)), "operators should see the shared directory");
  const operatorListRow = (operatorDirectory.data.items || []).find(
    (row) => Number(row.id) === Number(patientId),
  );
  assert.equal(operatorListRow.consultation_notes, undefined);

  const operatorProfile = await api("GET", `/api/patients/${patientId}`, { token: operatorToken });
  assert.equal(operatorProfile.status, 200, JSON.stringify(operatorProfile.data));
  assert.equal(operatorProfile.data.consultations?.length || 0, 0);
  assert.equal(operatorProfile.data.labReports?.length || 0, 0);
  assert.equal(operatorProfile.data.patient.consultation_notes, undefined);

  const operatorLabs = await api("GET", `/api/lab-reports?patientId=${patientId}`, {
    token: operatorToken,
  });
  assert.equal(operatorLabs.status, 403);

  const labTechLogin = await api("POST", "/api/auth/login", {
    body: { username: "labtech01", password: "Welcome@123" },
  });
  assert.equal(labTechLogin.status, 200, JSON.stringify(labTechLogin.data));
  const labTechProfile = await api("GET", `/api/patients/${patientId}`, {
    token: labTechLogin.data.token,
  });
  assert.equal(labTechProfile.status, 200, JSON.stringify(labTechProfile.data));
  assert.equal(labTechProfile.data.consultations?.length || 0, 0);
  assert.equal(labTechProfile.data.labReports?.length > 0, true);

  const created = await api("POST", `/api/patients/${patientId}/consultations`, {
    token: doctorToken,
    body: {
      consultation_date: "2026-08-18",
      appointment_time: "11:15",
      doctor_notes: "Covering doctor note on another doctor's patient.",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
});
