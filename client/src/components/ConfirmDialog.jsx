import Modal from "./Modal.jsx";

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size="md">
      <div className="space-y-4">
        {children}
        <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`min-h-11 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition disabled:opacity-60 ${
            tone === "danger"
              ? "bg-rose-600 hover:bg-rose-700"
              : "bg-ocs-teal hover:bg-ocs-teal/90"
          }`}
        >
          {confirmLabel}
        </button>
        </div>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
