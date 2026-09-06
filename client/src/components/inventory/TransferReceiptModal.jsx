import { Printer } from "lucide-react";
import Modal from "../Modal.jsx";

export default function TransferReceiptModal({ open, receipt, onClose, onPrint }) {
  if (!receipt) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stock transfer receipt"
      description="Formatted transfer note for this inventory movement."
      size="lg"
    >
      <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">Transaction ID: {receipt.transaction_id}</p>
        <p className="text-xs text-slate-600">
          Issued by {receipt.issued_by_name || "Actor unavailable"} · Received by{" "}
          {receipt.received_by_name || "Actor unavailable"}
        </p>
        {(receipt.items || []).length ? (
          <ul className="space-y-1 text-sm text-slate-700">
            {receipt.items.map((line) => (
              <li key={`${line.item_name}-${line.batch_number || line.quantity}`}>
                {line.item_name} × {line.quantity} {line.unit || "unit"}
                {line.expiry ? ` · ${line.expiry}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">
          Close
        </button>
        <button type="button" onClick={onPrint} className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[#4FB8B3] px-4 text-sm font-semibold text-white">
          <Printer className="size-4" />
          Print Restock Receipt
        </button>
      </div>
    </Modal>
  );
}
