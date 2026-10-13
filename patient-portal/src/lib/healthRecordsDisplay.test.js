import { test } from "node:test";
import assert from "node:assert/strict";

test("patient prescriptions preserve every supplied line instead of lossy legacy parsing", async () => {
  const { formatPrescriptionSummary } = await import("./healthRecordsDisplay.js");
  const text = "First medicine\nSecond medicine\nFollow these exact instructions.";
  assert.equal(formatPrescriptionSummary({ patient_prescription: text, prescriptions: [{ name: "First medicine", dosage: "First medicine" }] }), text);
  assert.equal(formatPrescriptionSummary({ prescriptions: [] }), null);
  assert.equal(formatPrescriptionSummary({ prescriptions: [{ name: "Legacy medicine", dosage: "Legacy medicine" }] }), "Legacy medicine");
});

test("health export opens a writable print tab, severs its opener and includes the full escaped prescription", async () => {
  const { exportHealthRecordsPdf } = await import("./healthRecordsExport.js");
  const previousWindow = globalThis.window;
  let html = "", printed = false;
  const popup = { opener: {}, document: { open() {}, write(value) { html = value; }, close() {} }, focus() {}, print() { printed = true; } };
  globalThis.window = {
    open(_url, _target, features) { return features.includes("noopener") ? null : popup; },
    setTimeout(fn) { fn(); },
  };
  try {
    exportHealthRecordsPdf({ patientName: "Test patient", timeline: [{ date: "2026-10-13", title: "Shared assessment", subtitle: "Dr Test" }], consultations: [{ date: "2026-10-13", diagnosis: "Shared assessment", doctor_name: "Dr Test", plain_summary: "Shared plan", patient_prescription: "First line\nSecond line <img src=x onerror=alert(1)>" }] });
    assert.equal(popup.opener, null); assert.equal(printed, true);
    assert.ok(html.includes("First line\nSecond line &lt;img")); assert.ok(!html.includes("<img")); assert.ok(html.includes("Shared plan"));
  } finally { globalThis.window = previousWindow; }
});
