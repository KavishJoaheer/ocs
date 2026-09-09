import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin,
  Phone,
  Stethoscope,
  Clock,
  RefreshCw,
  GripVertical,
  Timer,
  LockKeyhole,
} from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { cx } from "../lib/utils.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { useAppointmentChangeCount } from "../hooks/useAppointmentChangeCount.js";
import AppointmentChangeInbox from "../components/AppointmentChangeInbox.jsx";

const STATUS_OPTIONS = [
  { value: "pending", label: "Request received" },
  { value: "acknowledged", label: "Reviewing" },
  { value: "assigned", label: "Doctor assigned" },
  { value: "en_route", label: "Doctor en route" },
  { value: "arrived", label: "Doctor arrived" },
  { value: "in_consultation", label: "Consultation in progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

// Dispatch desk sees the full pipeline from patient intake through consultation.
const DISPATCH_BOARD_COLUMNS = [
  { status: "pending", label: "Request received", accent: "#e2574c" },
  { status: "acknowledged", label: "Reviewing", accent: "#d97706" },
  { status: "assigned", label: "Doctor assigned", accent: "#2d8f98" },
  { status: "en_route", label: "En route", accent: "#2d8f98" },
  { status: "arrived", label: "Arrived", accent: "#1a7f4b" },
  { status: "in_consultation", label: "In consultation", accent: "#1a7f4b" },
];

// Doctors only see visits once dispatch has assigned them.
const DOCTOR_BOARD_COLUMNS = [
  { status: "assigned", label: "Doctor assigned", accent: "#2d8f98" },
  { status: "en_route", label: "En route", accent: "#2d8f98" },
  { status: "arrived", label: "Arrived", accent: "#1a7f4b" },
  { status: "in_consultation", label: "In consultation", accent: "#1a7f4b" },
];

const URGENCY_STYLES = {
  routine: "bg-[rgba(45,143,152,0.12)] text-[#23767f]",
  urgent: "bg-brand-gold/15 text-brand-gold-dark",
  emergency: "bg-[rgba(226,87,76,0.14)] text-[#c23a2f]",
};

const URGENCY_DOT = {
  routine: "#2d8f98",
  urgent: "#d97706",
  emergency: "#e2574c",
};

function visitForLabel(request) {
  const value = String(request?.visit_for || "myself").trim().toLowerCase();
  if (!value || value === "myself") {
    return null;
  }
  if (request?.dependent_name) {
    return `Visit for ${request.dependent_name}`;
  }
  if (value === "dependent") {
    return "Visit for a dependent";
  }
  return `Visit for ${value.replace(/_/g, " ")}`;
}

const POLL_INTERVAL_MS = 15000;
const CLOSED_STATUSES = ["completed", "cancelled"];
const requestDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "Indian/Mauritius",
});

function playDispatchAlertTone() {
  if (typeof window === "undefined") return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    void context.resume().then(() => {
      const gain = context.createGain();
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.38);
      oscillator.addEventListener("ended", () => void context.close(), { once: true });
    }).catch(() => void context.close());
  } catch {
    // Browser autoplay rules can block sound until the operator interacts.
  }
}

