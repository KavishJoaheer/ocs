"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocs-visit-access-"));
process.env.DB_PATH = path.join(tempDir, "test.db");
process.env.NODE_ENV = "test";
process.env.SEED_USER_PASSWORD = "VisitTestOnly!2026";
const { createApp } = require("../src/app");
const { db } = require("../src/db");
const { hashPassword } = require("../src/lib/security");
let server;
let baseUrl;
let patientId;
let doctorId;
const tokens = {};

async function api(method, route, role, body) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

function visit(status, createdAt = "2026-09-09 08:00:00", assignedDoctorId = doctorId) {
  return Number(db.prepare(`
    INSERT INTO visit_requests (patient_id, assigned_doctor_id, address, reason, status, created_at, staff_notes)
    VALUES (?, ?, 'Test address', 'Isolated test visit', ?, ?, 'Original notes')
  `).run(patientId, assignedDoctorId, status, createdAt).lastInsertRowid);
}

before(async () => {
  const app = createApp();
  server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  patientId = db.prepare("SELECT id FROM patients ORDER BY id LIMIT 1").get().id;
  doctorId = db.prepare("SELECT id FROM doctors ORDER BY id LIMIT 1").get().id;
  for (const role of ["admin", "operator", "doctor"]) {
    const username = `visit.test.${role}`;
    db.prepare("INSERT INTO users (username, full_name, password_hash, role, doctor_id) VALUES (?, ?, ?, ?, ?)")
      .run(username, `Visit test ${role}`, hashPassword("VisitTestOnly!2026"), role, role === "doctor" ? doctorId : null);
    const login = await api("POST", "/auth/login", null, { username, password: "VisitTestOnly!2026" });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    tokens[role] = login.data.token;
  }
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

for (const status of ["completed", "cancelled"]) {
  for (const role of ["doctor", "operator"]) {
    test(`${role} cannot change any fields or reopen a ${status} visit`, async () => {
      const id = visit(status);
      const original = db.prepare("SELECT * FROM visit_requests WHERE id = ?").get(id);
      for (const body of [
        { status: "en_route" },
        { eta_minutes: 12 },
        { staff_notes: "Attempted change" },
        { assigned_doctor_id: null },
        { status: "completed", staff_notes: "Attempted change" },
      ]) {
        const result = await api("PATCH", `/visit-requests/${id}`, role, body);
        assert.equal(result.status, 403, JSON.stringify(result.data));
        assert.match(result.data.error, /locked.*admin/i);
        assert.deepEqual(db.prepare("SELECT * FROM visit_requests WHERE id = ?").get(id), original);
      }
    });
  }
  test(`admin can edit and reopen a ${status} visit`, async () => {
    const id = visit(status);
    const edited = await api("PATCH", `/visit-requests/${id}`, "admin", { staff_notes: "Admin correction", eta_minutes: 10 });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.equal(edited.data.visit_request.status, status);
    assert.equal(edited.data.visit_request.staff_notes, "Admin correction");
    const reopened = await api("PATCH", `/visit-requests/${id}`, "admin", { status: "assigned" });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.data));
    assert.equal(reopened.data.visit_request.status, "assigned");
  });
}

test("doctors can complete active visits and operators can cancel them, then the lock applies", async () => {
  const completedId = visit("in_consultation");
  const completed = await api("PATCH", `/visit-requests/${completedId}`, "doctor", { status: "completed" });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  assert.ok(completed.data.follow_up.consultation_id);
  assert.equal((await api("PATCH", `/visit-requests/${completedId}`, "doctor", { eta_minutes: 3 })).status, 403);
  const cancelledId = visit("assigned");
  assert.equal((await api("PATCH", `/visit-requests/${cancelledId}`, "operator", { status: "cancelled" })).status, 200);
  assert.equal((await api("PATCH", `/visit-requests/${cancelledId}`, "operator", { staff_notes: "Too late" })).status, 403);
});

test("date range includes both Mauritius day boundaries, combines status and preserves doctor scope", async () => {
  const before = visit("completed", "2030-01-08 19:59:59");
  const start = visit("completed", "2030-01-08 20:00:00");
  const end = visit("cancelled", "2030-01-09 19:59:59");
  const after = visit("completed", "2030-01-09 20:00:00");
  const unassigned = visit("pending", "2030-01-09 10:00:00", null);
  const range = "date_from=2030-01-09&date_to=2030-01-09";
  const doctor = await api("GET", `/visit-requests?status=all&${range}`, "doctor");
  assert.equal(doctor.status, 200);
  assert.deepEqual(doctor.data.visit_requests.map((row) => row.id), [end, start]);
  const completed = await api("GET", `/visit-requests?status=completed&${range}`, "operator");
  assert.deepEqual(completed.data.visit_requests.map((row) => row.id), [start]);
  const dispatch = await api("GET", `/visit-requests?status=all&${range}`, "admin");
  assert.deepEqual(dispatch.data.visit_requests.map((row) => row.id), [end, unassigned, start]);
  const fromOnly = await api("GET", "/visit-requests?status=all&date_from=2030-01-09", "doctor");
  assert.deepEqual(fromOnly.data.visit_requests.map((row) => row.id), [after, end, start]);
  const toOnly = await api("GET", "/visit-requests?status=all&date_to=2030-01-08", "doctor");
  assert.ok(toOnly.data.visit_requests.some((row) => row.id === before));
  assert.ok(!toOnly.data.visit_requests.some((row) => row.id === start));
  const cleared = await api("GET", "/visit-requests?status=all", "doctor");
  for (const id of [before, start, end, after]) assert.ok(cleared.data.visit_requests.some((row) => row.id === id));
});

test("invalid, impossible and reversed date ranges are rejected; an empty range returns no visits", async () => {
  for (const query of ["date_from=invalid", "date_to=2030-02-30", "date_from=2030-01-10&date_to=2030-01-09"]) {
    assert.equal((await api("GET", `/visit-requests?status=all&${query}`, "admin")).status, 400);
  }
  const empty = await api("GET", "/visit-requests?status=all&date_from=2040-01-01&date_to=2040-01-01", "admin");
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.visit_requests, []);
});
