import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Inbox } from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import OperatorAmendmentReviewPanel from "./OperatorAmendmentReviewPanel.jsx";
import OperatorFulfilmentPanel from "./OperatorFulfilmentPanel.jsx";
import SectionCard from "./SectionCard.jsx";
import SupplyRequestHistoryFilters, { EMPTY_HISTORY_FILTERS } from "./SupplyRequestHistoryFilters.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api, ApiError } from "../lib/api.js";
import { SUPPLY_REQUESTS_EVENT } from "../lib/inventorySync.js";
import {
  describeSupplyRequestItems,
  supplyRequestOverdueDays,
  formatSupplyRequestCollectionDay,
  formatSupplyRequestTimestamp,
  getSupplyRequestActions,
  splitSupplyRequestCardActions,
  summarizeActiveSupplyRequests,
  supplyRequestStatusLabel,
  supplyRequestStatusTone,
} from "../lib/supplyRequests.js";
import EmergencyOverrideDialog from "./EmergencyOverrideDialog.jsx";
import SupplyRequestDetailDrawer from "./SupplyRequestDetailDrawer.jsx";
import LegacyReconciliationNotice from "./LegacyReconciliationNotice.jsx";
import { withOperationalOverride } from "../lib/inventoryAccess.js";
import { cx } from "../lib/utils.js";

const HISTORY_PAGE_SIZE = 50;
const FALLBACK_POLL_MS = 30000;

function statusBadge(request, role) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold",
        supplyRequestStatusTone(request.status),
      )}
    >
      {request.status === "ready" ? (
        <CheckCircle2 className="size-3" />
      ) : (
        <ClipboardList className="size-3" />
      )}
      {supplyRequestStatusLabel(request.status, role)}
    </span>
  );
}

function HistoryRequestProgress({ request, role }) {
  return (
    <div className="space-y-1 text-[11px] text-slate-500">
      {request.accepted_by_name ? <div>Accepted by {request.accepted_by_name}</div> : null}
      {request.ready_by_name ? <div>Prepared by {request.ready_by_name}</div> : null}
      {request.completed_at ? (
        <div>
          {role === "operator" ? "Dispatched" : "Completed"} {formatSupplyRequestTimestamp(request.completed_at)}
        </div>
      ) : null}
      {request.cancelled_at ? (
        <div>
          Cancelled {formatSupplyRequestTimestamp(request.cancelled_at)}
          {request.cancelled_reason ? ` · ${request.cancelled_reason}` : ""}
        </div>
      ) : null}
      {request.transfer_transaction_id ? <div>Transfer {request.transfer_transaction_id}</div> : null}
    </div>
  );
}

function actionClass(kind, extra = "") {
  if (kind === "primary") {
    return cx("inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white disabled:opacity-60", extra);
  }
  if (kind === "danger") {
    return cx("inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 disabled:opacity-60", extra);
  }
  if (kind === "ghost") {
    return cx("inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-60", extra);
  }
  return cx("inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-60", extra);
}

function runSupplyRequestAction(action, request, handlers) {
  if (!action || action.disabled) return;
  if (action.id === "accept") handlers.onAccept(request);
  if (action.id === "emergency_override_accept") handlers.onEmergencyAccept?.(request);
  if (action.id === "fulfil") handlers.onFulfil(request);
  if (action.id === "emergency_override_fulfil") handlers.onEmergencyFulfil?.(request);
  if (action.id === "review_amendment") handlers.onReviewAmendment(request);
  if (action.id === "cancel") handlers.onCancel(request);
  if (action.id === "details") handlers.onDetails(request);
  if (action.id === "receipt") handlers.onReceipt?.(request);
}

