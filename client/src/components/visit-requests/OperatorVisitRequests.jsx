import { useEffect, useRef, useState } from "react";
import { Bell, ChevronDown, ChevronRight, MapPin, Navigation, Phone, RefreshCw, SlidersHorizontal, UserRound } from "lucide-react";
import toast from "react-hot-toast";
import { cx } from "../../lib/utils.js";
import { setUnsavedWork } from "../../lib/unsavedWork.js";
import Modal from "../Modal.jsx";
import LoadingState from "../LoadingState.jsx";
import EmptyState from "../EmptyState.jsx";
import AppointmentChangeInbox from "../AppointmentChangeInbox.jsx";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import PushNotificationBanner from "../PushNotificationBanner.jsx";
import "./operatorVisitRequests.css";

const CLOSED = ["completed", "cancelled"];
const ATTENTION = ["pending", "acknowledged"];
const STAGES = [
  ["pending", "Request received"], ["acknowledged", "Reviewing"], ["assigned", "Doctor assigned"],
  ["en_route", "Doctor en route"], ["arrived", "Doctor arrived"], ["in_consultation", "In consultation"],
  ["completed", "Completed"], ["cancelled", "Cancelled"],
];
const NEXT = {
  assigned: ["en_route", "Mark en route"], en_route: ["arrived", "Mark arrived"],
  arrived: ["in_consultation", "Start consultation"], in_consultation: ["completed", "Complete visit"],
};
const pill = "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full border border-[#d5e4e1] bg-white px-4 py-2 text-sm font-semibold text-[#376168] transition hover:bg-[#edf9f7] disabled:opacity-50";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#137b80] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#106b70] disabled:cursor-not-allowed disabled:opacity-50";
const field = "min-h-11 w-full min-w-0 rounded-2xl border border-[#cde2de] bg-white px-3 py-2 text-base text-[#173f4a] outline-none focus:border-[#137b80]";
const statusLabel = request => STAGES.find(([value]) => value === request.status)?.[1] || request.status_label;
function timestamp(value) {
  const text = String(value || "");
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(" ", "T")}Z`) || 0;
}

function prioritise(a, b) {
  const rank = { emergency: 0, urgent: 1, routine: 2 };
  return (rank[a.urgency] ?? 2) - (rank[b.urgency] ?? 2)
    || timestamp(a.created_at) - timestamp(b.created_at) || a.id - b.id;
}

function RequestDetails({ request, doctors, doctorError, onRetryDoctors, onUpdate, readOnly, allowClosedEdits = false, onDirtyChange, UrgencyBadge, InsuranceCoverageBadge, SlaChip, now, formatRequestDate, visitForLabel }) {
  const locked = (CLOSED.includes(request.status) && !allowClosedEdits) || readOnly;
  const coverageBlocked = request.insurance_coverage?.is_linkham && request.insurance_coverage.allowed !== true;
  const [draft, setDraft] = useState(() => ({ doctor: String(request.assigned_doctor_id || ""), eta: request.eta_minutes ?? "", notes: request.staff_notes || "", status: request.status }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const serverKey = `${request.assigned_doctor_id}|${request.eta_minutes}|${request.staff_notes}|${request.status}`;
  const [syncedKey, setSyncedKey] = useState(serverKey);
  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    if (!dirty || locked) {
      setDraft({ doctor: String(request.assigned_doctor_id || ""), eta: request.eta_minutes ?? "", notes: request.staff_notes || "", status: request.status });
      setDirty(false);
    }
  }
  useEffect(() => {
    onDirtyChange(dirty);
    setUnsavedWork(`visit-request-${request.id}`, dirty);
    return () => { onDirtyChange(false); setUnsavedWork(`visit-request-${request.id}`, false); };
  }, [dirty, onDirtyChange, request.id]);

  function edit(patch) { setDraft(current => ({ ...current, ...patch })); setDirty(true); setError(""); }
  async function save(status) {
    if (busy.current || locked) return;
    const assigning = ATTENTION.includes(request.status) && status === "assigned";
    if ((assigning || ["assigned", "en_route", "completed"].includes(status)) && !draft.doctor) {
      setError("Choose a doctor before continuing."); return;
    }
    if (draft.eta !== "" && (!Number.isInteger(Number(draft.eta)) || Number(draft.eta) < 0)) {
      setError("Enter ETA as a whole number of minutes, or leave it blank."); return;
    }
    busy.current = true; setSaving(true); setError("");
    try {
      await onUpdate(request.id, {
        ...(draft.doctor !== String(request.assigned_doctor_id || "") ? { assigned_doctor_id: draft.doctor ? Number(draft.doctor) : null } : {}),
        ...(dirty ? { eta_minutes: draft.eta === "" ? null : Number(draft.eta), staff_notes: draft.notes } : {}),
        ...(status ? { status } : {}),
      });
      setDirty(false);
      toast.success(assigning ? "Doctor assigned." : "Visit request updated.");
    } catch (failure) { setError(failure?.message || "Could not update this request. Please retry."); }
    finally { busy.current = false; setSaving(false); }
  }
  const pending = ATTENTION.includes(request.status);
  const advance = pending ? ["assigned", "Assign doctor"] : NEXT[request.status];
  const blockedAdvance = coverageBlocked && (pending || ["assigned", "en_route"].includes(request.status));
  const blockedSave = coverageBlocked && (draft.doctor !== String(request.assigned_doctor_id || "") && Boolean(draft.doctor) || ["assigned", "en_route"].includes(draft.status) && draft.status !== request.status);

  return <div className="space-y-5 text-[#173f4a]">
    <div>
      <p className="text-xs font-medium text-[#5b7379]">Patient name</p>
      <h2 className="mt-1 break-words text-xl font-bold">{request.patient_name}</h2>
      {visitForLabel(request) ? <p className="mt-1 text-xs text-[#5b7379]">{visitForLabel(request)}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2"><UrgencyBadge urgency={request.urgency} /><SlaChip createdAt={request.created_at} now={now} escalate={pending} /><span className="rounded-full bg-[#edf6f3] px-2.5 py-1 text-xs font-medium">{statusLabel(request)}</span></div>
      <InsuranceCoverageBadge request={request} />
    </div>
    <dl className="space-y-4 text-sm">
      <div><dt className="text-xs font-medium text-[#137b80]">Address</dt><dd className="mt-1 flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-[#137b80]" aria-hidden="true" /><span className="break-words">{request.address || "No address provided"}</span></dd></div>
      <div><dt className="text-xs font-medium text-[#137b80]">Reason for visit</dt><dd className="mt-1 whitespace-pre-wrap break-words">{request.reason || "No reason provided"}</dd></div>
      <div><dt className="text-xs font-medium text-[#137b80]">Requested</dt><dd className="mt-1">{formatRequestDate(request.created_at)}{request.patient_identifier ? ` · ${request.patient_identifier}` : ""}</dd></div>
    </dl>
    <div className="flex flex-wrap gap-2">
      {request.patient_contact_number ? <a className={pill} href={`tel:${request.patient_contact_number}`} aria-label={`Call ${request.patient_name}`}><Phone className="size-4" aria-hidden="true" />Call patient</a> : null}
      {request.address ? <a className={pill} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(request.address)}`} target="_blank" rel="noopener noreferrer"><Navigation className="size-4" aria-hidden="true" />Directions</a> : null}
    </div>
    {locked ? <div className="space-y-3 border-t border-[#e3eeeb] pt-4 text-sm">
      <p className="font-medium">{CLOSED.includes(request.status) ? "Visit closed · Only an admin can edit this visit." : "Training mode · Changes cannot be saved."}</p>
      <p>{request.doctor_name || "Unassigned"}{request.eta_minutes != null ? ` · ${request.eta_minutes} min ETA` : ""}</p>
      <p className="whitespace-pre-wrap break-words text-[#5b7379]">{request.staff_notes || "No team notes"}</p>
    </div> : <>
      <div className="space-y-3 border-t border-[#e3eeeb] pt-4">
        <label className="block text-sm font-semibold">{pending ? "Assign doctor" : "Assigned doctor"}
          <select aria-label={pending ? "Assign doctor" : "Assigned doctor"} className={`${field} mt-2`} value={draft.doctor} disabled={saving || coverageBlocked} onChange={event => edit({ doctor: event.target.value })}>
            <option value="">Choose a doctor</option>
            {request.assigned_doctor_id && !doctors.some(doctor => Number(doctor.id) === Number(request.assigned_doctor_id)) ? <option value={String(request.assigned_doctor_id)}>{request.doctor_name || "Current doctor"}</option> : null}
            {doctors.map(doctor => <option key={doctor.id} value={String(doctor.id)}>{doctor.full_name}</option>)}
          </select>
        </label>
        {doctorError ? <p role="alert" className="text-xs text-red-800">{doctorError} <button type="button" className="min-h-11 font-semibold underline" onClick={onRetryDoctors}>Retry doctors</button></p> : null}
        {coverageBlocked ? <p className="rounded-2xl bg-rose-50 p-3 text-xs leading-5 text-rose-800">Insurance coverage must be confirmed before assigning a doctor or sending them en route.</p> : null}
        {advance ? <button type="button" className={`${primary} w-full`} disabled={saving || blockedAdvance || !draft.doctor} onClick={() => save(advance[0])}>{saving ? "Updating…" : advance[1]}</button> : null}
        {request.status === "pending" ? <button type="button" className={`${pill} w-full`} disabled={saving} onClick={() => save("acknowledged")}>Mark reviewing</button> : null}
      </div>
      <details className="group border-t border-[#e3eeeb] pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">ETA & team notes<ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden="true" /></summary>
        <div className="space-y-3 pt-2">
          <label className="block text-xs font-semibold">ETA in minutes<input type="number" min="0" step="1" inputMode="numeric" value={draft.eta} disabled={saving} onChange={event => edit({ eta: event.target.value })} className={`${field} mt-1.5`} placeholder="e.g. 25" /></label>
          <div><label htmlFor={`dispatch-notes-${request.id}`} className="block text-xs font-semibold">Team notes</label><textarea id={`dispatch-notes-${request.id}`} rows={3} value={draft.notes} disabled={saving} onChange={event => edit({ notes: event.target.value })} className={`${field} mt-1.5 resize-y`} placeholder="Add coordination notes" /></div>
        </div>
      </details>
      <details className="group border-t border-[#e3eeeb] pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">Change status<ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden="true" /></summary>
        <label className="mt-2 block text-xs font-semibold">Visit status<select aria-label="Visit status" className={`${field} mt-1.5`} value={draft.status} disabled={saving} onChange={event => edit({ status: event.target.value })}>{STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </details>
      {dirty ? <button type="button" className={`${pill} w-full`} disabled={saving || blockedSave} onClick={() => save(draft.status !== request.status ? draft.status : undefined)}>{saving ? "Saving…" : "Save changes"}</button> : null}
    </>}
    {error ? <p role="alert" className="rounded-2xl bg-rose-50 p-3 text-sm text-red-800">{error}</p> : null}
  </div>;
}

