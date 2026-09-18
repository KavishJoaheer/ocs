import { useState } from "react";
import Modal from "../Modal.jsx";

export default function ReverseWriteOffModal({ open, row, isSaving, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const ready = reason.trim().length >= 10 && confirmed;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reverse write-off"
      description="This preserves the original event and posts a compensating entry back to the exact recorded batch."
      size="sm"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          onSubmit({ reason: reason.trim(), confirm: true });
        }}
      >
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
          <p className="font-black">{row?.item_name || "Inventory item"}</p>
          <p className="mt-1">
            Restore {Math.abs(Number(row?.quantity || 0))} unit(s) to the original evidenced batch.
          </p>
        </div>
        <label className="block space-y-2">
          <span className="text-sm font-bold text-slate-700">Reason for reversal</span>
          <textarea
            autoFocus
            required
            minLength={10}
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why the original write-off was incorrect"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base outline-none focus:border-[#2d8f98] focus:bg-white"
          />
          <p className="text-xs text-slate-500">At least 10 characters. The reason is retained in audit history.</p>
        </label>
        <label className="flex min-h-12 items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[#17666a]"
          />
          <span className="text-sm font-semibold text-slate-700">
            I checked the original batch evidence and confirm this compensating reversal.
          </span>
        </label>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="min-h-11 rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={!ready || isSaving} className="min-h-11 rounded-2xl bg-rose-700 px-5 text-sm font-black text-white disabled:opacity-50">
            {isSaving ? "Reversing…" : "Post reversal"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
