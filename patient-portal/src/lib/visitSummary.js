import { buildAuthedFileUrl } from "./api.js";

/** Build a visit summary view model from API consultation data only. */
export function buildVisitSummary(consultation) {
  if (!consultation) return null;

  const reports = consultation.reports || [];
  const documents = reports.map((doc) => ({
    id: doc.id,
    name: doc.name || doc.original_name || "Document",
    url:
      doc.url ||
      buildAuthedFileUrl(`/patient-portal/reports/attachments/${doc.id}/download`),
  }));

  return {
    id: consultation.id,
    date: consultation.date || consultation.consultation_date,
    time: consultation.time || null,
    doctor_name: consultation.doctor_name,
    doctor_specialty: consultation.doctor_specialty || "General Practitioner",
    visit_type: consultation.visit_type || "Home Visit",
    diagnosis: consultation.diagnosis || null,
    plain_summary: consultation.plain_summary || consultation.note_preview || null,
    prescriptions: consultation.prescriptions || [],
    documents,
  };
}
