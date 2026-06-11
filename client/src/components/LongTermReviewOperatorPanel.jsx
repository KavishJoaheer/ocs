import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import LongTermReviewWorkspaceList from "./LongTermReviewWorkspaceList.jsx";
import { parsePatientReviewDueMonth } from "../lib/patientReview.js";

const CALENDAR_MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

function monthLabelFromIndex(monthIndex) {
  return CALENDAR_MONTH_OPTIONS.find((option) => option.value === monthIndex)?.label || monthIndex;
}

function filterPatientsByMonthIndex(patients, selectedMonthIndex) {
  if (selectedMonthIndex === "all") {
    return patients;
  }

  return patients.filter(
    (patient) => parsePatientReviewDueMonth(patient.review_due_date) === selectedMonthIndex,
  );
}

function LongTermReviewOperatorPanel({ patients = [], onPatientsChange }) {
  const [selectedMonthIndex, setSelectedMonthIndex] = useState("all");

  const filteredReviewList = useMemo(
    () => filterPatientsByMonthIndex(patients, selectedMonthIndex),
    [patients, selectedMonthIndex],
  );

  const filteredMonthLabel = monthLabelFromIndex(selectedMonthIndex);

  return (
    <div className="space-y-6">
      <div className="mb-6 flex w-full flex-col gap-4 border-b border-gray-200/60 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-black tracking-tight text-gray-900 tabular-nums">
            {filteredReviewList.length}
          </span>
          <h2 className="text-lg font-extrabold tracking-wide text-gray-800">Review Appointments</h2>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-4">
          <div className="flex min-w-[180px] flex-col gap-1">
            <label
              className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400"
              htmlFor="long-term-review-month-filter"
            >
              Filter by month
            </label>
            <div className="relative">
              <select
                id="long-term-review-month-filter"
                value={selectedMonthIndex}
                onChange={(event) => setSelectedMonthIndex(event.target.value)}
                className="w-full cursor-pointer appearance-none rounded-xl border border-gray-200/80 bg-white py-2 pl-3.5 pr-10 text-xs font-bold text-gray-700 shadow-sm focus:border-[#557373] focus:outline-none"
              >
                <option value="all">All Months</option>
                {CALENDAR_MONTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div
                className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[9px] text-gray-400"
                aria-hidden
              >
                ▼
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 transition-all hover:bg-gray-50"
            >
              Back to dashboard
            </Link>
            <Link
              to="/patients"
              className="rounded-xl bg-[#557373] px-4 py-2 text-xs font-bold text-white transition-all hover:bg-[#435c5c]"
            >
              Open patients
            </Link>
          </div>
        </div>
      </div>

      <LongTermReviewWorkspaceList
        patients={filteredReviewList}
        emptyDescription={
          selectedMonthIndex === "all"
            ? "Patients flagged by the operator desk for long term review will appear here."
            : `No long term review patients have a due date in ${filteredMonthLabel}.`
        }
        emptyTitle={
          selectedMonthIndex === "all"
            ? "No long term review patients"
            : `No patients due in ${filteredMonthLabel}`
        }
        onPatientsChange={onPatientsChange}
      />
    </div>
  );
}

export default LongTermReviewOperatorPanel;
