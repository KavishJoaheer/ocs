import { Link } from "react-router-dom";
import dayjs from "dayjs";
import {
  ArrowRight,
  Calendar,
  CalendarClock,
  FileText,
  FlaskConical,
  HousePlus,
  Phone,
  Pill,
} from "lucide-react";
import { useRequestVisit } from "../../hooks/useRequestVisit.jsx";
import { useFamilyProfile } from "../../hooks/useFamilyProfile.jsx";
import { CLINIC_TEL_HREF } from "../../lib/clinicContact.js";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";
import { getVisitRequestLabel } from "../../lib/familyProfiles.js";
import { CareNetworkMap } from "./CareNetworkVisual.jsx";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function buildCareTimeline({ lastConsultation, nextAppointment, overdueReview, careTeamDoctorName }) {
  const cards = [];

  if (overdueReview) {
    const dateLabel = dayjs(overdueReview.date).isValid()
      ? dayjs(overdueReview.date).format("D MMMM YYYY")
      : overdueReview.date;
    cards.push({
      id: "overdue-review",
      type: "review",
      title: "Follow-up overdue",
      subtitle: `Due ${dateLabel}`,
      detail: overdueReview.reason || "Contact your care team to arrange a new review time.",
      action: { label: "View Follow-up", to: "/appointments" },
      muted: false,
      urgent: true,
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

  if (lastConsultation) {
    const dateLabel = dayjs(lastConsultation.date).isValid()
      ? dayjs(lastConsultation.date).format("D MMMM YYYY")
      : lastConsultation.date;
    cards.push({
      id: "visit",
      type: "visit",
      title: "Recent visit summary",
      subtitle: formatDoctorName(lastConsultation.doctor_name),
      detail: `${lastConsultation.diagnosis || lastConsultation.visit_type || "Home visit"} · ${dateLabel}`,
      action: {
        label: "View Notes",
        to: lastConsultation.id
          ? `/health-records/visits/${lastConsultation.id}`
          : "/health-records",
      },
      muted: false,
    });
  }

  if (careTeamDoctorName) {
    cards.push({
      id: "care-team",
      type: "care-team",
      title: "Your care team",
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
    review: CalendarClock,
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
            card.urgent
              ? "bg-amber-100 text-amber-700"
              : card.muted
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
  overdueReview = null,
  careTeamDoctorName = null,
  activeVisitSlot = null,
  managing = false,
}) {
  const { openRequestSheet } = useRequestVisit();
  const { activeProfile } = useFamilyProfile();
  const greeting = getGreeting();
  const visitLabel = getVisitRequestLabel(activeProfile);

  const timelineCards = buildCareTimeline({
    lastConsultation,
    nextAppointment,
    overdueReview,
    careTeamDoctorName,
  });

  return (
    <div className="native-dashboard min-h-full bg-[#F2F2F7]">
      <header className="animate-fade-in-up pb-10">
        <h1 className="native-display text-[28px] leading-tight">
          {managing ? (
            <>
              <span className="text-brand-dark-grey">Managing care for</span>{" "}
              <span className="text-brand-gold">{firstName}</span>.
            </>
          ) : (
            <>
              <span className="text-brand-dark-grey">{greeting},</span>{" "}
              <span className="text-brand-gold">{firstName || "there"}</span>
            </>
          )}
        </h1>
        <p className="mt-1 text-left text-[15px] leading-relaxed text-gray-500">
          Your care overview and anything that needs attention today.
        </p>
      </header>

      {activeVisitSlot ? (
        <section className="squircle-outer mb-6 bg-white px-5 py-5" aria-label="Active visit">
          {activeVisitSlot}
        </section>
      ) : null}

      {!activeVisitSlot ? (
        <section className="squircle-outer ocs-elevate-hero animate-fade-in-up stagger-1 relative mb-9 overflow-hidden bg-[#173f4a] px-5 py-4 text-white">
          <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full bg-brand-gold/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-12 size-40 rounded-full bg-brand-teal/25 blur-3xl" />
          <div className="mobile-care-hero-heading relative z-10">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9be5df]">
                24/7 home visits
              </p>
              <p className="mt-2 font-display text-base font-semibold leading-snug text-brand-gold">
                Connecting homes<br />through care
              </p>
            </div>
            <CareNetworkMap className="care-network-mobile-map" />
          </div>

          <div className="relative z-10 mt-2 grid gap-1">
            <button
              type="button"
              onClick={() => openRequestSheet()}
              className="squircle-inner flex min-h-[58px] w-full items-center gap-3 bg-brand-gold px-4 text-left text-[#173f4a] shadow-[0_10px_24px_rgba(var(--ocs-brand-gold-rgb),0.22)] transition active:scale-[0.98]"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/45">
                <HousePlus className="size-[18px]" strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="native-display min-w-0 flex-1 text-[19px] leading-tight">
                Request a doctor
              </span>
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#173f4a]/10">
                <ArrowRight className="size-4.5" strokeWidth={2.5} aria-hidden="true" />
              </span>
            </button>
            <a
              href={CLINIC_TEL_HREF}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 px-4 text-[15px] font-bold text-white/85 transition active:scale-[0.98] active:text-white"
            >
              <Phone className="size-4.5" strokeWidth={2} aria-hidden="true" />
              Call the clinic
            </a>
          </div>
        </section>
      ) : null}

      <section className="animate-fade-in-up stagger-3" aria-label="Care timeline">
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
              className="squircle-inner mt-5 bg-brand-gold px-6 py-3.5 text-[14px] font-bold text-brand-dark-grey shadow-[0_4px_16px_rgba(var(--ocs-brand-gold-rgb),0.25)] transition active:scale-[0.98]"
            >
              {visitLabel}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default MobileDashboardHome;
