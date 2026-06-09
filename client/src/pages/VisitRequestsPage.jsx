import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, Phone, Stethoscope, Clock, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { api } from "../lib/api.js";
import { formatDate } from "../lib/format.js";
import { cx } from "../lib/utils.js";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "assigned", label: "Doctor assigned" },
  { value: "en_route", label: "Doctor en route" },
  { value: "arrived", label: "Doctor arrived" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const URGENCY_STYLES = {
  routine: "bg-[rgba(45,143,152,0.12)] text-[#23767f]",
  urgent: "bg-[rgba(232,160,32,0.15)] text-[#a86c08]",
  emergency: "bg-[rgba(226,87,76,0.14)] text-[#c23a2f]",
};

function UrgencyBadge({ urgency }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold capitalize",
        URGENCY_STYLES[urgency] || URGENCY_STYLES.routine,
      )}
    >
      {urgency}
    </span>
  );
}

function VisitRequestCard({ request, doctors, onUpdate }) {
  const [draft, setDraft] = useState({
    status: request.status,
    assigned_doctor_id: request.assigned_doctor_id ? String(request.assigned_doctor_id) : "",
    eta_minutes: request.eta_minutes != null ? String(request.eta_minutes) : "",
    staff_notes: request.staff_notes || "",
  });
  const [saving, setSaving] = useState(false);

  const dirty =
    draft.status !== request.status ||
    draft.assigned_doctor_id !== (request.assigned_doctor_id ? String(request.assigned_doctor_id) : "") ||
    draft.eta_minutes !== (request.eta_minutes != null ? String(request.eta_minutes) : "") ||
    draft.staff_notes !== (request.staff_notes || "");

  async function handleSave() {
    setSaving(true);
    try {
      await onUpdate(request.id, {
        status: draft.status,
        assigned_doctor_id: draft.assigned_doctor_id === "" ? null : Number(draft.assigned_doctor_id),
        eta_minutes: draft.eta_minutes === "" ? null : Number(draft.eta_minutes),
        staff_notes: draft.staff_notes,
      });
      toast.success("Visit request updated.");
    } catch (error) {
      toast.error(error?.message || "Could not update the visit request.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[rgba(65,200,198,0.18)] bg-white/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-slate-950">{request.patient_name}</p>
            <UrgencyBadge urgency={request.urgency} />
          </div>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-gray-400">
            {request.patient_identifier || "—"} · Requested {formatDate(request.created_at)}
          </p>
        </div>
        {request.patient_contact_number ? (
          <a
            href={`tel:${request.patient_contact_number}`}
            className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-[rgba(65,200,198,0.08)] px-3 py-2 text-sm font-semibold text-[#2d8f98] transition hover:bg-[rgba(65,200,198,0.14)]"
          >
            <Phone className="size-4" />
            {request.patient_contact_number}
          </a>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-[#6e949b]" />
          <span className="text-slate-700">{request.address || "No address provided"}</span>
        </div>
        <div className="flex items-start gap-2">
          <Stethoscope className="mt-0.5 size-4 shrink-0 text-[#6e949b]" />
          <span className="text-slate-700">{request.reason || "No reason provided"}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Status</span>
          <select
            value={draft.status}
            onChange={(e) => setDraft((c) => ({ ...c, status: e.target.value }))}
            className="rounded-xl border border-[rgba(65,200,198,0.25)] bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#2d8f98]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Doctor</span>
          <select
            value={draft.assigned_doctor_id}
            onChange={(e) => setDraft((c) => ({ ...c, assigned_doctor_id: e.target.value }))}
            className="rounded-xl border border-[rgba(65,200,198,0.25)] bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#2d8f98]"
          >
            <option value="">Unassigned</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={String(doctor.id)}>
                {doctor.full_name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">ETA (mins)</span>
          <div className="relative">
            <Clock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
            <input
              type="number"
              min="0"
              value={draft.eta_minutes}
              onChange={(e) => setDraft((c) => ({ ...c, eta_minutes: e.target.value }))}
              placeholder="e.g. 25"
              className="w-full rounded-xl border border-[rgba(65,200,198,0.25)] bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-[#2d8f98]"
            />
          </div>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Internal notes</span>
        <textarea
          value={draft.staff_notes}
          onChange={(e) => setDraft((c) => ({ ...c, staff_notes: e.target.value }))}
          rows={2}
          placeholder="Add coordination notes for the team"
          className="w-full resize-none rounded-xl border border-[rgba(65,200,198,0.25)] bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#2d8f98]"
        />
      </label>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-2xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

export default function VisitRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("active");

  const loadRequests = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    try {
      const data = await api.get(`/visit-requests?status=${statusFilter}`);
      setRequests(data.visit_requests || []);
    } catch (error) {
      toast.error(error?.message || "Could not load visit requests.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    let ignore = false;

    async function loadDoctors() {
      try {
        const data = await api.get("/doctors");
        if (!ignore) setDoctors(data.doctors || data || []);
      } catch {
        if (!ignore) setDoctors([]);
      }
    }

    loadDoctors();
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    setLoading(true);
    loadRequests();
  }, [loadRequests]);

  const handleUpdate = useCallback(async (id, payload) => {
    await api.patch(`/visit-requests/${id}`, payload);
    await loadRequests({ silent: true });
  }, [loadRequests]);

  const activeDoctors = useMemo(
    () => doctors.filter((doctor) => doctor.is_active !== 0 && !doctor.deleted_at),
    [doctors],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dispatch desk"
        title="Visit requests"
        description="Home-visit requests raised by patients from the patient portal. Acknowledge, assign a doctor, and keep the patient's live tracker up to date."
        actions={
          <button
            type="button"
            onClick={() => loadRequests({ silent: true })}
            className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-white/80 px-3 py-2 text-sm font-semibold text-[#2d8f98] transition hover:bg-white"
          >
            <RefreshCw className={cx("size-4", refreshing && "animate-spin")} />
            Refresh
          </button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {[
          { value: "active", label: "Active" },
          { value: "all", label: "All" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
        ].map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={cx(
              "rounded-full px-4 py-2 text-sm font-semibold transition",
              statusFilter === tab.value
                ? "bg-[#2d8f98] text-white shadow-sm"
                : "border border-[rgba(65,200,198,0.25)] bg-white/70 text-[#4e7b83] hover:bg-white",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading visit requests" />
      ) : requests.length === 0 ? (
        <EmptyState
          title="No visit requests"
          description="When a patient requests a home visit from the patient portal, it will appear here for the team to action."
        />
      ) : (
        <SectionCard title={`${requests.length} request${requests.length === 1 ? "" : "s"}`}>
          <div className="space-y-4">
            {requests.map((request) => (
              <VisitRequestCard
                key={request.id}
                request={request}
                doctors={activeDoctors}
                onUpdate={handleUpdate}
              />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