function CompactRequestActions({ request, role, busy, layout = "card", handlers }) {
  const actions = getSupplyRequestActions({ request, role, busy });
  if (layout === "row") {
    return (
      <div className="flex flex-col items-end gap-2">
        {actions.map((action) =>
          action.kind === "info" ? (
            <span key={action.id} className="max-w-[14rem] text-right text-[11px] text-slate-500">
              {action.label}
            </span>
          ) : (
            <button
              key={action.id}
              type="button"
              disabled={action.disabled}
              onClick={() => runSupplyRequestAction(action, request, handlers)}
              className={actionClass(action.kind, "min-w-[9.5rem]")}
            >
              {busy && action.kind === "primary" ? "Saving…" : action.label}
            </button>
          ),
        )}
      </div>
    );
  }

  const { primary, details, overflow, info } = splitSupplyRequestCardActions(actions);
  return (
    <div className="mt-3 flex flex-col gap-2">
      {info ? <p className="text-xs text-slate-500">{info.label}</p> : null}
      {primary ? (
        <button
          type="button"
          disabled={primary.disabled}
          onClick={() => runSupplyRequestAction(primary, request, handlers)}
          className={actionClass(primary.kind, "w-full")}
        >
          {busy ? "Saving…" : primary.label}
        </button>
      ) : null}
      {details ? (
        <button
          type="button"
          onClick={() => runSupplyRequestAction(details, request, handlers)}
          className={actionClass("secondary", "w-full")}
        >
          {details.label}
        </button>
      ) : null}
      {overflow.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={action.disabled}
          onClick={() => runSupplyRequestAction(action, request, handlers)}
          className={actionClass(action.kind, "w-full")}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export default function OperatorSupplyRequestsPanel() {
  const { user } = useAuth();
  const role = user?.role === "admin" ? "admin" : "operator";
  const [tab, setTab] = useState("active");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [requests, setRequests] = useState([]);
  const [history, setHistory] = useState({
    requests: [],
    total: 0,
    doctor_counts: [],
    item_counts: [],
  });
  const [doctors, setDoctors] = useState([]);
  const [operators, setOperators] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [filters, setFilters] = useState({ ...EMPTY_HISTORY_FILTERS });
  const [historyOffset, setHistoryOffset] = useState(0);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [amendmentTarget, setAmendmentTarget] = useState(null);
  const [fulfilmentRequest, setFulfilmentRequest] = useState(null);
  const [detailRequestId, setDetailRequestId] = useState(null);
  const [overrideTarget, setOverrideTarget] = useState(null);

  const loadActive = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.get("/restock-requests");
      setRequests(Array.isArray(payload?.requests) ? payload.requests : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load restock requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  const historyQuery = useMemo(() => {
    const params = new URLSearchParams({
      view: "history",
      include_events: "1",
      limit: String(HISTORY_PAGE_SIZE),
      offset: String(historyOffset),
    });
    if (filters.doctor_id) params.set("doctor_id", filters.doctor_id);
    if (filters.status) params.set("status", filters.status);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.item.trim()) params.set("item", filters.item.trim());
    if (filters.request_id.trim()) params.set("request_id", filters.request_id.trim());
    if (filters.operator_id) params.set("operator_id", filters.operator_id);
    if (filters.folder_id) params.set("folder_id", filters.folder_id);
    return params.toString();
  }, [filters, historyOffset]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const payload = await api.get(`/restock-requests?${historyQuery}`);
      setHistory({
        requests: Array.isArray(payload?.requests) ? payload.requests : [],
        total: Number(payload?.total || 0),
        doctor_counts: Array.isArray(payload?.doctor_counts) ? payload.doctor_counts : [],
        item_counts: Array.isArray(payload?.item_counts) ? payload.item_counts : [],
        completed_count: Number(payload?.completed_count || 0),
        cancelled_count: Number(payload?.cancelled_count || 0),
        request_count: Number(payload?.request_count || 0),
      });
      if (Array.isArray(payload?.operators)) setOperators(payload.operators);
      if (Array.isArray(payload?.folders)) setFolders(payload.folders);
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : "Could not load supply request history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyQuery]);

  useEffect(() => {
    loadActive();
  }, [loadActive]);

  useEffect(() => {
    if (tab === "history") {
      loadHistory();
    }
  }, [tab, loadHistory]);

  useEffect(() => {
    let ignore = false;
    async function loadDoctors() {
      try {
        const payload = await api.get("/doctors");
        if (!ignore) {
          setDoctors(Array.isArray(payload) ? payload : payload?.doctors || []);
        }
      } catch {
        /* doctor filter remains optional */
      }
    }
    loadDoctors();
    async function loadLookups() {
      try {
        const payload = await api.get("/restock-requests/history-lookups");
        if (!ignore) {
          setOperators(Array.isArray(payload?.operators) ? payload.operators : []);
          setFolders(Array.isArray(payload?.folders) ? payload.folders : []);
        }
      } catch {
        /* lookups remain optional until history loads */
      }
    }
    loadLookups();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const handleRefresh = () => {
      void loadActive();
      if (tab === "history") void loadHistory();
    };
    window.addEventListener(SUPPLY_REQUESTS_EVENT, handleRefresh);
    const timer = window.setInterval(handleRefresh, FALLBACK_POLL_MS);
    return () => {
      window.removeEventListener(SUPPLY_REQUESTS_EVENT, handleRefresh);
      window.clearInterval(timer);
    };
  }, [loadActive, loadHistory, tab]);

  async function patchRequest(request, body, successMessage) {
    if (updatingId) return;
    setUpdatingId(request.id);
    try {
      await api.patch(`/restock-requests/${request.id}`, body);
      toast.success(successMessage);
      await Promise.all([loadActive(), loadHistory()]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update request.");
    } finally {
      setUpdatingId(null);
    }
  }

  const overdueCount = requests.filter(request => supplyRequestOverdueDays(request) > 0).length;
  const visibleRequests = requests.filter(request => !overdueOnly || supplyRequestOverdueDays(request) > 0)
    .sort((a, b) => supplyRequestOverdueDays(b) - supplyRequestOverdueDays(a));
  const summaryLabel = summarizeActiveSupplyRequests(requests, role);
  const historyPage = Math.floor(historyOffset / HISTORY_PAGE_SIZE) + 1;
  const historyPages = Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE));
  const requestHandlers = {
    onAccept: (request) => patchRequest(request, { status: "accepted" }, "Request accepted."),
    onEmergencyAccept: (request) => setOverrideTarget({ request, kind: "accept" }),
    onFulfil: (request) => setFulfilmentRequest(request),
    onEmergencyFulfil: (request) => setOverrideTarget({ request, kind: "fulfil" }),
    onReviewAmendment: (request) => setAmendmentTarget(request),
    onCancel: (request) => {
      setCancelTarget(request);
      setCancelReason("");
    },
    onDetails: (request) => setDetailRequestId(request.id),
    onReceipt: (request) => setDetailRequestId(request.id),
  };

  return (
    <>
      <SectionCard
        title="Supply Requests"
        subtitle={
          loading
            ? "Loading…"
            : tab === "history"
              ? `${history.total} archived request${history.total === 1 ? "" : "s"}`
              : summaryLabel
        }
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-2xl bg-[#ba5a32]/10 px-3 py-1.5 text-xs font-bold text-[#ba5a32]">
            <Inbox className="size-3.5" />
            {tab === "history" ? history.total : requests.length} {tab === "history" ? "archived" : "active"}
          </span>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-50 p-1">
          {[
            { id: "active", label: "Active" },
            { id: "history", label: "History" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cx(
                "min-h-11 rounded-xl text-sm font-bold transition",
                tab === item.id ? "bg-[#2d8f98] text-white" : "text-slate-600",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "active" && <label className="mb-3 flex min-h-11 items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm">
          <input type="checkbox" checked={overdueOnly} onChange={event => setOverdueOnly(event.target.checked)} />
          Overdue only ({overdueCount}) · oldest first
        </label>}
        {tab === "active" ? (
          error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : !visibleRequests.length && !loading ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
              No supply requests match this view.
            </div>
          ) : (
            <>
            <div className="space-y-3 lg:hidden">
              {visibleRequests.map((request) => {
                const busy = updatingId === request.id;
                return (
                  <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words font-semibold text-slate-800">Dr. {request.doctor_name}</p>
                        <p className="text-[11px] text-slate-400">Sent {dayjs(request.created_at).format("DD MMM HH:mm")}</p>
                      </div>
                      {statusBadge(request, role)}
                    </div>
                    <LegacyReconciliationNotice request={request} compact />
                    <p className="mt-2 break-words text-sm text-slate-700">{describeSupplyRequestItems(request.items)}</p>
                    <p className="mt-1 text-xs text-slate-500">{dayjs(request.collection_date).format("ddd, DD MMM")}
                          {supplyRequestOverdueDays(request) > 0 && <span className="block font-semibold text-amber-800">{supplyRequestOverdueDays(request)} days overdue</span>}
                          <span className="block">Follow-up owner: {request.assigned_to_name || 'Unassigned'}</span></p>
                    <CompactRequestActions
                      request={request}
                      role={role}
                      busy={busy}
                      layout="card"
                      handlers={requestHandlers}
                    />
                  </article>
                );
              })}
            </div>
            <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 lg:block">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500 lg:text-ocs-slate">
                  <tr>
                    <th className="px-3 py-2 text-left">Doctor</th>
                    <th className="px-3 py-2 text-left">Requested items</th>
                    <th className="px-3 py-2 text-left">Collection</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {visibleRequests.map((request) => {
                    const busy = updatingId === request.id;
                    const pendingAmendment = request.pending_amendment;
                    return (
                      <tr key={request.id} className="align-top">
                        <td className="min-w-0 px-3 py-3 font-semibold text-slate-800">
                          <div className="break-words">Dr. {request.doctor_name}</div>
                          <div className="text-[11px] font-normal text-slate-400">
                            Sent {dayjs(request.created_at).format("DD MMM HH:mm")}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          <div className="max-w-[28rem] break-words">
                            {describeSupplyRequestItems(request.items)}
                          </div>
                          {request.note ? (
                            <div className="mt-1 text-[11px] italic text-slate-500">
                              “{request.note}”
                            </div>
                          ) : null}
                          {pendingAmendment ? (
                            <button
                              type="button"
                              onClick={() => setAmendmentTarget(request)}
                              className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800"
                            >
                              Change Requested
                            </button>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-slate-700">
                          {dayjs(request.collection_date).format("ddd, DD MMM")}
                          {supplyRequestOverdueDays(request) > 0 && <span className="block font-semibold text-amber-800">{supplyRequestOverdueDays(request)} days overdue</span>}
                          <span className="block">Follow-up owner: {request.assigned_to_name || 'Unassigned'}</span>
                        </td>
                        <td className="px-3 py-3">
                          {statusBadge(request, role)}
                          <LegacyReconciliationNotice request={request} compact />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <CompactRequestActions
                            request={request}
                            role={role}
                            busy={busy}
                            layout="row"
                            handlers={requestHandlers}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )
        ) : (
          <div className="flex flex-col gap-4">
            <SupplyRequestHistoryFilters
              filters={filters}
              doctors={doctors}
              operators={operators}
              folders={folders}
              role={role}
              resultCount={history.total}
              exportControl={
                <a
                  href={`/api/restock-requests/export?${historyQuery.replace("view=history&", "").replace("include_events=1&", "")}`}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"
                  onClick={(event) => {
                    event.preventDefault();
                    const token = window.localStorage.getItem("ocs_medecins_auth_token");
                    void fetch(`/api/restock-requests/export?${new URLSearchParams({
                      ...Object.fromEntries(new URLSearchParams(historyQuery)),
                    })}`, {
                      credentials: "include",
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    }).then(async (response) => {
                      const blob = await response.blob();
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = "supply-request-history.csv";
                      link.click();
                      URL.revokeObjectURL(url);
                    });
                  }}
                >
                  Export CSV
                </a>
              }
              onChange={(next) => {
                setHistoryOffset(0);
                setFilters(next);
              }}
            />

            {history.doctor_counts.length || history.item_counts.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Requests by doctor
                  </p>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-700">
                    {history.doctor_counts.slice(0, 8).map((row) => (
                      <li key={row.doctor_id} className="flex justify-between gap-3">
                        <span>Dr. {row.doctor_name}</span>
                        <span className="font-bold tabular-nums">{row.request_count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Item frequency
                  </p>
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-700">
                    {history.item_counts.slice(0, 8).map((row) => (
                      <li key={row.item_name} className="flex justify-between gap-3">
                        <span className="truncate">{row.item_name}</span>
                        <span className="font-bold tabular-nums">
                          {row.request_count} · qty {row.total_quantity || 0}
                          {row.total_fulfilled != null ? ` / ${row.total_fulfilled} fulfilled` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {historyError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {historyError}
              </div>
            ) : historyLoading ? (
              <p className="text-sm text-slate-500">Loading history…</p>
            ) : !history.requests.length ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
                No completed or cancelled requests match these filters.
              </div>
            ) : (
              <>
                <div className="space-y-3 lg:hidden">
                  {history.requests.map((request) => (
                    <article key={request.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words font-semibold text-slate-800">Dr. {request.doctor_name}</p>
                          <p className="text-[11px] text-slate-400">
                            Requested {formatSupplyRequestTimestamp(request.created_at)}
                          </p>
                        </div>
                        {statusBadge(request, role)}
                      </div>
                      <p className="mt-2 break-words text-sm text-slate-700">{describeSupplyRequestItems(request.items)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Collect {formatSupplyRequestCollectionDay(request.collection_date)}
                      </p>
                      <div className="mt-2">
                        <HistoryRequestProgress request={request} role={role} />
                      </div>
                      <CompactRequestActions
                        request={request}
                        role={role}
                        busy={false}
                        layout="card"
                        handlers={requestHandlers}
                      />
                    </article>
                  ))}
                </div>
                <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 lg:block">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Doctor</th>
                        <th className="px-3 py-2 text-left">Items</th>
                        <th className="px-3 py-2 text-left">Progress</th>
                        <th className="px-3 py-2 text-left">Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {history.requests.map((request) => (
                        <tr key={request.id} className="align-top">
                          <td className="px-3 py-3">
                            <div className="font-semibold text-slate-800">Dr. {request.doctor_name}</div>
                            <div className="text-[11px] text-slate-400">
                              Requested {formatSupplyRequestTimestamp(request.created_at)}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-slate-700">
                            <div>{describeSupplyRequestItems(request.items)}</div>
                            <div className="text-[11px] text-slate-400">
                              Collect {formatSupplyRequestCollectionDay(request.collection_date)}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <HistoryRequestProgress request={request} role={role} />
                            {(request.events || []).length ? (
                              <ol className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                                {request.events.map((event) => (
                                  <li key={event.id}>
                                    {formatSupplyRequestTimestamp(event.created_at)} · {event.event_label || event.event_type}
                                    {event.actor_display_name ? ` · ${event.actor_display_name}` : ""}
                                    {event.reason ? ` · ${event.reason}` : ""}
                                  </li>
                                ))}
                              </ol>
                            ) : null}
                          </td>
                          <td className="px-3 py-3">
                            {statusBadge(request, role)}
                            <button
                              type="button"
                              onClick={() => setDetailRequestId(request.id)}
                              className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 text-xs font-semibold"
                            >
                              View details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {history.total > HISTORY_PAGE_SIZE ? (
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                <button
                  type="button"
                  disabled={historyOffset <= 0}
                  onClick={() => setHistoryOffset((value) => Math.max(0, value - HISTORY_PAGE_SIZE))}
                  className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 disabled:opacity-40"
                >
                  Previous
                </button>
                <span>
                  Page {historyPage} of {historyPages}
                </span>
                <button
                  type="button"
                  disabled={historyOffset + HISTORY_PAGE_SIZE >= history.total}
                  onClick={() => setHistoryOffset((value) => value + HISTORY_PAGE_SIZE)}
                  className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      <OperatorAmendmentReviewPanel
        open={Boolean(amendmentTarget)}
        request={amendmentTarget}
        onClose={() => setAmendmentTarget(null)}
        onReviewed={() => {
          void loadActive();
          void loadHistory();
        }}
      />

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => {
          setCancelTarget(null);
          setCancelReason("");
        }}
        title={role === "admin" && ["accepted", "ready"].includes(cancelTarget?.status)
          ? "Exceptional cancellation"
          : "Cancel and archive this request?"}
        description={role === "admin" && ["accepted", "ready"].includes(cancelTarget?.status)
          ? "This is an administrative exception. Confirm the consequences and record a reason of at least 10 characters."
          : "The request will be moved to History. It will not be permanently deleted."}
        size="md"
      >
        <div className="flex flex-col gap-4">
          {cancelTarget && ["accepted", "ready"].includes(cancelTarget.status) ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-semibold">
                {role === "admin" ? "Exceptional cancellation" : "Cancellation after acceptance"}
              </p>
              {role === "admin" ? (
                <p className="mt-1">
                  Administrators do not cancel accepted or ready requests as a routine action. This override releases reservations and archives the request.
                </p>
              ) : null}
              <p>Reserved quantities will be released.</p>
              <p>Packed or picked quantities will no longer be associated with the request.</p>
              <p>The request will remain in History.</p>
              <p>No stock should be deducted unless the physical dispatch already occurred.</p>
            </div>
          ) : null}
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Cancellation reason
            <textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value.slice(0, 500))}
              rows={3}
              minLength={role === "admin" && ["accepted", "ready"].includes(cancelTarget?.status) ? 10 : undefined}
              placeholder={role === "admin" && ["accepted", "ready"].includes(cancelTarget?.status)
                ? "Explain why this exceptional cancellation is required (at least 10 characters)"
                : "Why is this request being archived?"}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCancelTarget(null);
                setCancelReason("");
              }}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600"
            >
              Keep request
            </button>
            <button
              type="button"
              disabled={
                !cancelReason.trim()
                || updatingId === cancelTarget?.id
                || (role === "admin" && ["accepted", "ready"].includes(cancelTarget?.status) && cancelReason.trim().length < 10)
              }
              onClick={() => {
                const request = cancelTarget;
                setCancelTarget(null);
                patchRequest(
                  request,
                  { status: "cancelled", reason: cancelReason.trim() },
                  "Request archived in history.",
                );
                setCancelReason("");
              }}
              className="rounded-2xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Archive request
            </button>
          </div>
        </div>
      </Modal>
      <OperatorFulfilmentPanel
        open={Boolean(fulfilmentRequest)}
        request={fulfilmentRequest}
        emergencyOverride={Boolean(fulfilmentRequest?.__override)}
        onClose={() => setFulfilmentRequest(null)}
        onUpdated={() => {
          void loadActive();
          void loadHistory();
        }}
      />
      <EmergencyOverrideDialog
        open={Boolean(overrideTarget)}
        summary={
          overrideTarget?.kind === "accept"
            ? `This will accept request #${overrideTarget.request.id}, reserve available warehouse stock using FEFO, and notify the doctor. Use this only if an operator cannot complete the action.`
            : `This will open fulfilment for request #${overrideTarget?.request?.id || ""} so an administrator can pick, pack, or mark supply ready.`
        }
        onClose={() => setOverrideTarget(null)}
        onConfirm={async (reason) => {
          const target = overrideTarget;
          if (!target?.request) return;
          if (target.kind === "accept") {
            await patchRequest(
              target.request,
              withOperationalOverride(user, { status: "accepted" }, reason),
              "Request accepted with an emergency override.",
            );
            return;
          }
          setFulfilmentRequest({ ...target.request, __override: true, __overrideReason: reason });
        }}
      />
      <SupplyRequestDetailDrawer
        open={Boolean(detailRequestId)}
        requestId={detailRequestId}
        role={role}
        busy={updatingId === detailRequestId}
        onClose={() => setDetailRequestId(null)}
        onAccept={(request) =>
          role === "admin" ? requestHandlers.onEmergencyAccept(request) : requestHandlers.onAccept(request)
        }
        onFulfil={(request) => {
          setDetailRequestId(null);
          if (role === "admin") requestHandlers.onEmergencyFulfil(request);
          else requestHandlers.onFulfil(request);
        }}
        onReviewAmendment={(request) => {
          setDetailRequestId(null);
          requestHandlers.onReviewAmendment(request);
        }}
        onCancel={(request) => requestHandlers.onCancel(request)}
      />
    </>
  );
}
