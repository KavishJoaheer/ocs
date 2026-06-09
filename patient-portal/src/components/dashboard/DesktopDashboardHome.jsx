import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { ArrowRight, Heart, HousePlus } from "lucide-react";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";

function doctorInitials(name) {
  const trimmed = String(name || "Dr").replace(/^dr\.?\s+/i, "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function DesktopStatWidget({ label, value }) {
  return (
    <div className="desktop-stat-widget">
      <p className="desktop-stat-label">{label}</p>
      <p className="desktop-stat-value">{value}</p>
    </div>
  );
}

function DesktopHelpCard() {
  return (
    <section className="desktop-card desktop-card-hover animate-fade-in-up stagger-4 p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6e949b]">
        Need help?
      </p>
      <p className="mt-3 text-sm font-semibold text-[#22485b]">Contact our care team</p>
      <p className="mt-2 text-sm leading-6 text-[#5b7f8a]">
        Reach out any time for appointment changes, billing questions, or medical inquiries.
      </p>
      <div className="mt-4 rounded-[16px] bg-[rgba(26,160,140,0.06)] px-4 py-3 transition hover:bg-[rgba(26,160,140,0.09)]">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2d8f98]">
          Hotline
        </p>
        <div className="mt-1 flex items-center gap-3">
          <Heart className="size-4 shrink-0 text-[#f2c14d]" />
          <a
            href="tel:52522234"
            className="pl-1 text-xl font-bold tracking-tight text-[#22485b] transition hover:text-[#2d8f98]"
          >
            52 52 22 34
          </a>
        </div>
      </div>
    </section>
  );
}

function DesktopLastVisitCard({ consultation }) {
  const doctorName = formatDoctorName(consultation.doctor_name);
  const dateLabel = dayjs(consultation.date).isValid()
    ? dayjs(consultation.date).format("D MMMM YYYY")
    : consultation.date;

  return (
    <section className="desktop-card desktop-card-hover animate-fade-in-up stagger-3 p-6">
      <h2 className="font-display text-lg font-bold text-[#1a5c52]">Your Last Visit</h2>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-[#5b7f8a]">{dateLabel}</p>
        <span className="consultation-visit-badge shrink-0">Home Visit</span>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#2d8f98] to-[#41c8c6] text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(45,143,152,0.2)]"
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

      <div className="mt-6 flex flex-wrap items-center gap-4 pt-1">
        <Link
          to="/health-records"
          className="text-[13px] font-medium text-[#5f9aa0] transition hover:text-[#2d8f98]"
        >
          View your full health timeline →
        </Link>
        <Link
          to="/consultations"
          className="text-[13px] font-normal text-[#2d8f98] transition hover:text-[#23767f]"
        >
          View full consultation record →
        </Link>
      </div>
    </section>
  );
}

function DesktopDashboardHome({
  greeting,
  firstName,
  subline,
  isPrimaryProfile,
  profileStats,
  profileLastConsultation,
  activeVisitSlot,
  headline,
}) {
  const pendingBills = profileStats?.pending_bills ?? 0;
  const totalVisits = profileStats?.total_visits ?? 0;

  return (
    <div className="desktop-dashboard">
      {/* Edge-to-edge teal header band */}
      <header className="desktop-dashboard-teal-band animate-fade-in-up">
        <div className="desktop-dashboard-inner">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/65">
            OCS Virtual Practice
          </p>
          <h1 className="mt-3 font-display text-3xl tracking-tight text-white sm:text-[2.5rem]">
            {headline ?? (
              <>
                {greeting},{" "}
                <span className="text-ocs-orange">{firstName}</span>
              </>
            )}
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-white/75">{subline}</p>
        </div>
      </header>

      {/* Soft canvas body + floating dispatch card + grid */}
      <div className="desktop-dashboard-lower">
        <div className="desktop-dashboard-inner">
          <Link to="/request-visit" className="desktop-dispatch-card group animate-fade-in-up stagger-1">
            <div className="min-w-0 flex-1 pr-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6e949b]">
                24/7 Concierge Care
              </p>
              <p className="mt-2.5 font-display text-xl font-bold leading-tight text-[#1a5c52] sm:text-[22px]">
                Request a Doctor to Your Home
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#5b7f8a]">
                A licensed physician at your door — typically within the hour.
              </p>
            </div>
            <div className="desktop-dispatch-arrow transition group-hover:scale-105">
              <ArrowRight className="size-6 text-ocs-orange" strokeWidth={2.5} />
            </div>
          </Link>

          <div className="desktop-dashboard-grid">
            <div className="desktop-dashboard-col">
              {activeVisitSlot ? (
                <div className="animate-fade-in-up stagger-2">{activeVisitSlot}</div>
              ) : null}

              {profileLastConsultation ? (
                <DesktopLastVisitCard consultation={profileLastConsultation} />
              ) : (
                <section className="desktop-card p-6">
                  <h2 className="font-display text-lg font-bold text-[#1a5c52]">Your Last Visit</h2>
                  <div className="mt-5 flex items-center gap-4">
                    <div className="flex size-11 items-center justify-center rounded-[14px] bg-[rgba(26,160,140,0.08)]">
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
              {isPrimaryProfile ? (
                <section className="desktop-card desktop-card-hover animate-fade-in-up stagger-2 p-6">
                  <div className="grid grid-cols-2 gap-6">
                    <DesktopStatWidget label="Pending Bills" value={pendingBills} />
                    <DesktopStatWidget label="Total Visits" value={totalVisits} />
                  </div>
                </section>
              ) : null}

              <DesktopHelpCard />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DesktopDashboardHome;
