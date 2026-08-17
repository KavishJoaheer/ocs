const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPatientAppointmentPayload } = require("../src/lib/appointmentNotifications");

test("buildPatientAppointmentPayload booked includes doctor and stamp", () => {
  const payload = buildPatientAppointmentPayload("booked", {
    id: 9,
    doctor_name: "Dr Joaheer",
    appointment_date: "2026-08-20",
    appointment_time: "10:30",
  });

  assert.equal(payload.title, "Appointment booked");
  assert.match(payload.body, /Dr Joaheer/);
  assert.match(payload.body, /20 Aug 2026/);
  assert.match(payload.body, /10:30/);
  assert.equal(payload.url, "/appointments");
  assert.equal(payload.tag, "appointment-9-booked");
});

test("buildPatientAppointmentPayload cancelled names the visit", () => {
  const payload = buildPatientAppointmentPayload("cancelled", {
    id: 9,
    doctor_name: "Dr Joaheer",
    appointment_date: "2026-08-20",
    appointment_time: "10:30",
  });

  assert.equal(payload.title, "Appointment cancelled");
  assert.match(payload.body, /20 Aug 2026/);
  assert.equal(payload.url, "/appointments");
});

test("buildPatientAppointmentPayload ignores unknown kinds", () => {
  assert.equal(buildPatientAppointmentPayload("reschedule", { id: 1 }), null);
});
