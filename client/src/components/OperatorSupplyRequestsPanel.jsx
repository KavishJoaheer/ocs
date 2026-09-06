import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Inbox } from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import OperatorFulfilmentPanel from "./OperatorFulfilmentPanel.jsx";
import SectionCard from "./SectionCard.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api, ApiError } from "../lib/api.js";
import { SUPPLY_REQUESTS_EVENT } from "../lib/inventorySync.js";
import {
  describeSupplyRequestItems,
  formatSupplyRequestCollectionDay,
  formatSupplyRequestTimestamp,
  supplyRequestStatusLabel,
  supplyRequestStatusTone,
} from "../lib/supplyRequests.js";
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

function itemDiff(currentItems = [], proposedItems = []) {
  return {
    current: describeSupplyRequestItems(currentItems),
    proposed: describeSupplyRequestItems(proposedItems),
  };
}

export default function OperatorSupplyRequestsPanel() {
  const { user } = useAuth();
  const role = user?.role === "admin" ? "admin" : "operator";
  const [tab, setTab] = useState("active");
  const [requests, setRequests] = useState([]);
  const [history, setHistory] = useState({
    requests: [],
    total: 0,
    doctor_counts: [],
    item_counts: [],
  });
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [filters, setFilters] = useState({
    doctor_id: "",
    status: "",
    from: "",
    to: "",
    item: "",
  });
  const [historyOffset, setHistoryOffset] = useState(0);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [amendmentTarget, setAmendmentTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [fulfilmentRequest, setFulfilmentRequest] = useState(null);

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
      });
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
      await loadActive();
      if (tab === "history") await loadHistory();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update request.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function reviewAmendment(request, amendment, decision, reason = "") {
    if (updatingId) return;
    setUpdatingId(request.id);
    try {
      await api.patch(`/restock-requests/${request.id}/amendments/${amendment.id}`, {
        decision,
        reason,
      });
      toast.success(decision === "accepted" ? "Change request accepted." : "Change request declined.");
      setAmendmentTarget(null);
      setRejectOpen(false);
      setRejectReason("");
      await loadActive();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not review the change request.");
    } finally {
      setUpdatingId(null);
    }
  }

  const pendingCount = requests.filter((row) => row.status === "pending").length;
  const changeCount = requests.filter((row) => row.pending_amendment).length;
  const historyPage = Math.floor(historyOffset / HISTORY_PAGE_SIZE) + 1;
  const historyPages = Math.max(1, Math.ceil(history.total / HISTORY_PAGE_SIZE));

  return (
    <>
      <SectionCard
        title="Supply Requests"
        subtitle={
          loading
            ? "Loading…"
            : tab === "history"
              ? `${history.total} archived request${history.total === 1 ? "" : "s"}`
              : pendingCount > 0
                ? `${pendingCount} pending pack${pendingCount === 1 ? "" : "s"}${
                    changeCount ? ` · ${changeCount} change request${changeCount === 1 ? "" : "s"}` : ""
                  }`
                : "No pending packs"
        }
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-2xl bg-[#ba5a32]/10 px-3 py-1.5 text-xs font-bold text-[#ba5a32]">
            <Inbox className="size-3.5" />
            Inbox
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
                "min-h-10 rounded-xl text-sm font-bold transition",
                tab === item.id ? "bg-[#2d8f98] text-white" : "text-slate-600",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "active" ? (
          error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : !requests.length && !loading ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
              No active restock requests from doctors right now.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
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
                  {requests.map((request) => {
                    const busy = updatingId === request.id;
                    const pendingAmendment = request.pending_amendment;
                    return (
                      <tr key={request.id} className="align-top">
                        <td className="px-3 py-3 font-semibold text-slate-800">
                          <div>Dr. {request.doctor_name}</div>
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
                        </td>
                        <td className="px-3 py-3">{statusBadge(request, role)}</td>
                        <td className="px-3 py-3 text-right">
                          <div className="flex flex-col items-end gap-2">
                            {request.status === "pending" ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  patchRequest(request, { status: "accepted" }, "Request accepted.")
                                }
                                className="inline-flex items-center gap-1.5 rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#26717c] disabled:opacity-60"
                              >
                                {busy ? "Saving…" : "Request Accepted"}
                              </button>
                            ) : null}
                            {request.status === "accepted" ? (
                              <button
                                type="button"
                                disabled={busy || Boolean(pendingAmendment)}
                                onClick={() => setFulfilmentRequest(request)}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#26717c] disabled:opacity-60"
                                title={
                                  pendingAmendment
                                    ? "Review the pending change request before picking."
                                    : undefined
                                }
                              >
                                {busy ? "Saving…" : "Open fulfilment"}
                              </button>
                            ) : null}
                            {request.status === "ready" ? (
                              <span className="text-[11px] text-slate-400">
                                Waiting for doctor to confirm collection
                                {request.ready_by_name ? ` · prepared by ${request.ready_by_name}` : ""}
                              </span>
                            ) : null}
                            {request.status !== "completed" && request.status !== "cancelled" ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setCancelTarget(request);
                                  setCancelReason("");
                                }}
                                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                              >
                                Cancel & archive
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Doctor
                <select
                  value={filters.doctor_id}
                  onChange={(event) => {
                    setHistoryOffset(0);
                    setFilters((current) => ({ ...current, doctor_id: event.target.value }));
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  <option value="">All doctors</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.full_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Outcome
                <select
                  value={filters.status}
                  onChange={(event) => {
                    setHistoryOffset(0);
                    setFilters((current) => ({ ...current, status: event.target.value }));
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  <option value="">Completed & cancelled</option>
                  <option value="completed">
                    {role === "operator" ? "Supply Dispatched" : "Completed"}
                  </option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                From
                <input
                  type="date"
                  value={filters.from}
                  onChange={(event) => {
                    setHistoryOffset(0);
                    setFilters((current) => ({ ...current, from: event.target.value }));
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                To
                <input
                  type="date"
                  value={filters.to}
                  onChange={(event) => {
                    setHistoryOffset(0);
                    setFilters((current) => ({ ...current, to: event.target.value }));
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </label>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Item search
                <input
                  type="search"
                  value={filters.item}
                  onChange={(event) => {
                    setHistoryOffset(0);
                    setFilters((current) => ({ ...current, item: event.target.value }));
                  }}
                  placeholder="Item name"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </label>
            </div>

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
                        <span className="font-bold tabular-nums">{row.request_count}</span>
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
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
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
                        <td className="px-3 py-3 text-[11px] text-slate-500">
                          {request.accepted_by_name ? (
                            <div>Accepted by {request.accepted_by_name}</div>
                          ) : null}
                          {request.ready_by_name ? (
                            <div>Prepared by {request.ready_by_name}</div>
                          ) : null}
                          {request.completed_at ? (
                            <div>
                              {role === "operator" ? "Dispatched" : "Completed"}{" "}
                              {formatSupplyRequestTimestamp(request.completed_at)}
                            </div>
                          ) : null}
                          {request.cancelled_at ? (
                            <div>
                              Cancelled {formatSupplyRequestTimestamp(request.cancelled_at)}
                              {request.cancelled_reason ? ` · ${request.cancelled_reason}` : ""}
                            </div>
                          ) : null}
                          {request.transfer_transaction_id ? (
                            <div>Transfer {request.transfer_transaction_id}</div>
                          ) : null}
                          {(request.events || []).length ? (
                            <ol className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                              {request.events.map((event) => (
                                <li key={event.id}>
                                  {formatSupplyRequestTimestamp(event.created_at)} · {event.event_type}
                                  {event.actor_display_name ? ` · ${event.actor_display_name}` : ""}
                                  {event.reason ? ` · ${event.reason}` : ""}
                                </li>
                              ))}
                            </ol>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">{statusBadge(request, role)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {history.total > HISTORY_PAGE_SIZE ? (
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                <button
                  type="button"
                  disabled={historyOffset <= 0}
                  onClick={() => setHistoryOffset((value) => Math.max(0, value - HISTORY_PAGE_SIZE))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 disabled:opacity-40"
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
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      <Modal
        open={Boolean(amendmentTarget)}
        onClose={() => {
          setAmendmentTarget(null);
          setRejectOpen(false);
          setRejectReason("");
        }}
        title="Change requested"
        description="Compare the currently accepted request with the doctor's proposed changes."
        size="md"
      >
        {amendmentTarget?.pending_amendment ? (
          <div className="flex flex-col gap-4">
            {(() => {
              const proposed = amendmentTarget.pending_amendment;
              const items = itemDiff(amendmentTarget.items, proposed.items);
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Currently accepted
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-800">
                      {formatSupplyRequestCollectionDay(amendmentTarget.collection_date)}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{items.current || "—"}</p>
                    {amendmentTarget.note ? (
                      <p className="mt-2 text-[11px] italic text-slate-500">“{amendmentTarget.note}”</p>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                      Proposed
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-800">
                      {formatSupplyRequestCollectionDay(proposed.proposed_collection_date)}
                    </p>
                    <p className="mt-1 text-sm text-slate-700">{items.proposed || "—"}</p>
                    {proposed.proposed_note ? (
                      <p className="mt-2 text-[11px] italic text-slate-600">“{proposed.proposed_note}”</p>
                    ) : null}
                  </div>
                </div>
              );
            })()}

            {rejectOpen ? (
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Decline reason (optional)
                <textarea
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value.slice(0, 500))}
                  rows={2}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                />
              </label>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  if (!rejectOpen) {
                    setRejectOpen(true);
                    return;
                  }
                  reviewAmendment(
                    amendmentTarget,
                    amendmentTarget.pending_amendment,
                    "rejected",
                    rejectReason,
                  );
                }}
                className="min-h-11 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700"
              >
                {rejectOpen ? "Confirm decline" : "Decline changes"}
              </button>
              <button
                type="button"
                onClick={() =>
                  reviewAmendment(amendmentTarget, amendmentTarget.pending_amendment, "accepted")
                }
                className="min-h-11 rounded-2xl bg-[#2d8f98] px-5 py-2.5 text-sm font-bold text-white"
              >
                Accept changes
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => {
          setCancelTarget(null);
          setCancelReason("");
        }}
        title="Cancel and archive this request?"
        description="The request will be moved to History. It will not be permanently deleted."
        size="md"
      >
        <div className="flex flex-col gap-4">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Cancellation reason
            <textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value.slice(0, 500))}
              rows={3}
              placeholder="Why is this request being archived?"
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
              disabled={!cancelReason.trim() || updatingId === cancelTarget?.id}
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
        onClose={() => setFulfilmentRequest(null)}
        onUpdated={loadActive}
      />
    </>
  );
}
