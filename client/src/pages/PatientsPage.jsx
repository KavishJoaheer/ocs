import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CreditCard,
  IdCard,
  LockKeyhole,
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
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import PatientLocationTags from "../components/PatientLocationTags.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import {
  formatAgeFromDateOfBirth,
  formatDate,
  truncate,
} from "../lib/format.js";
import { cx } from "../lib/utils.js";

const emptyPatient = {
  first_name: "",
  last_name: "",
  patient_identifier: "",
  patient_id_number: "",
  date_of_birth: "",
  gender: "M",
  assigned_doctor_id: "",
  patient_contact_number: "",
  address: "",
  location: "",
  location_tags: [],
  past_medical_history: "",
  past_surgical_history: "",
  drug_history: "",
  drug_allergy_history: "",
  particularity: "",
  next_of_kin_name: "",
  next_of_kin_relationship: "",
  next_of_kin_contact_number: "",
  next_of_kin_email: "",
  status: "active",
  ongoing_treatment: "",
};

function toPatientFormState(patient) {
  if (!patient) {
    return emptyPatient;
  }

  return {
    first_name: patient.first_name ?? "",
    last_name: patient.last_name ?? "",
    patient_identifier: patient.patient_identifier ?? "",
    patient_id_number: patient.patient_id_number ?? "",
    date_of_birth: patient.date_of_birth ?? "",
    gender: patient.gender ?? "M",
    assigned_doctor_id: patient.assigned_doctor_id ? String(patient.assigned_doctor_id) : "",
    patient_contact_number:
      patient.patient_contact_number ?? patient.contact_number ?? "",
    address: patient.address ?? "",
    location: patient.location ?? "",
    location_tags: patient.location_tags ?? [],
    past_medical_history: patient.past_medical_history ?? "",
    past_surgical_history: patient.past_surgical_history ?? "",
    drug_history: patient.drug_history ?? "",
    drug_allergy_history: patient.drug_allergy_history ?? "",
    particularity: patient.particularity ?? "",
    next_of_kin_name: patient.next_of_kin_name ?? "",
    next_of_kin_relationship:
      patient.next_of_kin_relationship ?? patient.contact_relationship ?? "",
    next_of_kin_contact_number: patient.next_of_kin_contact_number ?? "",
    next_of_kin_email: patient.next_of_kin_email ?? "",
    status: patient.status ?? "active",
    ongoing_treatment: patient.ongoing_treatment ?? "",
  };
}

function displayText(value, fallback = "Not recorded") {
  return value ? value : fallback;
}

