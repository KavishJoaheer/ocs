import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BellRing, Search, X } from "lucide-react";
import PatientWorkspaceHeader from "../components/patient-workspace/PatientWorkspaceHeader.jsx";
import PendingActionCard from "../components/pending-actions/PendingActionCard.jsx";
import ResponsiveFilterPanel from "../components/ResponsiveFilterPanel.jsx";
import "../components/pending-actions/pendingActions.css";
import { api } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";
const field = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800";
const targetLabels = {
  dispatch_minutes: "Routine dispatch (minutes)", urgent_dispatch_minutes: "Urgent dispatch / report review (minutes)",
  assignment_minutes: "Doctor acknowledgement (minutes)", start_minutes: "Dispatch assignment / consultation start (minutes)",
  escalation_minutes: "Further escalation after (minutes)", report_hours: "Routine report review (hours)", supply_hours: "Supply request acceptance (hours)",
};
function formatTime(value) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Indian/Mauritius" }).format(new Date(value)) : "—";
}

export default function ActionInboxPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState("active");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(Number(params.get("task")) || null);
  const [history, setHistory] = useState({});
  const [historyError, setHistoryError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [note, setNote] = useState("");
  const [nextOwner, setNextOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [policyDraft, setPolicyDraft] = useState(null);
  const [saved, setSaved] = useState("");
  const generation = useRef(0);
  useEffect(() => { document.title = "Pending actions · OCS Médecins"; }, []);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const load = useCallback(async () => {
    const id = ++generation.current;
    try {
      const result = await api.get(`/operational-tasks?status=${view}`);
      if (id === generation.current) { setData(result); setError(""); }
      return result;
    } catch (failure) { if (id === generation.current) setError(failure.message); }
    finally { if (id === generation.current) setLoading(false); }
  }, [view]);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 30000);
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    return () => { clearInterval(timer); window.removeEventListener("focus", load); window.removeEventListener("online", load); invalidate(); };
  }, [load, invalidate]);
  const loadHistory = useCallback(async id => {
    try { const result = await api.get(`/operational-tasks/${id}/events`); setHistory(previous => ({ ...previous, [id]: result })); setHistoryError(""); }
    catch (failure) { setHistoryError(failure.message); }
  }, []);
  useEffect(() => { if (selected) void loadHistory(selected); }, [selected, loadHistory]);
  async function refresh() { setRefreshing(true); try { await load(); if (selected) await loadHistory(selected); } finally { setRefreshing(false); } }
  function ask(task, action) { setDialog({ task, action }); setNote(""); setNextOwner(""); setError(""); }
  async function act(task, action, extra = {}) {
    setBusy(true); setError("");
    try {
      await api.patch(`/operational-tasks/${task.id}`, { revision: task.revision, action, ...extra });
      setDialog(null); await load(); await loadHistory(task.id);
      window.dispatchEvent(new Event("ocs-actions-updated"));
    } catch (failure) {
      await load(); setError(failure.message); setDialog(null);
    }
    finally { setBusy(false); }
  }
  async function savePolicy(event) {
    event.preventDefault(); setBusy(true); setSaved(""); setError("");
    try {
      await api.put("/operational-tasks/policy", policyDraft || data.policy);
      setPolicyDraft(null); setSaved("Response targets saved. New work will use these targets."); await load();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const tasks = (data?.tasks || []).filter(task => (filter === "all" || (filter === "mine" && Number(task.owner_user_id) === Number(user.id))
    || (filter === "overdue" && task.overdue) || (filter === "unowned" && !task.owner_user_id) || (filter === "escalated" && task.escalation_level > 0))
    && (!search.trim() || [task.title, task.patient_name, task.owner_name, `#${task.id}`].some(value => String(value || "").toLowerCase().includes(search.trim().toLowerCase()))))
    .sort((a, b) => view === "resolved" ? 0 : Number(b.priority === "urgent") - Number(a.priority === "urgent")
      || Number(b.overdue) - Number(a.overdue) || Number(b.escalation_level) - Number(a.escalation_level)
      || Date.parse(a.response_due_at) - Date.parse(b.response_due_at));
  const policy = policyDraft || data?.policy;
  const filters = [
    { value: "all", label: "All pending", count: data?.counts.open || 0 },
    { value: "mine", label: "Mine", count: data?.counts.mine || 0 },
    { value: "overdue", label: "Overdue", count: data?.counts.overdue || 0, attention: true },
    { value: "unowned", label: "Needs owner", count: data?.counts.unowned || 0, attention: true },
    { value: "escalated", label: "Escalated", count: data?.counts.escalated || 0, attention: true },
  ];
  return <section className="pending-actions mx-auto w-full max-w-6xl space-y-4" aria-label="Pending actions">
    <PatientWorkspaceHeader title="Pending actions" subtitle="Requests, reviews and team tasks." role={user.role}
      onRefresh={refresh} refreshing={refreshing || loading} refreshLabel="Refresh actions" />
    <ResponsiveFilterPanel label="Action filters" active={filter !== "all"}><nav className="pending-filter-pills" aria-label="Pending action filters">
      {filters.map(item => <button key={item.value} type="button" className="pending-filter-pill"
        aria-pressed={view === "active" && filter === item.value} data-attention={Boolean(item.attention && item.count)}
        onClick={() => { if (view !== "active") setLoading(true); setView("active"); setFilter(item.value); }}>
        {item.label}<strong>{item.count}</strong>
      </button>)}
    </nav></ResponsiveFilterPanel>
    <div>
      <div className="pending-action-toolbar">
        <nav className="pending-action-tabs" aria-label="Pending action views">
          {["active", "resolved"].map(value => <button key={value} type="button" aria-pressed={view === value}
            onClick={() => { if (value !== view) { setLoading(true); setView(value); setFilter("all"); } }}>
            {value === "active" ? "Pending" : "Resolved"}
          </button>)}
        </nav>
        {view === "resolved" && <label><span className="sr-only">Filter actions</span><select className={field} value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">All resolved</option><option value="mine">Assigned to me</option>
        </select></label>}
        <label className="pending-action-search">
          <span className="sr-only">Search actions</span><Search size={17} aria-hidden="true" />
          <input type="search" placeholder="Find patient, action or owner" value={search} onChange={event => setSearch(event.target.value)} />
          {search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={16} aria-hidden="true" /></button>}
        </label>
      </div>
      <div className="pending-actions-help">{!loading && <span>{tasks.length} action{tasks.length === 1 ? "" : "s"} shown</span>}
        <span>Acknowledging keeps the task open.</span><span>Times shown in Mauritius time.</span>
      </div>
    </div>
    {error && <div role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">{error}<button className="ml-3 underline" onClick={refresh}>Retry</button></div>}
    {data?.worker && (data.worker.last_error || !data.worker.last_success_at || Date.now() - Date.parse(data.worker.last_success_at) > 180000) && <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">Scheduled notification checks have not completed recently. Ask the system administrator to check the service; open work remains visible here.</p>}
    {loading ? <p role="status">Loading actions…</p> : tasks.length ? <div className="pending-action-list">
      {tasks.map(task => <PendingActionCard key={task.id} task={task} user={user} busy={busy} selected={selected === task.id}
        onAcknowledge={() => act(task, "acknowledge")} onAsk={action => ask(task, action)}
        onHistory={() => setSelected(selected === task.id ? null : task.id)} formatTime={formatTime}>
        {historyError && <p role="alert" className="text-rose-700">{historyError}<button className="ml-2 underline" onClick={() => loadHistory(task.id)}>Retry history</button></p>}
        {!history[task.id] ? <p role="status">Loading history…</p> : <>
          <ol className="space-y-2">{history[task.id].events.map(entry => <li key={entry.id}>
            <strong>{entry.action.replaceAll("_", " ")}</strong> · {formatTime(entry.created_at)} · {entry.actor_name || "OCS workflow"}
            {entry.note && <p className="mt-1 whitespace-pre-wrap break-words">{entry.note}</p>}
          </li>)}</ol>
          {history[task.id].deliveries.some(d => d.status === "failed") && <p className="mt-3 text-amber-800">Push could not reach at least one recipient. This task remains available here and delivery will be retried.</p>}
          {history[task.id].deliveries.some(d => d.status === "accepted") && <p className="mt-3">Push service accepted a notification. This does not confirm that its recipient read or acknowledged it.</p>}
        </>}
      </PendingActionCard>)}
    </div> : <div className="pending-actions-empty"><BellRing size={26} aria-hidden="true" />
      <p>{search || filter !== "all" ? "No actions match these filters." : view === "resolved" ? "No resolved actions yet." : "No actions need attention."}</p>
      {(search || filter !== "all") && <button type="button" className="pending-control mt-4" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</button>}
    </div>}
    {selected && data && !data.tasks.some(t => t.id === selected) && <p role="status" className="text-sm text-slate-600">The linked action has moved on or is no longer in this view. Check Resolved or your current work above.</p>}
    {user.role === "admin" && policy && <details className="pending-actions-settings"><summary className="min-h-11 cursor-pointer font-semibold text-slate-800">Response targets and escalation supervisor</summary>
      <p className="mt-2 text-sm text-slate-600">These are adjustable operational starting targets. They do not replace clinical judgement or direct contact for urgent care. Targets apply to new work; existing deadlines remain unchanged. Reviews are due by 17:00 Mauritius time on their scheduled date.</p>
      <form onSubmit={savePolicy} className="mt-4 space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(targetLabels).map(([key, label]) => <label key={key} className="text-sm font-medium text-slate-700">{label}<input className={`${field} mt-1`} type="number" min="1" max={key.endsWith("hours") ? 168 : 1440} step="1" required value={policy[key]} disabled={user.is_read_only} onChange={event => setPolicyDraft({ ...policy, [key]: Number(event.target.value) })} /></label>)}
        <label className="text-sm font-medium text-slate-700">Escalation supervisor<select className={`${field} mt-1`} value={policy.supervisor_user_id || ""} disabled={user.is_read_only} onChange={event => setPolicyDraft({ ...policy, supervisor_user_id: Number(event.target.value) || null })}><option value="">Available administrator</option>{data.owners.filter(owner => owner.role === "admin").map(owner => <option key={owner.id} value={owner.id}>{owner.full_name}</option>)}</select></label></div>
        <button className={button} disabled={busy || user.is_read_only}>Save response targets</button>{saved && <p role="status" className="text-sm text-teal-800">{saved}</p>}
      </form>
    </details>}
    <ConfirmDialog open={Boolean(dialog)} onClose={() => !busy && setDialog(null)} busy={busy} tone="normal"
      title={dialog?.action === "handover" ? "Hand over responsibility" : dialog?.action === "decline" ? "Return assignment to dispatch" : dialog?.action === "flag_urgent" ? "Flag this report for urgent review" : "Record clinical review outcome"}
      description={dialog?.action === "resolve" ? "Record what was reviewed, the outcome, and who owns any next step." : dialog?.action === "flag_urgent" ? "Record why review is urgent and the direct contact or escalation needed. OCS does not classify report values automatically." : "Explain the handover so the next person can continue the work."}
      confirmLabel={dialog?.action === "resolve" ? "Save outcome and resolve" : dialog?.action === "decline" ? "Return to dispatch" : dialog?.action === "flag_urgent" ? "Flag urgent review" : "Confirm handover"}
      confirmDisabled={!note.trim() || (dialog?.action === "handover" && !nextOwner)}
      onConfirm={() => act(dialog.task, dialog.action, { note, owner_user_id: Number(nextOwner) || undefined })}>
      {dialog?.action === "handover" && <label className="block text-sm font-medium">Next owner<select className={`${field} mt-1`} value={nextOwner} onChange={event => setNextOwner(event.target.value)}><option value="">Select a team member</option>{(data?.owners || []).filter(owner => [dialog.task.owner_role, "admin"].includes(owner.role) && owner.id !== dialog.task.owner_user_id).map(owner => <option key={owner.id} value={owner.id}>{owner.full_name}</option>)}</select></label>}
      <label className="block text-sm font-medium">Action note<textarea className={`${field} mt-1`} rows="3" maxLength="2000" value={note} onChange={event => setNote(event.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    </ConfirmDialog>
  </section>;
}
