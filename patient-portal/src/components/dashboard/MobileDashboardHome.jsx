import { Link } from "react-router-dom";
import { Bell, ArrowRight, FileText, Pill, FlaskConical } from "lucide-react";
import { useFamilyProfile } from "../../hooks/useFamilyProfile.jsx";
import { AVATAR_STYLES } from "../../lib/familyProfiles.js";

// ─── Mock care timeline cards ─────────────────────────────────────────────────

const MOCK_TIMELINE = [
  {
    id: "visit",
    type: "visit",
    title: "Recent Visit Summary",
    subtitle: "Dr. Smith",
    detail: "Upper respiratory review · 3 days ago",
    action: { label: "View Notes", to: "/health-records" },
    muted: false,
  },
  {
    id: "rx",
    type: "prescription",
    title: "Active Prescription",
    subtitle: "Amoxicillin 500mg",
    detail: "Take twice daily with food",
    daysLeft: 5,
    daysTotal: 10,
    muted: false,
  },
  {
    id: "labs",
    type: "labs",
    title: "Pending Lab Results",
    subtitle: "Complete Blood Count",
    detail: "Processing at OCS Lab · Est. 1–2 days",
    muted: true,
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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
  };
  const Icon = icons[card.type] || FileText;

  return (
    <article
      className={[
        "squircle-outer ocs-elevate flex w-[288px] shrink-0 snap-start flex-col bg-white",
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

function MobileDashboardHome({ firstName, unreadNotifications = 2 }) {
  const { activeProfile } = useFamilyProfile();
  const greeting = getGreeting();
  const avatarColor = AVATAR_STYLES[activeProfile.avatarVariant] || "bg-[#2d8f98] text-white";

  return (
    <div className="native-dashboard -mx-4 min-h-full bg-[#f4f7f7]">
      {/* ── 1. Welcome Zone — respects notch / punch-hole via --native-safe-top ─ */}
      <header className="animate-fade-in-up flex items-center justify-between gap-4 pb-7">
        <div className="min-w-0 flex-1 pr-2">
          <h1 className="native-display text-[28px] leading-tight text-[#1a5c52]">
            {greeting},{" "}
            <span className="text-[#2d8f98]">{firstName || "there"}</span>
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#5b7f8a]">
            Your health, cared for around the clock.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ""}`}
            className="native-header-btn relative"
          >
            <Bell className="size-[20px] text-[#5b7f8a]" strokeWidth={1.75} />
            {unreadNotifications > 0 ? (
              <span className="absolute right-2 top-2 flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e8a020] opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-[#e8a020] shadow-[0_0_8px_rgba(232,160,32,0.5)]" />
              </span>
            ) : null}
          </button>

          <Link
            to="/profile"
            aria-label="Your profile"
            className={`native-header-btn ${avatarColor} text-[14px] font-semibold`}
          >
            {activeProfile.initials}
          </Link>
        </div>
      </header>

      {/* ── 2. Hero Dispatch — outer squircle 24px, inner icon well 14px ───── */}
      <Link
        to="/request-visit"
        className="dashboard-hero-press squircle-outer ocs-elevate-hero animate-fade-in-up stagger-1 mb-9 flex w-full items-center justify-between bg-gradient-to-br from-[#1a6b72] via-[#2d8f98] to-[#41c8c6] text-white"
      >
        <div className="pr-4">
          <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-white/80">
            24/7 Home Visits
          </p>
          <p className="native-display mt-2.5 text-[22px] leading-tight text-white">
            Request a Home Doctor
          </p>
        </div>
        <div className="squircle-inner flex size-12 shrink-0 items-center justify-center bg-white/20 backdrop-blur-sm">
          <ArrowRight className="size-6" strokeWidth={2.5} />
        </div>
      </Link>

      {/* ── 3. Care Timeline — carousel with scroll padding & bottom clearance ─ */}
      <section className="animate-fade-in-up stagger-2" aria-label="Care timeline">
        <div className="mb-5">
          <h2 className="native-display text-[18px] text-[#1a5c52]">Your Care Timeline</h2>
          <p className="mt-1 text-[14px] text-[#8a9e9a]">Swipe for recent activity</p>
        </div>

        <div className="native-carousel -mx-[var(--native-pad-screen)] flex gap-4 overflow-x-auto px-[var(--native-pad-screen)] snap-x snap-mandatory">
          {MOCK_TIMELINE.map((card) => (
            <TimelineCard key={card.id} card={card} />
          ))}
          {/* Trailing spacer so the last card clears the screen edge */}
          <div className="w-1 shrink-0 snap-end" aria-hidden="true" />
        </div>
      </section>
    </div>
  );
}

export default MobileDashboardHome;
