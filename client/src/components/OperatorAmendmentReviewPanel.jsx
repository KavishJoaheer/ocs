import { useState } from "react";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import { api, ApiError } from "../lib/api.js";
import {
  compareSupplyRequestAmendment,
  formatSupplyRequestCollectionDay,
} from "../lib/supplyRequests.js";
import { cx } from "../lib/utils.js";

function changeLabel(change) {
  if (change === "added") return "Added";
  if (change === "removed") return "Removed";
  if (change === "quantity") return "Quantity changed";
  return "Unchanged";
}

export default function OperatorAmendmentReviewPanel({ request, open, onClose, onReviewed }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [acceptNote, setAcceptNote] = useState("");
  const [saving, setSaving] = useState(false);

  const proposed = request?.pending_amendment || null;
  const lines = proposed
    ? compareSupplyRequestAmendment(request.items, proposed.items)
    : [];
  const dateChanged =
    proposed && String(request.collection_date || "") !== String(proposed.proposed_collection_date || "");
  const noteChanged = proposed && String(request.note || "") !== String(proposed.proposed_note || "");

  function reset() {
    setRejectOpen(false);
    setRejectReason("");
    setAcceptNote("");
  }

  async function review(decision) {
    if (!request?.id || !proposed?.id || saving) return;
    const reason = decision === "rejected" ? rejectReason.trim() : acceptNote.trim();
    if (decision === "rejected" && reason.length < 10) {
      toast.error("A decline reason of at least 10 characters is required.");
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/restock-requests/${request.id}/amendments/${proposed.id}`, {
        decision,
        reason,
      });
      toast.success(decision === "accepted" ? "Change request accepted." : "Change request declined.");
      reset();
      await onReviewed?.(decision);
      onClose?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not review the change request.");
      if (err instanceof ApiError && err.status === 409) {
        await onReviewed?.("conflict");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose?.();
      }}
      title="Review requested changes"
      description="Compare the currently accepted request with the doctor's proposed changes."
      size="lg"
    >
      {proposed ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Currently accepted</p>
              <p className={cx("mt-2 text-sm font-semibold", dateChanged ? "text-slate-500 line-through" : "text-slate-800")}>
                {formatSupplyRequestCollectionDay(request.collection_date)}
              </p>
              {request.note ? (
                <p className={cx("mt-2 text-[11px] italic", noteChanged ? "text-slate-400 line-through" : "text-slate-500")}>
                  “{request.note}”
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-slate-400">No note</p>
              )}
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Proposed</p>
              <p className={cx("mt-2 text-sm font-semibold", dateChanged ? "text-amber-900" : "text-slate-800")}>
                {formatSupplyRequestCollectionDay(proposed.proposed_collection_date)}
              </p>
              {proposed.proposed_note ? (
                <p className={cx("mt-2 text-[11px] italic", noteChanged ? "text-amber-800" : "text-slate-600")}>
                  “{proposed.proposed_note}”
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-slate-400">No note</p>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Accepted</th>
                  <th className="px-3 py-2 text-right">Proposed</th>
                  <th className="px-3 py-2 text-left">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((line) => (
                  <tr
                    key={line.key}
                    className={cx(
                      line.change === "added" && "bg-emerald-50",
                      line.change === "removed" && "bg-rose-50",
                      line.change === "quantity" && "bg-amber-50",
                    )}
                  >
                    <td className="px-3 py-2 font-semibold text-slate-800">{line.item_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {line.current_quantity == null ? "—" : line.current_quantity}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {line.proposed_quantity == null ? "—" : line.proposed_quantity}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {changeLabel(line.change)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rejectOpen ? (
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Decline reason
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value.slice(0, 500))}
                rows={2}
                placeholder="At least 10 characters"
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-700"
              />
            </label>
          ) : (
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Review note (optional)
              <textarea
                value={acceptNote}
                onChange={(event) => setAcceptNote(event.target.value.slice(0, 500))}
                rows={2}
                placeholder="Optional note for the doctor"
                className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case text-slate-700"
              />
            </label>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (!rejectOpen) {
                  setRejectOpen(true);
                  return;
                }
                void review("rejected");
              }}
              className="min-h-11 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 disabled:opacity-60"
            >
              {rejectOpen ? "Confirm decline" : "Decline changes"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void review("accepted")}
              className="min-h-11 rounded-2xl bg-[#2d8f98] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              Accept changes
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">This request no longer has a pending change.</p>
      )}
    </Modal>
  );
}
