import { useState } from "react";
import { ChevronDown, LayoutGrid, List, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { cx } from "../../lib/utils.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { hasUnsavedWork } from "../../lib/unsavedWork.js";
import LoadingState from "../LoadingState.jsx";
import EmptyState from "../EmptyState.jsx";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import PushNotificationBanner from "../PushNotificationBanner.jsx";
import "../doctor-workspace/doctorWorkspace.css";

const pill = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#d5e4e1] bg-white px-4 py-2 text-[#376168] hover:bg-[#edf9f7]";
const stages = [{ id: "assigned", label: "Ready to go" }, { id: "en_route", label: "On the way" }, { id: "arrived", label: "Arrived" }, { id: "in_consultation", label: "In consultation" }];
export default function DoctorHomeVisits({ user, requests, loading, refreshing, loadError, onRefresh, statusFilter, onStatusFilter, renderDateFilter, hasDateFilter, Card, onUpdate }) {
  const [query, setQuery] = useState("");
  const [board, setBoard] = useState(false);
  const mobile = useIsMobile();
  const history = statusFilter !== "active";
  function guard(action) {
    if (!hasUnsavedWork() || window.confirm("You have unsaved visit details. Discard these changes?")) action();
  }
  const visits = requests.filter(request => Number(request.assigned_doctor_id) === Number(user.doctor_id) && (history ? ["completed", "cancelled"].includes(request.status) : stages.some(stage => stage.id === request.status)))
    .filter(request => `${request.patient_name} ${request.reason} ${request.address}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => ({ emergency: 0, urgent: 1, routine: 2 }[a.urgency] ?? 2) - ({ emergency: 0, urgent: 1, routine: 2 }[b.urgency] ?? 2) || a.id - b.id);
  return <div className="doctor-workspace space-y-4 text-[#173f4a] sm:space-y-5">
    <header className="flex items-center justify-between gap-3 rounded-[28px] bg-gradient-to-r from-[#e3f5f0] via-[#eef9f5] to-[#fff9ed] px-4 py-4 sm:px-6 sm:py-5">
      <div><p className="text-xs font-semibold text-[#137b80]">Your care workspace</p><h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Home visits</h1></div>
      <div className="flex shrink-0 items-center gap-1"><PushNotificationBanner compact role="doctor" /><AppUpdateBanner compact /><button type="button" aria-label="Refresh visit requests" disabled={refreshing} onClick={onRefresh} className={`${pill} !px-3`}><RefreshCw aria-hidden="true" className={cx("size-4", refreshing && "animate-spin")} /></button></div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Home visit views" className="flex gap-2">{[{ id: "active", label: "Active visits" }, { id: "all", label: "History" }].map(tab => <button key={tab.id} aria-pressed={tab.id === "active" ? !history : history} type="button" onClick={() => guard(() => onStatusFilter(tab.id))} className={pill}>{tab.label}</button>)}</nav>
      {!mobile && !history && <div className="flex gap-1 rounded-full bg-[#e6f2ef] p-1" aria-label="Visit layout"><button aria-label="List view" aria-pressed={!board} type="button" onClick={() => guard(() => setBoard(false))} className={cx(pill, "!border-0 !px-3", board && "!bg-transparent")}><List className="size-4" />List</button><button aria-label="Board view" aria-pressed={board} type="button" onClick={() => guard(() => setBoard(true))} className={cx(pill, "!border-0 !px-3", !board && "!bg-transparent")}><LayoutGrid className="size-4" />Board</button></div>}
    </div>
    <label className="relative block"><Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6d868b]" aria-hidden="true" /><input aria-label="Search home visits" value={query} onChange={event => guard(() => setQuery(event.target.value))} placeholder="Search patient, reason or address" className="min-h-11 w-full min-w-0 rounded-full border border-[#d5e4e1] bg-white py-3 pl-11 pr-4 text-base outline-none focus:border-[#137b80]" /></label>
    <details className="group rounded-3xl border border-[#d5e4e1] bg-white/70"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-[#5b7379] [&::-webkit-details-marker]:hidden"><SlidersHorizontal className="size-4" aria-hidden="true" />{hasDateFilter ? "Date filter applied" : "Filter by date"}<ChevronDown className="ml-auto size-4 group-open:rotate-180" aria-hidden="true" /></summary>{renderDateFilter(guard)}</details>
    {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-red-800"><p>{loadError} {visits.length ? "Showing the last available visits." : ""}</p><button className={pill} type="button" onClick={onRefresh}>Retry</button></div>}
    {loading ? <LoadingState label="Loading home visits" /> : !visits.length ? <EmptyState title={hasDateFilter ? "No visits match these dates" : query ? "No matching visits" : history ? "No visit history yet" : "No active visits"} description={hasDateFilter ? "Try another date range or clear the dates to see your visits." : "Home visits assigned to you appear here automatically."} /> : <section aria-label={history ? "Visit history" : "Active visits"} className="space-y-3">
      <p aria-live="polite" className="px-1 text-xs text-[#5b7379]">{visits.length} {history ? "past" : "active"} visit{visits.length === 1 ? "" : "s"}{hasDateFilter ? " · Filtered by date" : ""}</p>
      {board && !mobile && !history ? <div className="doctor-visits-board">{stages.map(stage => <section key={stage.id} aria-label={stage.label} className="min-w-0 space-y-3 rounded-[28px] bg-[#eaf4f0] p-3"><h2 className="flex items-center justify-between px-1 text-sm font-bold">{stage.label}<span className="rounded-full bg-white px-2 py-1 text-xs">{visits.filter(visit => visit.status === stage.id).length}</span></h2>{visits.filter(visit => visit.status === stage.id).map(visit => <Card key={visit.id} request={visit} onUpdate={onUpdate} readOnly={user.is_read_only} />)}</section>)}</div> : visits.map(visit => <Card key={visit.id} request={visit} onUpdate={onUpdate} readOnly={user.is_read_only} />)}
    </section>}
  </div>;
}
