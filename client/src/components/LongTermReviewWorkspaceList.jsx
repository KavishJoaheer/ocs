import { Link } from "react-router-dom";
import { CalendarClock, ChevronDown } from "lucide-react";
import EmptyState from "./EmptyState.jsx";
import { LongTermReviewLogUpdateButton } from "./LongTermReviewLogUpdate.jsx";
import { useLongTermReviewLogUpdate } from "../hooks/useLongTermReviewLogUpdate.jsx";
import { useReviewAssignment } from "../hooks/useReviewAssignment.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { formatDate, truncate } from "../lib/format.js";
import { formatReviewAppointmentTime, formatScheduledReviewDate, getReviewDueTiming, getReviewDoctorName } from "../lib/patientReview.js";

const SECONDARY_BUTTON = "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border border-[#d5e4e1] bg-white text-xs font-semibold text-[#376168] transition hover:bg-[#edf9f7]";

function dueBadge(patient) {
  const timing = getReviewDueTiming(patient.review_due_date);
  if (timing.status === "overdue") return { className: "bg-rose-50 text-rose-800", label: `Overdue ${timing.days}d` };
  if (timing.status === "today") return { className: "bg-amber-50 text-amber-900", label: "Due today" };
  if (timing.status === "due_7_days") return { className: "bg-amber-50 text-amber-800", label: `Due in ${timing.days}d` };
  if (timing.status === "no_date") return null;
  return { className: "bg-[#edf9f7] text-[#137b80]", label: "Upcoming" };
}

function ReviewActions({ canManage, canAssign, patient, onLogUpdate, onAssign, compact }) {
  return <div className="flex flex-wrap items-center gap-2 xl:justify-end">
    {canManage ? <>
      <LongTermReviewLogUpdateButton onClick={() => onLogUpdate(patient)} ariaLabel="Update review" label={compact ? "Update" : "Update review"} className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full bg-[#137b80] ${compact ? "px-2" : "px-3"} text-xs font-semibold text-white transition hover:bg-[#106b70]`} />
      <Link aria-label="Open patient" to={`/patients/${patient.id}`} className={`${SECONDARY_BUTTON} min-w-11 ${compact ? "px-2" : "px-3"}`}>{compact ? "Open" : "Open patient"}</Link>
    </> : <span className="text-xs text-[#5b7379]">View only</span>}
    {canAssign ? <button type="button" aria-label="Assign doctor/time" onClick={() => onAssign(patient)} className={`${SECONDARY_BUTTON} min-w-11 ${compact ? "px-2" : "px-3"}`}>{compact ? "Assign" : "Assign doctor/time"}</button> : null}
  </div>;
}

export default function LongTermReviewWorkspaceList({
  patients, onPatientsChange, showMineBadge = false, showReviewDoctor = true,
  emptyTitle = "No review appointments", emptyDescription = "Patients flagged for a review appointment will appear here.",
}) {
  const compact = useIsMobile(1024);
  const { openLogUpdate, dialogs } = useLongTermReviewLogUpdate({ onUpdated: onPatientsChange });
  const { canAssign, openAssignment, dialogs: assignmentDialogs } = useReviewAssignment({ onUpdated: onPatientsChange });

  return <>
    {!patients.length ? <EmptyState title={emptyTitle} description={emptyDescription} /> : <div className="space-y-3">
      {patients.map(patient => {
        const reviewNote = String(patient.review_reason_note || patient.ongoing_treatment || patient.particularity || "");
        const badge = dueBadge(patient);
        const doctorName = getReviewDoctorName(patient);
        const displayDoctor = doctorName ? /^dr\.?\s/i.test(doctorName) ? doctorName : `Dr ${doctorName}` : "Doctor not assigned";
        const meta = [patient.patient_identifier, patient.location?.trim()].filter(Boolean).join(" · ");
        const initials = String(patient.full_name || "").split(/\s+/).filter(Boolean).slice(0, 2).map(name => name[0]).join("");
        const time = formatReviewAppointmentTime(patient.review_appointment_time);
        return <article key={patient.id} aria-label={`Review for ${patient.full_name}`} className="min-w-0 rounded-[26px] border border-[#d5e4e1] bg-white px-4 py-3.5 shadow-[0_6px_20px_rgba(59,89,92,0.03)]">
          <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
            <div className={`grid min-w-0 gap-2 ${showReviewDoctor ? "xl:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)_minmax(0,1fr)]" : "xl:grid-cols-2"} xl:items-center xl:gap-4`}>
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#edf9f7] text-xs font-semibold text-[#137b80]">{initials}</span>
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-sm font-bold text-[#173f4a] sm:text-base">{patient.full_name}</h2>{showMineBadge && patient.is_mine ? <span className="rounded-full bg-[#edf9f7] px-2 py-0.5 text-xs font-semibold text-[#137b80]">Yours</span> : null}</div>{meta ? <p className="mt-0.5 break-words text-xs text-[#5b7379]">{meta}</p> : null}</div>
              </div>
              {showReviewDoctor ? <p className="min-w-0 break-words text-xs font-medium text-[#5b7379] xl:text-sm">{displayDoctor}</p> : null}
              <div className="flex flex-wrap items-center gap-2 xl:block">
                <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[#376168]"><CalendarClock aria-hidden="true" className="size-3.5 shrink-0" /><span>{patient.review_due_date ? formatScheduledReviewDate(patient.review_due_date) : "Date not set"}{time ? ` · ${time}` : ""}</span></p>
                {badge ? <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold xl:mt-1 ${badge.className}`}>{badge.label}</span> : null}
              </div>
            </div>
            <ReviewActions canManage={patient.can_manage !== false} canAssign={canAssign} patient={patient} onLogUpdate={openLogUpdate} onAssign={openAssignment} compact={compact} />
          </div>
          {reviewNote || patient.last_consultation_date ? <details className="group mt-2 min-w-0 border-t border-[#edf3f1] pt-2 text-xs text-[#5b7379]">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#137b80]"><span className="min-w-0 truncate">{reviewNote ? truncate(reviewNote, 100) : `Last consultation: ${formatDate(patient.last_consultation_date)}`}</span><span className="flex shrink-0 items-center gap-1 font-semibold text-[#137b80]">Details<ChevronDown aria-hidden="true" className="size-3.5 transition group-open:rotate-180" /></span></summary>
            {reviewNote ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{reviewNote}</p> : null}
            {patient.last_consultation_date ? <p className="mt-2">Last consultation: {formatDate(patient.last_consultation_date)}</p> : null}
          </details> : null}
        </article>;
      })}
    </div>}
    {dialogs}{assignmentDialogs}
  </>;
}
