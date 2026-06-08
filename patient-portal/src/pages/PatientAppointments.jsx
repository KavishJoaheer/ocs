import dayjs from "dayjs";
import { CalendarCheck2 } from "lucide-react";

const SAMPLE_UPCOMING = [
  {
    id: 1,
    date: "2026-06-15",
    time: "2:00 PM",
    type: "Follow-up Consultation",
    doctor_name: "Dr. Avinash Sharma",
  },
  {
    id: 2,
    date: "2026-06-28",
    time: "10:30 AM",
    type: "Blood Pressure Review",
    doctor_name: "Dr. Priya Nair",
  },
];

const SAMPLE_PAST = [
  {
    id: 3,
    date: "2026-06-07",
    time: "11:00 AM",
    type: "General Consultation",
    doctor_name: "Dr. Avinash Sharma",
  },
  {
    id: 4,
    date: "2026-04-15",
    time: "3:00 PM",
    type: "Viral Fever Follow-up",
    doctor_name: "Dr. Priya Nair",
  },
];

function SectionLabel({ children, muted = false }) {
  return (
    <p
      className={`text-[11px] font-semibold uppercase tracking-[1.5px] ${
        muted ? "text-[#8a9ea3]" : "text-[#6e949b]"
      }`}
    >
      {children}
    </p>
  );
}

function AppointmentCard({ appointment, variant }) {
  const isUpcoming = variant === "upcoming";
  const date = dayjs(appointment.date);

  return (
    <div
      className={`flex items-stretch gap-5 rounded-xl border border-[rgba(26,160,140,0.12)] px-6 py-5 ${
        isUpcoming
          ? "border-l-[3px] border-l-[#1a5c52] bg-white"
          : "border-l-[3px] border-l-[#c0c0c0] bg-[rgba(0,0,0,0.02)]"
      }`}
    >
      <div className="flex shrink-0 items-center gap-5">
        <div className="text-center">
          <p
            className={`font-display text-2xl font-bold leading-none ${
              isUpcoming ? "text-[#1a5c52]" : "text-[#6e949b]"
            }`}
          >
            {date.format("D")}
          </p>
          <p
            className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
              isUpcoming ? "text-[#5b7f8a]" : "text-[#94a9ad]"
            }`}
          >
            {date.format("MMM")}
          </p>
        </div>
        <div
          className={`h-full w-px self-stretch ${
            isUpcoming ? "bg-[rgba(26,160,140,0.12)]" : "bg-[rgba(0,0,0,0.08)]"
          }`}
        />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`text-[15px] font-bold ${
            isUpcoming ? "text-[#1a5c52]" : "text-[#5b7f8a]"
          }`}
        >
          {appointment.type}
        </p>
        <p
          className={`mt-0.5 text-sm font-light ${
            isUpcoming ? "text-[#5b7f8a]" : "text-[#8a9ea3]"
          }`}
        >
          {appointment.doctor_name}
        </p>
        <p
          className={`mt-1 text-[13px] ${
            isUpcoming ? "text-[#6e949b]" : "text-[#94a9ad]"
          }`}
        >
          {appointment.time}
        </p>
      </div>

      <div className="flex shrink-0 items-start">
        {isUpcoming ? (
          <span className="inline-flex rounded-[20px] bg-[rgba(26,160,140,0.1)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#2d8f98]">
            Upcoming
          </span>
        ) : (
          <span className="inline-flex rounded-[20px] bg-[rgba(0,0,0,0.06)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a9ea3]">
            Completed
          </span>
        )}
      </div>
    </div>
  );
}

function PatientAppointments() {
  const upcoming = SAMPLE_UPCOMING;
  const past = SAMPLE_PAST;

  return (
    <div className="mx-auto max-w-[720px] space-y-10">
      <div className="animate-fade-in-up">
        <div className="flex items-center gap-2">
          <CalendarCheck2
            className="size-[18px] shrink-0 text-[#6B9E95]"
            strokeWidth={1.5}
          />
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            Review Appointments
          </p>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Your Appointments.
        </h1>
        <p className="mt-2 text-sm font-light text-[#5b7f8a]">
          Scheduled by your OCS care team.
        </p>
      </div>

      <section className="space-y-3">
        <SectionLabel>Upcoming</SectionLabel>
        {upcoming.length === 0 ? (
          <p className="text-[13px] font-light italic text-[#8a9ea3]">
            No upcoming appointments. Your OCS care team will schedule these for
            you.
          </p>
        ) : (
          <div className="space-y-3">
            {upcoming.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                variant="upcoming"
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionLabel muted>Past</SectionLabel>
        {past.length === 0 ? (
          <p className="text-[13px] font-light italic text-[#8a9ea3]">
            No past appointments yet.
          </p>
        ) : (
          <div className="space-y-3">
            {past.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                variant="past"
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default PatientAppointments;
