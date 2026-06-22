import { Link } from "react-router-dom";
import EmptyState from "./EmptyState.jsx";
import StatusBadge from "./StatusBadge.jsx";
import {
  LongTermReviewLogUpdateButton,
  useLongTermReviewLogUpdate,
} from "./LongTermReviewLogUpdate.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { formatDate, truncate } from "../lib/format.js";
import { formatScheduledReviewDate } from "../lib/patientReview.js";

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
  if (!patient.assigned_doctor_name) {
    return "Not assigned";
  }

  const name = String(patient.assigned_doctor_name).trim();
  const withoutPrefix = name.replace(/^dr\.?\s+/i, "").trim();
  return withoutPrefix ? `Dr ${withoutPrefix}` : "Not assigned";
}

function formatMobileAssignedDoctorLine(patient) {
  if (!patient.assigned_doctor_name) {
    return "Not assigned";
  }

  const name = String(patient.assigned_doctor_name).trim();
  return /^dr\.?\s/i.test(name) ? name : `Dr ${name}`;
}

function LongTermReviewWorkspaceList({
  patients,
  onPatientsChange,
  emptyTitle = "No long term review patients",
  emptyDescription = "Patients flagged by the operator desk for long term review will appear here.",
}) {
  const isMobile = useIsMobile();
  const { openLogUpdate, dialogs } = useLongTermReviewLogUpdate({ onUpdated: onPatientsChange });

  if (!patients.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      <div className="space-y-4">
        {patients.map((patient) => {
          const reviewNote = truncate(
            patient.review_reason_note || patient.ongoing_treatment || patient.particularity,
            160,
          );
          const dueLabel = formatScheduledReviewDate(patient.review_due_date);

          return (
            <div
              key={patient.id}
              className="rounded-[26px] border border-slate-200/80 bg-slate-50/70 p-4 md:p-5"
            >
              <div className="grid gap-4 md:grid-cols-4 md:items-center">
                <div className="min-w-0 space-y-1">
                  <p className="text-lg font-semibold text-slate-950">{patient.full_name}</p>
                  <p className="text-sm text-[#4f6f7a]">{formatReviewPatientMetaLine(patient)}</p>
                </div>

                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-slate-800">
                    {isMobile ? formatMobileAssignedDoctorLine(patient) : formatAssignedDoctorLine(patient)}
                  </p>
                  <p className="text-sm text-slate-500">
                    Last consultation:{" "}
                    {patient.last_consultation_date
                      ? formatDate(patient.last_consultation_date)
                      : "Not yet recorded"}
                  </p>
                </div>

                <div className="min-w-0">
                  {dueLabel ? (
                    <p className="text-sm font-bold text-amber-700">⏱ Due: {dueLabel}</p>
                  ) : (
                    <p className="text-sm font-bold text-slate-500">⏱ Due date not set</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                  {isMobile ? <StatusBadge value={patient.status} /> : null}
                  <Link
                    className="rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                    to={`/patients/${patient.id}`}
                  >
                    Open patient
                  </Link>
                  <LongTermReviewLogUpdateButton onClick={() => openLogUpdate(patient)} />
                </div>
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
    </>
  );
}

export default LongTermReviewWorkspaceList;
