const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPatientVisitPayload } = require("../src/lib/visitRequestNotifications");
const { getDoctorUserId } = require("../src/lib/push");

test("push module exports getDoctorUserId for assigned-doctor notifications", () => {
  assert.equal(typeof getDoctorUserId, "function");
});

test("buildPatientVisitPayload returns en route message with ETA", () => {
  const payload = buildPatientVisitPayload(
    {
      id: 7,
      status: "en_route",
      doctor_name: "Dr Smith",
      eta_minutes: 12,
    },
    { previousStatus: "assigned" },
  );

  assert.ok(payload);
  assert.match(payload.body, /Dr Smith/);
  assert.match(payload.body, /ETA 12 min/);
  assert.equal(payload.url, "/request-visit/tracking");
});

test("buildPatientVisitPayload returns consultation started message", () => {
  const payload = buildPatientVisitPayload(
    {
      id: 7,
      status: "in_consultation",
      doctor_name: "Dr Smith",
    },
    { previousStatus: "arrived" },
  );

  assert.ok(payload);
  assert.match(payload.body, /started your consultation/i);
  assert.equal(payload.title, "Consultation started");
});

test("buildPatientVisitPayload skips unchanged status", () => {
  const payload = buildPatientVisitPayload(
    { id: 7, status: "assigned", doctor_name: "Dr Smith" },
    { previousStatus: "assigned" },
  );

  assert.equal(payload, null);
});
