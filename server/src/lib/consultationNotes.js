function trimValue(value) {
  return String(value ?? "").trim();
}

function hasStructuredConsultationFields(body) {
  return (
    trimValue(body?.clinical_note) ||
    trimValue(body?.patient_diagnosis) ||
    trimValue(body?.patient_prescription)
  );
}

function normalizeVitalsFields(body) {
  return {
    vital_bp: trimValue(body?.vital_bp),
    vital_temperature: trimValue(body?.vital_temperature),
    vital_glycemia: trimValue(body?.vital_glycemia),
    vital_spo2: trimValue(body?.vital_spo2),
    vital_pulse: trimValue(body?.vital_pulse),
  };
}

/** Compact vitals line for legacy doctor_notes / health-record parsers. */
function composeVitalsLine(vitals) {
  const parts = [];

  if (vitals.vital_bp) {
    parts.push(`BP ${vitals.vital_bp}`);
  }

  if (vitals.vital_temperature) {
    parts.push(`T ${vitals.vital_temperature}`);
  }

  if (vitals.vital_glycemia) {
    parts.push(`Gr ${vitals.vital_glycemia}`);
  }

  if (vitals.vital_spo2) {
    parts.push(`SpO2 ${vitals.vital_spo2}`);
  }

  if (vitals.vital_pulse) {
    parts.push(`Pulse ${vitals.vital_pulse}`);
  }

  return parts.join(". ");
}

/** Legacy doctor_notes text composed for staff viewers and older integrations. */
function composeDoctorNotesStorage({
  clinicalNote,
  patientDiagnosis,
  patientPrescription,
  vitals,
}) {
  const parts = [];
  const vitalsLine = vitals ? composeVitalsLine(vitals) : "";

  if (vitalsLine) {
    parts.push(vitalsLine);
  }

  if (clinicalNote) {
    parts.push(clinicalNote);
  }

  if (patientDiagnosis) {
    parts.push(patientDiagnosis);
  }

  if (patientPrescription) {
    parts.push(`Prescribed: ${patientPrescription}`);
  }

  return parts.join("\n\n");
}

function emptyVitalsFields() {
  return {
    vital_bp: "",
    vital_temperature: "",
    vital_glycemia: "",
    vital_spo2: "",
    vital_pulse: "",
  };
}

function normalizeStructuredConsultationPayload(body) {
  const clinicalNote = trimValue(body?.clinical_note);
  const patientDiagnosis = trimValue(body?.patient_diagnosis);
  const patientPrescription = trimValue(body?.patient_prescription);
  const vitals = normalizeVitalsFields(body);

  if (!clinicalNote) {
    return { error: "Internal clinical note is required." };
  }

  if (!patientDiagnosis) {
    return { error: "Patient-facing diagnosis is required." };
  }

  return {
    clinical_note: clinicalNote,
    patient_diagnosis: patientDiagnosis,
    patient_prescription: patientPrescription,
    ...vitals,
    doctor_notes: composeDoctorNotesStorage({
      clinicalNote,
      patientDiagnosis,
      patientPrescription,
      vitals,
    }),
  };
}

function normalizeLegacyConsultationNotes(body) {
  const doctorNotes = trimValue(body?.doctor_notes);

  if (!doctorNotes) {
    return { error: "Consultation note is required." };
  }

  return {
    clinical_note: "",
    patient_diagnosis: "",
    patient_prescription: "",
    ...emptyVitalsFields(),
    doctor_notes: doctorNotes,
  };
}

function normalizeConsultationNotesPayload(body) {
  if (hasStructuredConsultationFields(body)) {
    return normalizeStructuredConsultationPayload(body);
  }

  return normalizeLegacyConsultationNotes(body);
}

module.exports = {
  composeDoctorNotesStorage,
  composeVitalsLine,
  hasStructuredConsultationFields,
  normalizeConsultationNotesPayload,
};
