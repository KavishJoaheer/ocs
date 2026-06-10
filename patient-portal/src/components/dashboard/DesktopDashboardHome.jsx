import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { HousePlus, Phone } from "lucide-react";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";

const OCS_CARE_TEL = "52522234";
const OCS_CARE_DISPLAY = "52 52 22 34";

function doctorInitials(name) {
  const trimmed = String(name || "Dr").replace(/^dr\.?\s+/i, "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function DesktopCareTeamCard({ doctorName }) {
  const displayName = doctorName ? formatDoctorName(doctorName) : "Your OCS care team";
  const isAssigned = Boolean(doctorName);

  return (
    <section className="desktop-card animate-fade-in-up stagger-1">
      <p className="desktop-section-label">Your Care Team</p>

      <div className="mt-5 flex items-center gap-4">
        <div className="desktop-care-team-avatar-wrap shrink-0">
          <div className="desktop-care-team-avatar-ring">
            <div className="desktop-care-team-avatar" aria-hidden="true">
              {doctorInitials(doctorName || "Care Team")}
            </div>
          </div>
          <span className="desktop-care-team-status" aria-label="Available" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold leading-snug text-[#1a5c52]">
            {displayName}
          </p>
          <p className="mt-0.5 text-sm text-[#8a9e9a]">
            {isAssigned ? "Primary Care Physician" : "Assigning your physician shortly"}
          </p>
          {isAssigned ? (
            <p className="mt-1 text-xs text-[#8a9e9a]">Your assigned OCS doctor</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DesktopConciergeCard() {
  return (
    <section className="desktop-concierge-card desktop-concierge-card-hover animate-fade-in-up stagger-2">
      <p className="font-display text-sm font-semibold text-ocs-orange">We&apos;re here for you.</p>
      <h2 className="mt-3 font-display text-2xl font-bold leading-tight tracking-tight text-white">
        24/7 Medical Concierge
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/70">
        Immediate support for your health, day or night.
      </p>
      <a href={`tel:${OCS_CARE_TEL}`} className="desktop-concierge-dial mt-7">
        <Phone className="size-5 shrink-0 text-white" strokeWidth={2} />
        <span>{OCS_CARE_DISPLAY}</span>
      </a>
    </section>
  );
}

function DesktopLastVisitCard({ consultation }) {
  const doctorName = formatDoctorName(consultation.doctor_name);
  const dateLabel = dayjs(consultation.date).isValid()
    ? dayjs(consultation.date).format("D MMMM YYYY")
    : consultation.date;
  const summaryTo = consultation.id
    ? `/health-records/visits/${consultation.id}`
    : "/health-records";

  return (
    <section className="desktop-card animate-fade-in-up stagger-1">
      <h2 className="font-display text-lg font-bold text-[#1a5c52]">Your Last Visit</h2>

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-[#5b7f8a]">{dateLabel}</p>
        <span className="desktop-visit-badge shrink-0">Home Visit</span>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2d8f98] to-[#41c8c6] text-[15px] font-bold text-white"
          aria-hidden="true"
        >
          {doctorInitials(consultation.doctor_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold leading-snug text-[#1a5c52]">{doctorName}</p>
          <p className="mt-0.5 text-sm text-[#8a9e9a]">General Practitioner</p>
        </div>
      </div>

      {consultation.diagnosis ? (
        <div className="mt-6">
          <p className="consultation-micro-label">Diagnosis</p>
          <span className="mt-2 inline-flex rounded-[14px] bg-[rgba(26,160,140,0.1)] px-4 py-1.5 text-[13px] font-medium text-[#2d8f98]">
            {consultation.diagnosis}
          </span>
        </div>
      ) : null}

      <div className="mt-8 flex justify-end">
        <Link
          to={summaryTo}
          className="text-sm font-bold text-ocs-orange transition hover:text-[#c88710]"
        >
          View Visit Summary →
        </Link>
      </div>
    </section>
  );
}

function DesktopDashboardHome({
  subline,
  profileLastConsultation,
  activeVisitSlot,
  headline,
  careTeamDoctorName,
}) {
  return (
    <div className="desktop-dashboard">
      <header className="desktop-dashboard-greeting animate-fade-in-up">
        <h1 className="font-display text-[2rem] tracking-tight text-[#1a5c52] sm:text-4xl">
          {headline}
        </h1>
        <p className="mt-2 max-w-xl text-base leading-relaxed text-[#5b7f8a]">{subline}</p>
      </header>

      {activeVisitSlot ? (
        <div className="desktop-active-visit mb-6 animate-fade-in-up">{activeVisitSlot}</div>
      ) : null}

      <div className="desktop-dashboard-shell">
      <div className="desktop-dashboard-grid">
        <div className="desktop-dashboard-col">
          {profileLastConsultation ? (
            <DesktopLastVisitCard consultation={profileLastConsultation} />
          ) : (
            <section className="desktop-card animate-fade-in-up stagger-1">
              <h2 className="font-display text-lg font-bold text-[#1a5c52]">Your Last Visit</h2>
              <div className="mt-6 flex items-center gap-4">
                <div className="flex size-11 items-center justify-center rounded-[12px] bg-[rgba(26,160,140,0.06)]">
                  <HousePlus className="size-5 text-[#2d8f98]" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="font-display text-base font-bold text-[#1a5c52]">No visits yet</p>
                  <p className="mt-0.5 text-sm text-[#5b7f8a]">
                    Your care timeline will appear here after your first home visit.
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="desktop-dashboard-col">
          <DesktopCareTeamCard doctorName={careTeamDoctorName} />
          <DesktopConciergeCard />
        </div>
      </div>
      </div>
    </div>
  );
}

export default DesktopDashboardHome;
