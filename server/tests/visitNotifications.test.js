const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPatientVisitPayload } = require("../src/lib/visitRequestNotifications");

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

test("buildPatientVisitPayload skips unchanged status", () => {
  const payload = buildPatientVisitPayload(
    { id: 7, status: "assigned", doctor_name: "Dr Smith" },
    { previousStatus: "assigned" },
  );

  assert.equal(payload, null);
});
