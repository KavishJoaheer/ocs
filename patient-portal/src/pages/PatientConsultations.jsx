import { useEffect, useState } from "react";
import dayjs from "dayjs";
import {
  History,
  CalendarDays,
  Clock,
  Stethoscope,
  FileText,
} from "lucide-react";
import { api } from "../lib/api.js";

function PatientConsultations() {
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function fetchConsultations() {
      try {
        const data = await api.get("/patient-portal/appointments");
        if (!ignore) {
          const past = (data.appointments || []).filter(
            (item) =>
              item.status === "completed" ||
              dayjs(item.date).isBefore(dayjs(), "day"),
          );
          setConsultations(past);
        }
      } catch {
        if (!ignore) setConsultations([]);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchConsultations();
    return () => {
      ignore = true;
    };
  }, []);

  const sorted = [...consultations].sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in-up">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] p-2.5 shadow-lg shadow-[rgba(45,143,152,0.22)]">
            <History className="size-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-2xl tracking-tight text-slate-950 sm:text-3xl">
              Consultation History
            </h1>
            <p className="mt-1 text-sm text-[#5b7f8a]">
              A complete record of your past visits with OCS Médecins.
            </p>
          </div>
        </div>
      </div>

      {/* Consultations list */}
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
          <History className="mx-auto size-14 text-[rgba(65,200,198,0.3)]" />
          <h3 className="mt-4 font-display text-xl font-semibold text-[#22485b]">
            No past consultations yet
          </h3>
          <p className="mt-2 text-sm text-[#6e949b]">
            Once you complete a visit, it will appear here for easy reference.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map((consultation, idx) => (
            <div
              key={consultation.id || idx}
              className={`animate-fade-in-up stagger-${Math.min(idx + 1, 6)} rounded-[24px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-5 shadow-[0_12px_36px_rgba(34,72,91,0.06)] transition hover:shadow-[0_16px_48px_rgba(34,72,91,0.1)]`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-[rgba(65,200,198,0.1)] p-3">
                    <Stethoscope className="size-5 text-[#2d8f98]" />
                  </div>
                  <div>
                    <p className="font-display text-base font-semibold text-[#22485b]">
                      {consultation.doctor_name || "Doctor"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-[#5b7f8a]">
                      <span className="flex items-center gap-1.5">
                        <CalendarDays className="size-3.5" />
                        {dayjs(consultation.date).format("ddd, MMM D, YYYY")}
                      </span>
                      {consultation.time && (
                        <span className="flex items-center gap-1.5">
                          <Clock className="size-3.5" />
                          {consultation.time}
                        </span>
                      )}
                    </div>
                    {consultation.notes && (
                      <p className="mt-2 flex items-start gap-1.5 text-sm text-[#6e949b]">
                        <FileText className="mt-0.5 size-3.5 shrink-0" />
                        {consultation.notes}
                      </p>
                    )}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-emerald-200 bg-[rgba(34,197,94,0.1)] px-3 py-1 text-xs font-bold text-emerald-700">
                  Completed
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PatientConsultations;
