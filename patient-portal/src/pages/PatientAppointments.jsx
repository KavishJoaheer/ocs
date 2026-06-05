import { useEffect, useState } from "react";
import dayjs from "dayjs";
import {
  CalendarDays,
  Clock,
  Stethoscope,
  CheckCircle2,
  XCircle,
  AlertCircle,
  CalendarCheck,
} from "lucide-react";
import { api } from "../lib/api.js";

const statusConfig = {
  completed: {
    label: "Completed",
    bg: "bg-[rgba(34,197,94,0.1)]",
    text: "text-emerald-700",
    border: "border-emerald-200",
    icon: CheckCircle2,
  },
  scheduled: {
    label: "Scheduled",
    bg: "bg-[rgba(242,193,77,0.12)]",
    text: "text-amber-700",
    border: "border-amber-200",
    icon: CalendarCheck,
  },
  cancelled: {
    label: "Cancelled",
    bg: "bg-[rgba(239,68,68,0.08)]",
    text: "text-red-600",
    border: "border-red-200",
    icon: XCircle,
  },
  confirmed: {
    label: "Confirmed",
    bg: "bg-[rgba(65,200,198,0.1)]",
    text: "text-[#2d8f98]",
    border: "border-[rgba(65,200,198,0.3)]",
    icon: CheckCircle2,
  },
};

function StatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.scheduled;
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${config.bg} ${config.text} ${config.border}`}
    >
      <Icon className="size-3" />
      {config.label}
    </span>
  );
}

function PatientAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function fetchAppointments() {
      try {
        const data = await api.get("/patient-portal/appointments");
        if (!ignore) setAppointments(data.appointments || []);
      } catch {
        if (!ignore) setAppointments([]);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchAppointments();
    return () => { ignore = true; };
  }, []);

  const sorted = [...appointments].sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in-up">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] p-2.5 shadow-lg shadow-[rgba(45,143,152,0.22)]">
            <CalendarDays className="size-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-2xl tracking-tight text-slate-950 sm:text-3xl">
              Your Appointments
            </h1>
            <p className="mt-1 text-sm text-[#5b7f8a]">
              View and track all your medical appointments.
            </p>
          </div>
        </div>
      </div>

      {/* Appointments list */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-[24px] bg-[rgba(65,200,198,0.06)]"
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="animate-fade-in-up stagger-1 rounded-[30px] border border-dashed border-[rgba(65,200,198,0.25)] bg-[rgba(65,200,198,0.04)] p-12 text-center">
          <CalendarDays className="mx-auto size-14 text-[rgba(65,200,198,0.3)]" />
          <h3 className="mt-4 font-display text-xl font-semibold text-[#22485b]">
            No appointments yet
          </h3>
          <p className="mt-2 text-sm text-[#6e949b]">
            Contact our team to schedule your first appointment with OCS Médecins.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map((appointment, idx) => (
            <div
              key={appointment.id || idx}
              className={`animate-fade-in-up stagger-${Math.min(idx + 1, 6)} rounded-[24px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-5 shadow-[0_12px_36px_rgba(34,72,91,0.06)] transition hover:shadow-[0_16px_48px_rgba(34,72,91,0.1)]`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-[rgba(65,200,198,0.1)] p-3">
                    <Stethoscope className="size-5 text-[#2d8f98]" />
                  </div>
                  <div>
                    <p className="font-display text-base font-semibold text-[#22485b]">
                      {appointment.doctor_name || "Doctor"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-[#5b7f8a]">
                      <span className="flex items-center gap-1.5">
                        <CalendarDays className="size-3.5" />
                        {dayjs(appointment.date).format("ddd, MMM D, YYYY")}
                      </span>
                      {appointment.time && (
                        <span className="flex items-center gap-1.5">
                          <Clock className="size-3.5" />
                          {appointment.time}
                        </span>
                      )}
                    </div>
                    {appointment.notes && (
                      <p className="mt-2 text-sm text-[#6e949b]">
                        <AlertCircle className="mr-1 inline size-3.5" />
                        {appointment.notes}
                      </p>
                    )}
                  </div>
                </div>
                <StatusBadge status={appointment.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PatientAppointments;
