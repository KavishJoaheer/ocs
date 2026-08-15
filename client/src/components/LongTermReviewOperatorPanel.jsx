import { useEffect, useMemo, useState } from "react";
import LongTermReviewWorkspaceList from "./LongTermReviewWorkspaceList.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
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

const FILTER_SELECT_CLASS =
  "w-full cursor-pointer appearance-none rounded-xl border border-gray-200/80 bg-white py-2 pl-3.5 pr-10 text-xs font-bold text-gray-700 shadow-sm focus:border-[#557373] focus:outline-none";

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

function ReviewFilterSelect({ id, label, value, onChange, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400"
        htmlFor={id}
      >
        {label}
      </label>
      <div className="relative">
        <select id={id} value={value} onChange={onChange} className={FILTER_SELECT_CLASS}>
          {children}
        </select>
        <div
          className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-[9px] text-gray-400"
          aria-hidden
        >
          ▼
        </div>
      </div>
    </div>
  );
}

function LongTermReviewOperatorPanel({
  patients = [],
  scope = "all",
  onScopeChange,
  onPatientsChange,
}) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const isDoctor = user?.role === "doctor";
  const [selectedMonthIndex, setSelectedMonthIndex] = useState("all");
  const [doctors, setDoctors] = useState([]);

  useEffect(() => {
    let ignore = false;

    api
      .get("/doctors")
      .then((rows) => {
        if (ignore) return;
        const list = Array.isArray(rows) ? rows : [];
        setDoctors(list.filter((doctor) => doctor.is_active !== 0 && !doctor.deleted_at));
      })
      .catch(() => {
        if (!ignore) {
          setDoctors([]);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  const filteredReviewList = useMemo(
    () => filterPatientsByMonthIndex(patients, selectedMonthIndex),
    [patients, selectedMonthIndex],
  );

  const filteredMonthLabel = monthLabelFromIndex(selectedMonthIndex);
  const heading = isDoctor && scope === "mine" ? "Your reviews" : "Review Appointments";
  const countLabel =
    isDoctor && scope === "mine"
      ? `${filteredReviewList.length} assigned to you`
      : `${filteredReviewList.length} ${filteredReviewList.length === 1 ? "review" : "reviews"}`;

  function handleScopeChange(event) {
    const value = event.target.value;
    if (isDoctor && Number(value) === Number(user?.doctor_id)) {
      onScopeChange?.("mine");
      return;
    }
    onScopeChange?.(value);
  }

  const filters = (
    <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "sm:flex sm:items-end sm:gap-4"}`}>
      <ReviewFilterSelect
        id="long-term-review-doctor-filter"
        label="View reviews"
        value={scope}
        onChange={handleScopeChange}
      >
        {isDoctor ? <option value="mine">My reviews</option> : null}
        <option value="all">All doctors</option>
        {doctors.map((doctor) => (
          <option key={doctor.id} value={String(doctor.id)}>
            {doctor.full_name}
            {doctor.specialization ? ` — ${doctor.specialization}` : ""}
          </option>
        ))}
      </ReviewFilterSelect>

      <ReviewFilterSelect
        id="long-term-review-month-filter"
        label="Filter by month"
        value={selectedMonthIndex}
        onChange={(event) => setSelectedMonthIndex(event.target.value)}
      >
        <option value="all">All Months</option>
        {CALENDAR_MONTH_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </ReviewFilterSelect>
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {isMobile ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-xl font-bold tracking-tight text-ocs-slate">Review</h1>
            <p className="text-sm font-medium text-slate-500">{countLabel}</p>
          </div>
          {filters}
        </div>
      ) : (
        <div className="mb-6 flex w-full flex-col gap-4 border-b border-gray-200/60 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-black tracking-tight text-gray-900 tabular-nums">
              {filteredReviewList.length}
            </span>
            <h2 className="text-lg font-extrabold tracking-wide text-gray-800">{heading}</h2>
          </div>
          {filters}
        </div>
      )}

      <LongTermReviewWorkspaceList
        patients={filteredReviewList}
        showMineBadge={isDoctor && scope !== "mine"}
        showReviewDoctor={!(isDoctor && scope === "mine")}
        emptyDescription={
          selectedMonthIndex !== "all"
            ? `No review appointment patients have a due date in ${filteredMonthLabel}.`
            : scope === "mine"
              ? "Reviews assigned to you will appear here."
              : "Patients flagged for a review appointment will appear here."
        }
        emptyTitle={
          selectedMonthIndex !== "all"
            ? `No patients due in ${filteredMonthLabel}`
            : scope === "mine"
              ? "No reviews assigned to you"
              : "No review appointment patients"
        }
        onPatientsChange={onPatientsChange}
      />
    </div>
  );
}

export default LongTermReviewOperatorPanel;
