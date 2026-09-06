import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import TransferReceiptModal from "./inventory/TransferReceiptModal.jsx";
import { api, ApiError } from "../lib/api.js";
import {
  fetchSupplyRequestDetail,
  formatSupplyRequestCollectionDay,
  formatSupplyRequestTimestamp,
  getSupplyRequestActions,
  supplyRequestStatusLabel,
  supplyRequestStatusTone,
} from "../lib/supplyRequests.js";
import { printTransferReceipt } from "../lib/transferReceipt.js";
import { cx } from "../lib/utils.js";

const LEGACY_ACTOR = "Actor unavailable for this legacy record.";
const LEGACY_STAFF = "Legacy staff record";

function amendmentStatusLabel(status) {
  if (status === "pending") return "Changes awaiting review";
  if (status === "accepted") return "Changes accepted";
  if (status === "rejected") return "Changes declined";
  return status || "";
}

function actorLabel(name, { expected = false } = {}) {
  const value = String(name || "").trim();
  if (value && value.toLowerCase() !== "staff") return value;
  if (expected) return LEGACY_STAFF;
  return null;
}

function DetailSection({ title, children }) {
  return (
    <section>
      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ActionButton({ action, onClick }) {
  if (!action || action.kind === "info") return null;
  const className =
    action.kind === "primary"
      ? "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#2d8f98] px-4 text-sm font-bold text-white disabled:opacity-60 sm:w-auto"
      : action.kind === "danger"
        ? "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 disabled:opacity-60 sm:w-auto"
        : "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 disabled:opacity-60 sm:w-auto";
  return (
    <button type="button" disabled={action.disabled} onClick={onClick} className={className}>
      {action.disabled && action.kind === "primary" ? "Saving…" : action.label}
    </button>
  );
}

export default function SupplyRequestDetailDrawer({
  open,
  requestId,
  role = "operator",
  busy = false,
  onClose,
  onAccept,
  onFulfil,
  onReviewAmendment,
  onCancel,
  onPrintReceipt,
}) {
  const [request, setRequest] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [receiptError, setReceiptError] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadReceipt(transactionId) {
    setReceiptError("");
    try {
      const nextReceipt = await api.get(`/inventory/receipts/${transactionId}`);
      const payload = nextReceipt?.receipt || nextReceipt;
      setReceipt(payload);
      return payload;
    } catch (err) {
      setReceipt(null);
      setReceiptError(err instanceof ApiError ? err.message : "Could not load the transfer receipt.");
      return null;
    }
  }

  useEffect(() => {
    if (!open || !requestId) {
      setRequest(null);
      setReceipt(null);
      setReceiptError("");
      setReceiptOpen(false);
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
          await loadReceipt(detail.transfer_transaction_id);
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

  const fulfilment = request?.fulfilment || null;
  const fulfilmentItems = fulfilment?.items || [];
  const currentItems = request?.items || [];
  const originalItems = request?.original_items || [];
  const status = request?.status;
  const lifecycleReady = ["accepted", "ready", "completed"].includes(status);
  const timeline = request?.timeline?.length
    ? request.timeline
    : (request?.events || []).map((event) => ({
        id: event.id,
        label: event.event_label || String(event.event_type || "").replace(/_/g, " "),
        at: event.created_at,
        actor: event.actor_display_name,
        reason: event.reason,
      }));

  const footerActions = useMemo(() => {
    if (!request) return [];
    return getSupplyRequestActions({ request, role, busy }).filter((action) => action.id !== "details");
  }, [request, role, busy]);

  const dense = Boolean(
    timeline.length > 4
      || (request?.amendments || []).length
      || fulfilmentItems.length > 2
      || (request?.movements || []).length,
  );

  function handleAction(action) {
    if (!action || action.disabled) return;
    if (action.id === "accept") onAccept?.(request);
    if (action.id === "fulfil") onFulfil?.(request);
    if (action.id === "review_amendment") onReviewAmendment?.(request);
    if (action.id === "cancel") onCancel?.(request);
    if (action.id === "receipt") openReceipt();
  }

  async function openReceipt() {
    if (!request?.transfer_transaction_id) return;
    let next = receipt;
    if (!next) {
      next = await loadReceipt(request.transfer_transaction_id);
    }
    if (!next) return;
    setReceiptOpen(true);
  }

  function printLoadedReceipt() {
    if (onPrintReceipt) {
      onPrintReceipt(receipt);
      return;
    }
    const printed = printTransferReceipt(receipt);
    if (!printed) toast.error("Unable to open print preview.");
  }

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={request ? `Request #${request.id}` : "Request details"}
      description="Role-specific status, items, fulfilment and audit trail."
      size={dense ? "lg" : "md"}
      innerScroll={false}
    >
      {loading ? (
        <p className="text-sm text-slate-500" aria-live="polite">Loading request details…</p>
      ) : error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">{error}</p>
      ) : request ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-4 pr-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-slate-900">Dr. {request.doctor_name}</p>
                <p className="text-xs text-slate-500">
                  Created {formatSupplyRequestTimestamp(request.created_at)} · Collection{" "}
                  {formatSupplyRequestCollectionDay(request.collection_date)}
                </p>
              </div>
              <span className={cx("rounded-full px-3 py-1 text-xs font-bold", supplyRequestStatusTone(request.status))}>
                {supplyRequestStatusLabel(request.status, role)}
              </span>
            </div>

            {status === "ready" ? (
              <p className="rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                The doctor must confirm collection. Staff cannot mark this request collected.
              </p>
            ) : null}

            <DetailSection title="Requested items">
              <ul className="space-y-2">
                {currentItems.map((item) => {
                  const original = originalItems.find(
                    (row) => Number(row.inventory_id || 0) === Number(item.inventory_id || 0) || row.item_name === item.item_name,
                  );
                  const fulfilmentLine = fulfilmentItems.find(
                    (row) => Number(row.inventory_id || 0) === Number(item.inventory_id || 0) || row.item_name === item.item_name,
                  );
                  const batches = fulfilmentLine?.picked_batches || fulfilmentLine?.allocations || fulfilmentLine?.batches || [];
                  return (
                    <li key={item.id || item.item_name} className="rounded-2xl border border-slate-100 px-3 py-2 text-sm">
                      <p className="break-words font-semibold text-slate-800">{item.item_name}</p>
                      <p className="text-xs text-slate-500">
                        Original {original?.quantity ?? item.quantity} · Current {item.quantity}
                        {fulfilmentLine
                          ? ` · Reserved ${fulfilmentLine.reserved_quantity ?? 0} · Fulfilled ${fulfilmentLine.fulfilled_quantity ?? 0}`
                          : ""}
                        {Number(fulfilmentLine?.shortage_quantity || 0) > 0
                          ? ` · Shortage ${fulfilmentLine.shortage_quantity}${fulfilmentLine.shortage_reason ? ` (${fulfilmentLine.shortage_reason})` : ""}`
                          : ""}
                      </p>
                      {batches.length ? (
                        <ul className="mt-1 text-xs text-slate-500">
                          {batches.map((batch) => (
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
            </DetailSection>

            {lifecycleReady ? (
              <DetailSection title="Fulfilment">
                {request.fulfilment_recorded ? (
                  <p className="text-sm text-slate-700">
                    Reserved, fulfilled and picked-batch quantities are listed on each item above.
                    {request.partial_fulfilment_approved
                      ? ` Partial fulfilment approved${request.partial_fulfilment_reason ? `: ${request.partial_fulfilment_reason}` : "."}`
                      : ""}
                  </p>
                ) : (
                  <p className="text-sm text-slate-600">Fulfilment details were not recorded for this legacy request.</p>
                )}
              </DetailSection>
            ) : null}

            <DetailSection title="Actors">
              <div className="grid gap-2 text-sm text-slate-700">
                {request.accepted_at ? (
                  <p>
                    Accepted by {actorLabel(request.accepted_by_name, { expected: true }) || LEGACY_ACTOR} ·{" "}
                    {formatSupplyRequestTimestamp(request.accepted_at)}
                  </p>
                ) : null}
                {request.ready_at ? (
                  <p>
                    Ready / prepared by {actorLabel(request.ready_by_name || request.prepared_by_name, { expected: true }) || LEGACY_ACTOR} ·{" "}
                    {formatSupplyRequestTimestamp(request.ready_at || request.prepared_at)}
                  </p>
                ) : null}
                {request.completed_at ? (
                  <p>
                    Collected / dispatched by {actorLabel(request.completed_by_name, { expected: true }) || LEGACY_ACTOR} ·{" "}
                    {formatSupplyRequestTimestamp(request.completed_at)}
                  </p>
                ) : null}
                {request.cancelled_at ? (
                  <p className="text-rose-700">
                    Cancelled by {actorLabel(request.cancelled_by_name, { expected: true }) || LEGACY_STAFF} ·{" "}
                    {formatSupplyRequestTimestamp(request.cancelled_at)}
                    {request.cancelled_reason ? ` · ${request.cancelled_reason}` : ""}
                  </p>
                ) : null}
                {!request.accepted_at && !request.ready_at && !request.completed_at && !request.cancelled_at ? (
                  <p className="text-sm text-slate-500">No actor events have been recorded yet.</p>
                ) : null}
              </div>
            </DetailSection>

            {(request.amendments || []).length ? (
              <DetailSection title="Amendment history">
                <ul className="space-y-2 text-sm text-slate-700">
                  {request.amendments.map((amendment) => (
                    <li key={amendment.id} className="rounded-2xl bg-slate-50 px-3 py-2">
                      <p className="font-semibold">{amendmentStatusLabel(amendment.status)}</p>
                      <p className="text-xs text-slate-500">
                        Proposed {dayjs(amendment.submitted_at).format("DD MMM YYYY, HH:mm")}
                        {amendment.submitted_by_name ? ` · ${amendment.submitted_by_name}` : ""}
                        {amendment.reviewed_at ? ` · decided ${dayjs(amendment.reviewed_at).format("DD MMM YYYY, HH:mm")}` : ""}
                        {amendment.reviewed_by_name
                          ? ` · ${amendment.reviewed_by_name}`
                          : amendment.reviewed_at
                            ? ` · ${LEGACY_STAFF}`
                            : ""}
                      </p>
                      {amendment.review_reason ? <p className="text-xs">{amendment.review_reason}</p> : null}
                    </li>
                  ))}
                </ul>
              </DetailSection>
            ) : null}

            {status === "completed" || request.transfer_transaction_id ? (
              <DetailSection title="Inventory movements">
                {(request.movement_ids || []).length ? (
                  <p className="text-sm text-slate-700">Movement IDs: {(request.movement_ids || []).join(", ")}</p>
                ) : (
                  <p className="text-sm text-slate-600">Inventory movements were not recorded for this legacy request.</p>
                )}
                {request.transfer_transaction_id ? (
                  <p className="mt-1 text-sm text-slate-700">Transfer ID: {request.transfer_transaction_id}</p>
                ) : null}
              </DetailSection>
            ) : null}

            <DetailSection title="Status timeline">
              {timeline.length ? (
                <ol className="space-y-2 border-l-2 border-slate-200 pl-3">
                  {timeline.map((event) => (
                    <li key={event.id || `${event.label}-${event.at}`} className="text-sm text-slate-700">
                      <p className="font-semibold">{event.label}</p>
                      <p className="text-xs text-slate-500">
                        {formatSupplyRequestTimestamp(event.at)}
                        {` · ${actorLabel(event.actor, { expected: true }) || LEGACY_STAFF}`}
                        {event.reason ? ` · ${event.reason}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-600">No historical event timeline is available for this request.</p>
              )}
            </DetailSection>
          </div>

          <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white/95 pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
            {request.receipt_available ? (
              <button
                type="button"
                onClick={openReceipt}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#2d8f98] px-4 text-sm font-semibold text-white"
              >
                <Printer className="size-4" />
                View receipt
              </button>
            ) : request.receipt_applicable && request.transfer_transaction_id ? (
              <p className="text-sm text-rose-700" role="alert">
                {receiptError || "Receipt reference exists but could not be loaded."}{" "}
                <button type="button" className="underline" onClick={() => loadReceipt(request.transfer_transaction_id)}>
                  Retry
                </button>
              </p>
            ) : null}
            {footerActions
              .filter((action) => action.id !== "receipt")
              .map((action) => (
                <ActionButton key={action.id} action={action} onClick={() => handleAction(action)} />
              ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">No request selected.</p>
      )}
    </Modal>
    <TransferReceiptModal
      open={receiptOpen && Boolean(receipt)}
      receipt={receipt}
      onClose={() => setReceiptOpen(false)}
      onPrint={printLoadedReceipt}
    />
    </>
  );
}
