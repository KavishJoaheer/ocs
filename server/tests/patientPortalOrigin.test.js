const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getPatientPortalOrigin } = require("../src/lib/mailer");

function environment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test("existing production environments default to the trusted OCS Care domain, not staff", t => {
  environment(t, { NODE_ENV: "production", PATIENT_PORTAL_ORIGIN: undefined, CLIENT_ORIGIN: "https://staff.ocsvp.com" });
  assert.equal(getPatientPortalOrigin(), "https://ocsvp.com");
});
test("blank production settings also use the canonical Care address", t => {
  environment(t, { NODE_ENV: "production", PATIENT_PORTAL_ORIGIN: "   " });
  assert.equal(getPatientPortalOrigin(), "https://ocsvp.com");
});
test("an explicit HTTPS Care origin overrides the default and normalizes trailing slash", t => {
  environment(t, { NODE_ENV: "production", PATIENT_PORTAL_ORIGIN: " https://care.example.test/ " });
  assert.equal(getPatientPortalOrigin(), "https://care.example.test");
});
test("invalid or insecure explicit production origins still fail closed", t => {
  environment(t, { NODE_ENV: "production", PATIENT_PORTAL_ORIGIN: "" });
  for (const value of ["not-a-url", "http://ocsvp.com", "javascript:alert(1)", "https://user:secret@ocsvp.com", "https://ocsvp.com/sign-in", "https://ocsvp.com?redirect=other", "https://ocsvp.com/#token"]) {
    process.env.PATIENT_PORTAL_ORIGIN = value;
    assert.throws(getPatientPortalOrigin, error => error.status === 503);
  }
});
test("development has its own Care origin and supports a local override", t => {
  environment(t, { NODE_ENV: "test", PATIENT_PORTAL_ORIGIN: undefined, CLIENT_ORIGIN: "http://localhost:5173" });
  assert.equal(getPatientPortalOrigin(), "http://localhost:5174");
  process.env.PATIENT_PORTAL_ORIGIN = "http://127.0.0.1:4274/";
  assert.equal(getPatientPortalOrigin(), "http://127.0.0.1:4274");
});
