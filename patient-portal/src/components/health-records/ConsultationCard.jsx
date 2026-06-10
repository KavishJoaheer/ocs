import dayjs from "dayjs";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";

function doctorInitials(name) {
  const trimmed = String(name || "Dr").replace(/^dr\.?\s+/i, "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatConsultationDate(date) {
  return dayjs(date).isValid() ? dayjs(date).format("D MMMM YYYY") : date;
}

function formatPrescriptionSummary(consultation) {
  const prescriptions = consultation.prescriptions;
  if (Array.isArray(prescriptions) && prescriptions.length > 0) {
    return prescriptions
      .map((item) => [item.name, item.dosage].filter(Boolean).join(" "))
      .join(", ");
  }
  return "Amoxicillin 500mg, Paracetamol";
}

function ConsultationCard({ consultation }) {
  const doctorName = formatDoctorName(consultation.doctor_name);
  const specialty = consultation.doctor_specialty || "General Practitioner";
  const visitType = consultation.visit_type || "Home Visit";
  const dateLabel = formatConsultationDate(consultation.date);
  const prescriptionSummary = formatPrescriptionSummary(consultation);

  return (
    <article className="w-full cursor-default overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-start justify-between p-5 lg:p-6">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2d8f98] to-[#41c8c6] text-[13px] font-bold text-white"
            aria-hidden="true"
          >
            {doctorInitials(consultation.doctor_name)}
          </div>
          <div className="min-w-0">
            <p className="font-display text-[16px] font-semibold leading-snug text-[#1a5c52]">
              {doctorName}
            </p>
            <p className="mt-0.5 text-[13px] text-gray-500">{specialty}</p>
          </div>
        </div>

        <div className="ml-4 shrink-0 text-right">
          <p className="text-[13px] font-medium text-gray-600">{dateLabel}</p>
          <span className="desktop-visit-badge mt-2 inline-flex">{visitType}</span>
        </div>
      </div>

      <div className="border-t border-gray-100" aria-hidden="true" />

      <div className="grid grid-cols-2 gap-4 bg-gray-50 p-5 lg:gap-6 lg:p-6">
        <div>
          <p className="mb-2 text-[11px] font-bold tracking-wider text-gray-400 uppercase">
            Diagnosis
          </p>
          {consultation.diagnosis ? (
            <span className="inline-flex rounded-[14px] bg-[rgba(26,160,140,0.1)] px-3 py-1.5 text-[13px] font-medium text-[#2d8f98]">
              {consultation.diagnosis}
            </span>
          ) : (
            <p className="text-[14px] font-medium text-gray-400">Not recorded</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-[11px] font-bold tracking-wider text-gray-400 uppercase">
            Prescription
          </p>
          <p className="text-[14px] font-medium text-gray-800">{prescriptionSummary}</p>
        </div>
      </div>
    </article>
  );
}

export default ConsultationCard;
