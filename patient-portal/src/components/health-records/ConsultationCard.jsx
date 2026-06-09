import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";

function doctorInitials(name) {
  const trimmed = String(name || "Dr").replace(/^dr\.?\s+/i, "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatConsultationDateTime(date, time) {
  const dateLabel = dayjs(date).isValid() ? dayjs(date).format("D MMMM YYYY") : date;
  if (!time) return dateLabel;
  return `${dateLabel} • ${time}`;
}

function ConsultationCard({ consultation }) {
  const navigate = useNavigate();

  const doctorName = formatDoctorName(consultation.doctor_name);
  const specialty = consultation.doctor_specialty || "General Practitioner";
  const visitType = consultation.visit_type || "Home Visit";
  const dateTimeLabel = formatConsultationDateTime(consultation.date, consultation.time);

  return (
    <button
      type="button"
      onClick={() => navigate(`/health-records/visits/${consultation.id}`)}
      className="consultation-card-pressable squircle-outer ocs-elevate-timeline w-full bg-white text-left"
    >
      {/* Top row — date/time + visit badge */}
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <p className="text-[13px] font-medium text-[#5b7f8a]">{dateTimeLabel}</p>
        <span className="consultation-visit-badge shrink-0">{visitType}</span>
      </div>

      {/* Doctor row — avatar + name + role */}
      <div className="mt-4 flex items-center gap-3 px-5">
        <div
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2d8f98] to-[#41c8c6] text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(45,143,152,0.2)]"
          aria-hidden="true"
        >
          {doctorInitials(consultation.doctor_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="native-display text-[16px] leading-snug text-[#1a5c52]">{doctorName}</p>
          <p className="mt-0.5 text-[13px] text-[#8a9e9a]">{specialty}</p>
        </div>
      </div>

      {/* Diagnosis */}
      {consultation.diagnosis ? (
        <div className="mt-5 px-5">
          <p className="consultation-micro-label">Diagnosis</p>
          <span className="squircle-inner mt-2 inline-flex bg-[rgba(26,160,140,0.1)] px-3.5 py-1.5 text-[13px] font-medium text-[#2d8f98]">
            {consultation.diagnosis}
          </span>
        </div>
      ) : null}

      {/* Footer CTA */}
      <div className="consultation-card-divider mt-5" aria-hidden="true" />
      <div className="flex items-center justify-between px-5 py-4">
        <span className="text-[14px] font-semibold text-[#1a5c52]">View Full Report</span>
        <ChevronRight className="size-[18px] text-ocs-orange" strokeWidth={2.25} />
      </div>
    </button>
  );
}

export default ConsultationCard;
