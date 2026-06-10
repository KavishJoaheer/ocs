import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { ChevronRight } from "lucide-react";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";
import { NativeGroupedRow } from "../native/NativeGroupedList.jsx";

function formatConsultationDateTime(date, time) {
  const dateLabel = dayjs(date).isValid() ? dayjs(date).format("D MMMM YYYY") : date;
  if (!time) return dateLabel;
  return `${dateLabel} · ${time}`;
}

function ConsultationCard({ consultation, isLast = false }) {
  const doctorName = formatDoctorName(consultation.doctor_name);
  const specialty = consultation.doctor_specialty || "General Practitioner";
  const visitType = consultation.visit_type || "Home Visit";
  const dateTimeLabel = formatConsultationDateTime(consultation.date, consultation.time);
  const visitPath = consultation.id
    ? `/health-records/visits/${consultation.id}`
    : "/health-records";

  return (
    <>
      {/* Mobile — native grouped row */}
      <NativeGroupedRow
        to={visitPath}
        isLast={isLast}
        ariaLabel={`${doctorName}, ${dateTimeLabel}`}
        className="lg:hidden"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] leading-snug text-gray-900">{doctorName}</p>
          <p className="mt-0.5 truncate text-[15px] text-gray-500">
            {dateTimeLabel} · {visitType}
          </p>
          {consultation.diagnosis ? (
            <p className="mt-0.5 truncate text-[15px] text-gray-500">{consultation.diagnosis}</p>
          ) : null}
        </div>
        <ChevronRight className="size-[17px] shrink-0 text-gray-300" strokeWidth={2} aria-hidden="true" />
      </NativeGroupedRow>

      {/* Desktop — card layout */}
      <Link
        to={visitPath}
        className={[
          "hidden w-full rounded-2xl border border-black/5 bg-white shadow-md transition hover:brightness-[1.01] lg:block",
          isLast ? "" : "mb-4",
        ].join(" ")}
        style={{ padding: "var(--native-pad-card)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium leading-none text-[#5b7f8a]">{dateTimeLabel}</p>
          <span className="text-[12px] font-medium text-gray-500">{visitType}</span>
        </div>
        <div className="mt-4 flex items-center justify-between gap-6">
          <div className="min-w-0">
            <p className="native-display text-[16px] leading-snug text-[#1a5c52]">{doctorName}</p>
            <p className="mt-0.5 text-[13px] text-[#8a9e9a]">{specialty}</p>
          </div>
          {consultation.diagnosis ? (
            <p className="shrink-0 text-[15px] text-gray-700">{consultation.diagnosis}</p>
          ) : null}
        </div>
      </Link>
    </>
  );
}

export default ConsultationCard;