export default function OperatorVisitRequests({ requests, doctors, doctorError, onRetryDoctors, onUpdate, now, isMobile, loading, refreshing, loadError, lastUpdated, onRefresh, statusFilter, onStatusFilter, appointmentChangeCount, arrivalNotice, renderDateFilter, hasDateFilter, readOnly, allowClosedEdits = false, UrgencyBadge, InsuranceCoverageBadge, SlaChip, formatRequestDate, visitForLabel }) {
  const [view, setView] = useState("attention");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailDirty, setDetailDirty] = useState(false);
  const [detailVersion, setDetailVersion] = useState(0);
  const [confirmAction, setConfirmAction] = useState(null);
  const needsAttention = requests.filter(request => ATTENTION.includes(request.status)).sort(prioritise);
  const inProgress = requests.filter(request => !ATTENTION.includes(request.status) && !CLOSED.includes(request.status)).sort(prioritise);
  const history = requests.filter(request => CLOSED.includes(request.status) && (historyStatus === "all" || request.status === historyStatus));
  const visible = view === "attention" ? needsAttention : view === "progress" ? inProgress : history;
  const selected = visible.find(request => request.id === selectedId) || (!isMobile ? visible[0] : null);
  const changes = statusFilter === "changes";
  const detailsProps = { doctors, doctorError, onRetryDoctors, onUpdate, readOnly, allowClosedEdits, onDirtyChange: setDetailDirty, UrgencyBadge, InsuranceCoverageBadge, SlaChip, now, formatRequestDate, visitForLabel };
  function guard(action) { if (detailDirty) setConfirmAction(() => action); else action(); }
  function changeView(next) { guard(() => { setDetailDirty(false); setSelectedId(null); setMobileOpen(false); setView(next); onStatusFilter(next === "history" ? "all" : "active"); }); }
  function openRequest(id) { guard(() => { setDetailDirty(false); setSelectedId(id); setMobileOpen(true); }); }
  const emptyTitle = hasDateFilter ? "No visits match these dates" : view === "attention" ? "No requests waiting" : view === "progress" ? "No visits in progress" : "No visit history yet";

  const liveBadge = <span className={cx("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold", loadError ? "bg-amber-50 text-amber-900" : "bg-[#def7ef] text-[#137b80]")}><span className={cx("size-2 rounded-full", loadError ? "bg-amber-500" : "bg-[#14b88b]")} />{loadError ? "Connection issue" : loading ? "Connecting" : "Live"}</span>;

  return <section aria-label="Operator visit requests" className="operator-visit-requests mx-auto w-full min-w-0 max-w-7xl space-y-5 pb-4 text-[#173f4a]">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Home Visit Request</h1>{!isMobile ? liveBadge : null}</div>
      <div className="flex items-center gap-2">
        {!readOnly ? <PushNotificationBanner role="operator" compact /> : null}<AppUpdateBanner compact />
        <button type="button" aria-label="Refresh visit requests" className={`${pill} px-3`} disabled={loading || refreshing} onClick={onRefresh}><RefreshCw className={cx("size-4", refreshing && "animate-spin")} aria-hidden="true" /></button>
      </div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Home visit request views" className={isMobile ? "flex flex-wrap gap-2" : "flex flex-wrap gap-1 rounded-[26px] border border-[#d8ebe7] bg-white/70 p-1"}>
        {[{ value: "attention", label: "Needs attention", count: needsAttention.length }, { value: "progress", label: "In progress", count: inProgress.length }, { value: "history", label: "History" }].map(tab => <button key={tab.value} type="button" aria-pressed={!changes && view === tab.value} onClick={() => changeView(tab.value)} className={cx("inline-flex min-h-11 items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition sm:px-4 sm:text-sm", !changes && view === tab.value ? "bg-[#137b80] text-white shadow-sm" : "text-[#376168] hover:bg-[#edf9f7]", isMobile && (view === tab.value && !changes ? "border border-[#137b80]" : "border border-[#d8ebe7] bg-white/70"))}>{tab.label}{tab.count != null ? <span className={cx("rounded-full px-2 py-0.5 text-xs tabular-nums", !changes && view === tab.value ? "bg-white/20" : "bg-[#eaf3f1]")}>{loading ? "…" : tab.count}</span> : null}</button>)}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        {isMobile ? liveBadge : null}
        <button type="button" className={cx(pill, changes && "border-[#137b80] bg-[#edf9f7]")} aria-pressed={changes} onClick={() => guard(() => { setDetailDirty(false); setMobileOpen(false); onStatusFilter("changes"); })}><Bell className="size-4" aria-hidden="true" />Changes{appointmentChangeCount > 0 ? <span className="rounded-full bg-[#dff3ef] px-2 py-0.5 text-xs tabular-nums">{appointmentChangeCount}</span> : null}</button>
        {!changes ? <button type="button" className={pill} aria-expanded={filtersOpen} aria-controls="operator-visit-filters" onClick={() => guard(() => setFiltersOpen(open => !open))}><SlidersHorizontal className="size-4" aria-hidden="true" />Filters{hasDateFilter ? <span className="size-2 rounded-full bg-[#137b80]" aria-label="Date filter applied" /> : null}</button> : null}
      </div>
    </div>
    {!changes && filtersOpen ? <div id="operator-visit-filters">{renderDateFilter(guard)}</div> : null}
    {!changes && hasDateFilter && !filtersOpen ? <p className="text-xs text-[#5b7379]">Date filter applied · Open Filters to change or clear it.</p> : null}
    {arrivalNotice ? <p role="alert" className="rounded-2xl border border-[#b9e5d9] bg-[#edf9f7] px-4 py-3 text-sm font-semibold">{arrivalNotice}</p> : null}
    {changes ? <AppointmentChangeInbox /> : <>
      {loadError ? <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-red-800">{loadError} {requests.length ? "Showing the last loaded requests." : ""} <button type="button" onClick={onRefresh} className="min-h-11 font-semibold underline">Retry requests</button></p> : null}
      {loading ? <LoadingState label="Loading visit requests" /> : !visible.length ? <EmptyState title={loadError && !requests.length ? "Requests unavailable" : emptyTitle} description={loadError && !requests.length ? "Retry to load visit requests." : hasDateFilter ? "Try another date range or clear the dates in Filters." : view === "history" ? "Completed and cancelled visits will appear here." : "New requests and visit updates appear here automatically."} /> : <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3 xl:rounded-[26px] xl:border xl:border-[#d8ebe7] xl:bg-white/50 xl:p-3">
          <ul aria-label={view === "attention" ? "Requests needing attention" : view === "progress" ? "Visits in progress" : "Visit history"} className="space-y-3">
            {visible.map(request => <li key={request.id} className="min-w-0"><button type="button" aria-label={`Open request for ${request.patient_name}`} aria-current={!isMobile && selected?.id === request.id ? "true" : undefined} onClick={() => openRequest(request.id)} className={cx("w-full min-w-0 rounded-[22px] border bg-white p-4 text-left transition hover:border-[#72bfb8] focus-visible:outline-2 focus-visible:outline-[#137b80]", !isMobile && selected?.id === request.id ? "border-[#52b8ac] bg-[#f0faf7]" : "border-[#d8ebe7]")}>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2"><h2 className="min-w-0 break-words text-base font-bold">{request.patient_name}</h2><div className="flex flex-wrap items-center gap-2"><UrgencyBadge urgency={request.urgency} /><SlaChip createdAt={request.created_at} now={now} escalate={ATTENTION.includes(request.status)} /></div></div>
              {visitForLabel(request) ? <p className="mt-1 text-xs text-[#5b7379]">{visitForLabel(request)}</p> : null}
              <p className="mt-2 whitespace-pre-wrap break-words text-sm font-normal leading-5 text-[#376168]">{request.reason || "No reason provided"}</p>
              <p className="mt-2 flex items-start gap-2 text-xs font-normal leading-5 text-[#5b7379]"><MapPin className="mt-0.5 size-3.5 shrink-0 text-[#137b80]" aria-hidden="true" /><span className="min-w-0 break-words">{request.address || "No address provided"}</span></p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2 text-xs text-[#376168]"><UserRound className="size-4 shrink-0" aria-hidden="true" /><span className="break-words">{request.doctor_name || "Unassigned"}</span></span>{isMobile ? <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#137b80] px-4 py-2 text-xs font-semibold text-white">{!readOnly && ATTENTION.includes(request.status) ? "Assign doctor" : "View details"}<ChevronRight className="size-3.5" aria-hidden="true" /></span> : <ChevronRight className="size-4 shrink-0 text-[#137b80]" aria-hidden="true" />}</div>
              {!ATTENTION.includes(request.status) ? <p className="mt-2 text-xs font-medium text-[#137b80]">{statusLabel(request)}{request.eta_minutes != null && !CLOSED.includes(request.status) ? ` · ${request.eta_minutes} min ETA` : ""}</p> : null}
              {request.insurance_coverage?.is_linkham ? <div className="mt-2"><InsuranceCoverageBadge request={request} /></div> : null}
            </button></li>)}
          </ul>
        </div>
        {!isMobile && selected ? <aside aria-label="Request details" className="min-w-0 rounded-[26px] border border-[#d8ebe7] bg-white p-5 lg:sticky lg:top-4"><h2 className="mb-5 text-lg font-bold">Request details</h2><RequestDetails key={`${selected.id}-${detailVersion}`} request={selected} {...detailsProps} /></aside> : null}
      </div>}
      {view === "history" ? <label className="flex flex-wrap items-center gap-2 text-sm text-[#376168]">History status<select aria-label="History status" className="min-h-11 rounded-full border border-[#d5e4e1] bg-white px-4 py-2" value={historyStatus} onChange={event => guard(() => setHistoryStatus(event.target.value))}><option value="all">Completed & cancelled</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label> : null}
      {!loading && lastUpdated && !loadError ? <p className="flex items-center gap-2 text-xs text-[#5b7379]"><span className="size-2 rounded-full bg-[#14b88b]" />{refreshing ? "Refreshing…" : `Updated ${new Date(lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}</p> : null}
    </>}
    <Modal open={Boolean(isMobile && mobileOpen && selected && !loading && !changes)} onClose={() => guard(() => { setDetailDirty(false); setMobileOpen(false); })} title="Request details" size="md">
      {isMobile && selected ? <RequestDetails key={`${selected.id}-${detailVersion}`} request={selected} {...detailsProps} /> : null}
    </Modal>
    <Modal open={Boolean(confirmAction)} onClose={() => setConfirmAction(null)} title="Discard visit changes?" size="sm">
      <p className="text-sm text-[#5b7379]">Your edits have not been saved.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={pill} onClick={() => setConfirmAction(null)}>Continue editing</button><button type="button" className={primary} onClick={() => { const action = confirmAction; setConfirmAction(null); setDetailDirty(false); setDetailVersion(version => version + 1); action?.(); }}>Discard changes</button></div>
    </Modal>
  </section>;
}
