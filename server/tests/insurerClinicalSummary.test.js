"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeConsultationNotesPayload } = require("../src/lib/consultationNotes");
const { buildInsurerTreatmentSummaries } = require("../src/lib/insurerClinicalSummary");

test("insurer summary prefers the structured diagnosis over private clinical text", () => {
  const notes = normalizeConsultationNotesPayload({
    clinical_note: "Impression: PRIVATE differential diagnosis\nBP 138/88.",
    patient_diagnosis: "Viral syndrome",
    patient_prescription: "PRIVATE prescription instructions",
  });
  const [summary] = buildInsurerTreatmentSummaries([{
    ...notes,
    raw_text: notes.doctor_notes,
    doctor_name: "Example Doctor",
    visit_date: "2026-10-29",
  }]);

  assert.equal(summary.diagnosis, "Viral syndrome");
  assert.equal(summary.summaryString, "Diagnosis: Viral syndrome");
  assert.equal(JSON.stringify(summary).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(summary).includes("138/88"), false);
});

test("structured records without a shared diagnosis do not fall back to private notes", () => {
  for (const structuredFields of [
    { clinical_note: "Private findings" },
    { patient_prescription: "Private prescription" },
  ]) {
    const [summary] = buildInsurerTreatmentSummaries([{
      ...structuredFields,
      patient_diagnosis: " ",
      raw_text: "Impression: PRIVATE differential diagnosis",
    }]);

    assert.equal(summary.diagnosis, "General Assessment");
    assert.equal(JSON.stringify(summary).includes("PRIVATE"), false);
  }
});

test("legacy records retain diagnosis-prefix parsing", () => {
  for (const fields of [{}, { clinical_note: " ", patient_diagnosis: null, patient_prescription: "" }]) {
    const [summary] = buildInsurerTreatmentSummaries([{
      ...fields,
      raw_text: "BP 138/88.\nImpression: Seasonal allergic rhinitis\nRx: PRIVATE medication",
    }]);

    assert.equal(summary.diagnosis, "Seasonal allergic rhinitis");
    assert.equal(JSON.stringify(summary).includes("PRIVATE"), false);
    assert.equal(JSON.stringify(summary).includes("138/88"), false);
  }
});

test("structured diagnoses preserve their wording within the existing summary length limit", () => {
  const diagnosis = "Type IV hypersensitivity, day 2 review";
  const [summary, longSummary] = buildInsurerTreatmentSummaries([
    { patient_diagnosis: `  ${diagnosis}  ` },
    { patient_diagnosis: "a".repeat(150) },
  ]);

  assert.equal(summary.diagnosis, diagnosis);
  assert.equal(longSummary.diagnosis, `${"a".repeat(140)}…`);
});
