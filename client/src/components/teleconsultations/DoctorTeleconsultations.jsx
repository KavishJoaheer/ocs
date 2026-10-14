import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, RefreshCw, Search, Video } from "lucide-react";
import { api } from "../../lib/api.js";
import { cx } from "../../lib/utils.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useLiveRefreshKey } from "../../hooks/useLiveRefreshKey.js";
import { useDraftNavigationProtection } from "../../hooks/useClinicalDraft.js";
import RequestCard from "./ClinicalRequestCard.jsx";
import EmptyState from "../EmptyState.jsx";
import LoadingState from "../LoadingState.jsx";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import PushNotificationBanner from "../PushNotificationBanner.jsx";
import "../doctor-workspace/doctorWorkspace.css";

const pill = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#d5e4e1] bg-white px-4 py-2 text-[#376168] hover:bg-[#edf9f7]";
const views = [{ id: "assigned", label: "Ready to call" }, { id: "in_consultation", label: "In consultation" }, { id: "history", label: "History" }];
const active = ["assigned", "in_consultation"];
const labels = { assigned: "Ready to call", in_consultation: "In consultation", completed: "Completed", cancelled: "Cancelled", referred: "In-person assessment" };
function viewFor(request) { return active.includes(request.status) ? request.status : "history"; }
function initials(name) { return String(name || "Patient").trim().split(/\s+/).map(part => part[0]).filter((_, index, parts) => index === 0 || index === parts.length - 1).join("").toUpperCase(); }

