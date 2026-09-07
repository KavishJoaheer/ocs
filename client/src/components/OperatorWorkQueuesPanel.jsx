import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ClipboardList, Package, TimerReset, Truck } from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import { useSearchParams } from "react-router-dom";
import SectionCard from "./SectionCard.jsx";
import OperatorFulfilmentPanel from "./OperatorFulfilmentPanel.jsx";
import OperatorAmendmentReviewPanel from "./OperatorAmendmentReviewPanel.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { SUPPLY_REQUESTS_EVENT } from "../lib/inventorySync.js";
import {
  formatSupplyRequestCollectionDay,
  getSupplyRequestActions,
  supplyRequestStatusLabel,
} from "../lib/supplyRequests.js";
import { cx } from "../lib/utils.js";
import SupplyRequestDetailDrawer from "./SupplyRequestDetailDrawer.jsx";
import SupplyRequestHistoryFilters, { EMPTY_HISTORY_FILTERS } from "./SupplyRequestHistoryFilters.jsx";

const QUEUE_DEFS = [
  { id: "changes", label: "Changes", key: "changes" },
  { id: "reconciliation_required", label: "Reconciliation required", key: "reconciliation_required" },
  { id: "shortages", label: "Shortages", key: "shortages" },
  { id: "new_requests", label: "New requests", key: "new_requests" },
  { id: "pick_today", label: "Pick today", key: "pick_today" },
  { id: "awaiting_collection", label: "Awaiting collection", key: "awaiting_collection" },
  { id: "incoming_shipments", label: "Incoming shipments", key: "incoming_shipments", kind: "shipments" },
  { id: "count_variances", label: "Count variances", key: "count_variances", kind: "variances" },
  { id: "history", label: "History", key: "history", kind: "history" },
];

const QUEUE_PRIORITY = [
  "changes",
  "reconciliation_required",
  "shortages",
  "new_requests",
  "pick_today",
  "awaiting_collection",
  "incoming_shipments",
  "count_variances",
];

function validQueueId(value) {
  return QUEUE_DEFS.some((queue) => queue.id === value) ? value : null;
}

function highestPriorityNonEmpty(counts = {}) {
  return QUEUE_PRIORITY.find((id) => Number(counts[id] || 0) > 0) || "new_requests";
}

function waitingLabel(value) {
  if (!value) return "—";
  const hours = Math.max(0, dayjs().diff(dayjs(value), "hour"));
  if (hours < 24) return `${hours}h waiting`;
  return `${Math.floor(hours / 24)}d waiting`;
}

