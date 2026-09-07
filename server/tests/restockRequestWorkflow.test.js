"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  canTransition,
  normaliseStatus,
  supplyRequestStatusLabel,
} = require("../src/lib/restockRequestWorkflow");

test("legacy prepared status normalises to ready", () => {
  assert.equal(normaliseStatus("prepared"), "ready");
  assert.equal(normaliseStatus("READY"), "ready");
});

test("role-specific completed labels are correct", () => {
  assert.equal(supplyRequestStatusLabel("pending", "doctor"), "Requested");
  assert.equal(supplyRequestStatusLabel("pending", "operator"), "Pending");
  assert.equal(supplyRequestStatusLabel("accepted", "doctor"), "Request Accepted");
  assert.equal(supplyRequestStatusLabel("ready", "operator"), "Supply Ready");
  assert.equal(supplyRequestStatusLabel("completed", "doctor"), "Supply Collected");
  assert.equal(supplyRequestStatusLabel("completed", "operator"), "Supply Dispatched");
  assert.equal(supplyRequestStatusLabel("completed", "admin"), "Completed");
  assert.equal(supplyRequestStatusLabel("cancelled", "admin"), "Cancelled");
});

test("only valid role transitions are accepted", () => {
  assert.equal(canTransition("doctor", "pending", "cancelled"), true);
  assert.equal(canTransition("doctor", "pending", "accepted"), false);
  assert.equal(canTransition("doctor", "accepted", "cancelled"), false);
  assert.equal(canTransition("doctor", "ready", "completed"), true);
  assert.equal(canTransition("doctor", "accepted", "completed"), false);
  assert.equal(canTransition("operator", "pending", "accepted"), true);
  assert.equal(canTransition("operator", "accepted", "ready"), true);
  assert.equal(canTransition("operator", "pending", "ready"), false);
  assert.equal(canTransition("operator", "ready", "completed"), false);
  assert.equal(canTransition("operator", "ready", "cancelled"), false);
  assert.equal(canTransition("admin", "accepted", "cancelled"), true);
  assert.equal(canTransition("admin", "ready", "cancelled"), true);
});
