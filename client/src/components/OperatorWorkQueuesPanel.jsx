import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Package, TimerReset, Truck } from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import OperatorFulfilmentPanel from "./OperatorFulfilmentPanel.jsx";
import OperatorAmendmentReviewPanel from "./OperatorAmendmentReviewPanel.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { SUPPLY_REQUESTS_EVENT } from "../lib/inventorySync.js";
import { formatSupplyRequestCollectionDay, supplyRequestStatusLabel } from "../lib/supplyRequests.js";
import { cx } from "../lib/utils.js";
import SupplyRequestDetailDrawer from "./SupplyRequestDetailDrawer.jsx";

const QUEUE_DEFS = [
  { id: "new_requests", label: "New requests", key: "new_requests" },
  { id: "changes", label: "Changes", key: "changes" },
  { id: "shortages", label: "Shortages", key: "shortages" },
  { id: "pick_today", label: "Pick today", key: "pick_today" },
  { id: "awaiting_collection", label: "Awaiting collection", key: "awaiting_collection" },
  { id: "incoming_shipments", label: "Incoming shipments", key: "incoming_shipments", kind: "shipments" },
  { id: "count_variances", label: "Count variances", key: "count_variances", kind: "variances" },
  { id: "history", label: "History", key: "history", kind: "history" },
];

function waitingLabel(value) {
  if (!value) return "—";
  const hours = Math.max(0, dayjs().diff(dayjs(value), "hour"));
  if (hours < 24) return `${hours}h waiting`;
  return `${Math.floor(hours / 24)}d waiting`;
}

export default function OperatorWorkQueuesPanel({ onOpenShipments, onOpenCount }) {
  const { user } = useAuth();
  const [queues, setQueues] = useState(null);
  const [active, setActive] = useState("new_requests");
  const [loading, setLoading] = useState(false);
  const [fulfilmentRequest, setFulfilmentRequest] = useState(null);
  const [amendmentRequest, setAmendmentRequest] = useState(null);
  const [detailRequestId, setDetailRequestId] = useState(null);
  const [history, setHistory] = useState({ requests: [], total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.get("/restock-requests/queues");
      setQueues(payload);
      if (active === "history") {
        const archived = await api.get("/restock-requests?view=history&include_events=1&limit=50&offset=0");
        setHistory({
          requests: Array.isArray(archived?.requests) ? archived.requests : [],
          total: Number(archived?.total || 0),
        });
      }
    } catch (error) {
      toast.error(error.message || "Could not load work queues.");
    } finally {
      setLoading(false);
    }
  }, [active]);

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

  const counts = queues?.counts || {};
  const waitingTotal = QUEUE_DEFS.filter((queue) => queue.kind !== "history").reduce(
    (sum, queue) => sum + Number(counts[queue.key] || 0),
    0,
  );
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
                onClick={() => setActive(queue.id)}
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

        {Number(counts.fulfilment_linkage_required || 0) > 0 ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {counts.fulfilment_linkage_required} legacy request
            {counts.fulfilment_linkage_required === 1 ? "" : "s"} need fulfilment linkage before collection.
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
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={() => setDetailRequestId(row.id)}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700"
                  >
                    View details
                  </button>
                  <button
                    type="button"
                    onClick={() => claim(row)}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600"
                  >
                    Claim
                  </button>
                  {row.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => accept(row)}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-xs font-bold text-white"
                    >
                      Accept & reserve
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openQueueAction(row)}
                      className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-[#2d8f98] px-3 text-xs font-bold text-white"
                    >
                      {row.status === "ready" ? <Truck className="size-3.5" /> : <TimerReset className="size-3.5" />}
                      {active === "changes" ? "Review changes" : "Open fulfilment"}
                    </button>
                  )}
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
