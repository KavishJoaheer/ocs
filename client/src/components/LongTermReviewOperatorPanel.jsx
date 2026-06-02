import { useMemo, useState } from "react";
import dayjs from "dayjs";
import LongTermReviewWorkspaceList from "./LongTermReviewWorkspaceList.jsx";

function monthKeyFromDueDate(dueDate) {
  const raw = String(dueDate || "").trim();
  return raw.length >= 7 ? raw.slice(0, 7) : "";
}

function formatMonthOptionLabel(monthKey) {
  const parsed = dayjs(`${monthKey}-01`);
  return parsed.isValid() ? parsed.format("MMMM YYYY") : monthKey;
}

function buildMonthFilterOptions(patients) {
  const monthKeys = new Set();

  for (const patient of patients) {
    const key = monthKeyFromDueDate(patient.review_due_date);
    if (key) {
      monthKeys.add(key);
    }
  }

  const current = dayjs().startOf("month");
  for (let offset = 0; offset < 6; offset += 1) {
    monthKeys.add(current.add(offset, "month").format("YYYY-MM"));
  }

  return Array.from(monthKeys)
    .sort()
    .map((value) => ({ value, label: formatMonthOptionLabel(value) }));
}

function filterPatientsByMonth(patients, selectedMonthFilter) {
  if (selectedMonthFilter === "all") {
    return patients;
  }

  return patients.filter((patient) =>
    monthKeyFromDueDate(patient.review_due_date).startsWith(selectedMonthFilter),
  );
}

function LongTermReviewOperatorPanel({ patients = [], onPatientsChange }) {
  const [selectedMonthFilter, setSelectedMonthFilter] = useState("all");

  const monthOptions = useMemo(() => buildMonthFilterOptions(patients), [patients]);

  const filteredReviewList = useMemo(
    () => filterPatientsByMonth(patients, selectedMonthFilter),
    [patients, selectedMonthFilter],
  );

  const reviewCount = patients.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full max-w-md shrink-0 rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-white/88 p-5 shadow-[0_24px_64px_rgba(34,72,91,0.08)]">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Review appointment
          </p>
          <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-slate-950">
            {reviewCount}
          </p>
          <p className="mt-2 text-sm leading-6 text-[#4f6f7a]">
            Pending medical re-evaluations and chronic care follow-ups required.
          </p>
        </div>

        <div className="flex min-w-[160px] flex-col gap-1.5 lg:ml-auto">
          <label
            className="text-[11px] font-bold uppercase tracking-wider text-gray-400"
            htmlFor="long-term-review-month-filter"
          >
            Filter by month
          </label>
          <div className="relative">
            <select
              id="long-term-review-month-filter"
              value={selectedMonthFilter}
              onChange={(event) => setSelectedMonthFilter(event.target.value)}
              className="w-full cursor-pointer appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-4 pr-10 text-xs font-bold text-gray-700 shadow-sm focus:border-[#557373] focus:outline-none"
            >
              <option value="all">All Months</option>
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div
              className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[10px] text-gray-400"
              aria-hidden
            >
              ▼
            </div>
          </div>
        </div>
      </div>

      <LongTermReviewWorkspaceList
        patients={filteredReviewList}
        emptyDescription={
          selectedMonthFilter === "all"
            ? "Patients flagged by the operator desk for long term review will appear here."
            : `No long term review patients have a due date in ${formatMonthOptionLabel(selectedMonthFilter)}.`
        }
        emptyTitle={
          selectedMonthFilter === "all"
            ? "No long term review patients"
            : "No patients for this month"
        }
        onPatientsChange={onPatientsChange}
      />
    </div>
  );
}

export default LongTermReviewOperatorPanel;
