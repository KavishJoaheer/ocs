import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { ArrowRight, FileText, Pill, FlaskConical, Calendar } from "lucide-react";
import { useFamilyProfile } from "../../hooks/useFamilyProfile.jsx";
import { useRequestVisit } from "../../hooks/useRequestVisit.jsx";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function buildCareTimeline({ lastConsultation, nextAppointment, careTeamDoctorName }) {
  const cards = [];

  if (lastConsultation) {
    const dateLabel = dayjs(lastConsultation.date).isValid()
      ? dayjs(lastConsultation.date).format("D MMMM YYYY")
      : lastConsultation.date;
    cards.push({
      id: "visit",
      type: "visit",
      title: "Recent Visit Summary",
      subtitle: formatDoctorName(lastConsultation.doctor_name),
      detail: `${lastConsultation.diagnosis || lastConsultation.visit_type || "Home Visit"} · ${dateLabel}`,
      action: {
        label: "View Notes",
        to: lastConsultation.id
          ? `/health-records/visits/${lastConsultation.id}`
          : "/health-records",
      },
      muted: false,
    });
  }

  if (nextAppointment) {
    const dateLabel = dayjs(nextAppointment.date).isValid()
      ? dayjs(nextAppointment.date).format("D MMMM YYYY")
      : nextAppointment.date;
    const time = nextAppointment.time || "";
    cards.push({
      id: "appointment",
      type: "appointment",
      title: "Upcoming Visit",
      subtitle: formatDoctorName(nextAppointment.doctor_name),
      detail: `${dateLabel}${time ? ` at ${time}` : ""}`,
      action: { label: "View Appointments", to: "/appointments" },
      muted: false,
    });
  }

  if (careTeamDoctorName) {
    cards.push({
      id: "care-team",
      type: "care-team",
      title: "Your Care Team",
      subtitle: formatDoctorName(careTeamDoctorName),
      detail: "Primary care physician assigned to you",
      action: { label: "View Profile", to: "/profile" },
      muted: false,
    });
  }

  return cards;
}

