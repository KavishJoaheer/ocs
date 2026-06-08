import Modal from "./Modal.jsx";

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size="md">
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`rounded-2xl px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition ${
            tone === "danger"
              ? "bg-rose-600 hover:bg-rose-700"
              : "bg-[#2d8f98] hover:bg-[#26717c]"
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;
