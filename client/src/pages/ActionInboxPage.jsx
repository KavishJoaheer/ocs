import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BellRing, Check, RefreshCw } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";
const primaryButton = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-teal-700 bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
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
    && (!search.trim() || [task.title, task.patient_name, task.owner_name, `#${task.id}`].some(value => String(value || "").toLowerCase().includes(search.trim().toLowerCase()))));
  const policy = policyDraft || data?.policy;
  return <section className="mx-auto w-full max-w-6xl space-y-5" aria-label="Action inbox">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold text-teal-700">OCS operations</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Action inbox</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">Accept responsibility, act in the linked workflow, and hand over anything that remains open. Acknowledging an alert does not complete the work.</p></div>
      <button className={button} onClick={refresh} disabled={refreshing || loading}><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />Refresh actions</button>
    </header>
    {data && <div className="flex flex-wrap gap-3 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-700" aria-label="Action counts">
      <span><strong>{data.counts.open}</strong> open</span><span><strong>{data.counts.mine}</strong> mine</span><span><strong>{data.counts.overdue}</strong> overdue</span><span><strong>{data.counts.unowned}</strong> without an owner</span><span><strong>{data.counts.escalated}</strong> escalated</span>
    </div>}
    <div className="flex flex-wrap items-center gap-3">
      <nav className="flex gap-2" aria-label="Action inbox views">{["active", "resolved"].map(value => <button key={value} className={button} aria-pressed={view === value} onClick={() => { if (value !== view) { setLoading(true); setView(value); setFilter("all"); } }}>{value === "active" ? "Active" : "Resolved"}</button>)}</nav>
      <label className="min-w-40"><span className="sr-only">Filter actions</span><select className={field} value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All actions</option><option value="mine">Assigned to me</option>{view === "active" && <><option value="overdue">Overdue</option><option value="unowned">Without an owner</option><option value="escalated">Escalated</option></>}</select></label>
      <label className="min-w-0 flex-1"><span className="sr-only">Search actions</span><input className={field} type="search" placeholder="Find patient, action or owner" value={search} onChange={event => setSearch(event.target.value)} /></label>
    </div>
    {error && <div role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{error}<button className="ml-3 underline" onClick={refresh}>Retry</button></div>}
    {data?.worker && (data.worker.last_error || !data.worker.last_success_at || Date.now() - Date.parse(data.worker.last_success_at) > 180000) && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Scheduled notification checks have not completed recently. Ask the system administrator to check the service; open work remains visible here.</p>}
    {loading ? <p role="status">Loading actions…</p> : tasks.length ? <div className="space-y-3">{tasks.map(task => <article key={task.id} aria-label={`Action ${task.id}`} className={`rounded-2xl border bg-white p-4 ${task.overdue || task.priority === "urgent" ? "border-amber-300" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-base font-semibold text-slate-900">{task.title}</h2>{task.patient_name && <p className="mt-1 text-sm text-slate-600">{task.patient_name}</p>}
          <p className="mt-2 text-sm text-slate-600">Owner: <strong>{task.owner_name || "Needs an owner"}</strong> · {task.status === "acknowledged" ? "Acknowledged; work remains open" : task.status === "resolved" ? "Resolved" : "Awaiting acknowledgement"}</p>
          <p className="mt-1 text-xs text-slate-500">{task.status === "resolved" ? `Resolved ${formatTime(task.resolved_at)}` : `${task.acknowledged_at ? "Action" : "Acknowledgement"} due ${formatTime(task.response_due_at)}`} · Mauritius time</p>
          {(task.overdue || task.escalation_level > 0 || task.priority === "urgent") && <p className="mt-2 text-sm font-semibold text-amber-800">{[task.priority === "urgent" && "Urgent review", task.overdue && "Overdue", task.escalation_level > 0 && `Escalated to supervisor (level ${task.escalation_level})`].filter(Boolean).join(" · ")}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {task.status !== "resolved" && task.can_acknowledge && task.status !== "acknowledged" && <button disabled={busy} className={primaryButton} onClick={() => act(task, "acknowledge")}><Check className="size-4" />{task.owner_user_id ? "Acknowledge" : "Claim and acknowledge"}</button>}
          <Link className={button} to={task.url}>Open workflow</Link>
          {task.status !== "resolved" && task.can_act && !task.clinical_owner_id && <button className={button} disabled={busy} onClick={() => ask(task, "handover")}>Hand over</button>}
          {task.status !== "resolved" && task.kind === "doctor_assignment" && Number(task.clinical_owner_id) === Number(user.id) && !user.is_read_only && <button className={button} disabled={busy} onClick={() => ask(task, "decline")}>Decline assignment</button>}
          {task.status !== "resolved" && task.can_act && task.can_resolve && <button className={button} disabled={busy} onClick={() => ask(task, "resolve")}>Record review outcome</button>}
          {task.status !== "resolved" && task.kind === "report_review" && !user.is_read_only && task.priority !== "urgent" && <button className={button} disabled={busy} onClick={() => ask(task, "flag_urgent")}>Flag urgent review</button>}
          <button className={button} aria-expanded={selected === task.id} onClick={() => setSelected(selected === task.id ? null : task.id)}>Action history</button>
        </div>
      </div>
      {selected === task.id && <div className="mt-4 border-t border-slate-100 pt-3">
        {historyError && <p role="alert" className="text-sm text-rose-700">{historyError}<button className="ml-2 underline" onClick={() => loadHistory(task.id)}>Retry history</button></p>}
        {!history[task.id] ? <p role="status" className="text-sm text-slate-500">Loading history…</p> : <>
          <ol className="space-y-2 text-sm text-slate-600">{history[task.id].events.map(entry => <li key={entry.id}><strong>{entry.action.replaceAll("_", " ")}</strong> · {formatTime(entry.created_at)} · {entry.actor_name || "OCS workflow"}{entry.note && <p className="mt-1 whitespace-pre-wrap break-words">{entry.note}</p>}</li>)}</ol>
          {history[task.id].deliveries.some(d => d.status === "failed") && <p className="mt-3 text-sm text-amber-800">Push could not reach at least one recipient. This task remains available here and delivery will be retried.</p>}
          {history[task.id].deliveries.some(d => d.status === "accepted") && <p className="mt-3 text-xs text-slate-500">Push service accepted a notification. This does not confirm that its recipient read or acknowledged it.</p>}
        </>}
      </div>}
    </article>)}</div> : <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center"><BellRing className="mx-auto size-6 text-slate-400" /><p className="mt-2 text-sm text-slate-600">{search || filter !== "all" ? "No actions match these filters." : view === "resolved" ? "No resolved actions yet." : "No actions need attention."}</p></div>}
    {selected && data && !data.tasks.some(t => t.id === selected) && <p role="status" className="text-sm text-slate-600">The linked action has moved on or is no longer in this view. Check Resolved or your current work above.</p>}
    {user.role === "admin" && policy && <details className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="min-h-11 cursor-pointer font-semibold text-slate-800">Response targets and escalation supervisor</summary>
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
