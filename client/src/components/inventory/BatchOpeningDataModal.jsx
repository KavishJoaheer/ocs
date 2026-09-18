import { useState } from "react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";

const FIELD = "min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none focus:border-[#2d8f98] focus:bg-white";

export default function BatchOpeningDataModal({ open, item, batch, isSaving, onClose, onSubmit }) {
  const isNewBatch = !batch?.id;
  const [form, setForm] = useState(() => ({
    unit_cost: Number(batch?.unit_cost || 0) > 0 ? String(batch.unit_cost) : "",
    expiry_date: batch?.expiry_date || "",
    is_non_expiring: Boolean(batch?.is_non_expiring),
    reason: "",
  }));

  const costReady = Number(form.unit_cost) > 0;
  const expiryReady = form.is_non_expiring || /^\d{4}-\d{2}-\d{2}$/.test(form.expiry_date);
  const reasonReady = form.reason.trim().length >= 10;
  const valid = costReady && expiryReady && reasonReady;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNewBatch ? "Create opening batch" : "Verify batch opening data"}
      description="Use the supplier invoice, delivery note, or package label. Verified data unlocks eligible stock for use."
      size="sm"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) {
            toast.error("Complete the actual cost, expiry status, and evidence note.");
            return;
          }
          onSubmit({
            unit_cost: Number(form.unit_cost),
            expiry_date: form.is_non_expiring ? null : form.expiry_date,
            is_non_expiring: form.is_non_expiring,
            reason: form.reason.trim(),
            expected_row_version: Number(batch?.row_version || item?.row_version || 1),
            confirm: true,
          });
        }}
      >
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-black">
            {item?.item_name || "Inventory item"}{isNewBatch ? " · Unbatched opening stock" : ` · Batch #${batch?.id}`}
          </p>
          <p className="mt-1">
            On hand {Number(batch?.quantity_remaining || item?.unbatched_quantity || 0)}. This stock remains blocked until its data is verified.
          </p>
        </div>
        <label className="block space-y-2">
          <span className="text-sm font-bold text-slate-700">Actual unit cost (Rs)</span>
          <input required min="0.01" step="0.01" inputMode="decimal" type="number" value={form.unit_cost} onChange={(event) => setForm((value) => ({ ...value, unit_cost: event.target.value }))} className={FIELD} />
        </label>
        <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4">
          <input type="checkbox" checked={form.is_non_expiring} onChange={(event) => setForm((value) => ({ ...value, is_non_expiring: event.target.checked, expiry_date: event.target.checked ? "" : value.expiry_date }))} className="size-5 accent-[#2d8f98]" />
          <span className="text-sm font-bold text-slate-700">Manufacturer confirms this item is non-expiring</span>
        </label>
        {!form.is_non_expiring ? (
          <label className="block space-y-2">
            <span className="text-sm font-bold text-slate-700">Verified expiry date</span>
            <input required type="date" value={form.expiry_date} onChange={(event) => setForm((value) => ({ ...value, expiry_date: event.target.value }))} className={FIELD} />
          </label>
        ) : null}
        <label className="block space-y-2">
          <span className="text-sm font-bold text-slate-700">Evidence checked</span>
          <textarea required minLength={10} rows={3} value={form.reason} onChange={(event) => setForm((value) => ({ ...value, reason: event.target.value }))} className={`${FIELD} py-3`} placeholder="e.g. Supplier invoice INV-104 and package label checked" />
          <span className="text-xs text-slate-500">This note is retained in the immutable audit history.</span>
        </label>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-700">Cancel</button>
          <button type="submit" disabled={isSaving || !valid} className="min-h-11 rounded-2xl bg-[#17666a] px-5 text-sm font-black text-white disabled:opacity-50">
            {isSaving ? "Verifying…" : isNewBatch ? "Create verified batch" : "Verify and unlock batch"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
