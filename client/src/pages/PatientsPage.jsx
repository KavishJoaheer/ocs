import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CreditCard,
  IdCard,
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
  truncate,
} from "../lib/format.js";
import { cx } from "../lib/utils.js";

import { PatientFormModal } from "../components/PatientIntakeForm.jsx";

function displayText(value, fallback = "Not recorded") {
  return value ? value : fallback;
}

function PatientsPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const canCreatePatients = ["admin", "doctor", "operator"].includes(user.role);
  const canDeletePatients = user.role === "admin";
  const canEditPatientIdentifier = user.role === "admin";
  const canOpenBilling = user.role === "admin" || user.role === "doctor";
  const [search, setSearch] = useState("");
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
  const [restoringPatientId, setRestoringPatientId] = useState(null);

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
      let url = `/patients?search=${encodeURIComponent(deferredSearch)}&page=${page}&limit=8`;

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

  const mobileActionBtn =
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700";

  return (
    <div className="w-full min-w-0 max-w-full space-y-4">
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
                        className="min-w-0 max-w-full rounded-[24px] border border-slate-200/80 bg-white p-4"
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

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link to={`/patients/${patient.id}`} className={mobileActionBtn}>
                            View
                          </Link>
                          {canEditPatient(patient) ? (
                            <button
                              type="button"
                              onClick={() => setEditor({ mode: "edit", patient })}
                              className={mobileActionBtn}
                            >
                              <SquarePen className="size-4" />
                              Edit
                            </button>
                          ) : null}
                          {canOpenBilling ? (
                            <Link
                              to={`/billing?patientId=${patient.id}`}
                              className={mobileActionBtn}
                            >
                              <CreditCard className="size-4" />
                              Billing
                            </Link>
                          ) : null}
                          {canDeletePatients ? (
                            <button
                              type="button"
                              onClick={() => setPatientToDelete(patient)}
                              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                            >
                              <Trash2 className="size-4" />
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* ── Desktop: original table ── */
                  <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
                    <div className="overflow-x-auto">
                      <table className="min-w-full bg-white text-left">
                        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                          <tr>
                            <th className="px-5 py-4">Patient</th>
                            <th className="px-5 py-4">Patient details</th>
                            <th className="px-5 py-4">Next of kin</th>
                            <th className="px-5 py-4">Clinical</th>
                            <th className="px-5 py-4">Created</th>
                            <th className="px-5 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {patients.map((patient) => (
                            <tr key={patient.id} className="border-t border-slate-200/70">
                              <td className="px-5 py-4 align-top">
                                <div className="flex items-start gap-3">
                                  <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
                                    <UserRound className="size-5" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="font-semibold text-slate-950">{patient.full_name}</p>
                                    <p className="inline-flex items-center gap-2 text-sm text-slate-500">
                                      <IdCard className="size-4" />
                                      OCS care number: {displayText(patient.patient_identifier)}
                                    </p>
                                    <p className="text-sm text-slate-500">
                                      Patient ID: {displayText(patient.patient_id_number)}
                                    </p>
                                    <p className="text-sm text-slate-500">
                                      {patient.gender}
                                      {patient.date_of_birth
                                        ? ` - ${formatAgeFromDateOfBirth(patient.date_of_birth)}`
                                        : ""}
                                    </p>
                                  </div>
                                </div>
                              </td>

                              <td className="px-5 py-4 align-top">
                                <p className="font-medium text-slate-800">
                                  {displayText(patient.patient_contact_number)}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {displayText(patient.address)}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {displayText(patient.location, "Location not selected")}
                                </p>
                              </td>

                              <td className="px-5 py-4 align-top">
                                <p className="font-medium text-slate-800">
                                  {displayText(patient.next_of_kin_name)}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {displayText(patient.next_of_kin_relationship)}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {displayText(patient.next_of_kin_contact_number)}
                                </p>
                              </td>

                              <td className="px-5 py-4 align-top">
                                <div className="space-y-2">
                                  <StatusBadge value={patient.status} />
                                  <p className="text-sm text-slate-600">
                                    Assigned doctor:{" "}
                                    {displayText(patient.assigned_doctor_name, "Not assigned")}
                                  </p>
                                  <p className="text-sm text-slate-600">
                                    {patient.status === "active"
                                      ? truncate(
                                          displayText(
                                            patient.ongoing_treatment,
                                            "Ongoing treatment not recorded",
                                          ),
                                          90,
                                        )
                                      : truncate(
                                          displayText(
                                            patient.drug_allergy_history,
                                            "Allergy history not recorded",
                                          ),
                                          90,
                                        )}
                                  </p>
                                  {user.role === "operator" && patient.operator_edit_allowed ? (
                                    <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                                      Edit enabled
                                    </span>
                                  ) : null}
                                </div>
                              </td>

                              <td className="px-5 py-4 align-top text-sm text-slate-500">
                                {formatDate(patient.created_at)}
                              </td>

                              <td className="px-5 py-4 align-top">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Link
                                    to={`/patients/${patient.id}`}
                                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                                  >
                                    View
                                  </Link>

                                  {canEditPatient(patient) ? (
                                    <button
                                      type="button"
                                      onClick={() => setEditor({ mode: "edit", patient })}
                                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                                    >
                                      <SquarePen className="size-4" />
                                      Edit
                                    </button>
                                  ) : null}

                                  {canOpenBilling ? (
                                    <Link
                                      to={`/billing?patientId=${patient.id}`}
                                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                                    >
                                      <CreditCard className="size-4" />
                                      Billing
                                    </Link>
                                  ) : null}

                                  {canDeletePatients ? (
                                    <button
                                      type="button"
                                      onClick={() => setPatientToDelete(patient)}
                                      className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                                    >
                                      <Trash2 className="size-4" />
                                      Delete
                                    </button>
                                  ) : null}
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
                <table className="min-w-full bg-white text-left">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                    <tr>
                      <th className="px-5 py-4">Patient</th>
                      <th className="px-5 py-4">Assigned doctor</th>
                      <th className="px-5 py-4">Clinical records</th>
                      <th className="px-5 py-4">Deleted</th>
                      <th className="px-5 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deletedPatients.map((patient) => (
                      <tr key={patient.id} className="border-t border-slate-200/70">
                        <td className="px-5 py-4 align-top">
                          <p className="font-semibold text-slate-950">{patient.full_name}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            OCS care number: {displayText(patient.patient_identifier)}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            Patient ID: {displayText(patient.patient_id_number)}
                          </p>
                        </td>
                        <td className="px-5 py-4 align-top text-sm text-slate-600">
                          {displayText(patient.assigned_doctor_name, "Not assigned")}
                        </td>
                        <td className="px-5 py-4 align-top text-sm text-slate-600">
                          <p>{patient.appointment_count} appointments</p>
                          <p className="mt-1">{patient.consultation_count} consultations</p>
                          <p className="mt-1">{patient.bill_count} bills</p>
                        </td>
                        <td className="px-5 py-4 align-top text-sm text-slate-500">
                          {formatDate(patient.deleted_at)}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleRestorePatient(patient.id)}
                              disabled={restoringPatientId === patient.id}
                              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <RotateCcw className="size-4" />
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
