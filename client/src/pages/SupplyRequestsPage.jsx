import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ClipboardList, Plus } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import LoadingState from "../components/LoadingState.jsx";
import RestockRequestModal from "../components/RestockRequestModal.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useDoctorSupplyRequests } from "../hooks/useDoctorSupplyRequests.js";
import { api, ApiError } from "../lib/api.js";
import { buildInventoryListQuery } from "../lib/inventoryFolders.js";
import {
  formatSupplyRequestCollectionDay,
  supplyRequestStatusLabel,
  supplyRequestStatusTone,
} from "../lib/supplyRequests.js";
import { cx } from "../lib/utils.js";

export default function SupplyRequestsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  const { requests, loading, error, reload } = useDoctorSupplyRequests({ refreshKey });

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
  }

  function openCreateModal() {
    setEditingRequest(null);
    setModalOpen(true);
  }

  function openEditModal(request) {
    setEditingRequest(request);
    setModalOpen(true);
  }

  async function handleSubmit(payload) {
    setIsSaving(true);
    try {
      if (editingRequest?.id) {
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

  async function handleCancel(requestId) {
    if (updatingId) return;
    const confirmed = window.confirm(
      "Cancel this supply order? Operators will no longer prepare this pack.",
    );
    if (!confirmed) return;

    setUpdatingId(requestId);
    try {
      await api.patch(`/restock-requests/${requestId}`, { status: "cancelled" });
      toast.success("Supply request cancelled.");
      await reload();
      bumpRefresh();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not cancel request.";
      toast.error(message);
    } finally {
      setUpdatingId(null);
    }
  }

  if (user?.role !== "doctor") {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col gap-3.5 bg-[#f8f9fa] px-1 py-2 md:max-w-2xl md:px-0 md:py-4">
        <div className="mb-1 flex items-center gap-2 px-1">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-gray-500 transition active:bg-white/80"
            aria-label="Go back"
          >
            <ChevronLeft className="size-6 font-bold" strokeWidth={2.5} />
          </button>
          <h1 className="text-lg font-extrabold text-gray-800">My Supply Requests</h1>
        </div>

        <div className="px-1">
          <button
            type="button"
            onClick={openCreateModal}
            disabled={catalogLoading}
            className="flex w-full min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#ba5a32] px-4 py-3 text-sm font-bold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
          >
            <Plus className="size-4" />
            New supply request
          </button>
        </div>

        {loading ? (
          <LoadingState label="Loading supply requests" />
        ) : error ? (
          <div className="mx-1 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : !requests.length ? (
          <div className="mx-1 rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
            <ClipboardList className="mx-auto mb-3 size-8 text-[#ba5a32]/60" />
            <p>No supply requests yet.</p>
            <p className="mt-1 text-[11px] text-gray-400">Submit a request and track it here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5 px-1">
            {requests.map((request) => {
              const isPending = request.status === "pending";
              const isCancelled = request.status === "cancelled";
              const statusLabel = supplyRequestStatusLabel(request.status);

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

                  {request.status === "prepared" && request.prepared_by_name ? (
                    <p className="text-[11px] font-medium text-emerald-700">
                      Prepared by {request.prepared_by_name}
                    </p>
                  ) : null}

                  {isPending ? (
                    <div className="mt-1 flex items-center gap-2.5 border-t border-gray-50 pt-3">
                      <button
                        type="button"
                        disabled={updatingId === request.id}
                        onClick={() => openEditModal(request)}
                        className="flex-1 rounded-xl border border-gray-200/60 bg-gray-50 py-2.5 text-xs font-bold text-gray-700 transition-all hover:bg-gray-100 active:scale-[0.98]"
                      >
                        Edit request
                      </button>
                      <button
                        type="button"
                        disabled={updatingId === request.id}
                        onClick={() => handleCancel(request.id)}
                        className="flex-1 rounded-xl border border-rose-100/60 bg-rose-50 py-2.5 text-xs font-bold text-rose-600 transition-all hover:bg-rose-100 active:scale-[0.98] disabled:opacity-60"
                      >
                        {updatingId === request.id ? "Cancelling…" : "Cancel order"}
                      </button>
                    </div>
                  ) : null}

                  {isCancelled ? (
                    <p className="border-t border-gray-50 pt-2 text-[11px] text-gray-400">
                      This request was cancelled and is read-only.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <RestockRequestModal
        open={modalOpen}
        isSaving={isSaving}
        catalogItems={catalogItems}
        editingRequest={editingRequest}
        onClose={closeModal}
        onSubmit={handleSubmit}
      />
    </>
  );
}
