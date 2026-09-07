import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, PackageSearch } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import { api } from "../lib/api.js";
import { formatSupplyRequestCollectionDay } from "../lib/supplyRequests.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { ATP_HELP_TEXT } from "../lib/inventoryStockDisplay.js";
import { withOperationalOverride } from "../lib/inventoryAccess.js";
import { setUnsavedWork } from "../lib/unsavedWork.js";

function qty(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function OperatorFulfilmentPanel({ request, open, onClose, onUpdated, emergencyOverride = false }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [detail, setDetail] = useState(null);
  const [lines, setLines] = useState([]);
  const [partialApproved, setPartialApproved] = useState(false);
  const [partialReason, setPartialReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [overrideReason, setOverrideReason] = useState(request?.__overrideReason || "");
  const [preview, setPreview] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reconReason, setReconReason] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!open || !request?.id) return undefined;
    let cancelled = false;
    api
      .get(`/restock-requests/${request.id}/fulfilment`)
      .then((payload) => {
        if (cancelled) return;
        const fulfilment = payload.fulfilment || payload.request?.fulfilment;
        setDetail(fulfilment);
        setLines(
          (fulfilment?.items || []).map((line) => ({
            id: line.id,
            picked_quantity: qty(line.picked_quantity),
            fulfilled_quantity: qty(line.fulfilled_quantity),
          })),
        );
        setPartialApproved(Boolean(fulfilment?.partial_approved));
        setPartialReason(fulfilment?.partial_reason || "");
      })
      .catch((error) => toast.error(error.message || "Could not load fulfilment."));
    return () => {
      cancelled = true;
    };
  }, [open, request?.id, request?.__overrideReason]);

  useEffect(() => {
    setUnsavedWork("fulfilment", Boolean(open && request?.id));
    return () => setUnsavedWork("fulfilment", false);
  }, [open, request?.id]);

  const requireOverride = isAdmin || emergencyOverride || Boolean(request?.__override);
  function withOverride(payload) {
    if (!requireOverride) return payload;
    return withOperationalOverride(user, payload, overrideReason || request?.__overrideReason || "");
  }

  const hasShortage = Boolean(detail?.has_shortage);
  const linkageRequired = Boolean(detail?.linkage_required) || Boolean(detail?.reconciliation_required);
  const fulfilmentLocked = String(request?.status) === "ready" && !linkageRequired;
  const overrideBlocked = requireOverride && String(overrideReason || "").trim().length < 10;

  const summary = useMemo(
    () =>
      (detail?.items || []).map((line) => {
        const draft = lines.find((row) => Number(row.id) === Number(line.id)) || {};
        return {
          ...line,
          picked_quantity: qty(draft.picked_quantity),
          fulfilled_quantity: qty(draft.fulfilled_quantity),
        };
      }),
    [detail, lines],
  );

  async function save(extra = {}) {
    if (!request?.id) return;
    setSaving(true);
    try {
      await api.patch(`/restock-requests/${request.id}/fulfilment`, withOverride({
        lines,
        partial_approved: partialApproved,
        partial_reason: partialReason,
        ...extra,
      }));
      toast.success("Fulfilment updated.");
      await onUpdated?.();
    } catch (error) {
      toast.error(error.message || "Could not update fulfilment.");
    } finally {
      setSaving(false);
    }
  }

  async function markReady() {
    if (!request?.id) return;
    setSaving(true);
    try {
      await api.patch(`/restock-requests/${request.id}/fulfilment`, withOverride({
        lines,
        partial_approved: partialApproved,
        partial_reason: partialReason,
      }));
      await api.patch(`/restock-requests/${request.id}`, withOverride({ status: "ready" }));
      toast.success("Supply marked ready.");
      await onUpdated?.();
      onClose?.();
    } catch (error) {
      toast.error(error.message || "Could not mark supply ready.");
    } finally {
      setSaving(false);
    }
  }

  async function openReconciliationPreview() {
    if (!request?.id || previewLoading || saving) return;
    setPreviewLoading(true);
    try {
      const payload = await api.get(`/restock-requests/${request.id}/reconcile/preview`);
      setPreview(payload.preview || payload);
      setReconReason("");
      setPreviewOpen(true);
    } catch (error) {
      toast.error(error.message || "Could not load the reconciliation preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmReconciliation() {
    if (!request?.id || saving) return;
    if (String(reconReason || "").trim().length < 10) {
      toast.error("Enter a reconciliation reason of at least 10 characters.");
      return;
    }
    setSaving(true);
    try {
      const payload = await api.post(`/restock-requests/${request.id}/reconcile`, withOverride({
        reason: String(reconReason).trim(),
        preview_token: preview?.preview_token,
      }));
      const fulfilment = payload.fulfilment || payload.request?.fulfilment;
      if (fulfilment) {
        setDetail(fulfilment);
        setLines(
          (fulfilment.items || []).map((line) => ({
            id: line.id,
            picked_quantity: qty(line.picked_quantity),
            fulfilled_quantity: qty(line.fulfilled_quantity),
          })),
        );
        setPartialApproved(Boolean(fulfilment.partial_approved));
        setPartialReason(fulfilment.partial_reason || "");
      }
      setPreviewOpen(false);
      setPreview(null);
      toast.success(payload.explanation || "Fulfilment linked.");
      await onUpdated?.(payload);
    } catch (error) {
      toast.error(error.message || "Could not reconcile this request.");
    } finally {
      setSaving(false);
    }
  }

  async function reconcile() {
    await openReconciliationPreview();
  }

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={`Fulfil request #${request?.id || ""}`}
      description={
        request
          ? `Dr. ${request.doctor_name} · collect ${formatSupplyRequestCollectionDay(request.collection_date)}`
          : "Pick reserved stock and lock the pack."
      }
      size="xl"
    >
      {requireOverride ? (
        <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          <p className="font-semibold">Emergency operational override</p>
          <p className="mt-1 text-xs">
            Routine picking and readiness are operator actions. Enter a reason of at least 10 characters to proceed.
          </p>
          <textarea
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
            rows={3}
            className="mt-2 w-full rounded-xl border border-rose-200 px-3 py-2"
            placeholder="Why an operator cannot complete this action now"
          />
        </div>
      ) : null}
      {linkageRequired ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">Fulfilment linkage required</p>
          <p className="mt-1 text-xs">
            Review the proposed reservations and batches before confirming. The first click does not change inventory.
          </p>
          <button
            type="button"
            disabled={saving || previewLoading || overrideBlocked}
            onClick={reconcile}
            className="mt-3 min-h-11 rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-600"
          >
            {previewLoading ? "Loading preview…" : "Review reconciliation"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {fulfilmentLocked ? (
            <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Fulfilment quantities and batch allocations are locked. Only the owning doctor can confirm collection.
            </p>
          ) : null}
          {hasShortage ? (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                Shortages are outstanding. Resolve after new stock arrives, or approve a partial fulfilment with a
                reason before marking ready.
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Req</th>
                  <th className="px-3 py-2 text-right">Reserved</th>
                  <th className="px-3 py-2 text-right" title={ATP_HELP_TEXT}>ATP</th>
                  <th className="px-3 py-2 text-right">Short</th>
                  <th className="px-3 py-2 text-right">Picked</th>
                  <th className="px-3 py-2 text-right">Fulfilled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-800">{line.item_name}</div>
                      <div className="text-[11px] text-slate-400">
                        {(line.allocations || [])
                          .map((batch) =>
                            batch.is_non_expiring
                              ? `B${batch.batch_id} non-expiring ×${batch.quantity}`
                              : `B${batch.batch_id} ${batch.is_non_expiring ? "Non-expiring" : batch.expiry_date ? (batch.expired ? "Expired" : batch.expiry_date) : "Expiry missing"} ×${batch.quantity}`,
                          )
                          .join(" · ") || "No batches"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(line.requested_quantity)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(line.reserved_quantity)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(line.available_to_promise)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-700">{qty(line.shortage_quantity)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        disabled={fulfilmentLocked}
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right disabled:bg-slate-100"
                        value={qty(line.picked_quantity)}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((row) =>
                              Number(row.id) === Number(line.id)
                                ? {
                                    ...row,
                                    picked_quantity:
                                      event.target.value === "" ? 0 : Number(event.target.value),
                                  }
                                : row,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        disabled={fulfilmentLocked}
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right disabled:bg-slate-100"
                        value={qty(line.fulfilled_quantity)}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((row) =>
                              Number(row.id) === Number(line.id)
                                ? {
                                    ...row,
                                    fulfilled_quantity:
                                      event.target.value === "" ? 0 : Number(event.target.value),
                                  }
                                : row,
                            ),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {fulfilmentLocked ? null : (
            <>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={partialApproved}
              onChange={(event) => setPartialApproved(event.target.checked)}
            />
            <span>Approve partial fulfilment (required when a shortage remains)</span>
          </label>
          {partialApproved ? (
            <textarea
              value={partialReason}
              onChange={(event) => setPartialReason(event.target.value)}
              placeholder="Reason for partial fulfilment (at least 10 characters)"
              className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm"
              rows={2}
            />
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={saving || overrideBlocked}
              onClick={() => save({ resolve_shortages: true })}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Resolve shortages
            </button>
            <button
              type="button"
              disabled={saving || overrideBlocked}
              onClick={() => save()}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              <PackageSearch className="size-3.5" />
              Save pick
            </button>
            <button
              type="button"
              disabled={saving || overrideBlocked}
              onClick={markReady}
              className="inline-flex items-center gap-1 rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-bold text-white"
            >
              <CheckCircle2 className="size-3.5" />
              Mark supply ready
            </button>
          </div>
            </>
          )}
        </div>
      )}
    </Modal>
    <Modal
      open={previewOpen}
      onClose={() => {
        if (saving) return;
        setPreviewOpen(false);
      }}
      title={`Review reconciliation #${preview?.request_number || request?.id || ""}`}
      description="This preview does not change inventory until you confirm."
      size="xl"
    >
      {preview ? (
        <div className="space-y-4 text-sm text-slate-700">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p><strong>Request #{preview.request_number}</strong> · {preview.current_status} → {preview.resulting_status}</p>
            <p>Dr. {preview.doctor_name} · collect {formatSupplyRequestCollectionDay(preview.collection_date)}</p>
            <p className="mt-2 text-xs">{preview.explanation}</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
            {preview.warning}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Requested</th>
                  <th className="px-3 py-2 text-right">Currently reserved</th>
                  <th className="px-3 py-2 text-right">Proposed reserved</th>
                  <th className="px-3 py-2 text-right">Proposed picked</th>
                  <th className="px-3 py-2 text-right">Proposed fulfilled</th>
                  <th className="px-3 py-2 text-right" title={ATP_HELP_TEXT}>ATP</th>
                  <th className="px-3 py-2 text-right">Shortage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(preview.lines || []).map((line) => (
                  <tr key={line.request_item_id}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-800">{line.item_name}</div>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">
                        {(line.allocations || []).length ? (line.allocations || []).map((batch) => (
                          <li key={`${batch.batch_id}-${batch.quantity}`}>
                            Batch {batch.batch_id} · {batch.expiry_date || (batch.is_non_expiring ? "Non-expiring" : "Expiry missing")} · qty {batch.quantity} · {batch.usability}
                          </li>
                        )) : <li>No eligible batches</li>}
                      </ul>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(line.requested_quantity)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(line.currently_reserved)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(line.proposed_reserved)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(line.proposed_picked)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(line.proposed_fulfilled)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{qty(line.available_to_promise)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-700">{qty(line.shortage_quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.partial_fulfilment ? (
            <p className="text-xs font-semibold text-amber-800">
              Partial fulfilment is proposed. Confirmation will not auto-approve it.
            </p>
          ) : null}
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Reconciliation reason
            <textarea
              value={reconReason}
              onChange={(event) => setReconReason(event.target.value.slice(0, 500))}
              rows={3}
              minLength={10}
              placeholder="Why this reconciliation is being applied (at least 10 characters)"
              className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case text-slate-800"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setPreviewOpen(false)}
              className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || String(reconReason || "").trim().length < 10}
              onClick={confirmReconciliation}
              className="min-h-11 rounded-xl bg-[#2d8f98] px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-600"
            >
              {saving ? "Applying…" : "Confirm reconciliation"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Loading preview…</p>
      )}
    </Modal>
    </>
  );
}