export default function DoctorTeleconsultations({ user }) {
  const [params] = useSearchParams();
  const parsedId = Number(params.get("request"));
  const requestedId = Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : null;
  const [requests, setRequests] = useState([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("assigned");
  const [selectedId, setSelectedId] = useState(requestedId || null);
  const [workspaceOpen, setWorkspaceOpen] = useState(Boolean(requestedId));
  const version = useRef(0);
  const resolvedRequest = useRef(null);
  const workspaceRef = useRef(null);
  const queueRef = useRef(null);
  const isMobile = useIsMobile(1024);
  const refreshKey = useLiveRefreshKey();
  useDraftNavigationProtection();

  const load = useCallback(async (manual = false) => {
    const generation = ++version.current;
    if (manual) setRefreshing(true);
    try {
      const response = await api.get("/teleconsultations");
      if (generation !== version.current) return;
      setRequests((response.requests || []).filter(request => Number(request.assigned_doctor_id) === Number(user.doctor_id)));
      setHasMoreHistory(Boolean(response.has_more_history));
      setError("");
    } catch (err) { if (generation === version.current) setError(err.message); }
    finally { if (generation === version.current) { setLoading(false); setRefreshing(false); } }
  }, [user.doctor_id]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => load(), 15000);
    return () => { window.clearInterval(timer); version.current += 1; };
  }, [load, refreshKey]);
  useEffect(() => {
    if (!requestedId || resolvedRequest.current === requestedId) return;
    const request = requests.find(item => Number(item.id) === requestedId);
    if (!request) { if (!loading) setWorkspaceOpen(false); return; }
    resolvedRequest.current = requestedId;
    setSelectedId(requestedId); setView(viewFor(request)); setWorkspaceOpen(true);
  }, [requestedId, requests, loading]);

  const matching = requests.filter(request => viewFor(request) === view && `${request.patient_name} ${request.patient_identifier} ${request.reason} ${request.callback_number}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = matching.find(request => request.id === selectedId) || (selectedId === null ? matching[0] : undefined);
  const missingRequest = !loading && selectedId !== null && !requests.some(request => request.id === selectedId);
  const showWorkspace = !isMobile || workspaceOpen;
  const openPatient = request => {
    setSelectedId(request.id); setWorkspaceOpen(true);
    if (isMobile) window.requestAnimationFrame(() => { workspaceRef.current?.focus(); workspaceRef.current?.scrollIntoView({ block: "start" }); });
  };
  const backToQueue = () => {
    setWorkspaceOpen(false);
    window.requestAnimationFrame(() => queueRef.current?.querySelector(`[data-request-id="${selected?.id}"]`)?.focus());
  };
  const updated = request => {
    // Invalidate any refresh that started before this confirmed action.
    version.current += 1;
    setRequests(current => current.map(item => item.id === request.id ? request : item));
    setSelectedId(request.id); setView(viewFor(request));
    void load();
  };

  return <div className="doctor-workspace space-y-4 text-[#173f4a] sm:space-y-5">
    <header className="flex items-center justify-between gap-3 rounded-[28px] bg-gradient-to-r from-[#e3f5f0] via-[#eef9f5] to-[#fff9ed] px-4 py-4 sm:px-6 sm:py-5">
      <div className="min-w-0"><p className="text-xs font-semibold text-[#137b80]">Your care workspace</p><h1 className="mt-1 text-xl font-bold tracking-tight sm:text-3xl">Teleconsultations</h1></div>
      <div className="flex shrink-0 items-center gap-1"><PushNotificationBanner role="doctor" compact /><AppUpdateBanner compact /><button type="button" aria-label="Refresh" disabled={refreshing} onClick={() => load(true)} className={`${pill} !px-3`}><RefreshCw className={cx("size-4", refreshing && "animate-spin")} aria-hidden="true" /></button></div>
    </header>
    <nav hidden={isMobile && workspaceOpen && selected && active.includes(selected.status)} aria-label="Teleconsultation views" className="flex flex-wrap gap-2">
      {views.map(tab => <button key={tab.id} type="button" aria-label={tab.label} aria-pressed={view === tab.id} onClick={() => { setView(tab.id); setSelectedId(null); setWorkspaceOpen(false); }} className={pill}>{tab.label}<span className="rounded-full bg-[#e6f2ef] px-2 py-0.5 text-xs text-[#376168]">{requests.filter(request => viewFor(request) === tab.id).length}</span></button>)}
    </nav>
    <label hidden={isMobile && workspaceOpen && selected && active.includes(selected.status)} className="relative block"><Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6d868b]" /><input aria-label="Search teleconsultations" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search patient, reason or mobile" className="min-h-11 w-full min-w-0 rounded-full border border-[#d5e4e1] bg-white py-3 pl-11 pr-4 text-base outline-none focus:border-[#137b80]" /></label>
    {missingRequest && !error && <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">This consultation is no longer available in your queue. Choose another patient or open their chart.</p>}
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-rose-50 p-4 text-sm text-red-800"><p>{error} {requests.length ? "Showing the last available requests." : ""}</p><button type="button" onClick={() => load(true)} className={pill}>Retry</button></div>}
    {loading ? <LoadingState label="Loading your teleconsultations" /> : <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(240px,0.75fr)_minmax(0,1.7fr)]">
      <section ref={queueRef} aria-label="Patient queue" hidden={isMobile && workspaceOpen} className="min-w-0 overflow-hidden rounded-[30px] border border-[#d5e4e1] bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-[#e3eeeb] px-4 py-4"><h2 className="text-sm font-semibold">Patient queue</h2><span className="flex items-center gap-1.5 text-xs text-[#5b7379]"><span className="size-2 rounded-full bg-[#21bdb6]" />Live</span></div>
        {matching.map(request => <button key={request.id} data-request-id={request.id} type="button" aria-label={`Open consultation for ${request.patient_name}`} aria-current={showWorkspace && selected?.id === request.id ? "true" : undefined} onClick={() => openPatient(request)} className={cx("flex min-h-24 w-full items-start gap-3 border-b border-[#e3eeeb] p-4 text-left last:border-0 hover:bg-[#f0faf6]", showWorkspace && selected?.id === request.id && "bg-[#edf8f3]")}>
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dff3ef] text-[#137b80]">{initials(request.patient_name)}</span>
          <span className="min-w-0 flex-1"><span className="block break-words text-base font-bold">{request.patient_name}</span>{view === "history" && <span className="mt-1 block text-xs text-[#137b80]">{labels[request.status]}</span>}<span className="mt-2 block whitespace-pre-wrap break-words text-sm font-normal leading-5 text-[#5b7379]">{request.reason}</span></span><ChevronRight className="mt-3 size-4 shrink-0 text-[#6d868b]" aria-hidden="true" />
        </button>)}
        {!matching.length && <EmptyState title={error && !requests.length ? "Could not load your queue" : query ? "No matching requests" : view === "assigned" ? "No patients waiting" : view === "in_consultation" ? "No consultations in progress" : "No consultation history yet"} description={error && !requests.length ? "Retry to check your assigned consultations." : query ? "Try another patient name or reason." : view === "history" ? "Completed and referred consultations will appear here." : "New consultations assigned to you appear automatically."} />}
        {view === "history" && hasMoreHistory && <p className="p-4 text-xs text-[#5b7379]">Showing recent history. Older records are available in patient charts.</p>}
      </section>
      <div ref={workspaceRef} tabIndex={-1} hidden={!showWorkspace} className="min-w-0 space-y-3 outline-none">
        {isMobile && <button type="button" onClick={backToQueue} className={pill}><ArrowLeft className="size-4" aria-hidden="true" />Back to queue</button>}
        {requests.map(request => <RequestCard key={`${user.id}-${request.id}`} workspace request={request} user={user} visible={selected?.id === request.id} onOpen={() => setWorkspaceOpen(true)} onUpdated={updated} />)}
        {!selected && <div className="hidden rounded-[30px] border border-dashed border-[#cde2de] p-10 text-center text-sm text-[#5b7379] lg:block"><Video aria-hidden="true" className="mx-auto mb-3 size-7 text-[#137b80]" />Select a patient to open their consultation.</div>}
      </div>
    </div>}
  </div>;
}
