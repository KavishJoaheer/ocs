import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, PackageSearch } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import { api } from "../lib/api.js";
import { formatSupplyRequestCollectionDay } from "../lib/supplyRequests.js";

function qty(value) {
  return Number(value || 0);
}

export default function OperatorFulfilmentPanel({ request, open, onClose, onUpdated }) {
  const [detail, setDetail] = useState(null);
  const [lines, setLines] = useState([]);
  const [partialApproved, setPartialApproved] = useState(false);
  const [partialReason, setPartialReason] = useState("");
  const [saving, setSaving] = useState(false);

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
            picked_quantity: qty(line.picked_quantity || line.reserved_quantity),
            fulfilled_quantity: qty(line.fulfilled_quantity || line.reserved_quantity),
          })),
        );
        setPartialApproved(Boolean(fulfilment?.partial_approved));
        setPartialReason(fulfilment?.partial_reason || "");
      })
      .catch((error) => toast.error(error.message || "Could not load fulfilment."));
    return () => {
      cancelled = true;
    };
  }, [open, request?.id]);

  const hasShortage = Boolean(detail?.has_shortage);
  const linkageRequired = Boolean(detail?.linkage_required);

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
      await api.patch(`/restock-requests/${request.id}/fulfilment`, {
        lines,
        partial_approved: partialApproved,
        partial_reason: partialReason,
        ...extra,
      });
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
      await api.patch(`/restock-requests/${request.id}/fulfilment`, {
        lines,
        partial_approved: partialApproved,
        partial_reason: partialReason,
      });
      await api.patch(`/restock-requests/${request.id}`, { status: "ready" });
      toast.success("Supply marked ready.");
      await onUpdated?.();
      onClose?.();
    } catch (error) {
      toast.error(error.message || "Could not mark supply ready.");
    } finally {
      setSaving(false);
    }
  }

  async function reconcile() {
    setSaving(true);
    try {
      await api.post(`/restock-requests/${request.id}/reconcile`, {
        reason: "Operator reconciled legacy fulfilment quantities and batches.",
      });
      toast.success("Fulfilment linked.");
      await onUpdated?.();
    } catch (error) {
      toast.error(error.message || "Could not reconcile this request.");
    } finally {
      setSaving(false);
    }
  }

  return (
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
      {linkageRequired ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">Fulfilment linkage required</p>
          <p className="mt-1 text-xs">
            This accepted request has no reservation record. Reconcile actual quantities before collection.
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={reconcile}
            className="mt-3 rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
          >
            Reconcile fulfilment
          </button>
        </div>
      ) : (
        <div className="space-y-4">
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
                  <th className="px-3 py-2 text-right">ATP</th>
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
                              : `B${batch.batch_id} exp ${batch.expiry_date || "missing"} ×${batch.quantity}`,
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
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right"
                        value={qty(line.picked_quantity)}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((row) =>
                              Number(row.id) === Number(line.id)
                                ? { ...row, picked_quantity: Number(event.target.value || 0) }
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
                        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right"
                        value={qty(line.fulfilled_quantity)}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((row) =>
                              Number(row.id) === Number(line.id)
                                ? { ...row, fulfilled_quantity: Number(event.target.value || 0) }
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
              disabled={saving}
              onClick={() => save({ resolve_shortages: true })}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Resolve shortages
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => save()}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              <PackageSearch className="size-3.5" />
              Save pick
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={markReady}
              className="inline-flex items-center gap-1 rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-bold text-white"
            >
              <CheckCircle2 className="size-3.5" />
              Mark supply ready
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
