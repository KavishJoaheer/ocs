import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { HousePlus } from "lucide-react";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";

const OCS_CARE_WHATSAPP_URL = "https://wa.me/23052522234";

function WhatsAppIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

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
      <p className="desktop-section-label text-ocs-grey">Your Care Team</p>

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
          <p className="font-display text-base font-bold leading-snug text-ocs-slate">
            {displayName}
          </p>
          <p className="mt-0.5 text-sm text-brand-cool-grey">
            {isAssigned ? "Primary Care Physician" : "Assigning your physician shortly"}
          </p>
          {isAssigned ? (
            <p className="mt-1 text-xs text-brand-cool-grey">Your assigned OCS doctor</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DesktopConciergeCard() {
  return (
    <section className="desktop-concierge-card desktop-concierge-card-hover animate-fade-in-up stagger-2">
      <p className="font-display text-sm font-semibold text-ocs-yellow">We&apos;re here for you.</p>
      <h2 className="mt-3 font-display text-2xl font-bold leading-tight tracking-tight text-white">
        24/7 Medical Concierge
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-white/70">
        Immediate support for your health, day or night.
      </p>
      <a
        href={OCS_CARE_WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="desktop-concierge-dial mt-7"
      >
        <WhatsAppIcon className="size-5 shrink-0" />
        <span>Chat on WhatsApp</span>
      </a>
    </section>
  );
}

function DesktopLastVisitCard({ consultation }) {
  const doctorName = formatDoctorName(consultation.doctor_name);
  const dateLabel = dayjs(consultation.date).isValid()
    ? dayjs(consultation.date).format("D MMMM YYYY")
    : consultation.date;
  const summaryTo = "/health-records";

  return (
    <section className="desktop-card animate-fade-in-up stagger-1">
      <h2 className="font-display text-lg font-bold text-ocs-slate">Your Last Visit</h2>

      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-brand-cool-grey">{dateLabel}</p>
        <span className="desktop-visit-badge shrink-0">Home Visit</span>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-[#5ed9d2] text-[15px] font-bold text-white"
          aria-hidden="true"
        >
          {doctorInitials(consultation.doctor_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold leading-snug text-ocs-slate">{doctorName}</p>
          <p className="mt-0.5 text-sm text-brand-cool-grey">General Practitioner</p>
        </div>
      </div>

      {consultation.diagnosis ? (
        <div className="mt-6">
          <p className="consultation-micro-label">Diagnosis</p>
          <span className="mt-2 inline-flex rounded-[14px] bg-brand-teal/10 px-4 py-1.5 text-[13px] font-medium text-ocs-slate">
            {consultation.diagnosis}
          </span>
        </div>
      ) : null}

      <div className="mt-8 flex justify-end">
        <Link
          to={summaryTo}
          className="text-sm font-bold text-ocs-yellow transition hover:text-ocs-yellow-dark"
        >
          View Health Records →
        </Link>
      </div>
    </section>
  );
}

function DesktopDashboardHome({
  profileLastConsultation,
  activeVisitSlot,
  headline,
  careTeamDoctorName,
}) {
  return (
    <div className="desktop-dashboard">
      <header className="desktop-dashboard-greeting animate-fade-in-up">
        <h1 className="font-display text-[2rem] tracking-tight sm:text-4xl">
          {headline}
        </h1>
        <p className="mt-1 max-w-xl text-left text-[15px] leading-relaxed text-ocs-grey">
          Your health. Unwavering care. Accessed effortlessly, managed securely.
        </p>
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
              <h2 className="font-display text-lg font-bold text-ocs-slate">Your Last Visit</h2>
              <div className="mt-6 flex items-center gap-4">
                <div className="flex size-11 items-center justify-center rounded-[12px] bg-brand-teal/10">
                  <HousePlus className="size-5 text-brand-teal" strokeWidth={1.5} />
                </div>
                <div>
                  <p className="font-display text-base font-bold text-ocs-slate">No visits yet</p>
                  <p className="mt-0.5 text-sm text-brand-cool-grey">
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
