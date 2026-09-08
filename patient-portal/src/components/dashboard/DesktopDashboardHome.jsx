import { Link } from "react-router-dom";
import dayjs from "dayjs";
import {
  ArrowUpRight,
  Calendar,
  CalendarClock,
  FileText,
  HousePlus,
  Phone,
} from "lucide-react";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";
import { CLINIC_TEL_HREF } from "../../lib/clinicContact.js";
import RequestVisitCta from "../request-visit/RequestVisitCta.jsx";

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

function appointmentDateLabel(value) {
  const date = dayjs(value);
  if (!date.isValid()) return value;
  const daysAway = date.startOf("day").diff(dayjs().startOf("day"), "day");
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return date.format("dddd, D MMMM");
}

function DesktopRequestHero() {
  return (
    <section className="relative overflow-hidden rounded-[28px] bg-[#173f4a] px-7 py-6 text-white shadow-[0_24px_54px_rgba(23,63,74,0.2)] animate-fade-in-up stagger-1">
      <div className="pointer-events-none absolute -right-14 -top-24 size-72 rounded-full bg-brand-teal/25 blur-3xl" />
      <div className="relative z-10 flex items-center justify-between gap-8">
        <div className="max-w-xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#83ddd7]">24/7 home visits</p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">Need medical care at home?</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/68">
            Send your request to the OCS care team. We will confirm the visit and keep you updated here.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2.5">
          <RequestVisitCta
            leading={<HousePlus className="size-4.5" />}
            className="items-center justify-center gap-2 rounded-xl bg-brand-gold px-5 py-3 text-sm font-bold text-[#173f4a] shadow-sm transition hover:brightness-105"
          />
          <a href={CLINIC_TEL_HREF} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/85 transition hover:bg-white/10 hover:text-white">
            <Phone className="size-4" />
            Call the clinic
          </a>
        </div>
      </div>
    </section>
  );
}

function DesktopCareTeamCard({ doctorName }) {
  const displayName = doctorName ? formatDoctorName(doctorName) : "Your OCS care team";
  const isAssigned = Boolean(doctorName);

  return (
    <section className="desktop-card animate-fade-in-up stagger-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Care team</p>
        <Link to="/profile" className="text-xs font-bold text-[#287f86] hover:text-[#173f4a]">View profile</Link>
      </div>
      <div className="mt-5 flex items-center gap-4">
        <div className="desktop-care-team-avatar-ring shrink-0">
          <div className="desktop-care-team-avatar" aria-hidden="true">{doctorInitials(doctorName || "Care Team")}</div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold leading-snug text-ocs-slate">{displayName}</p>
          <p className="mt-1 text-sm text-slate-500">
            {isAssigned ? "Your assigned primary care physician" : "We are assigning your physician"}
          </p>
        </div>
      </div>
    </section>
  );
}