function formatRequestDate(value) {
  const date = parseTimestamp(value);
  return date ? requestDateFormatter.format(date) : "Not set";
}

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
        ? "bg-brand-gold/15 text-brand-gold-dark"
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
  // Re-sync the editable ETA when the server value changes, but never while
  // the dispatcher is mid-edit — a 15s poll would otherwise snap the field back.
  const [syncedEta, setSyncedEta] = useState(request.eta_minutes);
  const [etaDirty, setEtaDirty] = useState(false);
  if (request.eta_minutes !== syncedEta) {
    setSyncedEta(request.eta_minutes);
    if (!etaDirty) {
      setEta(request.eta_minutes != null ? String(request.eta_minutes) : "");
    }
  }

  const escalate = request.status === "pending" || request.status === "acknowledged";
  const advance = nextStatus(request.status, { isDoctor });

  function update(payload) {
    return onUpdate(request.id, payload).catch((error) => {
      toast.error(error?.message || "Could not update the visit request.");
      throw error;
    });
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
            {visitForLabel(request) ? (
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {visitForLabel(request)}
              </span>
            ) : null}
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
              onChange={(event) => {
                setEtaDirty(true);
                setEta(event.target.value);
              }}
              onBlur={() => {
                const next = eta === "" ? null : Number(eta);
                if (next === (request.eta_minutes ?? null)) {
                  setEtaDirty(false);
                  return;
                }
                void update({ eta_minutes: next }).finally(() => setEtaDirty(false));
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

function draftFromRequest(request) {
  return {
    status: request.status,
    assigned_doctor_id: request.assigned_doctor_id ? String(request.assigned_doctor_id) : "",
    eta_minutes: request.eta_minutes != null ? String(request.eta_minutes) : "",
    staff_notes: request.staff_notes || "",
  };
}

function VisitRequestCard({ request, doctors, onUpdate, canAssignDoctor = true, isAdmin = false }) {
  const locked = !isAdmin && CLOSED_STATUSES.includes(request.status);
  const [draft, setDraft] = useState(() => draftFromRequest(request));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const serverKey = `${request.id}|${request.status}|${request.assigned_doctor_id}|${request.eta_minutes}|${request.staff_notes}`;
  const [syncedKey, setSyncedKey] = useState(serverKey);

  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    if (!dirty || locked) {
      setDraft(draftFromRequest(request));
      setDirty(false);
    }
  }

  function updateDraft(patch) {
    setDirty(true);
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function handleSave() {
    if (saving || locked) return;
    setSaving(true);
    try {
      await onUpdate(request.id, {
        ...(draft.status !== request.status ? { status: draft.status } : {}),
        ...(canAssignDoctor ? {
          assigned_doctor_id: draft.assigned_doctor_id === "" ? null : Number(draft.assigned_doctor_id),
        } : {}),
        eta_minutes: draft.eta_minutes === "" ? null : Number(draft.eta_minutes),
        staff_notes: draft.staff_notes,
      });
      toast.success("Visit request updated.");
      setDirty(false);
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
            {visitForLabel(request) ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                {visitForLabel(request)}
              </span>
            ) : null}
            <UrgencyBadge urgency={request.urgency} />
          </div>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-gray-400">
            {request.patient_identifier || "—"} · Requested {formatRequestDate(request.created_at)}
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

      {locked ? (
        <div className="mt-5 space-y-4">
          <p className="flex items-start gap-2 rounded-xl bg-slate-100 px-3 py-3 text-sm font-medium text-slate-600">
            <LockKeyhole className="mt-0.5 size-4 shrink-0" />
            Locked · Only an admin can edit this {request.status} visit.
          </p>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Status</dt><dd className="mt-1 font-semibold text-slate-900">{request.status_label}</dd></div>
            <div><dt className="text-slate-500">Doctor</dt><dd className="mt-1 font-semibold text-slate-900">{request.doctor_name || "Unassigned"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-slate-500">Internal notes</dt><dd className="mt-1 whitespace-pre-wrap text-slate-700">{request.staff_notes || "No internal notes"}</dd></div>
          </dl>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Status</span>
              <select
                value={draft.status}
                onChange={(e) => updateDraft({ status: e.target.value })}
                className="rounded-xl border border-[rgba(65,200,198,0.25)] bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#2d8f98]"
              >
                {STATUS_OPTIONS.filter((option) => canAssignDoctor || option.value === request.status || ["en_route", "arrived", "in_consultation", "completed"].includes(option.value)).map((option) => (
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
                  onChange={(e) => updateDraft({ assigned_doctor_id: e.target.value })}
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
                  onChange={(e) => updateDraft({ eta_minutes: e.target.value })}
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
              onChange={(e) => updateDraft({ staff_notes: e.target.value })}
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
        </>
      )}
    </div>
  );
}

export default function VisitRequestsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const refreshKey = useLiveRefreshKey();
  const appointmentChangeCount = useAppointmentChangeCount();
  const isDoctor = user?.role === "doctor";
  const isAdmin = user?.role === "admin";
  const canAssignDoctor = !isDoctor;
  const boardColumns = isDoctor ? DOCTOR_BOARD_COLUMNS : DISPATCH_BOARD_COLUMNS;

  const [requests, setRequests] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("active");
  const [dateDraft, setDateDraft] = useState({ from: "", to: "" });
  const [dateFilter, setDateFilter] = useState({ from: "", to: "" });
  const [dateError, setDateError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const loadRef = useRef(null);
  const fetchIdRef = useRef(0);
  const knownActiveRequestIdsRef = useRef(null);
  const [arrivalNotice, setArrivalNotice] = useState("");

  const loadRequests = useCallback(async ({ silent = false } = {}) => {
    const fetchId = ++fetchIdRef.current;
    if (statusFilter === "changes") {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (silent) setRefreshing(true);
    try {
      const query = new URLSearchParams({ status: statusFilter });
      if (dateFilter.from) query.set("date_from", dateFilter.from);
      if (dateFilter.to) query.set("date_to", dateFilter.to);
      const data = await api.get(`/visit-requests?${query}`);
      if (fetchId !== fetchIdRef.current) return;
      const nextRequests = data.visit_requests || [];
      if (!isDoctor && statusFilter === "active" && !dateFilter.from && !dateFilter.to) {
        const nextIds = new Set(nextRequests.map((request) => Number(request.id)));
        const knownIds = knownActiveRequestIdsRef.current;
        if (knownIds) {
          const added = [...nextIds].filter((id) => !knownIds.has(id));
          if (added.length > 0) {
            const message = `${added.length} new visit request${added.length === 1 ? "" : "s"} need dispatch review.`;
            setArrivalNotice(message);
            toast.success(message, { duration: 10_000, icon: "🔔" });
            if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
              navigator.vibrate([200, 100, 200]);
            }
            playDispatchAlertTone();
          }
        }
        knownActiveRequestIdsRef.current = nextIds;
      } else {
        knownActiveRequestIdsRef.current = null;
      }
      setRequests(nextRequests);
      setLoadError("");
    } catch (error) {
      if (fetchId !== fetchIdRef.current) return;
      setLoadError(error?.message || "Could not load visit requests.");
      if (!silent) toast.error(error?.message || "Could not load visit requests.");
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [statusFilter, dateFilter, isDoctor]);

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
    return () => { fetchIdRef.current += 1; };
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

  useEffect(() => {
    if (!arrivalNotice) return undefined;
    const timeoutId = window.setTimeout(() => setArrivalNotice(""), 15_000);
    return () => window.clearTimeout(timeoutId);
  }, [arrivalNotice]);

  const handleUpdate = useCallback(async (id, payload) => {
    const existing = requests.find((request) => request.id === id);
    if (!isAdmin && CLOSED_STATUSES.includes(existing?.status)) {
      throw new Error("This visit is locked. Only an admin can edit completed or cancelled visits.");
    }
    if (payload.status === "completed") {
      const doctorId = Number(
        payload.assigned_doctor_id !== undefined
          ? payload.assigned_doctor_id
          : existing?.assigned_doctor_id,
      );
      if (!Number.isInteger(doctorId) || doctorId <= 0) {
        throw new Error("Assign a doctor before completing this visit.");
      }
    }

    // Optimistic: reflect the change in the UI immediately, then reconcile with
    // the server (and roll back to server truth if the request fails).
    setRequests((current) =>
      current.map((request) => (request.id === id ? { ...request, ...payload } : request)),
    );
    try {
      const result = await api.patch(`/visit-requests/${id}`, payload);
      if (result?.visit_request) {
        setRequests((current) =>
          current.map((request) =>
            request.id === id ? { ...request, ...result.visit_request } : request,
          ),
        );
      }
      if (payload.status === "completed" && result?.follow_up?.patient_id) {
        if (isDoctor && result.follow_up.consultation_id) {
          toast.success("Visit completed. Add consultation notes.");
          navigate(`/consultations/${result.follow_up.consultation_id}`);
        } else if (isDoctor) {
          toast.success("Visit completed. Add consultation notes on the patient chart.");
          navigate(`/patients/${result.follow_up.patient_id}?composeConsultation=1`);
        } else {
          toast.success("Visit completed. Appointment, consultation, and bill were created.");
        }
      }
    } catch (error) {
      await loadRequests({ silent: true });
      throw error;
    }
    await loadRequests({ silent: true });
  }, [isAdmin, isDoctor, loadRequests, navigate, requests]);

  const activeDoctors = useMemo(
    () => doctors.filter((doctor) => doctor.is_active !== 0 && !doctor.deleted_at),
    [doctors],
  );

  const isBoard = statusFilter === "active";
  const hasDateFilter = Boolean(dateFilter.from || dateFilter.to);
  const fromLabel = dateFilter.from ? formatRequestDate(`${dateFilter.from}T00:00:00Z`) : "any date";
  const toLabel = dateFilter.to ? formatRequestDate(`${dateFilter.to}T00:00:00Z`) : "";
  const dateSummary = dateFilter.from && dateFilter.from === dateFilter.to
    ? `Showing requests for ${fromLabel}.`
    : `Showing requests from ${fromLabel}${toLabel ? ` through ${toLabel}` : " onwards"}.`;

  function applyDates(event) {
    event.preventDefault();
    if (dateDraft.from && dateDraft.to && dateDraft.from > dateDraft.to) {
      setDateError("The start date must be on or before the end date.");
      return;
    }
    setDateError("");
    setDateFilter({ ...dateDraft });
  }

  function clearDates() {
    setDateDraft({ from: "", to: "" });
    setDateFilter({ from: "", to: "" });
    setDateError("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isDoctor ? "My visits" : "Dispatch desk"}
        title="Visit requests"
        description={
          isMobile && isDoctor
            ? undefined
            : isDoctor
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
          ...(!isDoctor ? [{ value: "changes", label: "Changes", badge: appointmentChangeCount }] : []),
          { value: "all", label: "All" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
        ].map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={cx(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
              statusFilter === tab.value
                ? "bg-[#2d8f98] text-white shadow-sm"
                : "border border-[rgba(65,200,198,0.25)] bg-white/70 text-[#4e7b83] hover:bg-white",
            )}
          >
            {tab.label}
            {tab.badge > 0 ? (
              <span
                className={cx(
                  "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold",
                  statusFilter === tab.value ? "bg-white/90 text-[#2d8f98]" : "bg-[#2d8f98] text-white",
                )}
              >
                {tab.badge > 9 ? "9+" : tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {statusFilter !== "changes" ? (
        <form onSubmit={applyDates} className="space-y-3 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-white/80 p-4">
          <p className="text-sm font-semibold text-slate-700">Requested date <span className="font-normal text-slate-500">· Mauritius time</span></p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:flex">
              <label className="flex min-w-0 flex-col gap-1 text-sm text-slate-600">
                From
                <input type="date" value={dateDraft.from} onChange={(event) => setDateDraft((current) => ({ ...current, from: event.target.value }))} className="min-w-0 w-full rounded-xl border border-[rgba(65,200,198,0.25)] bg-white px-3 py-2 text-sm text-slate-900 sm:w-44" />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-sm text-slate-600">
                To
                <input type="date" value={dateDraft.to} onChange={(event) => setDateDraft((current) => ({ ...current, to: event.target.value }))} className="min-w-0 w-full rounded-xl border border-[rgba(65,200,198,0.25)] bg-white px-3 py-2 text-sm text-slate-900 sm:w-44" />
              </label>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="flex-1 rounded-xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white sm:flex-none">Apply dates</button>
              {hasDateFilter || dateDraft.from || dateDraft.to ? <button type="button" onClick={clearDates} className="rounded-xl border border-[rgba(65,200,198,0.25)] px-4 py-2 text-sm font-semibold text-[#2d8f98]">Clear dates</button> : null}
            </div>
          </div>
          {dateError ? <p role="alert" className="text-sm text-red-700">{dateError}</p> : null}
          <p aria-live="polite" className="text-xs text-slate-500">
            {hasDateFilter
              ? dateSummary
              : "All dates. Use the same From and To date to find a single day."}
          </p>
        </form>
      ) : null}

      {!isDoctor && statusFilter === "active" && appointmentChangeCount > 0 ? (
        <button
          type="button"
          onClick={() => setStatusFilter("changes")}
          className="w-full rounded-2xl border border-[#2d8f98]/25 bg-[#2d8f98]/8 px-4 py-3 text-left text-sm font-semibold text-[#2d8f98] transition hover:bg-[#2d8f98]/12"
        >
          {appointmentChangeCount} appointment change{appointmentChangeCount === 1 ? "" : "s"} waiting for the clinic
        </button>
      ) : null}

      {arrivalNotice ? (
        <div
          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 shadow-sm"
          role="alert"
          aria-live="assertive"
        >
          {arrivalNotice} Open the first request and assign a doctor now.
        </div>
      ) : null}

      {statusFilter === "changes" ? (
        <AppointmentChangeInbox />
      ) : loading ? (
        <LoadingState label="Loading visit requests" />
      ) : loadError ? (
        <EmptyState title="Could not load visit requests" description={`${loadError} Use Refresh to try again.`} />
      ) : requests.length === 0 ? (
        <EmptyState
          title={hasDateFilter ? "No visits match these dates" : "No visit requests"}
          description={
            hasDateFilter
              ? "Try another date range, clear the dates, or choose All to include every visit status."
              : isDoctor
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
                isAdmin={isAdmin}
              />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
