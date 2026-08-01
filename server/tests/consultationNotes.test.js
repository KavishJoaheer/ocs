"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  composeDoctorNotesStorage,
  normalizeConsultationNotesPayload,
} = require("../src/lib/consultationNotes");
const { buildHealthRecordsPayload } = require("../src/lib/healthRecords");

test("normalizeConsultationNotesPayload stores structured consultation fields separately", () => {
  const payload = normalizeConsultationNotesPayload({
    clinical_note: "BP 138/88. Patient febrile.",
    patient_diagnosis: "URTI",
    patient_prescription: "Tab levodenk",
  });

  assert.equal(payload.clinical_note, "BP 138/88. Patient febrile.");
  assert.equal(payload.patient_diagnosis, "URTI");
  assert.equal(payload.patient_prescription, "Tab levodenk");
  assert.equal(payload.vital_bp, "");
  assert.equal(payload.vital_temperature, "");
  assert.equal(payload.vital_glycemia, "");
  assert.equal(payload.vital_spo2, "");
  assert.equal(payload.vital_rs, "");
  assert.match(payload.doctor_notes, /URTI/);
  assert.match(payload.doctor_notes, /Prescribed: Tab levodenk/);
});

test("normalizeConsultationNotesPayload stores structured vitals alongside notes", () => {
  const payload = normalizeConsultationNotesPayload({
    clinical_note: "Patient febrile.",
    patient_diagnosis: "URTI",
    patient_prescription: "Tab levodenk",
    vital_bp: "138/88",
    vital_temperature: "38.2 °C",
    vital_glycemia: "5.5",
    vital_spo2: "98%",
    vital_rs: "18",
  });

  assert.equal(payload.vital_bp, "138/88");
  assert.equal(payload.vital_temperature, "38.2 °C");
  assert.equal(payload.vital_glycemia, "5.5");
  assert.equal(payload.vital_spo2, "98%");
  assert.equal(payload.vital_rs, "18");
  assert.match(payload.doctor_notes, /BP 138\/88/);
  assert.match(payload.doctor_notes, /SpO2 98%/);
  assert.match(payload.doctor_notes, /Patient febrile/);
});

test("normalizeConsultationNotesPayload keeps legacy doctor_notes flow", () => {
  const payload = normalizeConsultationNotesPayload({
    doctor_notes: "URTI\nPrescribed: Tab levodenk",
  });

  assert.equal(payload.clinical_note, "");
  assert.equal(payload.patient_diagnosis, "");
  assert.equal(payload.patient_prescription, "");
  assert.equal(payload.vital_bp, "");
  assert.equal(payload.doctor_notes, "URTI\nPrescribed: Tab levodenk");
});

test("composeDoctorNotesStorage joins private and patient-facing sections", () => {
  const notes = composeDoctorNotesStorage({
    clinicalNote: "Private vitals review.",
    patientDiagnosis: "URTI",
    patientPrescription: "Tab levodenk",
  });

  assert.match(notes, /Private vitals review/);
  assert.match(notes, /URTI/);
  assert.match(notes, /Prescribed: Tab levodenk/);
});

test("buildHealthRecordsPayload prefers structured consultation columns", () => {
  const payload = buildHealthRecordsPayload({
    patient: {},
    consultationRows: [
      {
        id: 75,
        consultation_date: "2026-06-09",
        doctor_name: "Dr Shravan Joaheer",
        doctor_notes: "BP 138/88. Patient febrile.\n\nURTI\nPrescribed: Tab levodenk",
        clinical_note: "BP 138/88. Patient febrile.",
        patient_diagnosis: "URTI",
        patient_prescription: "Tab levodenk",
      },
    ],
    attachmentRows: [],
    labReportRows: [],
  });

  assert.equal(payload.consultations[0].diagnosis, "URTI");
  assert.equal(payload.consultations[0].prescriptions.length, 1);
  assert.match(payload.consultations[0].prescriptions[0].name, /levodenk/i);
  assert.doesNotMatch(payload.consultations[0].plain_summary, /138\/88/i);
  assert.equal(payload.consultations[0].plain_summary, "");
  assert.equal(payload.consultations[0].patient_prescription, "Tab levodenk");
});
