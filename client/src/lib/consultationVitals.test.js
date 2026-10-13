import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBloodPressureInput, formatVitalInput } from "./consultationVitals.js";

test("typing BP inserts a slash and backspace can clear the whole value", () => {
  let value = "";
  for (const digit of "12080") value = formatBloodPressureInput(value + digit, value);
  assert.equal(value, "120/80");
  for (const expected of ["120/8", "120/", "12", "1", ""]) {
    value = formatBloodPressureInput(value.slice(0, -1), value);
    assert.equal(value, expected);
  }
});

test("BP supports pasted readings and explicit two-digit systolic readings", () => {
  assert.equal(formatBloodPressureInput("12080"), "120/80");
  assert.equal(formatBloodPressureInput("120 / 80"), "120/80");
  assert.equal(formatBloodPressureInput("90/60"), "90/60");
  assert.equal(formatBloodPressureInput("130/80", "120/80"), "130/80");
});

test("pasted units stay outside editable measurements and optional fields can clear", () => {
  assert.equal(formatVitalInput("vital_temperature", "36.6 °C"), "36.6");
  assert.equal(formatVitalInput("vital_temperature", "36,6"), "36.6");
  assert.equal(formatVitalInput("vital_spo2", "98%"), "98");
  assert.equal(formatVitalInput("vital_temperature", ""), "");
  assert.equal(formatVitalInput("vital_spo2", ""), "");
  assert.equal(formatVitalInput("vital_pulse", "72"), "72");
});
