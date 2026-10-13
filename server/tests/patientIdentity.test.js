"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const databasePath = path.join(os.tmpdir(), `ocs-patient-identity-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = databasePath;
process.env.NODE_ENV = "test";
const { createApp } = require("../src/app");
const { db } = require("../src/db");
const { parseMauritianID } = require("../src/lib/nicParser");
let server, origin, token;

async function request(method, url, body) {
  const response = await fetch(`${origin}/api${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const basePatient = {
  first_name: "Identity", last_name: "Test", gender: "F", patient_contact_number: "57001122",
  address: "Moka", location: "Moka", location_tags: [{ category: "Town", name: "Moka" }],
};
before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const login = await request("POST", "/auth/login", { username: "shravan.joaheer", password: "Welcome@123" });
  assert.equal(login.status, 200);
  token = login.data.token;
  basePatient.assigned_doctor_id = db.prepare("SELECT id FROM doctors LIMIT 1").get().id;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(databasePath + suffix, { force: true });
});

test("National ID is required and supplies DOB and age on the server", async () => {
  for (const number of ["", "invalid", "B310293310239F"]) {
    const result = await request("POST", "/patients", { ...basePatient, patient_id_type: "national_id", patient_id_number: number });
    assert.equal(result.status, 400, JSON.stringify(result.data));
  }
  const number = "B290493310239F";
  const result = await request("POST", "/patients", {
    ...basePatient, patient_id_type: "national_id", patient_id_number: number,
    date_of_birth: "2000-01-01", manual_age: 1,
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.date_of_birth, "1993-04-29");
  assert.equal(result.data.age, parseMauritianID(number).age);
  assert.equal(result.data.manual_age, null);
});

test("alternative document types accept long numbers and optional DOB and age", async () => {
  for (const type of ["driving_licence", "passport", "birth_certificate"]) {
    const result = await request("POST", "/patients", {
      ...basePatient, patient_id_type: type, patient_id_number: `${type}-12345678901234567890`,
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.patient_id_type, type);
    assert.equal(result.data.date_of_birth, "");
    assert.equal(result.data.manual_age, null);
    const reopened = await request("GET", `/patients/${result.data.id}`);
    assert.equal(reopened.data.patient.patient_id_type, type);
  }
  // A passport that resembles a NIC must never trigger NIC autofill.
  const result = await request("POST", "/patients", {
    ...basePatient, patient_id_type: "passport", patient_id_number: "B290493310240F",
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.date_of_birth, "");
});

test("Old Age accepts blank ID, DOB and age and preserves manual age without inventing a DOB", async () => {
  const result = await request("POST", "/patients", { ...basePatient, patient_id_type: "old_age" });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.equal(result.data.patient_id_number, "");
  assert.equal(result.data.date_of_birth, "");
  assert.equal(result.data.manual_age, null);
  const edited = await request("PUT", `/patients/${result.data.id}`, {
    ...basePatient, patient_id_type: "old_age", manual_age: "82", date_of_birth: "",
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.manual_age, 82);
  assert.equal(edited.data.age, 82);
  assert.equal(edited.data.date_of_birth, "");
  // Re-run database startup against the saved records to catch legacy DOB backfill.
  execFileSync(process.execPath, ["-e", "require('./src/db').initializeDatabase()"], {
    cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "pipe",
  });
  const reopened = await request("GET", `/patients/${result.data.id}`);
  assert.equal(reopened.data.patient.manual_age, 82);
  assert.equal(reopened.data.patient.date_of_birth, "");
  const blank = db.prepare("SELECT date_of_birth, manual_age FROM patients WHERE patient_id_type = 'passport' LIMIT 1").get();
  assert.equal(blank.date_of_birth, "");
  assert.equal(blank.manual_age, null);
});

test("manual DOB, age zero, type edits and validation survive saving", async () => {
  const created = await request("POST", "/patients", {
    ...basePatient, patient_id_type: "birth_certificate", patient_id_number: "BC-NEWBORN", manual_age: 0,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.manual_age, 0);
  const edited = await request("PUT", `/patients/${created.data.id}`, {
    ...basePatient, patient_id_type: "driving_licence", patient_id_number: "DL-EDITED",
    date_of_birth: "1950-08-10", manual_age: 76,
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.patient_id_type, "driving_licence");
  assert.equal(edited.data.date_of_birth, "1950-08-10");
  assert.equal(edited.data.manual_age, 76);
  for (const age of [-1, 1.5, "unknown"]) {
    const invalid = await request("POST", "/patients", { ...basePatient, patient_id_type: "old_age", manual_age: age });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.data));
  }
  const invalid = await request("POST", "/patients", { ...basePatient, patient_id_type: "invalid" });
  assert.equal(invalid.status, 400);
});