export default function OperatorWorkQueuesPanel({ onOpenShipments, onOpenCount }) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQueue = validQueueId(searchParams.get("queue"));
  const [queues, setQueues] = useState(null);
  const [active, setActive] = useState(urlQueue || "new_requests");
  const queueTouchedRef = useRef(Boolean(urlQueue));
  const [loading, setLoading] = useState(false);
  const [fulfilmentRequest, setFulfilmentRequest] = useState(null);
  const [amendmentRequest, setAmendmentRequest] = useState(null);
  const [detailRequestId, setDetailRequestId] = useState(null);
  const [history, setHistory] = useState({ requests: [], total: 0, doctor_counts: [], item_counts: [] });
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyFilters, setHistoryFilters] = useState({ ...EMPTY_HISTORY_FILTERS });
  const [doctors, setDoctors] = useState([]);
  const [operators, setOperators] = useState([]);
  const [folders, setFolders] = useState([]);
  const HISTORY_PAGE_SIZE = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.get("/restock-requests/queues");
      setQueues(payload);
      if (!queueTouchedRef.current) {
        setActive(highestPriorityNonEmpty(payload?.counts || {}));
        queueTouchedRef.current = true;
      }
      if (active === "history") {
        const params = new URLSearchParams({
          view: "history",
          include_events: "1",
          limit: String(HISTORY_PAGE_SIZE),
          offset: String(historyOffset),
        });
        if (historyFilters.status) params.set("status", historyFilters.status);
        if (historyFilters.item.trim()) params.set("item", historyFilters.item.trim());
        if (historyFilters.from) params.set("from", historyFilters.from);
        if (historyFilters.to) params.set("to", historyFilters.to);
        if (historyFilters.doctor_id) params.set("doctor_id", historyFilters.doctor_id);
        if (historyFilters.operator_id) params.set("operator_id", historyFilters.operator_id);
        if (historyFilters.folder_id) params.set("folder_id", historyFilters.folder_id);
        if (historyFilters.request_id.trim()) params.set("request_id", historyFilters.request_id.trim());
        const archived = await api.get(`/restock-requests?${params.toString()}`);
        setHistory({
          requests: Array.isArray(archived?.requests) ? archived.requests : [],
          total: Number(archived?.total || 0),
          doctor_counts: Array.isArray(archived?.doctor_counts) ? archived.doctor_counts : [],
          item_counts: Array.isArray(archived?.item_counts) ? archived.item_counts : [],
          completed_count: Number(archived?.completed_count || 0),
          cancelled_count: Number(archived?.cancelled_count || 0),
        });
        if (Array.isArray(archived?.operators)) setOperators(archived.operators);
        if (Array.isArray(archived?.folders)) setFolders(archived.folders);
      }
    } catch (error) {
      toast.error(error.message || "Could not load work queues.");
    } finally {
      setLoading(false);
    }
  }, [active, historyOffset, historyFilters]);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(SUPPLY_REQUESTS_EVENT, onChange);
    const timer = window.setInterval(() => void load(), 30000);
    return () => {
      window.removeEventListener(SUPPLY_REQUESTS_EVENT, onChange);
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    let ignore = false;
    async function loadLookups() {
      try {
        const [doctorPayload, lookupPayload] = await Promise.all([
          api.get("/doctors"),
          api.get("/restock-requests/history-lookups"),
        ]);
        if (ignore) return;
        setDoctors(Array.isArray(doctorPayload) ? doctorPayload : doctorPayload?.doctors || []);
        setOperators(Array.isArray(lookupPayload?.operators) ? lookupPayload.operators : []);
        setFolders(Array.isArray(lookupPayload?.folders) ? lookupPayload.folders : []);
      } catch {
        /* history filters remain usable without lookups */
      }
    }
    void loadLookups();
    return () => {
      ignore = true;
    };
  }, []);

  const counts = queues?.counts || {};
  const waitingTotal = Number(counts.unique_requests ?? 0);
  const queueEntries = Number(counts.queue_entries ?? 0);
  const rows = useMemo(() => {
    if (active === "history") return history.requests;
    if (!queues) return [];
    return queues[active] || [];
  }, [queues, active, history.requests]);

  async function accept(request) {
    try {
      await api.patch(`/restock-requests/${request.id}`, { status: "accepted" });
      toast.success("Request accepted and reserved.");
      await load();
    } catch (error) {
      toast.error(error.message || "Could not accept this request.");
    }
  }

  async function claim(request) {
    try {
      await api.post(`/restock-requests/${request.id}/assign`, { user_id: user.id });
      toast.success("You claimed this request.");
      await load();
    } catch (error) {
      toast.error(error.message || "Could not assign this request.");
    }
  }

  function selectQueue(id) {
    queueTouchedRef.current = true;
    setActive(id);
    const next = new URLSearchParams(searchParams);
    next.set("queue", id);
    setSearchParams(next, { replace: true });
  }

  async function openQueueAction(row) {
    if (active === "changes") {
      try {
        const payload = await api.get(`/restock-requests/${row.id}`);
        const request = payload.request || payload;
        if (!request?.pending_amendment) {
          toast.error("This change has already been reviewed.");
          await load();
          return;
        }
        setAmendmentRequest(request);
      } catch (error) {
        toast.error(error.message || "Could not load the change request.");
      }
      return;
    }
    setFulfilmentRequest(row);
  }

  return (
    <>
      <SectionCard
        title="Work queues"
        subtitle="Accept, pick and dispatch supply requests without browsing the full catalogue."
        actions={
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-[#2d8f98]/10 px-3 py-1.5 text-xs font-bold text-[#2d8f98]">
            {waitingTotal} waiting
            {queueEntries > waitingTotal ? (
              <span className="font-semibold text-[#2d8f98]/80">· {queueEntries} queue entries</span>
            ) : null}
          </span>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2 pb-1">
          {QUEUE_DEFS.map((queue) => {
            const count = queue.kind === "history" ? Number(history.total || 0) : Number(counts[queue.key] || 0);
            return (
              <button
                key={queue.id}
                type="button"
                onClick={() => selectQueue(queue.id)}
                aria-pressed={active === queue.id}
                className={cx(
                  "inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-semibold transition",
                  active === queue.id
                    ? "bg-[#2d8f98] text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                {queue.label}
                <span
                  className={cx(
                    "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold",
                    active === queue.id ? "bg-white/90 text-[#2d8f98]" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {Number(counts.reconciliation_required || counts.fulfilment_linkage_required || 0) > 0 ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {counts.reconciliation_required || counts.fulfilment_linkage_required} request
            {(counts.reconciliation_required || counts.fulfilment_linkage_required) === 1 ? "" : "s"} need
            operator confirmation of actual quantities before collection.
          </div>
        ) : null}

        {loading && !queues ? (
          <p className="text-sm text-slate-500">Loading queues…</p>
        ) : active === "history" && loading && !history.requests.length ? (
          <p className="text-sm text-slate-500">Loading history…</p>
        ) : !rows.length ? (
          <p className="text-sm text-slate-500">
            {active === "history" ? "No archived supply requests yet." : "Nothing waiting in this queue."}
          </p>
        ) : active === "incoming_shipments" ? (
          <button
            type="button"
            onClick={() => onOpenShipments?.()}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Package className="mr-2 inline size-4 text-[#2d8f98]" />
            Open {rows.length} incoming shipment{rows.length === 1 ? "" : "s"}
          </button>
        ) : active === "count_variances" ? (
          <button
            type="button"
            onClick={() => onOpenCount?.()}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <ClipboardList className="mr-2 inline size-4 text-amber-700" />
            Review {rows.length} count variance{rows.length === 1 ? "" : "s"}
          </button>
        ) : active === "history" ? (
          <div className="space-y-3">
            <SupplyRequestHistoryFilters
              filters={historyFilters}
              doctors={doctors}
              operators={operators}
              folders={folders}
              role={user?.role === "admin" ? "admin" : "operator"}
              resultCount={history.total}
              exportControl={
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"
                  onClick={() => {
                    const token = window.localStorage.getItem("ocs_medecins_auth_token");
                    const params = new URLSearchParams({ view: "history" });
                    Object.entries(historyFilters).forEach(([key, value]) => {
                      if (String(value || "").trim()) params.set(key, String(value).trim());
                    });
                    void fetch(`/api/restock-requests/export?${params.toString()}`, {
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
                </button>
              }
              onChange={(next) => {
                setHistoryOffset(0);
                setHistoryFilters(next);
              }}
            />
            {history.doctor_counts?.length || history.item_counts?.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Requests by doctor</p>
                  <ul className="mt-2 space-y-1">
                    {(history.doctor_counts || []).slice(0, 8).map((row) => (
                      <li key={row.doctor_id} className="flex justify-between gap-3">
                        <span>Dr. {row.doctor_name}</span>
                        <span className="font-bold">{row.request_count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Item frequency</p>
                  <ul className="mt-2 space-y-1">
                    {(history.item_counts || []).slice(0, 8).map((row) => (
                      <li key={row.item_name} className="flex justify-between gap-3">
                        <span className="truncate">{row.item_name}</span>
                        <span className="font-bold">{row.request_count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">Dr. {row.doctor_name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Collect {formatSupplyRequestCollectionDay(row.collection_date)}
                    {row.transfer_transaction_id ? ` · Transfer ${row.transfer_transaction_id}` : ""}
                  </p>
                  <span className="mt-2 inline-flex rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase text-teal-800">
                    {supplyRequestStatusLabel(row.status, user?.role === "admin" ? "admin" : "operator")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailRequestId(row.id)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700"
                >
                  View details
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                type="button"
                disabled={historyOffset <= 0}
                onClick={() => setHistoryOffset((value) => Math.max(0, value - HISTORY_PAGE_SIZE))}
                className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-slate-500">
                {history.total} records · page {Math.floor(historyOffset / HISTORY_PAGE_SIZE) + 1}
              </span>
              <button
                type="button"
                disabled={historyOffset + HISTORY_PAGE_SIZE >= Number(history.total || 0)}
                onClick={() => setHistoryOffset((value) => value + HISTORY_PAGE_SIZE)}
                className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 text-sm font-semibold disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">Dr. {row.doctor_name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Collect {formatSupplyRequestCollectionDay(row.collection_date)}
                    {` · ${waitingLabel(row.created_at)}`}
                    {` · ${row.item_count} item${row.item_count === 1 ? "" : "s"}`}
                    {row.assigned_to_name ? ` · ${row.assigned_to_name}` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.overdue ? (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                        Overdue
                      </span>
                    ) : null}
                    {row.has_shortage ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                        <AlertTriangle className="size-3" />
                        Shortage
                      </span>
                    ) : null}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                      {row.next_action}
                    </span>
                    {row.reconciliation_required || row.linkage_required ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                        Legacy – reconciliation required
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {(() => {
                    const actions = getSupplyRequestActions({ request: row, role: user?.role });
                    const assignedToMe = Number(row.assigned_to_user_id || 0) === Number(user?.id || 0);
                    const claimable =
                      user?.role === "operator"
                      && !assignedToMe
                      && (row.status === "accepted" || (row.status === "ready" && (row.reconciliation_required || row.linkage_required)));
                    const fulfilAction = actions.find((action) => action.id === "fulfil" || action.id === "review_amendment");
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => setDetailRequestId(row.id)}
                          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700"
                        >
                          View details
                        </button>
                        {claimable ? (
                          <button
                            type="button"
                            onClick={() => claim(row)}
                            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600"
                          >
                            Claim
                          </button>
                        ) : null}
                        {row.status === "pending" && user?.role === "operator" ? (
                          <button
                            type="button"
                            onClick={() => accept(row)}
                            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-xs font-bold text-white"
                          >
                            Accept & reserve
                          </button>
                        ) : row.status === "pending" && user?.role === "admin" ? (
                          <p className="max-w-[12rem] text-right text-[11px] text-slate-500">
                            An operator must accept and reserve this request.
                          </p>
                        ) : fulfilAction ? (
                          <button
                            type="button"
                            onClick={() => openQueueAction(row)}
                            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-[#2d8f98] px-3 text-xs font-bold text-white"
                          >
                            {row.status === "ready" ? <Truck className="size-3.5" /> : <TimerReset className="size-3.5" />}
                            {active === "changes" ? "Review changes" : fulfilAction.label}
                          </button>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
      <OperatorFulfilmentPanel
        open={Boolean(fulfilmentRequest)}
        request={fulfilmentRequest}
        onClose={() => setFulfilmentRequest(null)}
        onUpdated={load}
      />
      <OperatorAmendmentReviewPanel
        open={Boolean(amendmentRequest)}
        request={amendmentRequest}
        onClose={() => setAmendmentRequest(null)}
        onReviewed={load}
      />
      <SupplyRequestDetailDrawer
        open={Boolean(detailRequestId)}
        requestId={detailRequestId}
        role={user?.role === "admin" ? "admin" : "operator"}
        onClose={() => setDetailRequestId(null)}
      />
    </>
  );
}
