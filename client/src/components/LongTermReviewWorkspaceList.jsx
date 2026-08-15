import { Link } from "react-router-dom";
import EmptyState from "./EmptyState.jsx";
import { LongTermReviewLogUpdateButton } from "./LongTermReviewLogUpdate.jsx";
import { useLongTermReviewLogUpdate } from "../hooks/useLongTermReviewLogUpdate.jsx";
import { useReviewAssignment } from "../hooks/useReviewAssignment.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { formatDate, truncate } from "../lib/format.js";
import {
  formatReviewAppointmentTime,
  formatReviewDueShort,
  formatScheduledReviewDate,
  getReviewDoctorName,
} from "../lib/patientReview.js";

function formatReviewPatientMetaLine(patient) {
  const parts = [];

  if (patient.patient_identifier) {
    parts.push(patient.patient_identifier);
  }

  if (patient.location?.trim()) {
    parts.push(patient.location.trim());
  }

  return parts.length ? parts.join(" • ") : "Location not recorded";
}

function formatAssignedDoctorLine(patient) {
  const name = getReviewDoctorName(patient);
  if (!name) {
    return "Not assigned";
  }

  const withoutPrefix = name.replace(/^dr\.?\s+/i, "").trim();
  return withoutPrefix ? `Dr ${withoutPrefix}` : "Not assigned";
}

function formatMobileAssignedDoctorLine(patient) {
  const name = getReviewDoctorName(patient);
  if (!name) {
    return "Not assigned";
  }

  return /^dr\.?\s/i.test(name) ? name : `Dr ${name}`;
}

function dueText(patient, { short = false } = {}) {
  const dueLabel = short
    ? formatReviewDueShort(patient.review_due_date)
    : formatScheduledReviewDate(patient.review_due_date);
  const timeLabel = formatReviewAppointmentTime(patient.review_appointment_time);
  if (!dueLabel) {
    return "Due date not set";
  }
  return timeLabel ? `Due ${dueLabel} · ${timeLabel}` : `Due ${dueLabel}`;
}

function ReviewActions({ canManage, canAssign, patient, onLogUpdate, onAssign, compact }) {
  if (!canManage && !canAssign) {
    return null;
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "md:justify-end"}`}>
      {canManage ? (
        <LongTermReviewLogUpdateButton
          onClick={() => onLogUpdate(patient)}
          label="Log update"
          className={
            compact
              ? "rounded-2xl bg-ocs-teal px-3 py-2 text-sm font-semibold text-white"
              : "rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-white"
          }
        />
      ) : null}
      {canManage ? (
        <Link
          className={
            compact
              ? "px-2 py-2 text-sm font-semibold text-slate-600"
              : "rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
          }
          to={`/patients/${patient.id}`}
        >
          {compact ? "Open" : "Open patient"}
        </Link>
      ) : null}
      {canAssign ? (
        <button
          type="button"
          onClick={() => onAssign(patient)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-white"
        >
          Assignment
        </button>
      ) : null}
    </div>
  );
}

function LongTermReviewWorkspaceList({
  patients,
  onPatientsChange,
  showMineBadge = false,
  showReviewDoctor = true,
  emptyTitle = "No review appointment patients",
  emptyDescription = "Patients flagged by the operator desk for a review appointment will appear here.",
}) {
  const isMobile = useIsMobile();
  const { openLogUpdate, dialogs } = useLongTermReviewLogUpdate({ onUpdated: onPatientsChange });
  const { canAssign, openAssignment, dialogs: assignmentDialogs } = useReviewAssignment({
    onUpdated: onPatientsChange,
  });

  if (!patients.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      <div className="space-y-3 md:space-y-4">
        {patients.map((patient) => {
          const reviewNote = truncate(
            patient.review_reason_note || patient.ongoing_treatment || patient.particularity,
            160,
          );
          const canManage = patient.can_manage !== false;
          const showYours = showMineBadge && patient.is_mine;

          if (isMobile) {
            return (
              <div
                key={patient.id}
                className="rounded-2xl border border-slate-200 bg-white p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[15px] font-semibold leading-snug text-slate-950">
                        {patient.full_name}
                      </p>
                      {showYours ? (
                        <span className="rounded-full bg-ocs-teal/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-ocs-teal">
                          Yours
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm text-[#4f6f7a]">{formatReviewPatientMetaLine(patient)}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                      patient.review_due_date ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {dueText(patient, { short: true })}
                  </span>
                </div>

                {reviewNote ? (
                  <p className="mt-2 text-sm leading-5 text-slate-600">{reviewNote}</p>
                ) : null}

                {showReviewDoctor ? (
                  <p className="mt-1.5 text-sm text-slate-500">{formatMobileAssignedDoctorLine(patient)}</p>
                ) : null}

                <div className="mt-3">
                  <ReviewActions
                    compact
                    canManage={canManage}
                    canAssign={canAssign}
                    patient={patient}
                    onLogUpdate={openLogUpdate}
                    onAssign={openAssignment}
                  />
                </div>
              </div>
            );
          }

          return (
            <div
              key={patient.id}
              className="rounded-[26px] border border-slate-200/80 bg-slate-50/70 p-4 md:p-5"
            >
              <div className="grid gap-4 md:grid-cols-4 md:items-center">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold text-slate-950">{patient.full_name}</p>
                    {showYours ? (
                      <span className="rounded-full bg-ocs-teal/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-ocs-teal">
                        Yours
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-[#4f6f7a]">{formatReviewPatientMetaLine(patient)}</p>
                </div>

                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-slate-800">
                    {formatAssignedDoctorLine(patient)}
                  </p>
                  <p className="text-sm text-slate-500">
                    Last consultation:{" "}
                    {patient.last_consultation_date
                      ? formatDate(patient.last_consultation_date)
                      : "Not yet recorded"}
                  </p>
                </div>

                <div className="min-w-0">
                  <p
                    className={`text-sm font-bold ${
                      patient.review_due_date ? "text-amber-700" : "text-slate-500"
                    }`}
                  >
                    {dueText(patient)}
                  </p>
                </div>

                <ReviewActions
                  canManage={canManage}
                  canAssign={canAssign}
                  patient={patient}
                  onLogUpdate={openLogUpdate}
                  onAssign={openAssignment}
                />
              </div>

              {reviewNote ? (
                <p className="mt-3 border-t border-slate-200/80 pt-3 text-sm leading-6 text-slate-600">
                  {reviewNote}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {dialogs}
      {assignmentDialogs}
    </>
  );
}

export default LongTermReviewWorkspaceList;
