import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CreditCard,
  IdCard,
  MoreVertical,
  Plus,
  RotateCcw,
  Search,
  SquarePen,
  Trash2,
  UserRound,
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
} from "../lib/format.js";
import { cx, pageContainerClass } from "../lib/utils.js";

import { PatientFormModal } from "../components/PatientIntakeForm.jsx";

function displayText(value, fallback = "Not recorded") {
  return value ? value : fallback;
}

function PatientsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const canCreatePatients = ["admin", "doctor", "operator"].includes(user.role);
  const canDeletePatients = user.role === "admin";
  const canEditPatientIdentifier = user.role === "admin";
  const canOpenBilling = user.role === "admin" || user.role === "doctor";
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState("all");
  const [doctorIdFilter, setDoctorIdFilter] = useState("");
  const [viewMode, setViewMode] = useState("active");
  const [page, setPage] = useState(1);
  const [patientsData, setPatientsData] = useState(null);
  const [deletedPatients, setDeletedPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState(null);
  const [patientCardMenu, setPatientCardMenu] = useState(null);
  const [desktopTableMenu, setDesktopTableMenu] = useState(null);
  const [restoringPatientId, setRestoringPatientId] = useState(null);

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

    return user.role === "operator" && Boolean(patient.operator_edit_allowed);
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

      if (statusFilter !== "all") {
        url += `&status=${statusFilter}`;
      }

      if (doctorIdFilter) {
        url += `&doctorId=${doctorIdFilter}`;
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

  async function loadDeletedPatients() {
    const target = deletedPatients.length ? setRefreshing : setLoading;
    target(true);

    try {
      const data = await api.get("/patients/deleted/recent");
      setDeletedPatients(data);
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
    setPage(1);
  }, [searchParams]);

  useEffect(() => {
    loadDoctors();
  }, []);

  useEffect(() => {
    if (viewMode === "deleted") {
      if (canDeletePatients) {
        loadDeletedPatients();
      }
      return;
    }

    loadPatients();
  }, [canDeletePatients, deferredSearch, page, statusFilter, doctorIdFilter, viewMode]);

  const patients = patientsData?.items || [];
  const pagination = patientsData?.pagination;

  const headerActions = useMemo(() => {
    if (!canCreatePatients || viewMode !== "active") {
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
  }, [canCreatePatients, viewMode]);

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
      toast.success("Patient moved to recently deleted.");
      setPatientToDelete(null);
      if (viewMode === "active") {
        await loadPatients();
      }
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function handleRestorePatient(patientId) {
    setRestoringPatientId(patientId);

    try {
      await api.post(`/patients/${patientId}/restore`);
      toast.success("Patient restored.");
      await loadDeletedPatients();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRestoringPatientId(null);
    }
  }

  if (loading) {
    return <LoadingState label="Loading patients" />;
  }

  return (
    <div className={cx(pageContainerClass, "space-y-4")}>
      <PageHeader
        title="Patients"
        actions={headerActions}
      />

      {canDeletePatients ? (
        <div className="flex flex-wrap gap-3 rounded-[24px] border border-slate-200/80 bg-white/80 p-2.5 shadow-[0_20px_60px_rgba(34,72,91,0.08)]">
          {[
            { id: "active", label: "Patient directory" },
            { id: "deleted", label: "Recently deleted" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setViewMode(tab.id)}
              className={cx(
                "rounded-xl px-4 py-2.5 text-sm font-semibold transition",
                viewMode === tab.id
                  ? "bg-sky-600 text-white shadow-lg shadow-sky-200"
                  : "bg-slate-50 text-slate-600 hover:bg-slate-100",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      <SectionCard
        title={viewMode === "deleted" ? "Recently deleted" : null}
        subtitle={
          viewMode === "deleted"
            ? `${deletedPatients.length} archived in the last 30 days`
            : `${pagination?.total || 0} total records`
        }
        actions={
          refreshing ? (
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
              Refreshing...
            </span>
          ) : null
        }
      >
        {viewMode === "active" ? (
          <>
            <div className="mb-4 flex flex-col gap-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <label className="relative w-full max-w-xl">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                    placeholder="Search by OCS care number, patient ID, name, assigned doctor, location, or next of kin"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-2xl border border-slate-100 bg-white p-1 shadow-sm">
                    {["all", "active", "discharged"].map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => {
                          setStatusFilter(status);
                          setPage(1);
                        }}
                        className={cx(
                          "rounded-xl px-4 py-2 text-sm font-semibold capitalize transition",
                          statusFilter === status
                            ? status === "active"
                              ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                              : status === "discharged"
                                ? "bg-slate-600 text-white shadow-md shadow-slate-600/20"
                                : "bg-sky-600 text-white shadow-md shadow-sky-600/20"
                            : "text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        {status}
                      </button>
                    ))}
                  </div>

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
                </div>
              </div>

              {user.role === "operator" ? (
                <div className="rounded-[24px] border border-amber-100 bg-amber-50/75 px-4 py-3 text-sm text-amber-800">
                  Operators can add new patients anytime. Existing patient records stay
                  edit-locked unless an active admin approval is in place.
                </div>
              ) : null}
            </div>

            {patients.length ? (
              <>
                {isMobile ? (
                  /* ── Mobile: card list ── */
                  <div className="space-y-3">
                    {patients.map((patient) => (
                      <div
                        key={patient.id}
                        className="relative min-w-0 max-w-full overflow-hidden rounded-[24px] border border-slate-200/80 bg-white"
                      >
                        <Link
                          to={`/patients/${patient.id}`}
                          className="block min-h-[4.5rem] p-4 pr-14"
                        >
                          <p className="break-words font-semibold text-slate-950">{patient.full_name}</p>
                          <p className="mt-1 break-words text-sm text-slate-500">
                            OCS care number: {displayText(patient.patient_identifier)}
                          </p>
                          <p className="break-words text-sm text-slate-500">
                            Patient ID: {displayText(patient.patient_id_number)}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {patient.gender}
                            {patient.date_of_birth
                              ? ` \u00B7 ${formatAgeFromDateOfBirth(patient.date_of_birth)}`
                              : ""}
                          </p>

                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <StatusBadge value={patient.status} />
                            <span className="text-sm text-slate-600">
                              {displayText(patient.assigned_doctor_name, "Not assigned")}
                            </span>
                          </div>

                          {user.role === "operator" && patient.operator_edit_allowed ? (
                            <span className="mt-2 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
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
                          className="absolute right-2 top-2 z-10 grid size-11 shrink-0 place-items-center rounded-2xl border border-slate-200/80 bg-white/90 text-slate-600 shadow-sm transition active:bg-slate-100"
                        >
                          <MoreVertical className="size-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* ── Desktop: original table ── */
                  <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
                    <div className="overflow-x-auto">
                      <table className="min-w-full table-fixed bg-white text-left">
                        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
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
                        </thead>
                        <tbody>
                          {patients.map((patient) => (
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
                                      <span className="truncate">
                                        {displayText(patient.patient_identifier)}
                                      </span>
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
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

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
              </>
            ) : (
              <EmptyState
                title="No patients found"
                description="Try a broader search or add a new patient to start tracking consultations and billing."
                action={canCreatePatients ? headerActions : null}
              />
            )}
          </>
        ) : deletedPatients.length ? (
          isMobile ? (
            /* ── Mobile: deleted patient cards ── */
            <div className="space-y-3">
              {deletedPatients.map((patient) => (
                <div
                  key={patient.id}
                  className="rounded-[24px] border border-slate-200/80 bg-white p-4"
                >
                  <p className="font-semibold text-slate-950">{patient.full_name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    OCS care number: {displayText(patient.patient_identifier)}
                  </p>
                  <p className="text-sm text-slate-500">
                    Patient ID: {displayText(patient.patient_id_number)}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {displayText(patient.assigned_doctor_name, "Not assigned")}
                  </p>
                  <div className="mt-1 text-sm text-slate-500">
                    <span>{patient.appointment_count} appt</span>
                    <span className="mx-1">&middot;</span>
                    <span>{patient.consultation_count} consult</span>
                    <span className="mx-1">&middot;</span>
                    <span>{patient.bill_count} bills</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Deleted {formatDate(patient.deleted_at)}
                  </p>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => handleRestorePatient(patient.id)}
                      disabled={restoringPatientId === patient.id}
                      className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RotateCcw className="size-4" />
                      {restoringPatientId === patient.id ? "Restoring..." : "Restore"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ── Desktop: original deleted table ── */
            <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
              <div className="overflow-x-auto">
                <table className="min-w-full table-fixed bg-white text-left">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                    <tr>
                      <th className="w-[30%] px-4 py-2.5">Patient</th>
                      <th className="w-[22%] px-4 py-2.5">Assigned doctor</th>
                      <th className="w-[26%] px-4 py-2.5">Clinical records</th>
                      <th className="w-[12%] px-4 py-2.5">Deleted</th>
                      <th className="w-[10%] px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletedPatients.map((patient) => (
                      <tr key={patient.id} className="border-t border-slate-200/70">
                        <td className="px-4 py-2 align-top">
                          <p className="truncate font-semibold leading-tight text-slate-950">
                            {patient.full_name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            OCS: {displayText(patient.patient_identifier)}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            ID: {displayText(patient.patient_id_number)}
                          </p>
                        </td>
                        <td className="px-4 py-2 align-top text-xs leading-snug text-slate-600">
                          {displayText(patient.assigned_doctor_name, "Not assigned")}
                        </td>
                        <td className="px-4 py-2 align-top text-xs leading-snug text-slate-600">
                          <p className="truncate">{patient.appointment_count} appointments</p>
                          <p className="truncate">{patient.consultation_count} consultations</p>
                          <p className="truncate">{patient.bill_count} bills</p>
                        </td>
                        <td className="px-4 py-2 align-top text-xs text-slate-500">
                          {formatDate(patient.deleted_at)}
                        </td>
                        <td className="px-4 py-2 align-top">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleRestorePatient(patient.id)}
                              disabled={restoringPatientId === patient.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <RotateCcw className="size-3.5" />
                              {restoringPatientId === patient.id ? "Restoring..." : "Restore"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        ) : (
          <EmptyState
            title="No recently deleted patients"
            description="Deleted patients from the last 30 days will appear here."
          />
        )}
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
            {canOpenBilling ? (
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
              {canOpenBilling ? (
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
            ? `${patientToDelete.full_name} will move to Recently deleted for 30 days. Appointments, consultation notes, and billing history stay attached.`
            : ""
        }
        confirmLabel="Move to recently deleted"
      />
    </div>
  );
}

export default PatientsPage;
