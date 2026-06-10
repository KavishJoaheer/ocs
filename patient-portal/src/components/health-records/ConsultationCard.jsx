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
    <article className="ocs-surface-card ocs-card-press w-full cursor-default overflow-hidden bg-white">
      <div
        className="flex items-start justify-between"
        style={{ padding: "var(--native-pad-card)" }}
      >
        <div className="flex min-w-0 items-start gap-4">
          <div
            className="squircle-inner flex size-11 shrink-0 items-center justify-center bg-gradient-to-br from-[#2d8f98] to-[#41c8c6] text-[13px] font-bold text-white"
            aria-hidden="true"
          >
            {doctorInitials(consultation.doctor_name)}
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="native-display text-[16px] leading-snug text-[#1a5c52]">{doctorName}</p>
            <p className="native-label mt-0.5 text-[13px] text-[#5b7f8a]">{specialty}</p>
          </div>
        </div>

        <div className="ml-4 shrink-0 text-right">
          <p className="native-label text-[13px] text-[#5b7f8a]">{dateLabel}</p>
          <span className="ocs-status-pill ocs-status-pill-teal mt-2">{visitType}</span>
        </div>
      </div>

      <div className="border-t border-teal-500/10" aria-hidden="true" />

      <div
        className="grid grid-cols-2 gap-4 bg-gradient-to-br from-teal-50/60 to-white lg:gap-6"
        style={{ padding: "var(--native-pad-card)" }}
      >
        <div>
          <p className="native-label mb-2 text-[13px] text-[#1a5c52]">Diagnosis</p>
          {consultation.diagnosis ? (
            <span className="ocs-status-pill-diagnosis">{consultation.diagnosis}</span>
          ) : (
            <p className="text-[14px] font-medium text-[#8a9e9a]">Not recorded</p>
          )}
        </div>

        <div>
          <p className="native-label mb-2 text-[13px] text-[#1a5c52]">Prescription</p>
          <p className="text-[14px] font-medium leading-relaxed text-[#22485b]">
            {prescriptionSummary}
          </p>
        </div>
      </div>
    </article>
  );
}

export default ConsultationCard;