function DesktopConciergeCard() {
  return (
    <section className="desktop-concierge-card animate-fade-in-up stagger-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#83ddd7]">WhatsApp support</p>
      <h2 className="mt-3 font-display text-xl font-bold leading-tight tracking-tight text-white">Prefer to message us?</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/68">Chat with the OCS care team about visits, appointments, or account questions.</p>
      <a
        href={OCS_CARE_WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gold px-4 py-3 text-sm font-bold text-[#173f4a] transition hover:brightness-105"
      >
        <WhatsAppIcon className="size-4" />
        Chat on WhatsApp
      </a>
    </section>
  );
}

function DesktopNextAppointmentCard({ appointment }) {
  const doctorName = formatDoctorName(appointment.doctor_name);
  const dateLabel = dayjs(appointment.date).isValid() ? dayjs(appointment.date).format("D MMMM YYYY") : appointment.date;
  const timeLabel = String(appointment.time || "").trim();

  return (
    <section className="desktop-card animate-fade-in-up stagger-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#287f86]">Next appointment</p>
          <h2 className="mt-2 font-display text-xl font-bold text-ocs-slate">{appointmentDateLabel(appointment.date)}</h2>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Confirmed</span>
      </div>
      <div className="mt-5 flex items-center gap-4 rounded-2xl bg-slate-50/80 p-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-teal/10 text-[#287f86]">
          <Calendar className="size-5" strokeWidth={1.9} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold text-ocs-slate">{doctorName}</p>
          <p className="mt-0.5 text-sm text-slate-500">{dateLabel}{timeLabel ? ` · ${timeLabel}` : ""}</p>
          <p className="mt-1 text-sm text-slate-600">{appointment.reason || "Scheduled home visit"}</p>
        </div>
      </div>
      <Link to="/appointments" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#287f86] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#216d73]">
        View appointment
        <ArrowUpRight className="size-4" />
      </Link>
    </section>
  );
}

function DesktopOverdueReviewCard({ review }) {
  const dateLabel = dayjs(review.date).isValid() ? dayjs(review.date).format("D MMMM YYYY") : review.date;
  return (
    <section className="rounded-[18px] border border-amber-200 bg-amber-50/80 p-7 shadow-[0_8px_30px_rgba(120,83,15,0.06)] animate-fade-in-up stagger-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Needs attention</p>
          <h2 className="mt-2 font-display text-xl font-bold text-[#5f4314]">Follow-up review overdue</h2>
          <p className="mt-2 text-sm leading-relaxed text-amber-900/70">This review was due on {dateLabel}. Contact the care team to arrange a new time.</p>
        </div>
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-amber-700 shadow-sm">
          <CalendarClock className="size-5" />
        </span>
      </div>
      {review.reason ? <p className="mt-4 text-sm font-semibold text-[#5f4314]">{review.reason}</p> : null}
      <a href={CLINIC_TEL_HREF} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-800">
        <Phone className="size-4" />
        Contact care team
      </a>
    </section>
  );
}

function DesktopEmptyAppointmentCard() {
  return (
    <section className="desktop-card animate-fade-in-up stagger-3">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-teal/10 text-[#287f86]"><Calendar className="size-5" /></span>
        <div>
          <p className="font-display text-lg font-bold text-ocs-slate">No upcoming appointments</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">Confirmed visits and follow-ups will appear here.</p>
        </div>
      </div>
      <Link to="/appointments" className="mt-5 inline-flex text-sm font-bold text-[#287f86] hover:text-[#173f4a]">View appointments →</Link>
    </section>
  );
}

function DesktopLastVisitCard({ consultation }) {
  const doctorName = formatDoctorName(consultation.doctor_name);
  const dateLabel = dayjs(consultation.date).isValid() ? dayjs(consultation.date).format("D MMMM YYYY") : consultation.date;
  const summaryTo = consultation.id ? `/health-records/visits/${consultation.id}` : "/health-records";

  return (
    <section className="desktop-card animate-fade-in-up stagger-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Latest health update</p>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Home visit</span>
      </div>
      <div className="mt-5 flex items-center gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-teal to-[#5ed9d2] text-sm font-bold text-white">{doctorInitials(consultation.doctor_name)}</div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold text-ocs-slate">{doctorName}</p>
          <p className="mt-0.5 text-sm text-slate-500">{dateLabel}</p>
        </div>
      </div>
      {consultation.diagnosis ? (
        <div className="mt-5 rounded-2xl bg-slate-50/80 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Visit summary</p>
          <p className="mt-1.5 text-sm font-semibold text-slate-700">{consultation.diagnosis}</p>
        </div>
      ) : null}
      <Link to={summaryTo} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#287f86] hover:text-[#173f4a]">
        View visit summary
        <ArrowUpRight className="size-4" />
      </Link>
    </section>
  );
}

function DesktopNoVisitsCard() {
  return (
    <section className="desktop-card animate-fade-in-up stagger-4">
      <div className="flex items-center gap-4">
        <span className="grid size-11 place-items-center rounded-xl bg-brand-teal/10 text-[#287f86]"><FileText className="size-5" /></span>
        <div>
          <p className="font-display text-base font-bold text-ocs-slate">No visit history yet</p>
          <p className="mt-1 text-sm text-slate-500">Your care summaries will appear after your first visit.</p>
        </div>
      </div>
    </section>
  );
}

function DesktopDashboardHome({
  profileLastConsultation,
  profileNextAppointment = null,
  overdueReview = null,
  activeVisitSlot,
  headline,
  careTeamDoctorName,
}) {
  return (
    <div className="desktop-dashboard">
      <header className="desktop-dashboard-greeting animate-fade-in-up">
        <h1 className="font-display text-[2rem] tracking-tight sm:text-4xl">{headline}</h1>
        <p className="mt-1 max-w-xl text-left text-[15px] leading-relaxed text-slate-500">Here is your care overview and anything that needs attention today.</p>
      </header>

      {activeVisitSlot ? (
        <div className="desktop-active-visit mb-5 animate-fade-in-up">{activeVisitSlot}</div>
      ) : (
        <div className="mb-5"><DesktopRequestHero /></div>
      )}

      <div className="desktop-dashboard-shell">
        <div className="desktop-dashboard-grid">
          <div className="desktop-dashboard-col">
            {profileNextAppointment ? (
              <DesktopNextAppointmentCard appointment={profileNextAppointment} />
            ) : overdueReview ? (
              <DesktopOverdueReviewCard review={overdueReview} />
            ) : (
              <DesktopEmptyAppointmentCard />
            )}
            {profileLastConsultation ? (
              <DesktopLastVisitCard consultation={profileLastConsultation} />
            ) : (
              <DesktopNoVisitsCard />
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