function PatientFormModal({
  open,
  patient,
  doctors,
  mode,
  canSelectAssignedDoctor,
  canEditPatientIdentifier,
  onClose,
  onSubmit,
  isSaving,
}) {
  const [form, setForm] = useState(emptyPatient);

  useEffect(() => {
    if (!open) return;
    setForm(toPatientFormState(patient));
  }, [open, patient]);

  const isEditing = mode === "edit";
  const actionLabel = isEditing ? "Update patient" : "Add patient";

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "status" && value === "discharged" ? { ongoing_treatment: "" } : {}),
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const locationTags = Array.isArray(form.location_tags) ? form.location_tags : [];
    const legacyLocation = locationTags.map((tag) => tag.name).join(", ");

    onSubmit({
      ...form,
      location_tags: locationTags,
      location: legacyLocation,
      assigned_doctor_id: form.assigned_doctor_id ? Number(form.assigned_doctor_id) : null,
      ongoing_treatment: form.status === "active" ? form.ongoing_treatment : "",
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit patient" : "Add patient"}
      description="Register patient details, location, next of kin information, and doctor assignment in one place."
      size="xl"
    >
      <form className="max-h-[72vh] space-y-6 overflow-y-auto px-1" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">First name</span>
            <input
              name="first_name"
              value={form.first_name}
              onChange={handleChange}
              placeholder="Enter first name"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Last name</span>
            <input
              name="last_name"
              value={form.last_name}
              onChange={handleChange}
              placeholder="Enter last name"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">OCS care number</span>
            <input
              name="patient_identifier"
              value={form.patient_identifier}
              onChange={handleChange}
              placeholder={isEditing ? "" : "Auto-assigned from OCS-150"}
              disabled={!canEditPatientIdentifier}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Patient ID</span>
            <input
              name="patient_id_number"
              value={form.patient_id_number}
              onChange={handleChange}
              placeholder="National ID card number or passport number"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Date of birth</span>
            <input
              name="date_of_birth"
              type="date"
              value={form.date_of_birth}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Gender</span>
            <select
              required
              name="gender"
              value={form.gender}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            >
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Status</span>
            <select
              required
              name="status"
              value={form.status}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            >
              <option value="active">Active</option>
              <option value="discharged">Discharged</option>
            </select>
          </label>

          {canSelectAssignedDoctor ? (
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Assigned doctor</span>
              <select
                required
                name="assigned_doctor_id"
                value={form.assigned_doctor_id}
                onChange={handleChange}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
              >
                <option value="">Select doctor</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.full_name} - {doctor.specialization}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {isEditing && patient?.assigned_doctor_name && !canSelectAssignedDoctor ? (
            <div className="rounded-[24px] border border-amber-100 bg-amber-50/80 p-4 md:col-span-2">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white p-3 text-amber-700 shadow-sm">
                  <LockKeyhole className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-950">
                    Only admin can change the assigned doctor
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {patient.assigned_doctor_name}
                    {patient.assigned_doctor_specialization
                      ? ` - ${patient.assigned_doctor_specialization}`
                      : ""}
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-semibold text-slate-700">
              Patient contact number
            </span>
            <input
              required
              name="patient_contact_number"
              value={form.patient_contact_number}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <div className="grid gap-4 md:col-span-2 md:grid-cols-[1fr_0.46fr]">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Address</span>
              <textarea
                required
                rows="2"
                name="address"
                value={form.address}
                onChange={handleChange}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
              />
            </label>

            <div className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Locations and affiliations</span>
              <PatientLocationTags
                tags={form.location_tags}
                onChange={(nextTags) =>
                  setForm((current) => ({ ...current, location_tags: nextTags }))
                }
              />
            </div>
          </div>

          {form.status === "active" ? (
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-semibold text-slate-700">Ongoing treatment</span>
              <textarea
                rows="2"
                name="ongoing_treatment"
                value={form.ongoing_treatment}
                onChange={handleChange}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
              />
            </label>
          ) : null}

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Past medical history</span>
            <textarea
              rows="3"
              name="past_medical_history"
              value={form.past_medical_history}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Past surgical history</span>
            <textarea
              rows="3"
              name="past_surgical_history"
              value={form.past_surgical_history}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-semibold text-slate-700">Drug history</span>
            <textarea
              rows="3"
              name="drug_history"
              value={form.drug_history}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="text-sm font-semibold text-slate-700">Allergy History</span>
            <textarea
              rows="2"
              name="drug_allergy_history"
              value={form.drug_allergy_history}
              onChange={handleChange}
              placeholder="Record medication, food, environmental, or other allergy details."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="space-y-2 md:col-span-2">
            <span className="font-display text-lg font-semibold text-slate-700">
              Particularity
            </span>
            <textarea
              rows="4"
              name="particularity"
              value={form.particularity}
              onChange={handleChange}
              placeholder="Blank page for additional notes..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <div className="md:col-span-2">
            <div className="rounded-[26px] border border-slate-200/80 bg-slate-50/80 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                Next of kin
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Name</span>
                  <input
                    name="next_of_kin_name"
                    value={form.next_of_kin_name}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-sky-400"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">
                    Relationship with patient
                  </span>
                  <input
                    name="next_of_kin_relationship"
                    value={form.next_of_kin_relationship}
                    onChange={handleChange}
                    placeholder="Spouse, daughter, son, sibling..."
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-sky-400"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Contact number</span>
                  <input
                    name="next_of_kin_contact_number"
                    value={form.next_of_kin_contact_number}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-sky-400"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Email address</span>
                  <input
                    name="next_of_kin_email"
                    type="email"
                    value={form.next_of_kin_email}
                    onChange={handleChange}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none transition focus:border-sky-400"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 mt-4 flex justify-end gap-3 border-t border-slate-100 bg-white py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : actionLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PatientsPage() {
  const { user } = useAuth();
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
      <button
        type="button"
        onClick={() => setEditor({ mode: "create", patient: null })}
        className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-700"
      >
        <Plus className="size-4" />
        Add patient
      </button>
    );
  }, [canCreatePatients, viewMode]);

  async function handleSave(payload) {
    setIsSaving(true);

    try {
      if (editor?.mode === "edit") {
        await api.put(`/patients/${editor.patient.id}`, payload);
        toast.success("Patient record updated.");
      } else {
        await api.post("/patients", payload);
        toast.success("Patient added successfully.");
        setPage(1);
      }

      setEditor(null);
      await loadPatients();
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Registry"
        title="Patients"
        description="Review patient details, next of kin records, and locked registration assignments across the full clinic."
        actions={headerActions}
      />

      {canDeletePatients ? (
        <div className="flex flex-wrap gap-3 rounded-[28px] border border-slate-200/80 bg-white/80 p-3 shadow-[0_20px_60px_rgba(34,72,91,0.08)]">
          {[
            { id: "active", label: "Patient directory" },
            { id: "deleted", label: "Recently deleted" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setViewMode(tab.id)}
              className={cx(
                "rounded-2xl px-4 py-3 text-sm font-semibold transition",
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
        title={viewMode === "deleted" ? "Recently deleted" : "Patient directory"}
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
            <div className="mb-5 flex flex-col gap-6">
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

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">
                    Page {pagination.page} of {pagination.totalPages}
                  </p>
                  <div className="flex gap-3">
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
        ) : (
          <EmptyState
            title="No recently deleted patients"
            description="Deleted patients from the last 30 days will appear here."
          />
        )}
      </SectionCard>

      <PatientFormModal
        open={Boolean(editor)}
        patient={editor?.patient}
        doctors={doctors}
        mode={editor?.mode}
        canSelectAssignedDoctor={
          user.role === "admin" ||
          (user.role === "operator" && editor?.mode === "create")
        }
        canEditPatientIdentifier={canEditPatientIdentifier}
        onClose={() => setEditor(null)}
        onSubmit={handleSave}
        isSaving={isSaving}
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