/** Prescription progress bar showing days remaining. */
function PrescriptionProgress({ daysLeft, daysTotal }) {
  const pct = Math.round((daysLeft / daysTotal) * 100);
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between text-[12px]">
        <span className="native-label font-medium text-[#5b7f8a]">{daysLeft} days left</span>
        <span className="text-[#8a9e9a]">{daysTotal} day course</span>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[rgba(26,160,140,0.1)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#41c8c6] to-[#2d8f98] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Individual card in the horizontally scrolling care timeline. */
function TimelineCard({ card }) {
  const icons = {
    visit: FileText,
    prescription: Pill,
    labs: FlaskConical,
    appointment: Calendar,
    "care-team": FileText,
  };
  const Icon = icons[card.type] || FileText;

  return (
    <article
      className={[
        "squircle-outer ocs-elevate-timeline flex w-[min(288px,calc(100vw-2*var(--native-pad-screen)-1rem))] shrink-0 snap-start flex-col bg-white",
        card.muted ? "opacity-75" : "",
      ].join(" ")}
      style={{ padding: "var(--native-pad-card)" }}
    >
      <div className="flex items-start gap-4">
        <div
          className={[
            "squircle-inner flex size-11 shrink-0 items-center justify-center",
            card.muted
              ? "bg-[rgba(138,158,154,0.12)] text-[#8a9e9a]"
              : "bg-[rgba(26,160,140,0.1)] text-[#2d8f98]",
          ].join(" ")}
        >
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p
            className={[
              "native-label text-[13px] leading-snug",
              card.muted ? "text-[#8a9e9a]" : "text-[#1a5c52]",
            ].join(" ")}
          >
            {card.title}
          </p>
          <p className="native-display mt-1 text-[16px] leading-snug text-[#22485b]">{card.subtitle}</p>
        </div>
      </div>

      <p className="mt-4 text-[14px] leading-relaxed text-[#5b7f8a]">{card.detail}</p>

      {card.type === "prescription" ? (
        <PrescriptionProgress daysLeft={card.daysLeft} daysTotal={card.daysTotal} />
      ) : null}

      {card.muted ? (
        <div className="mt-5 flex items-center gap-2.5">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8a9e9a] opacity-50" />
            <span className="relative inline-flex size-2 rounded-full bg-[#8a9e9a]" />
          </span>
          <span className="native-label text-[12px] text-[#8a9e9a]">Processing</span>
        </div>
      ) : null}

      {card.action ? (
        <Link to={card.action.to} className="native-action-btn">
          {card.action.label}
          <ArrowRight className="size-3.5" strokeWidth={2.5} />
        </Link>
      ) : null}
    </article>
  );
}

// ─── Main dashboard view ──────────────────────────────────────────────────────

function MobileDashboardHome({
  firstName,
  lastConsultation = null,
  nextAppointment = null,
  careTeamDoctorName = null,
}) {
  const { activeProfile } = useFamilyProfile();
  const { openRequestSheet } = useRequestVisit();
  const greeting = getGreeting();

  const timelineCards = buildCareTimeline({
    lastConsultation,
    nextAppointment,
    careTeamDoctorName,
  });

  return (
    <div className="native-dashboard min-h-full bg-[#F2F2F7]">
      <header className="animate-fade-in-up flex items-center justify-between gap-4 pb-10">
        <div className="min-w-0 flex-1 pr-2">
          <h1 className="native-display text-[28px] leading-tight text-[#1a5c52]">
            {greeting},{" "}
            <span className="text-ocs-orange">{firstName || "there"}</span>
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#5b7f8a]">
            Your health, cared for around the clock.
          </p>
        </div>

        <Link
          to="/profile"
          aria-label="Your profile"
          className="native-header-btn dashboard-header-avatar shrink-0 text-[14px]"
        >
          {activeProfile.initials}
        </Link>
      </header>

      <button
        type="button"
        onClick={() => openRequestSheet()}
        className="dashboard-hero-press squircle-outer ocs-elevate-hero animate-fade-in-up stagger-1 mb-9 flex w-full items-center justify-between bg-gradient-to-br from-[#1a6b72] via-[#2d8f98] to-[#41c8c6] text-left text-white"
      >
        <div className="pr-4">
          <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-white/80">
            24/7 Home Visits
          </p>
          <p className="native-display mt-2.5 text-[22px] leading-tight text-white">
            Request a Home Doctor
          </p>
        </div>
        <div className="dashboard-hero-arrow-btn">
          <ArrowRight className="size-6 text-ocs-orange" strokeWidth={2.5} />
        </div>
      </button>

      <section className="animate-fade-in-up stagger-2" aria-label="Care timeline">
        <div className="mb-5">
          <h2 className="native-display text-[18px] text-[#1a5c52]">Your Care Timeline</h2>
          <p className="mt-1 text-[14px] text-[#8a9e9a]">
            {timelineCards.length ? "Swipe for recent activity" : "Your activity will appear here"}
          </p>
        </div>

        {timelineCards.length ? (
          <div className="native-carousel -mx-[var(--native-pad-screen)] flex gap-4 overflow-x-auto px-[var(--native-pad-screen)] snap-x snap-mandatory">
            {timelineCards.map((card) => (
              <TimelineCard key={card.id} card={card} />
            ))}
            <div className="w-1 shrink-0 snap-end" aria-hidden="true" />
          </div>
        ) : (
          <div className="squircle-outer bg-white px-5 py-8 text-center">
            <p className="text-[14px] leading-relaxed text-[#8a9e9a]">
              After your first home visit, your care timeline will appear here.
            </p>
            <button
              type="button"
              onClick={() => openRequestSheet()}
              className="squircle-inner mt-5 bg-[#e8a020] px-6 py-3.5 text-[14px] font-bold text-white shadow-[0_4px_16px_rgba(232,160,32,0.25)] transition active:scale-[0.98]"
            >
              Request a Home Visit
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default MobileDashboardHome;
