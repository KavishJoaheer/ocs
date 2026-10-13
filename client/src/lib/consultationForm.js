export function consultationFormValues(consultation) {
  const structured = Boolean(consultation.clinical_note || consultation.patient_diagnosis || consultation.patient_prescription);
  return {
    appointment_id: String(consultation.appointment_id || ""),
    consultation_date: consultation.consultation_date ?? "",
    doctor_notes: consultation.doctor_notes ?? "",
    ...(structured ? {
      clinical_note: consultation.clinical_note || "",
      patient_diagnosis: consultation.patient_diagnosis || "",
      patient_prescription: consultation.patient_prescription || "",
      ...(consultation.teleconsultation_id ? { patient_summary: consultation.patient_summary || "" } : {}),
    } : {}),
  };
}
