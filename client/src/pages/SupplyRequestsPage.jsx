import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ClipboardList, Plus } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import LoadingState from "../components/LoadingState.jsx";
import SupplyRequestDetailDrawer from "../components/SupplyRequestDetailDrawer.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useDoctorSupplyRequests } from "../hooks/useDoctorSupplyRequests.js";
import { api, ApiError } from "../lib/api.js";
import { buildInventoryListQuery } from "../lib/inventoryFolders.js";
import {
  canDoctorCancelRequest,
  canDoctorConfirmCollection,
  canDoctorEditRequest,
  canDoctorRequestChanges,
  describeSupplyRequestItems,
  formatSupplyRequestCollectionDay,
  formatSupplyRequestTimestamp,
  supplyRequestStatusLabel,
  supplyRequestStatusTone,
} from "../lib/supplyRequests.js";
import { cx } from "../lib/utils.js";

const HISTORY_PAGE_SIZE = 20;

function amendmentStatusLabel(status) {
  if (status === "pending") return "Changes Awaiting Review";
  if (status === "accepted") return "Changes accepted";
  if (status === "rejected") return "Changes declined";
  return status || "";
}

function RequestTimeline({ request }) {
  const rows = [
    ["Requested", request.created_at, request.requested_by_name],
    ["Accepted", request.accepted_at, request.accepted_by_name],
    ["Supply ready", request.ready_at, request.ready_by_name || request.prepared_by_name],
    ["Supply collected", request.completed_at, request.completed_by_name],
    ["Cancelled", request.cancelled_at, request.cancelled_by_name],
  ].filter(([, at]) => at);

  if (!rows.length) return null;

  return (
    <dl className="grid gap-1 text-[11px] text-gray-500">
      {rows.map(([label, at, actor]) => (
        <div key={label} className="flex items-start justify-between gap-3">
          <dt className="font-semibold text-gray-400">{label}</dt>
          <dd className="text-right">
            {formatSupplyRequestTimestamp(at)}
            {actor ? <span className="block font-medium text-gray-500">{actor}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AmendmentHistory({ amendments = [] }) {
  if (!amendments.length) return null;

  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Amendment history
      </p>
      <ul className="mt-1 flex flex-col gap-1.5">
        {amendments.map((amendment) => (
          <li key={amendment.id} className="text-[11px] text-slate-600">
            <span className="font-semibold">{amendmentStatusLabel(amendment.status)}</span>
            {" · "}
            {formatSupplyRequestTimestamp(amendment.submitted_at)}
            {amendment.reviewed_at
              ? ` · reviewed ${formatSupplyRequestTimestamp(amendment.reviewed_at)}`
              : ""}
            {amendment.review_reason ? ` · ${amendment.review_reason}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function SupplyRequestsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState("active");
  const [refreshKey, setRefreshKey] = useState(0);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [editingRequest, setEditingRequest] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [confirmAction, setConfirmAction] = useState(null);
  const [detailRequestId, setDetailRequestId] = useState(null);

  const historyParams = useMemo(
    () => ({ limit: HISTORY_PAGE_SIZE, offset: historyOffset }),
    [historyOffset],
  );

  const {
    displayableRequests,
    historyRequests,
    historyTotal,
    loading,
    historyLoading,
    error,
    historyError,
    dismissRequest,
  } = useDoctorSupplyRequests({
    refreshKey,
    includeHistory: tab === "history",
    historyParams,
  });

  useEffect(() => {
    let ignore = false;

    async function loadCatalog() {
      setCatalogLoading(true);
      try {
        const payload = await api.get(
          `/inventory${buildInventoryListQuery({
            doctorContext: "ocs",
            includeDoctorContext: true,
          })}`,
        );
        if (!ignore) {
          setCatalogItems(Array.isArray(payload?.ocs_stock) ? payload.ocs_stock : []);
        }
      } catch (err) {
        if (!ignore) {
          toast.error(err instanceof ApiError ? err.message : "Could not load OCS catalog.");
        }
      } finally {
        if (!ignore) {
          setCatalogLoading(false);
        }
      }
    }

    loadCatalog();
    return () => {
      ignore = true;
    };
  }, []);

  const bumpRefresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  function closeModal() {
    setModalOpen(false);
    setEditingRequest(null);
    setModalMode("create");
  }

  function openCreateModal() {
    setEditingRequest(null);
    setModalMode("create");
    setModalOpen(true);
  }

  function openEditModal(request) {
    setEditingRequest(request);
    setModalMode("edit");
    setModalOpen(true);
  }

  function openAmendModal(request) {
    setEditingRequest(request);
    setModalMode("amend");
    setModalOpen(true);
  }

  async function handleSubmit(payload) {
    setIsSaving(true);
    try {
      if (modalMode === "amend" && editingRequest?.id) {
        await api.post(`/restock-requests/${editingRequest.id}/amendments`, payload);
        toast.success("Change request sent for operator review.");
      } else if (modalMode === "edit" && editingRequest?.id) {
        await api.put(`/restock-requests/${editingRequest.id}`, payload);
        toast.success("Supply request updated.");
      } else {
        await api.post("/restock-requests", payload);
        toast.success("Supply request sent to operators.");
      }
      closeModal();
      bumpRefresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not save request.";
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function runRequestAction(request, body, successMessage, { archive = false } = {}) {
    if (updatingId) return;
    setUpdatingId(request.id);
    try {
      await api.patch(`/restock-requests/${request.id}`, body);
      if (archive) dismissRequest(request.id);
      toast.success(successMessage);
      bumpRefresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not update request.";
      toast.error(message);
    } finally {
      setUpdatingId(null);
      setConfirmAction(null);
    }
  }

  if (user?.role !== "doctor") {
    return <Navigate to="/" replace />;
  }

  const historyPage = Math.floor(historyOffset / HISTORY_PAGE_SIZE) + 1;
  const historyPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));

  return (
    <>
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col gap-3.5 bg-slate-50 px-1 py-2 md:max-w-2xl md:px-0 md:py-4">
        <div className="mb-1 flex items-center gap-2 px-1">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-gray-500 transition active:bg-white/80"
            aria-label="Go back"
          >
            <ChevronLeft className="size-6 font-bold" strokeWidth={2.5} />
          </button>
          <h1 className="text-lg font-extrabold text-ocs-slate">My Supply Requests</h1>
        </div>

        <div className="px-1">
          <button
            type="button"
            onClick={openCreateModal}
            disabled={catalogLoading}
            className="flex w-full min-h-11 items-center justify-center gap-2 rounded-2xl bg-ocs-teal px-4 py-3 text-sm font-bold text-white shadow-sm transition active:scale-[0.98] active:bg-ocs-teal/90 disabled:opacity-60"
          >
            <Plus className="size-4" />
            New supply request
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 shadow-sm">
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
                tab === item.id ? "bg-ocs-teal text-white" : "text-slate-600",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "active" ? (
          loading ? (
            <LoadingState label="Loading supply requests" />
          ) : error ? (
            <div className="mx-1 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : displayableRequests.length === 0 ? (
            <div className="mx-1 rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
              <ClipboardList className="mx-auto mb-3 size-8 text-[#ba5a32]/60" />
              <p>No active supply requests.</p>
              <p className="mt-1 text-[11px] text-gray-400">
                Submit a new request or check History for collected and cancelled orders.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5 px-1">
              {displayableRequests.map((request) => {
                const statusLabel = supplyRequestStatusLabel(request.status, "doctor");
                const pendingAmendment = request.pending_amendment;
                const latestAmendment = request.latest_amendment;
                const busy = updatingId === request.id;

                return (
                  <article
                    key={request.id}
                    className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between border-b border-gray-50 pb-2">
                      <div>
                        <span className="block text-xs font-semibold text-gray-400">
                          Collection window
                        </span>
                        <span className="text-sm font-bold text-gray-800">
                          {formatSupplyRequestCollectionDay(request.collection_date)}
                        </span>
                      </div>
                      <span
                        className={cx(
                          "rounded-lg px-2.5 py-1 text-[11px] font-bold",
                          supplyRequestStatusTone(request.status),
                        )}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 py-0.5">
                      {(request.items || []).map((item) => (
                        <p
                          key={`${request.id}-${item.id || item.item_name}`}
                          className="text-xs font-bold text-gray-700"
                        >
                          {item.item_name} × {item.quantity}
                        </p>
                      ))}
                    </div>

                    {request.note ? (
                      <p className="text-[11px] italic text-gray-500">“{request.note}”</p>
                    ) : null}

                    {request.accepted_by_name ? (
                      <p className="text-[11px] font-medium text-sky-700">
                        Accepted by {request.accepted_by_name}
                      </p>
                    ) : null}

                    {(request.status === "ready" || request.status === "accepted") &&
                    request.fulfilment?.items?.length ? (
                      <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                        {(request.fulfilment.items || []).map((line) => (
                          <p key={line.id || line.item_name}>
                            {line.item_name}: requested {line.requested_quantity} · expected{" "}
                            {line.fulfilled_quantity || line.reserved_quantity}
                            {Number(line.shortage_quantity || 0) > 0
                              ? ` · short ${line.shortage_quantity}`
                              : ""}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    {(request.status === "ready" || request.status === "completed") &&
                    (request.ready_by_name || request.prepared_by_name) ? (
                      <p className="text-[11px] font-medium text-emerald-700">
                        Prepared by {request.ready_by_name || request.prepared_by_name}
                      </p>
                    ) : null}

                    {pendingAmendment ? (
                      <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        <p className="font-bold">Changes Awaiting Review</p>
                        <p className="mt-1">
                          {describeSupplyRequestItems(pendingAmendment.items)} ·{" "}
                          {formatSupplyRequestCollectionDay(pendingAmendment.proposed_collection_date)}
                        </p>
                      </div>
                    ) : null}

                    {!pendingAmendment &&
                    latestAmendment?.status === "rejected" &&
                    request.status === "accepted" ? (
                      <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                        <p className="font-bold">Change request declined</p>
                        {latestAmendment.review_reason ? (
                          <p className="mt-1">{latestAmendment.review_reason}</p>
                        ) : (
                          <p className="mt-1">Your accepted request is unchanged.</p>
                        )}
                      </div>
                    ) : null}

                    {canDoctorEditRequest(request) ? (
                      <div className="mt-1 flex items-center gap-2.5 border-t border-gray-50 pt-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openEditModal(request)}
                          className="flex-1 rounded-xl border border-gray-200/60 bg-gray-50 py-2.5 text-xs font-bold text-gray-700 transition-all hover:bg-gray-100 active:scale-[0.98]"
                        >
                          Edit request
                        </button>
                        {canDoctorCancelRequest(request) ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setConfirmAction({
                                type: "cancel",
                                request,
                              })
                            }
                            className="flex-1 rounded-xl border border-rose-100/60 bg-rose-50 py-2.5 text-xs font-bold text-rose-600 transition-all hover:bg-rose-100 active:scale-[0.98] disabled:opacity-60"
                          >
                            {busy ? "Cancelling…" : "Cancel request"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {canDoctorRequestChanges(request) ? (
                      <div className="border-t border-gray-50 pt-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openAmendModal(request)}
                          className="w-full rounded-xl border border-sky-100 bg-sky-50 py-2.5 text-xs font-bold text-sky-800 transition hover:bg-sky-100 disabled:opacity-60"
                        >
                          Request Changes
                        </button>
                      </div>
                    ) : null}

                    {canDoctorConfirmCollection(request) ? (
                      <div className="border-t border-gray-50 pt-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setConfirmAction({
                              type: "collect",
                              request,
                            })
                          }
                          className="w-full min-h-11 rounded-xl bg-ocs-teal py-2.5 text-xs font-bold text-white transition active:scale-[0.98] disabled:opacity-60"
                        >
                          {busy ? "Confirming…" : "Supply Collected"}
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setDetailRequestId(request.id)}
                      className="mt-1 w-full min-h-11 rounded-xl border border-gray-200 py-2.5 text-xs font-bold text-gray-700"
                    >
                      View details
                    </button>
                  </article>
                );
              })}
            </div>
          )
        ) : historyLoading ? (
          <LoadingState label="Loading history" />
        ) : historyError ? (
          <div className="mx-1 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {historyError}
          </div>
        ) : historyRequests.length === 0 ? (
          <div className="mx-1 rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
            <p>No collected or cancelled requests yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5 px-1">
            {historyRequests.map((request) => (
              <article
                key={request.id}
                className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-gray-800">
                      {formatSupplyRequestCollectionDay(request.collection_date)}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {describeSupplyRequestItems(request.items)}
                    </p>
                  </div>
                  <span
                    className={cx(
                      "rounded-lg px-2.5 py-1 text-[11px] font-bold",
                      supplyRequestStatusTone(request.status),
                    )}
                  >
                    {supplyRequestStatusLabel(request.status, "doctor")}
                  </span>
                </div>
                {request.note ? (
                  <p className="text-[11px] italic text-gray-500">“{request.note}”</p>
                ) : null}
                {request.cancelled_reason ? (
                  <p className="text-[11px] text-rose-600">Reason: {request.cancelled_reason}</p>
                ) : null}
                <RequestTimeline request={request} />
                <AmendmentHistory amendments={request.amendments} />
                <button
                  type="button"
                  onClick={() => setDetailRequestId(request.id)}
                  className="min-h-11 rounded-xl border border-gray-200 py-2.5 text-xs font-bold text-gray-700"
                >
                  View details
                </button>
              </article>
            ))}
            {historyTotal > HISTORY_PAGE_SIZE ? (
              <div className="flex items-center justify-between px-1 text-xs font-semibold text-slate-500">
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
                  disabled={historyOffset + HISTORY_PAGE_SIZE >= historyTotal}
                  onClick={() => setHistoryOffset((value) => value + HISTORY_PAGE_SIZE)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <RestockRequestModal
        open={modalOpen}
        isSaving={isSaving}
        catalogItems={catalogItems}
        editingRequest={editingRequest}
        mode={modalMode}
        onClose={closeModal}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={confirmAction?.type === "cancel"}
        onClose={() => setConfirmAction(null)}
        title="Cancel this supply request?"
        description="The request will be archived in History. It will not be permanently deleted."
        confirmLabel="Archive request"
        onConfirm={() =>
          confirmAction?.request
            ? runRequestAction(
                confirmAction.request,
                { status: "cancelled" },
                "Request archived in history.",
                { archive: true },
              )
            : null
        }
      />

      <ConfirmDialog
        open={confirmAction?.type === "collect"}
        onClose={() => setConfirmAction(null)}
        tone="default"
        title="Confirm supply collected?"
        description="This records collection, posts the inventory transfer into your bag, and moves the request into History."
        confirmLabel="Supply Collected"
        onConfirm={() =>
          confirmAction?.request
            ? runRequestAction(
                confirmAction.request,
                { status: "completed" },
                "Supply collected. The request is now in History.",
                { archive: true },
              )
            : null
        }
      />

      <SupplyRequestDetailDrawer
        open={Boolean(detailRequestId)}
        requestId={detailRequestId}
        role="doctor"
        onClose={() => setDetailRequestId(null)}
      />
    </>
  );
}
