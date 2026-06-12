import dayjs from "dayjs";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
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
  return null;
}

function ConsultationCard({ consultation }) {
  const doctorName = formatDoctorName(consultation.doctor_name);
  const specialty = consultation.doctor_specialty || "General Practitioner";
  const visitType = consultation.visit_type || "Home Visit";
  const dateLabel = formatConsultationDate(consultation.date);
  const prescriptionSummary = formatPrescriptionSummary(consultation);
  const summaryPath = consultation.id ? `/health-records/visits/${consultation.id}` : null;

  const card = (
    <article className="ocs-surface-card ocs-card-press w-full overflow-hidden bg-white">
      <div
        className="flex items-start justify-between"
        style={{ padding: "var(--native-pad-card)" }}
      >
        <div className="flex min-w-0 items-start gap-4">
          <div
            className="squircle-inner flex size-11 shrink-0 items-center justify-center bg-gradient-to-br from-brand-teal to-[#5ed9d2] text-[13px] font-bold text-white"
            aria-hidden="true"
          >
            {doctorInitials(consultation.doctor_name)}
          </div>
          <div className="min-w-0 pt-0.5">
            <p className="native-display text-[16px] leading-snug text-brand-dark-grey lg:text-ocs-slate">{doctorName}</p>
            <p className="native-label mt-0.5 text-[13px] text-brand-cool-grey">{specialty}</p>
          </div>
        </div>

        <div className="ml-4 shrink-0 text-right">
          <p className="native-label text-[13px] text-brand-cool-grey">{dateLabel}</p>
          <span className="ocs-status-pill ocs-status-pill-teal mt-2">{visitType}</span>
        </div>
      </div>

      <div className="border-t border-brand-teal/10" aria-hidden="true" />

      <div
        className="grid grid-cols-2 gap-4 bg-gradient-to-br from-brand-teal/5 to-white lg:gap-6"
        style={{ padding: "var(--native-pad-card)" }}
      >
        <div>
          <p className="native-label mb-2 text-[13px] text-brand-dark-grey lg:text-ocs-slate">Diagnosis</p>
          {consultation.diagnosis ? (
            <span className="ocs-status-pill-diagnosis">{consultation.diagnosis}</span>
          ) : (
            <p className="text-[14px] font-medium text-brand-cool-grey">Not recorded</p>
          )}
        </div>

        <div>
          <p className="native-label mb-2 text-[13px] text-brand-dark-grey lg:text-ocs-slate">Prescription</p>
          {prescriptionSummary ? (
            <p className="text-[14px] font-medium leading-relaxed text-brand-cool-grey">
              {prescriptionSummary}
            </p>
          ) : (
            <p className="text-[14px] font-medium text-brand-cool-grey">Not recorded</p>
          )}
        </div>
      </div>

      {summaryPath ? (
        <>
          <div className="border-t border-brand-teal/10" aria-hidden="true" />
          <div
            className="flex items-center justify-between bg-white"
            style={{ padding: "var(--native-pad-card)" }}
          >
            <span className="text-[14px] font-semibold text-brand-teal">View visit summary</span>
            <ChevronRight className="size-5 text-brand-teal" strokeWidth={2.25} aria-hidden="true" />
          </div>
        </>
      ) : null}
    </article>
  );

  if (!summaryPath) {
    return card;
  }

  return (
    <Link
      to={summaryPath}
      className="block w-full rounded-[inherit] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
      aria-label={`View visit summary for ${doctorName} on ${dateLabel}`}
    >
      {card}
    </Link>
  );
}

export default ConsultationCard;
