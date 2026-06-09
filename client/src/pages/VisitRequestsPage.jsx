import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin,
  Phone,
  Stethoscope,
  Clock,
  RefreshCw,
  GripVertical,
  Timer,
} from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { api } from "../lib/api.js";
import { formatDate } from "../lib/format.js";
import { cx } from "../lib/utils.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "assigned", label: "Doctor assigned" },
  { value: "en_route", label: "Doctor en route" },
  { value: "arrived", label: "Doctor arrived" },
  { value: "in_consultation", label: "Consultation in progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

// Dispatch desk sees the full pipeline from patient intake through consultation.
const DISPATCH_BOARD_COLUMNS = [
  { status: "pending", label: "Pending", accent: "#e2574c" },
  { status: "acknowledged", label: "Acknowledged", accent: "#e8a020" },
  { status: "assigned", label: "Assigned", accent: "#2d8f98" },
  { status: "en_route", label: "En route", accent: "#2d8f98" },
  { status: "arrived", label: "Arrived", accent: "#1a7f4b" },
  { status: "in_consultation", label: "In consultation", accent: "#1a7f4b" },
];

// Doctors only see visits once dispatch has assigned them.
const DOCTOR_BOARD_COLUMNS = [
  { status: "assigned", label: "Assigned", accent: "#2d8f98" },
  { status: "en_route", label: "En route", accent: "#2d8f98" },
  { status: "arrived", label: "Arrived", accent: "#1a7f4b" },
  { status: "in_consultation", label: "In consultation", accent: "#1a7f4b" },
];

const URGENCY_STYLES = {
  routine: "bg-[rgba(45,143,152,0.12)] text-[#23767f]",
  urgent: "bg-[rgba(232,160,32,0.15)] text-[#a86c08]",
  emergency: "bg-[rgba(226,87,76,0.14)] text-[#c23a2f]",
};

const URGENCY_DOT = {
  routine: "#2d8f98",
  urgent: "#e8a020",
  emergency: "#e2574c",
};

const POLL_INTERVAL_MS = 15000;

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

// SQLite timestamps come back as "YYYY-MM-DD HH:MM:SS" in UTC with no zone.
function parseTimestamp(value) {
  if (!value) return null;
  const text = String(value);
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(text)
    ? text
    : `${text.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function waitingMinutes(createdAt, now) {
  const created = parseTimestamp(createdAt);
  if (!created) return 0;
  return Math.max(0, Math.floor((now - created.getTime()) / 60000));
}

function SlaChip({ createdAt, now, escalate }) {
  const mins = waitingMinutes(createdAt, now);
  const tone = !escalate
    ? "bg-slate-100 text-slate-500"
    : mins >= 30
      ? "bg-[rgba(226,87,76,0.14)] text-[#c23a2f]"
      : mins >= 10
        ? "bg-[rgba(232,160,32,0.15)] text-[#a86c08]"
        : "bg-[rgba(26,127,75,0.12)] text-[#1a7f4b]";
  const label = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
        tone,
      )}
      title="Time since the patient requested this visit"
    >
      <Timer className="size-3" />
      {label}
    </span>
  );
}

function nextStatus(status, { isDoctor = false } = {}) {
  const order = isDoctor
    ? ["assigned", "en_route", "arrived", "in_consultation", "completed"]
    : ["pending", "acknowledged", "assigned", "en_route", "arrived", "in_consultation", "completed"];
  const idx = order.indexOf(status);
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
}

function advanceActionLabel(status, next) {
  if (status === "arrived" && next === "in_consultation") return "Start consultation";
  if (status === "in_consultation" && next === "completed") return "Consultation done";
  return `Move to ${STATUS_OPTIONS.find((option) => option.value === next)?.label || next}`;
}

function BoardCard({
  request,
  doctors,
  onUpdate,
  now,
  onDragStart,
  onDragEnd,
  canAssignDoctor = true,
  isDoctor = false,
}) {
  const [eta, setEta] = useState(request.eta_minutes != null ? String(request.eta_minutes) : "");
  // Re-sync the editable ETA when the server value changes (React's recommended
  // "adjust state during render" pattern, no effect needed).
  const [syncedEta, setSyncedEta] = useState(request.eta_minutes);
  if (request.eta_minutes !== syncedEta) {
    setSyncedEta(request.eta_minutes);
    setEta(request.eta_minutes != null ? String(request.eta_minutes) : "");
  }

  const escalate = request.status === "pending" || request.status === "acknowledged";
  const advance = nextStatus(request.status, { isDoctor });

  function update(payload) {
    onUpdate(request.id, payload).catch((error) =>
      toast.error(error?.message || "Could not update the visit request."),
    );
  }

  return (
    <div
      draggable
      onDragStart={(event) => onDragStart(event, request.id)}
      onDragEnd={onDragEnd}
      className="group cursor-grab rounded-2xl border border-[rgba(65,200,198,0.18)] bg-white p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 size-4 shrink-0 text-slate-300 group-hover:text-slate-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: URGENCY_DOT[request.urgency] || URGENCY_DOT.routine }}
            />
            <p className="truncate text-sm font-semibold text-slate-950">{request.patient_name}</p>
            <SlaChip createdAt={request.created_at} now={now} escalate={escalate} />
          </div>
          <p className="mt-1 line-clamp-1 text-xs text-slate-500">
            {request.reason || "No reason provided"}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
            <MapPin className="size-3 shrink-0" />
            <span className="truncate">{request.address || "No address"}</span>
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {canAssignDoctor ? (
          <select
            value={request.assigned_doctor_id ? String(request.assigned_doctor_id) : ""}
            onChange={(event) =>
              update({
                assigned_doctor_id: event.target.value === "" ? null : Number(event.target.value),
                ...(request.status === "pending" || request.status === "acknowledged"
                  ? { status: "assigned" }
                  : {}),
              })
            }
            className="w-full rounded-lg border border-[rgba(65,200,198,0.25)] bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-[#2d8f98]"
          >
            <option value="">Unassigned</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={String(doctor.id)}>
                {doctor.full_name}
              </option>
            ))}
          </select>
        ) : null}

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Clock className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[#6e949b]" />
            <input
              type="number"
              min="0"
              value={eta}
              onChange={(event) => setEta(event.target.value)}
              onBlur={() => {
                const next = eta === "" ? null : Number(eta);
                if (next !== (request.eta_minutes ?? null)) update({ eta_minutes: next });
              }}
              placeholder="ETA"
              className="w-full rounded-lg border border-[rgba(65,200,198,0.25)] bg-white py-1.5 pl-7 pr-2 text-xs text-slate-900 outline-none focus:border-[#2d8f98]"
            />
          </div>
          {request.patient_contact_number ? (
            <a
              href={`tel:${request.patient_contact_number}`}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-[rgba(65,200,198,0.22)] bg-[rgba(65,200,198,0.08)] text-[#2d8f98] transition hover:bg-[rgba(65,200,198,0.16)]"
              title={`Call ${request.patient_contact_number}`}
            >
              <Phone className="size-4" />
            </a>
          ) : null}
        </div>

        {advance ? (
          <button
            type="button"
            onClick={() => update({ status: advance })}
            className="w-full rounded-lg bg-[#2d8f98] px-2 py-1.5 text-xs font-semibold text-white transition hover:brightness-105 active:scale-95"
          >
            {advanceActionLabel(request.status, advance)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DispatchBoard({ requests, doctors, onUpdate, now, columns, canAssignDoctor, isDoctor }) {
  const [dragId, setDragId] = useState(null);
  const [overColumn, setOverColumn] = useState(null);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(columns.map((column) => [column.status, []]));
    requests.forEach((request) => {
      if (map[request.status]) map[request.status].push(request);
    });
    return map;
  }, [columns, requests]);

  function handleDragStart(event, id) {
    setDragId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(id));
  }

  function handleDrop(status) {
    setOverColumn(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const request = requests.find((item) => item.id === id);
    if (!request || request.status === status) return;
    onUpdate(id, { status }).catch((error) =>
      toast.error(error?.message || "Could not move the visit request."),
    );
  }

  const columnClass =
    columns.length >= 6 ? "lg:grid-cols-6" : columns.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-5";

  return (
    <div className={cx("grid gap-3", columnClass)}>
      {columns.map((column) => {
        const items = grouped[column.status] || [];
        const isOver = overColumn === column.status;
        return (
          <div
            key={column.status}
            onDragOver={(event) => {
              event.preventDefault();
              if (overColumn !== column.status) setOverColumn(column.status);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOverColumn(null);
            }}
            onDrop={() => handleDrop(column.status)}
            className={cx(
              "flex min-h-[120px] flex-col rounded-2xl border bg-slate-50/60 p-2.5 transition",
              isOver
                ? "border-[#2d8f98] bg-[rgba(45,143,152,0.06)] ring-2 ring-[#2d8f98]/30"
                : "border-slate-200/70",
            )}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: column.accent }} />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  {column.label}
                </span>
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-500">
                {items.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              {items.map((request) => (
                <BoardCard
                  key={request.id}
                  request={request}
                  doctors={doctors}
                  onUpdate={onUpdate}
                  now={now}
                  onDragStart={handleDragStart}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverColumn(null);
                  }}
                  canAssignDoctor={canAssignDoctor}
                  isDoctor={isDoctor}
                />
              ))}
              {items.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-slate-300">Drop here</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function VisitRequestCard({ request, doctors, onUpdate, canAssignDoctor = true }) {
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

        {canAssignDoctor ? (
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
        ) : null}

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
  const { user } = useAuth();
  const refreshKey = useLiveRefreshKey();
  const isDoctor = user?.role === "doctor";
  const canAssignDoctor = !isDoctor;
  const boardColumns = isDoctor ? DOCTOR_BOARD_COLUMNS : DISPATCH_BOARD_COLUMNS;

  const [requests, setRequests] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("active");
  const [now, setNow] = useState(() => Date.now());
  const loadRef = useRef(null);

  const loadRequests = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    try {
      const data = await api.get(`/visit-requests?status=${statusFilter}`);
      setRequests(data.visit_requests || []);
    } catch (error) {
      if (!silent) toast.error(error?.message || "Could not load visit requests.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  loadRef.current = loadRequests;

  useEffect(() => {
    if (!canAssignDoctor) {
      setDoctors([]);
      return undefined;
    }

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
  }, [canAssignDoctor]);

  useEffect(() => {
    setLoading(true);
    loadRequests();
  }, [loadRequests, refreshKey]);

  // Keep the board live: poll quietly and tick the SLA timers every second.
  useEffect(() => {
    const poll = setInterval(() => loadRef.current?.({ silent: true }), POLL_INTERVAL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const handleUpdate = useCallback(async (id, payload) => {
    // Optimistic: reflect the change in the UI immediately, then reconcile with
    // the server (and roll back to server truth if the request fails).
    setRequests((current) =>
      current.map((request) => (request.id === id ? { ...request, ...payload } : request)),
    );
    try {
      await api.patch(`/visit-requests/${id}`, payload);
    } catch (error) {
      await loadRequests({ silent: true });
      throw error;
    }
    await loadRequests({ silent: true });
  }, [loadRequests]);

  const activeDoctors = useMemo(
    () => doctors.filter((doctor) => doctor.is_active !== 0 && !doctor.deleted_at),
    [doctors],
  );

  const isBoard = statusFilter === "active";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isDoctor ? "My visits" : "Dispatch desk"}
        title="Visit requests"
        description={
          isDoctor
            ? "Home visits assigned to you. Update your ETA, start the consultation when you arrive, and mark it done when finished."
            : "Home-visit requests raised by patients from the patient portal. Review new requests, assign a doctor, and track the visit through to completion."
        }
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
          { value: "active", label: "Live board" },
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
          description={
            isDoctor
              ? "When dispatch assigns you a home visit, it will appear here."
              : "When a patient requests a home visit from the patient portal, it will appear here for the team to action."
          }
        />
      ) : isBoard ? (
        <DispatchBoard
          requests={requests}
          doctors={activeDoctors}
          onUpdate={handleUpdate}
          now={now}
          columns={boardColumns}
          canAssignDoctor={canAssignDoctor}
          isDoctor={isDoctor}
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
                canAssignDoctor={canAssignDoctor}
              />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
