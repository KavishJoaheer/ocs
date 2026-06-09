"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseVitalsFromText,
  mergeVitalsTrends,
  buildPlainSummaryFromNotes,
  extractDiagnosisFromNotes,
  buildHealthRecordsPayload,
} = require("../src/lib/healthRecords");

test("parseVitalsFromText extracts blood pressure and glucose", () => {
  const text = `
    Vitals: BP 138/88 mmHg, fasting glucose 6.4 mmol/L.
    Imp: Type 2 diabetes — review in 3 months.
  `;

  const readings = parseVitalsFromText(text, {
    date: "2026-03-01",
    source: "consultation",
    sourceId: 12,
  });

  assert.equal(readings.blood_pressure.length, 1);
  assert.deepEqual(readings.blood_pressure[0], {
    date: "2026-03-01",
    systolic: 138,
    diastolic: 88,
    source: "consultation",
    source_id: 12,
  });

  assert.equal(readings.glucose.length, 1);
  assert.equal(readings.glucose[0].value, 6.4);
  assert.equal(readings.glucose[0].unit, "mmol/L");
});

test("parseVitalsFromText extracts HbA1c from lab report text", () => {
  const readings = parseVitalsFromText("HbA1c: 7.2% — above target range.", {
    date: "2026-02-10",
    source: "lab_report",
    sourceId: 3,
  });

  assert.equal(readings.hba1c.length, 1);
  assert.equal(readings.hba1c[0].value, 7.2);
});

test("buildPlainSummaryFromNotes skips diagnosis lines", () => {
  const summary = buildPlainSummaryFromNotes(
    "Patient reports improved energy.\nImp: Hypertension — stable on current regimen.",
  );

  assert.match(summary, /improved energy/i);
  assert.doesNotMatch(summary, /hypertension/i);
});

test("extractDiagnosisFromNotes reads impression lines", () => {
  const diagnosis = extractDiagnosisFromNotes("Imp: Seasonal allergic rhinitis");
  assert.match(diagnosis, /allergic rhinitis/i);
});

test("buildHealthRecordsPayload returns summary, timeline, and vitals trends", () => {
  const payload = buildHealthRecordsPayload({
    patient: {
      past_medical_history: "Hypertension",
      past_surgical_history: "",
      drug_allergy_history: "Penicillin",
      drug_history: "Amlodipine 5 mg daily",
      ongoing_treatment: "Home BP monitoring twice weekly",
    },
    consultationRows: [
      {
        id: 1,
        consultation_date: "2026-03-01",
        doctor_name: "Dr Test",
        doctor_notes:
          "Home readings improved. BP 128/82 mmHg.\nImp: Hypertension — well controlled.",
      },
    ],
    attachmentRows: [],
    labReportRows: [
      {
        id: 9,
        report_date: "2026-02-15",
        report_details: "Fasting glucose 5.8 mmol/L. HbA1c 6.1%.",
      },
    ],
  });

  assert.equal(payload.consultations.length, 1);
  assert.ok(payload.summary.headline);
  assert.equal(payload.summary.allergy_count, 1);
  assert.equal(payload.timeline.length, 1);
  assert.equal(payload.vitals_trends.blood_pressure.length, 1);
  assert.equal(payload.vitals_trends.glucose.length, 1);
  assert.equal(payload.vitals_trends.hba1c.length, 1);
});
