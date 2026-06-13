import { useState } from "react";
import dayjs from "dayjs";
import { ChevronDown, ChevronUp } from "lucide-react";
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

function DesktopExpandedDetails({ consultation }) {
  const prescriptions = consultation.prescriptions || [];
  const hasPrescriptions = prescriptions.length > 0;
  const hasDoctorNotes = Boolean(consultation.plain_summary?.trim());

  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-[var(--native-pad-card)] py-5">
      <section>
        <h3 className="text-ocs-slate border-b border-slate-100 pb-2 mb-3 text-base font-semibold">
          Prescribed Medications &amp; Instructions
        </h3>
        {hasPrescriptions ? (
          <ul className="flex flex-col gap-4">
            {prescriptions.map((item) => (
              <li key={item.id}>
                <p className="text-ocs-slate font-medium">{item.name}</p>
                {item.instructions ? (
                  <p className="text-slate-500 mt-1 text-sm leading-relaxed">{item.instructions}</p>
                ) : item.dosage && item.dosage !== item.name ? (
                  <p className="text-slate-500 mt-1 text-sm leading-relaxed">{item.dosage}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-brand-cool-grey">No prescribed medications recorded.</p>
        )}
      </section>

      {hasDoctorNotes ? (
        <section className="mt-6">
          <h3 className="text-ocs-slate mb-2 text-base font-semibold">Doctor&apos;s Notes</h3>
          <p className="text-slate-600 text-sm leading-relaxed">{consultation.plain_summary}</p>
        </section>
      ) : null}
    </div>
  );
}

function ConsultationCard({ consultation }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const doctorName = formatDoctorName(consultation.doctor_name);
  const specialty = consultation.doctor_specialty || "General Practitioner";
  const visitType = consultation.visit_type || "Home Visit";
  const dateLabel = formatConsultationDate(consultation.date);
  const prescriptionSummary = formatPrescriptionSummary(consultation);
  const canExpand = Boolean(consultation.id);

  return (
    <article className="ocs-surface-card w-full overflow-hidden bg-white">
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
            <p className="native-display text-[16px] leading-snug text-brand-dark-grey lg:text-ocs-slate">
              {doctorName}
            </p>
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
          <p className="native-label mb-2 text-[13px] text-brand-dark-grey lg:text-ocs-slate">
            Diagnosis
          </p>
          {consultation.diagnosis ? (
            <span className="ocs-status-pill-diagnosis">{consultation.diagnosis}</span>
          ) : (
            <p className="text-[14px] font-medium text-brand-cool-grey">Not recorded</p>
          )}
        </div>

        <div>
          <p className="native-label mb-2 text-[13px] text-brand-dark-grey lg:text-ocs-slate">
            Prescription
          </p>
          {prescriptionSummary ? (
            <p className="text-[14px] font-medium leading-relaxed text-brand-cool-grey">
              {prescriptionSummary}
            </p>
          ) : (
            <p className="text-[14px] font-medium text-brand-cool-grey">Not recorded</p>
          )}
        </div>
      </div>

      {canExpand ? (
        <>
          <div className="hidden border-t border-brand-teal/10 lg:block" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setIsExpanded((open) => !open)}
            className="hidden w-full items-center justify-center bg-white py-3 text-ocs-teal transition hover:bg-slate-50/80 lg:flex"
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? `Collapse visit details for ${doctorName} on ${dateLabel}`
                : `Expand visit details for ${doctorName} on ${dateLabel}`
            }
          >
            {isExpanded ? (
              <ChevronUp className="size-5" strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <ChevronDown className="size-5" strokeWidth={2.25} aria-hidden="true" />
            )}
          </button>

          <div className="hidden lg:block">
            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                isExpanded ? "max-h-[960px] opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <DesktopExpandedDetails consultation={consultation} />
            </div>
          </div>
        </>
      ) : null}
    </article>
  );
}

export default ConsultationCard;
