import { formatRupees } from "../../lib/format.js";
import { formatAllocationExpiry } from "../../lib/inventoryAccess.js";

export default function AllocationPreviewList({ preview, emptyLabel = "Enter a quantity to preview FEFO batches." }) {
  const allocations = preview?.allocations || [];
  if (!allocations.length) {
    return <p className="text-sm text-slate-500">{preview ? "No batches available for this quantity." : emptyLabel}</p>;
  }
  return (
    <ul className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
      {allocations.map((row) => (
        <li key={`${row.batch_id}-${row.quantity}`} className="flex items-start justify-between gap-3 text-sm">
          <span className="min-w-0 break-words text-slate-700">
            Batch #{row.batch_id} · {formatAllocationExpiry(row)}
          </span>
          <span className="shrink-0 tabular-nums font-semibold text-slate-900">
            {row.quantity} u
            {Number(row.unit_cost || 0) > 0 ? ` · ${formatRupees(row.quantity * Number(row.unit_cost || 0))}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
