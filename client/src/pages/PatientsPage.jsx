import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CreditCard,
  IdCard,
  MoreVertical,
  Plus,
  Search,
  SquarePen,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import {
  formatAgeFromDateOfBirth,
  formatDate,
  statusLabel,
} from "../lib/format.js";
import { canBillPatientForUser } from "../lib/access.js";
import { isPatientSubscribed } from "../lib/patientSubscription.js";
import {
  formatReviewDueShort,
  formatReviewTimelineDate,
  isPatientUnderReview,
} from "../lib/patientReview.js";
import { cx, pageContainerClass } from "../lib/utils.js";

import { PatientFormModal } from "../components/PatientIntakeForm.jsx";

function displayText(value, fallback = "Not recorded") {
  return value ? value : fallback;
}

function PatientCareNumber({ patient, className }) {
  const identifier = displayText(patient.patient_identifier);

  if (!isPatientSubscribed(patient)) {
    return <span className={className}>{identifier}</span>;
  }

  return (
    <span className={className}>
      {identifier}
      <span className="ml-1 font-semibold text-teal-600" title="Health plan subscriber">
        {" "}
        ★
      </span>
    </span>
  );
}

function PatientHealthPlanInlineBadge({ onDark = false } = {}) {
  return (
    <span
      className={cx(
        "ml-2 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-semibold",
        onDark
          ? "border border-white/10 bg-white/15 text-[#e6f0f0]"
          : "bg-teal-50 text-teal-700",
      )}
      title="Health plan subscriber"
    >
      ★
    </span>
  );
}

function MobilePatientStatusPill({ value }) {
  const normalized = String(value || "").trim().toLowerCase();
  const isUnderReview = normalized === "under_review";

  return (
    <span
      className={cx(
        "inline-flex rounded-lg border px-2 py-0.5 text-[11px] font-bold capitalize",
        isUnderReview
          ? "border-amber-200/25 bg-amber-400/15 text-amber-100"
          : "border-white/10 bg-white/15 text-[#e6f0f0]",
      )}
    >
      {statusLabel(value)}
    </span>
  );
}

function formatMobilePatientGender(gender) {
  if (gender === "M") return "Male";
  if (gender === "F") return "Female";
  const normalized = String(gender || "").trim();
  return normalized || null;
}

function formatMobilePatientAgeYears(dateOfBirth) {
  const formatted = formatAgeFromDateOfBirth(dateOfBirth);
  const match = /^(\d+)\s+years old$/.exec(formatted);
  return match ? `${match[1]} yrs` : null;
}

function formatMobilePatientMetaLine(patient) {
  const parts = [];

  if (patient.patient_identifier) {
    parts.push(patient.patient_identifier);
  }

  const ageLabel = patient.date_of_birth ? formatMobilePatientAgeYears(patient.date_of_birth) : null;
  if (ageLabel) {
    parts.push(ageLabel);
  }

  const genderLabel = formatMobilePatientGender(patient.gender);
  if (genderLabel) {
    parts.push(genderLabel);
  }

  return parts.length ? parts.join(" • ") : "Patient details unavailable";
}

function formatUnderReviewAgeLocationLine(patient) {
  const parts = [];

  if (patient.date_of_birth) {
    const ageLabel = formatMobilePatientAgeYears(patient.date_of_birth);
    if (ageLabel) {
      parts.push(ageLabel);
    }
  }

  if (patient.gender === "M" || patient.gender === "F") {
    parts.push(patient.gender);
  } else if (patient.gender) {
    parts.push(String(patient.gender).trim());
  }

  const location = String(patient.location || "").trim();
  if (location) {
    parts.push(location);
  }

  return parts.length ? parts.join(" • ") : "Details unavailable";
}

function formatAssignedClinicianLine(patient) {
  if (!patient.assigned_doctor_name) {
    return "Not assigned";
  }

  if (patient.assigned_doctor_specialization) {
    return `${patient.assigned_doctor_name} (${patient.assigned_doctor_specialization})`;
  }

  return patient.assigned_doctor_name;
}

function PatientsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const subscriberFilterActive = searchParams.get("filter") === "subscribed";
  const myAssignedFilterActive = searchParams.get("filter") === "my_assigned";
  const isMobile = useIsMobile();
  const canCreatePatients = ["admin", "doctor"].includes(user.role);
  const canDeletePatients = user.role === "admin";
  const canEditPatientIdentifier = user.role === "admin";
  const canOpenBilling =
    user.role === "admin" || user.role === "doctor" || user.role === "accountant";
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState(() =>
    searchParams.get("tab") === "under_review" || searchParams.get("filter") === "under_review"
      ? "under_review"
      : "all",
  );
  const isUnderReviewView =
    statusFilter === "under_review" ||
    searchParams.get("tab") === "under_review" ||
    searchParams.get("filter") === "under_review";
  const [doctorIdFilter, setDoctorIdFilter] = useState("");
  const [page, setPage] = useState(1);
  const [patientsData, setPatientsData] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState(null);
  const [patientCardMenu, setPatientCardMenu] = useState(null);
  const [desktopTableMenu, setDesktopTableMenu] = useState(null);
  useEffect(() => {
    if (!desktopTableMenu) return undefined;

    function handleKey(event) {
      if (event.key === "Escape") {
        setDesktopTableMenu(null);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [desktopTableMenu]);

  function canEditPatient(patient) {
    if (user.role === "admin" || user.role === "doctor") {
      return true;
    }
    if (user.role === "operator") {
      return Boolean(patient?.operator_edit_allowed);
    }
    return false;
  }

  async function loadDoctors() {
    try {
      const data = await api.get("/doctors");
      setDoctors(data);
    } catch (error) {
      console.error("Failed to load doctors", error);
    }
  }

  async function loadPatients() {
    const target = patientsData ? setRefreshing : setLoading;
    target(true);

    try {
      let url = `/patients?search=${encodeURIComponent(deferredSearch)}&page=${page}&limit=15`;

      if (statusFilter === "under_review") {
        url += "&underReview=1";
      } else if (statusFilter !== "all") {
        url += `&status=${statusFilter}`;
      }

      if (doctorIdFilter) {
        url += `&doctorId=${doctorIdFilter}`;
      }

      if (subscriberFilterActive) {
        url += "&subscribed=1";
      }

      if (myAssignedFilterActive && user.role === "doctor" && user.doctor_id) {
        url += `&doctorId=${user.doctor_id}`;
        if (statusFilter === "all") {
          url += "&status=active";
        }
      }

      const data = await api.get(url);
      setPatientsData(data);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const next = searchParams.get("search") || "";
    setSearch((prev) => (prev === next ? prev : next));

    if (
      searchParams.get("tab") === "under_review" ||
      searchParams.get("filter") === "under_review"
    ) {
      setStatusFilter("under_review");
    }

    if (searchParams.get("filter") === "my_assigned" && user.role === "doctor" && user.doctor_id) {
      setDoctorIdFilter(String(user.doctor_id));
      setStatusFilter("active");
    }

    setPage(1);
  }, [searchParams, user.doctor_id, user.role]);

  useEffect(() => {
    loadDoctors();
  }, []);

  useEffect(() => {
    loadPatients();
  }, [
    deferredSearch,
    page,
    statusFilter,
    doctorIdFilter,
    subscriberFilterActive,
    myAssignedFilterActive,
    user.doctor_id,
    user.role,
  ]);

  const patients = useMemo(() => {
    const items = patientsData?.items || [];

    if (!myAssignedFilterActive || user.role !== "doctor" || !user.doctor_id) {
      return items;
    }

    return items.filter(
      (patient) =>
        Number(patient.assigned_doctor_id) === Number(user.doctor_id) &&
        patient.status === "active",
    );
  }, [patientsData?.items, myAssignedFilterActive, user.doctor_id, user.role]);
  const pagination = patientsData?.pagination;

  const headerActions = useMemo(() => {
    if (!canCreatePatients) {
      return null;
    }

    return (
      <Link
        to="/patients/add"
        className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-700"
      >
        <Plus className="size-4" />
        Add patient
      </Link>
    );
  }, [canCreatePatients]);

  async function handleSave(payload) {
    setIsSaving(true);

    try {
      if (editor?.mode === "edit") {
        await api.put(`/patients/${editor.patient.id}`, payload);
        toast.success("Patient record updated.");
        setEditor(null);
        await loadPatients();
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!patientToDelete) return;

    try {
      await api.delete(`/patients/${patientToDelete.id}`);
      toast.success("Patient removed from the directory.");
      setPatientToDelete(null);
      await loadPatients();
    } catch (error) {
      toast.error(error.message);
    }
  }

  function clearSubscriberFilter() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("filter");
    setSearchParams(nextParams, { replace: true });
    setPage(1);
  }

  function clearMyAssignedFilter() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("filter");
    setSearchParams(nextParams, { replace: true });
    setDoctorIdFilter("");
    setStatusFilter("all");
    setPage(1);
  }

  const searchField = (
    <label className="relative block w-full max-w-xl">
      <Search
        className={cx(
          "pointer-events-none absolute left-4 -translate-y-1/2 text-slate-400",
          isMobile ? "top-1/2 size-5" : "top-1/2 size-4",
        )}
      />
      <input
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
        placeholder={
          isMobile
            ? "Search by name or OCS ID..."
            : "Search by OCS care number, patient ID, name, assigned doctor, location, or next of kin"
        }
        className={cx(
          "w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition focus:border-sky-400 focus:bg-white",
          isMobile ? "h-12" : "py-3",
        )}
      />
    </label>
  );

  const subscriberFilterBadge = subscriberFilterActive ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-800">
      <span>Active filter: Subscribers</span>
      <button
        type="button"
        onClick={clearSubscriberFilter}
        className="inline-flex size-6 items-center justify-center rounded-full text-teal-700 transition hover:bg-teal-100"
        aria-label="Clear subscriber filter"
      >
        <X className="size-3.5" />
      </button>
    </span>
  ) : null;

  const myAssignedFilterBadge = myAssignedFilterActive ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700">
      <span>Filter Active: My Care Roster</span>
      <button
        type="button"
        onClick={clearMyAssignedFilter}
        className="inline-flex size-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
        aria-label="Clear my care roster filter"
      >
        <X className="size-3.5" />
      </button>
    </span>
  ) : null;

  const statusFilters = (
    <div className="flex flex-wrap items-center gap-2">
      {!myAssignedFilterActive ? (
        <div className="flex items-center gap-1 rounded-2xl border border-slate-100 bg-white p-1 shadow-sm">
          {[
            { id: "all", label: "All" },
            { id: "active", label: "Active" },
            { id: "discharged", label: "Discharged" },
            { id: "under_review", label: "Under Review" },
          ].map((status) => (
            <button
              key={status.id}
              type="button"
              onClick={() => {
                setStatusFilter(status.id);
                setPage(1);
              }}
              className={cx(
                "rounded-xl px-4 py-2 text-sm font-semibold transition",
                statusFilter === status.id
                  ? status.id === "active"
                    ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                    : status.id === "discharged"
                      ? "bg-slate-600 text-white shadow-md shadow-slate-600/20"
                      : status.id === "under_review"
                        ? "bg-amber-600 text-white shadow-md shadow-amber-600/20"
                        : "bg-sky-600 text-white shadow-md shadow-sky-600/20"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {status.label}
            </button>
          ))}
        </div>
      ) : (
        <span className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">
          Active assigned cases only
        </span>
      )}

      {!myAssignedFilterActive ? (
        <select
        value={doctorIdFilter}
        onChange={(event) => {
          setDoctorIdFilter(event.target.value);
          setPage(1);
        }}
        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-sky-400 focus:bg-white"
      >
        <option value="">All assigned doctors</option>
        {doctors.map((doctor) => (
          <option key={doctor.id} value={doctor.id}>
            {doctor.full_name}
          </option>
        ))}
      </select>
      ) : null}
    </div>
  );

  if (loading) {
    return <LoadingState label="Loading patients" />;
  }

  return (
    <div
      className={cx(
        pageContainerClass,
        isMobile
          ? "mx-auto flex min-h-[calc(100dvh-3.25rem)] w-full max-w-md flex-col space-y-3"
          : "space-y-4",
      )}
    >
      {isMobile ? (
        <header className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-bold tracking-tight text-gray-900">Patient Directory</h1>
            {headerActions}
          </div>
          {searchField}
        </header>
      ) : (
        <PageHeader title="Patients" actions={headerActions} />
      )}

      <SectionCard
        subtitle={isMobile ? null : `${pagination?.total || 0} total records`}
        className={
          isMobile
            ? "flex min-h-0 flex-1 flex-col rounded-[24px] p-3 shadow-[0_16px_40px_rgba(34,72,91,0.06)]"
            : undefined
        }
        actions={
          refreshing ? (
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
              Refreshing...
            </span>
          ) : null
        }
      >
        <>
            {!isMobile ? (
              <div className="mb-4 flex flex-col gap-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  {searchField}
                  {statusFilters}
                </div>
                {subscriberFilterBadge}
                {myAssignedFilterBadge}

                {user.role === "operator" ? (
                  <div className="rounded-[24px] border border-amber-100 bg-amber-50/75 px-4 py-3 text-sm text-amber-800">
                    Operators can add new patients anytime. Existing patient records stay
                    edit-locked unless an active admin approval is in place.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mb-3 space-y-3">
                {statusFilters}
                {subscriberFilterBadge}
                {myAssignedFilterBadge}
                {user.role === "operator" ? (
                  <div className="rounded-[20px] border border-amber-100 bg-amber-50/75 px-3 py-2.5 text-sm text-amber-800">
                    Operators can add new patients anytime. Existing patient records stay
                    edit-locked unless an active admin approval is in place.
                  </div>
                ) : null}
              </div>
            )}

            {patients.length ? (
              <>
                {isMobile ? (
                  /* ── Mobile: card list ── */
                  <div className="flex flex-col pb-8">
                    {patients.map((patient) => (
                      <div
                        key={patient.id}
                        className="mb-4 flex min-w-0 max-w-full flex-col gap-3 overflow-hidden rounded-2xl border border-[#445d5d] bg-[#557373] p-4 shadow-md transition-all active:scale-[0.99]"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="grid size-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/10 text-white"
                            aria-hidden
                          >
                            <UserRound className="size-5" strokeWidth={2} />
                          </div>

                          <Link to={`/patients/${patient.id}`} className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-y-1 break-words">
                              <span className="text-base font-bold tracking-wide text-white">
                                {patient.full_name}
                              </span>
                              {isPatientSubscribed(patient) ? (
                                <PatientHealthPlanInlineBadge onDark />
                              ) : null}
                            </p>
                            <p className="mt-1 break-words text-xs font-medium text-[#d1dede]">
                              {formatMobilePatientMetaLine(patient)}
                            </p>

                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                              <MobilePatientStatusPill value={patient.status} />
                              <span className="text-xs font-medium text-[#d1dede]">
                                {displayText(patient.assigned_doctor_name, "Not assigned")}
                              </span>
                            </div>
                            {isPatientUnderReview(patient) && formatReviewDueShort(patient.review_due_date) ? (
                              <p className="mt-1.5 text-xs font-medium text-amber-100/90">
                                ⏱️ Due: {formatReviewDueShort(patient.review_due_date)}
                              </p>
                            ) : null}

                            {user.role === "operator" && patient.operator_edit_allowed ? (
                              <span className="mt-2 inline-flex rounded-lg border border-white/10 bg-white/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#e6f0f0]">
                                Edit enabled
                              </span>
                            ) : null}
                          </Link>

                          <button
                            type="button"
                            aria-label="Patient actions"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setPatientCardMenu(patient);
                            }}
                            className="grid size-11 shrink-0 place-items-center rounded-xl text-white/80 transition hover:bg-white/10 hover:text-white active:scale-95"
                          >
                            <MoreVertical className="size-5" strokeWidth={2.25} />
                          </button>
                        </div>
                      </div>
                    ))}

                    {pagination ? (
                      <div className="mt-5 flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-slate-500">
                          Page {pagination.page} of {pagination.totalPages}
                        </p>
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            disabled={pagination.page <= 1}
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            disabled={pagination.page >= pagination.totalPages}
                            onClick={() =>
                              setPage((current) => Math.min(pagination.totalPages, current + 1))
                            }
                            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  /* ── Desktop: original table ── */
                  <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
                    <div className="overflow-x-auto">
                      <table className="min-w-full table-fixed bg-white text-left">
                        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                          {isUnderReviewView ? (
                            <tr>
                              <th className="w-[20%] px-4 py-2.5">Patient</th>
                              <th className="w-[18%] px-4 py-2.5">Age / location</th>
                              <th className="w-[18%] px-4 py-2.5">Assigned clinician</th>
                              <th className="w-[16%] px-4 py-2.5">Review timeline</th>
                              <th className="w-[22%] px-4 py-2.5">Review notes</th>
                              <th className="w-12 px-2 py-2.5 text-right">
                                <span className="sr-only">Row actions</span>
                              </th>
                            </tr>
                          ) : (
                            <tr>
                              <th className="w-[19%] px-4 py-2.5">Patient</th>
                              <th className="w-[20%] px-4 py-2.5">Patient details</th>
                              <th className="w-[16%] px-4 py-2.5">Next of kin</th>
                              <th className="w-[22%] px-4 py-2.5">Clinical</th>
                              <th className="w-[10%] px-4 py-2.5">Created</th>
                              <th className="w-12 px-2 py-2.5 text-right">
                                <span className="sr-only">Row actions</span>
                              </th>
                            </tr>
                          )}
                        </thead>
                        <tbody>
                          {patients.map((patient) => {
                            const reviewNote = String(patient.review_reason_note || "").trim();
                            const dueLabel = formatReviewTimelineDate(patient.review_due_date);

                            return (
                            <tr
                              key={patient.id}
                              onClick={() => navigate(`/patients/${patient.id}`)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  navigate(`/patients/${patient.id}`);
                                }
                              }}
                              tabIndex={0}
                              role="link"
                              aria-label={`Open patient profile for ${patient.full_name}`}
                              className="cursor-pointer border-t border-slate-200/70 outline-none transition hover:bg-slate-50/80 focus-visible:bg-slate-50/80 focus-visible:ring-2 focus-visible:ring-sky-400/40"
                            >
                              {isUnderReviewView ? (
                                <>
                                  <td className="px-4 py-2 align-top">
                                    <div className="min-w-0 space-y-0.5">
                                      <p className="flex flex-wrap items-center gap-y-1">
                                        <span className="truncate font-semibold leading-tight text-slate-950">
                                          {patient.full_name}
                                        </span>
                                        {isPatientSubscribed(patient) ? (
                                          <PatientHealthPlanInlineBadge />
                                        ) : null}
                                      </p>
                                      <p className="truncate text-xs text-slate-500">
                                        <PatientCareNumber patient={patient} className="truncate" />
                                      </p>
                                    </div>
                                  </td>

                                  <td className="px-4 py-2 align-top">
                                    <p className="truncate text-sm font-medium leading-snug text-slate-700">
                                      {formatUnderReviewAgeLocationLine(patient)}
                                    </p>
                                  </td>

                                  <td className="px-4 py-2 align-top">
                                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-800">
                                      {formatAssignedClinicianLine(patient)}
                                    </p>
                                  </td>

                                  <td className="px-4 py-2 align-top">
                                    {dueLabel ? (
                                      <p className="text-sm font-bold text-amber-700">⏱ Due: {dueLabel}</p>
                                    ) : (
                                      <p className="text-sm font-bold text-slate-500">⏱ Due date not set</p>
                                    )}
                                  </td>

                                  <td className="max-w-0 px-4 py-2 align-top">
                                    <div
                                      className="max-w-xs truncate text-xs font-medium text-gray-600 cursor-help"
                                      title={reviewNote || undefined}
                                    >
                                      {reviewNote || "No review note recorded"}
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                              <td className="px-4 py-2 align-top">
                                <div className="flex min-w-0 items-start gap-2">
                                  <div className="shrink-0 rounded-xl bg-sky-50 p-2 text-sky-700">
                                    <UserRound className="size-4" />
                                  </div>
                                  <div className="min-w-0 space-y-0.5">
                                    <p className="truncate font-semibold leading-tight text-slate-950">
                                      {patient.full_name}
                                    </p>
                                    <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-slate-500">
                                      <IdCard className="size-3.5 shrink-0" />
                                      <PatientCareNumber patient={patient} className="truncate" />
                                    </p>
                                    <p className="truncate text-xs text-slate-500">
                                      ID: {displayText(patient.patient_id_number)}
                                    </p>
                                    <p className="truncate text-xs text-slate-500">
                                      {patient.gender}
                                      {patient.date_of_birth
                                        ? ` · ${formatAgeFromDateOfBirth(patient.date_of_birth)}`
                                        : ""}
                                    </p>
                                  </div>
                                </div>
                              </td>

                              <td className="px-4 py-2 align-top">
                                <p className="truncate text-sm font-medium leading-tight text-slate-800">
                                  {displayText(patient.patient_contact_number)}
                                </p>
                                <p
                                  className="mt-0.5 line-clamp-1 break-words text-xs leading-snug text-slate-500"
                                  title={patient.address || undefined}
                                >
                                  {displayText(patient.address)}
                                </p>
                                <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-slate-500">
                                  {displayText(patient.location, "Location not selected")}
                                </p>
                              </td>

                              <td className="px-4 py-2 align-top">
                                <p className="truncate text-sm font-semibold leading-tight text-slate-900">
                                  {displayText(patient.next_of_kin_name)}
                                </p>
                                <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-slate-500">
                                  {displayText(patient.next_of_kin_relationship)}
                                </p>
                                <p className="mt-0.5 truncate text-xs leading-snug text-slate-500">
                                  {displayText(patient.next_of_kin_contact_number)}
                                </p>
                              </td>

                              <td className="max-w-0 px-4 py-2 align-top">
                                <div className="flex min-w-0 items-start gap-2">
                                  <StatusBadge value={patient.status} />
                                  <div className="min-w-0 flex-1 space-y-0.5">
                                    <p className="line-clamp-1 text-xs leading-snug text-slate-600">
                                      {displayText(patient.assigned_doctor_name, "Not assigned")}
                                    </p>
                                    <p
                                      className="line-clamp-1 text-xs leading-snug text-slate-600"
                                      title={
                                        patient.status === "active"
                                          ? displayText(
                                              patient.ongoing_treatment,
                                              "Ongoing treatment not recorded",
                                            )
                                          : displayText(
                                              patient.drug_allergy_history,
                                              "Allergy history not recorded",
                                            )
                                      }
                                    >
                                      {patient.status === "active"
                                        ? displayText(
                                            patient.ongoing_treatment,
                                            "Ongoing treatment not recorded",
                                          )
                                        : displayText(
                                            patient.drug_allergy_history,
                                            "Allergy history not recorded",
                                          )}
                                    </p>
                                    {isPatientUnderReview(patient) &&
                                    formatReviewDueShort(patient.review_due_date) ? (
                                      <p className="text-xs font-medium text-amber-700">
                                        ⏱️ Due: {formatReviewDueShort(patient.review_due_date)}
                                      </p>
                                    ) : null}
                                    {user.role === "operator" && patient.operator_edit_allowed ? (
                                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                                        Edit enabled
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </td>

                              <td className="px-4 py-2 align-top text-xs leading-snug text-slate-500">
                                {formatDate(patient.created_at)}
                              </td>
                                </>
                              )}

                              <td className="px-2 py-2 align-top">
                                <div className="flex justify-end">
                                  <button
                                    type="button"
                                    aria-label={`More actions for ${patient.full_name}`}
                                    aria-expanded={
                                      desktopTableMenu?.patient.id === patient.id
                                    }
                                    aria-haspopup="menu"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (desktopTableMenu?.patient.id === patient.id) {
                                        setDesktopTableMenu(null);
                                        return;
                                      }
                                      const rect = event.currentTarget.getBoundingClientRect();
                                      const menuWidth = 176;
                                      setDesktopTableMenu({
                                        patient,
                                        top: rect.bottom + 6,
                                        left: Math.max(8, rect.right - menuWidth),
                                      });
                                    }}
                                    className="grid size-9 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50"
                                  >
                                    <MoreVertical className="size-4" aria-hidden />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {!isMobile ? (
                <div className="mt-5 flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">
                    Page {pagination.page} of {pagination.totalPages}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={pagination.page <= 1}
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() =>
                        setPage((current) => Math.min(pagination.totalPages, current + 1))
                      }
                      className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
                ) : null}
              </>
            ) : (
              <EmptyState
                title="No patients found"
                description="Try a broader search or add a new patient to start tracking consultations and billing."
                action={canCreatePatients ? headerActions : null}
              />
            )}
        </>
      </SectionCard>

      {desktopTableMenu ? (
        <>
          <button
            type="button"
            aria-label="Dismiss menu"
            className="fixed inset-0 z-[45] cursor-default bg-transparent"
            onClick={() => setDesktopTableMenu(null)}
          />
          <div
            role="menu"
            className="fixed z-[50] min-w-[11rem] rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
            style={{ top: desktopTableMenu.top, left: desktopTableMenu.left }}
          >
            {canEditPatient(desktopTableMenu.patient) ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const p = desktopTableMenu.patient;
                  setDesktopTableMenu(null);
                  setEditor({ mode: "edit", patient: p });
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <SquarePen className="size-4 shrink-0 text-slate-500" />
                Edit
              </button>
            ) : null}
            {canOpenBilling && canBillPatientForUser(user, desktopTableMenu.patient) ? (
              <Link
                role="menuitem"
                to={`/billing?patientId=${desktopTableMenu.patient.id}`}
                onClick={() => setDesktopTableMenu(null)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <CreditCard className="size-4 shrink-0 text-slate-500" />
                Billing
              </Link>
            ) : null}
            {canDeletePatients ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const p = desktopTableMenu.patient;
                  setDesktopTableMenu(null);
                  setPatientToDelete(p);
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
              >
                <Trash2 className="size-4 shrink-0" />
                Delete
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {isMobile && patientCardMenu ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-[1px]"
            onClick={() => setPatientCardMenu(null)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-[61] rounded-t-[28px] border border-slate-200/80 bg-white px-4 pt-3 shadow-[0_-12px_40px_rgba(15,23,42,0.12)]"
            style={{
              paddingBottom: "max(1rem, var(--sab))",
              paddingLeft: "max(1rem, var(--sal))",
              paddingRight: "max(1rem, var(--sar))",
            }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" aria-hidden />
            <p className="truncate text-base font-semibold text-slate-950">{patientCardMenu.full_name}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {displayText(patientCardMenu.patient_identifier)}
            </p>
            <div className="mt-4 grid gap-2">
              {canEditPatient(patientCardMenu) ? (
                <button
                  type="button"
                  onClick={() => {
                    setPatientCardMenu(null);
                    setEditor({ mode: "edit", patient: patientCardMenu });
                  }}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 py-3 text-sm font-semibold text-slate-800 transition active:bg-slate-100"
                >
                  <SquarePen className="size-4" />
                  Edit patient
                </button>
              ) : null}
              {canOpenBilling && canBillPatientForUser(user, patientCardMenu) ? (
                <Link
                  to={`/billing?patientId=${patientCardMenu.id}`}
                  onClick={() => setPatientCardMenu(null)}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 py-3 text-sm font-semibold text-slate-800 transition active:bg-slate-100"
                >
                  <CreditCard className="size-4" />
                  Billing
                </Link>
              ) : null}
              {canDeletePatients ? (
                <button
                  type="button"
                  onClick={() => {
                    setPatientCardMenu(null);
                    setPatientToDelete(patientCardMenu);
                  }}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/60 py-3 text-sm font-semibold text-rose-700 transition active:bg-rose-100"
                >
                  <Trash2 className="size-4" />
                  Delete patient
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setPatientCardMenu(null)}
                className="mt-1 min-h-12 w-full rounded-2xl py-3 text-sm font-semibold text-slate-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      ) : null}

      <PatientFormModal
        canEditPatientIdentifier={canEditPatientIdentifier}
        canSelectAssignedDoctor={user.role === "admin"}
        doctors={doctors}
        isSaving={isSaving}
        mode={editor?.mode}
        open={Boolean(editor)}
        patient={editor?.patient}
        onClose={() => setEditor(null)}
        onSubmit={handleSave}
      />

      <ConfirmDialog
        open={Boolean(patientToDelete)}
        onClose={() => setPatientToDelete(null)}
        onConfirm={handleDelete}
        title="Delete patient?"
        description={
          patientToDelete
            ? `${patientToDelete.full_name} will be removed from the patient directory. Clinical history stays in the database but the record will no longer appear in searches.`
            : ""
        }
        confirmLabel="Remove patient"
      />
    </div>
  );
}

export default PatientsPage;
