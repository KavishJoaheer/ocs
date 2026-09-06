import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import { api, ApiError } from "../lib/api.js";
import {
  fetchSupplyRequestDetail,
  formatSupplyRequestCollectionDay,
  formatSupplyRequestTimestamp,
  supplyRequestStatusLabel,
  supplyRequestStatusTone,
} from "../lib/supplyRequests.js";
import { cx } from "../lib/utils.js";

function amendmentStatusLabel(status) {
  if (status === "pending") return "Changes awaiting review";
  if (status === "accepted") return "Changes accepted";
  if (status === "rejected") return "Changes declined";
  return status || "";
}

export default function SupplyRequestDetailDrawer({
  open,
  requestId,
  role = "operator",
  onClose,
  onPrintReceipt,
}) {
  const [request, setRequest] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !requestId) {
      setRequest(null);
      setReceipt(null);
      setError("");
      return undefined;
    }
    let ignore = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const detail = await fetchSupplyRequestDetail(requestId);
        if (ignore) return;
        setRequest(detail);
        if (detail?.receipt_available && detail?.transfer_transaction_id) {
          try {
            const nextReceipt = await api.get(`/inventory/receipts/${detail.transfer_transaction_id}`);
            if (!ignore) setReceipt(nextReceipt);
          } catch {
            if (!ignore) setReceipt(null);
          }
        } else {
          setReceipt(null);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof ApiError ? err.message : "Could not load request details.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [open, requestId]);

  const fulfilmentItems = request?.fulfilment?.items || [];
  const currentItems = request?.items || [];
  const originalItems = request?.original_items || [];
  const timeline = request?.timeline?.length
    ? request.timeline
    : (request?.events || []).map((event) => ({
        id: event.id,
        label: event.event_label || String(event.event_type || "").replace(/_/g, " "),
        at: event.created_at,
        actor: event.actor_display_name,
        reason: event.reason,
      }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={request ? `Request #${request.id}` : "Request details"}
      description="Role-specific status, items, fulfilment and audit trail."
      size="lg"
      innerScroll
    >
      {loading ? (
        <p className="text-sm text-slate-500">Loading request details…</p>
      ) : error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : request ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900">Dr. {request.doctor_name}</p>
              <p className="text-xs text-slate-500">
                Created {formatSupplyRequestTimestamp(request.created_at)} · Collection{" "}
                {formatSupplyRequestCollectionDay(request.collection_date)}
              </p>
            </div>
            <span className={cx("rounded-full px-3 py-1 text-xs font-bold", supplyRequestStatusTone(request.status))}>
              {supplyRequestStatusLabel(request.status, role)}
            </span>
          </div>

          <section>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Requested items</h4>
            <ul className="mt-2 space-y-2">
              {currentItems.map((item) => {
                const original = originalItems.find(
                  (row) => Number(row.inventory_id || 0) === Number(item.inventory_id || 0) || row.item_name === item.item_name,
                );
                const fulfilment = fulfilmentItems.find(
                  (row) => Number(row.inventory_id || 0) === Number(item.inventory_id || 0) || row.item_name === item.item_name,
                );
                return (
                  <li key={item.id || item.item_name} className="rounded-2xl border border-slate-100 px-3 py-2 text-sm">
                    <p className="break-words font-semibold text-slate-800">{item.item_name}</p>
                    <p className="text-xs text-slate-500">
                      Original {original?.quantity ?? item.quantity} · Current {item.quantity}
                      {fulfilment
                        ? ` · Fulfilled ${fulfilment.fulfilled_quantity ?? 0} · Reserved ${fulfilment.reserved_quantity ?? 0}`
                        : ""}
                      {Number(fulfilment?.shortage_quantity || 0) > 0
                        ? ` · Shortage ${fulfilment.shortage_quantity}${fulfilment.shortage_reason ? ` (${fulfilment.shortage_reason})` : ""}`
                        : ""}
                    </p>
                    {(fulfilment?.picked_batches || fulfilment?.batches || []).length ? (
                      <ul className="mt-1 text-xs text-slate-500">
                        {(fulfilment.picked_batches || fulfilment.batches).map((batch) => (
                          <li key={batch.id || `${batch.batch_id}-${batch.quantity}`}>
                            Batch {batch.batch_id || batch.id} · {batch.expiry_date || (batch.is_non_expiring ? "Non-expiring" : "—")} ×{" "}
                            {batch.quantity || batch.quantity_picked}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grid gap-2 text-sm text-slate-700">
            {request.accepted_by_name ? (
              <p>Accepted by {request.accepted_by_name} · {formatSupplyRequestTimestamp(request.accepted_at)}</p>
            ) : null}
            {request.ready_by_name || request.prepared_by_name ? (
              <p>
                Ready / prepared by {request.ready_by_name || request.prepared_by_name} ·{" "}
                {formatSupplyRequestTimestamp(request.ready_at || request.prepared_at)}
              </p>
            ) : null}
            {request.completed_at ? (
              <p>
                Collected {formatSupplyRequestTimestamp(request.completed_at)}
                {request.completed_by_name ? ` · ${request.completed_by_name}` : ""}
              </p>
            ) : null}
            {request.cancelled_at ? (
              <p className="text-rose-700">
                Cancelled by {request.cancelled_by_name || "staff"} · {formatSupplyRequestTimestamp(request.cancelled_at)}
                {request.cancelled_reason ? ` · ${request.cancelled_reason}` : ""}
              </p>
            ) : null}
            {request.transfer_transaction_id ? (
              <p>Transfer ID: {request.transfer_transaction_id}</p>
            ) : null}
            {(request.movement_ids || []).length ? (
              <p>Inventory movements: {(request.movement_ids || []).join(", ")}</p>
            ) : null}
          </section>

          {(request.amendments || []).length ? (
            <section>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Amendment history</h4>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                {request.amendments.map((amendment) => (
                  <li key={amendment.id} className="rounded-2xl bg-slate-50 px-3 py-2">
                    <p className="font-semibold">{amendmentStatusLabel(amendment.status)}</p>
                    <p className="text-xs text-slate-500">
                      Proposed {dayjs(amendment.submitted_at).format("DD MMM YYYY, HH:mm")}
                      {amendment.reviewed_at ? ` · decided ${dayjs(amendment.reviewed_at).format("DD MMM YYYY, HH:mm")}` : ""}
                      {amendment.reviewed_by_name ? ` · ${amendment.reviewed_by_name}` : ""}
                    </p>
                    {amendment.review_reason ? <p className="text-xs">{amendment.review_reason}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {timeline.length ? (
            <section>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Status timeline</h4>
              <ol className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3">
                {timeline.map((event) => (
                  <li key={event.id || `${event.label}-${event.at}`} className="text-sm text-slate-700">
                    <p className="font-semibold">{event.label}</p>
                    <p className="text-xs text-slate-500">
                      {formatSupplyRequestTimestamp(event.at)}
                      {event.actor ? ` · ${event.actor}` : ""}
                      {event.reason ? ` · ${event.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {request.receipt_available ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                  onClick={() => {
                    if (!receipt) {
                      toast.error("Receipt is not available yet.");
                      return;
                    }
                    if (onPrintReceipt) {
                      onPrintReceipt(receipt);
                      return;
                    }
                    const printWindow = window.open("", "_blank", "noopener,noreferrer");
                    if (!printWindow) return;
                    printWindow.document.write(`<pre>${JSON.stringify(receipt, null, 2)}</pre>`);
                    printWindow.document.close();
                    printWindow.print();
                  }}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#2d8f98] px-4 text-sm font-semibold text-white"
              >
                <Printer className="size-4" />
                View receipt
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No request selected.</p>
      )}
    </Modal>
  );
}
