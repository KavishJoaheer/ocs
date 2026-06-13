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
  assert.match(payload.doctor_notes, /URTI/);
  assert.match(payload.doctor_notes, /Prescribed: Tab levodenk/);
});

test("normalizeConsultationNotesPayload keeps legacy doctor_notes flow", () => {
  const payload = normalizeConsultationNotesPayload({
    doctor_notes: "URTI\nPrescribed: Tab levodenk",
  });

  assert.equal(payload.clinical_note, "");
  assert.equal(payload.patient_diagnosis, "");
  assert.equal(payload.patient_prescription, "");
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
});
