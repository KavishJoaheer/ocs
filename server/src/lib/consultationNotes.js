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

/** Legacy doctor_notes text composed for staff viewers and older integrations. */
function composeDoctorNotesStorage({ clinicalNote, patientDiagnosis, patientPrescription }) {
  const parts = [];

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

function normalizeStructuredConsultationPayload(body) {
  const clinicalNote = trimValue(body?.clinical_note);
  const patientDiagnosis = trimValue(body?.patient_diagnosis);
  const patientPrescription = trimValue(body?.patient_prescription);

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
    doctor_notes: composeDoctorNotesStorage({
      clinicalNote,
      patientDiagnosis,
      patientPrescription,
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
  hasStructuredConsultationFields,
  normalizeConsultationNotesPayload,
};
