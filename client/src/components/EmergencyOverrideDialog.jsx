import { useState } from "react";
import Modal from "./Modal.jsx";
import { MIN_OVERRIDE_REASON } from "../lib/inventoryAccess.js";

export default function EmergencyOverrideDialog({
  open,
  title = "Emergency operational override",
  summary,
  confirmLabel = "Apply override",
  onClose,
  onConfirm,
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();
  const valid = trimmed.length >= MIN_OVERRIDE_REASON;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onConfirm(trimmed);
      setReason("");
      onClose?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="This is not the routine warehouse workflow. An operator should perform the action unless an emergency requires an administrator to proceed."
      size="md"
    >
      <div className="space-y-3 text-sm text-slate-700">
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">{summary}</p>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Override reason (min {MIN_OVERRIDE_REASON} characters)
          </span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            className="w-full rounded-xl border border-slate-200 px-3 py-2"
            placeholder="Explain why an operator cannot complete this action now."
          />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void submit()}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-rose-700 px-3 font-bold text-white disabled:opacity-60"
          >
            {busy ? "Applying…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
