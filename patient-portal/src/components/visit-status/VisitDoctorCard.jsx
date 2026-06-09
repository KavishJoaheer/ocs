import { Phone } from "lucide-react";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";

const OCS_CARE_TEL = "52522234";

function doctorInitials(name) {
  const trimmed = String(name || "Dr").replace(/^dr\.?\s+/i, "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function VisitDoctorCard({ doctorName, specialty = "General Practitioner", phone = OCS_CARE_TEL }) {
  const formattedName = formatDoctorName(doctorName);

  return (
    <article className="visit-status-doctor-card flex items-center gap-4">
      <div className="relative shrink-0">
        <div
          className="flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-[#2d8f98] to-[#41c8c6] text-[15px] font-bold text-white shadow-[0_4px_14px_rgba(45,143,152,0.22)]"
          aria-hidden="true"
        >
          {doctorInitials(doctorName)}
        </div>
        <span
          className="absolute bottom-0 right-0 size-3.5 rounded-full border-2 border-white bg-[#34c759]"
          aria-label="Doctor online"
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="native-display truncate text-[17px] leading-snug text-[#1a5c52]">
          {formattedName}
        </p>
        <p className="mt-0.5 truncate text-[13px] text-[#8a9e9a]">{specialty}</p>
      </div>

      <a
        href={`tel:${phone}`}
        aria-label={`Call ${formattedName}`}
        className="visit-status-call-btn flex size-11 shrink-0 items-center justify-center rounded-full transition active:scale-95"
      >
        <Phone className="size-[18px] text-ocs-orange" strokeWidth={2.25} />
      </a>
    </article>
  );
}

export default VisitDoctorCard;
