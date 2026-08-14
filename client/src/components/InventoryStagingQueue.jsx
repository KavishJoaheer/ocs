import { useMemo, useState } from "react";
import { Package } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { api } from "../lib/api.js";

function InventoryStagingQueue({ rows = [], onReleased }) {
  const [releasingId, setReleasingId] = useState(null);
  const pending = useMemo(
    () => (Array.isArray(rows) ? rows : []).filter((row) => row.status === "pending"),
    [rows],
  );

  if (!pending.length) {
    return null;
  }

  async function releaseRow(row) {
    if (releasingId) return;
    setReleasingId(row.id);
    try {
      await api.post(`/inventory/staging/${row.id}/release`);
      toast.success(`${row.item_name} released into OCS stock.`);
      await onReleased?.();
    } catch (error) {
      toast.error(error.message || "Could not release this shipment.");
    } finally {
      setReleasingId(null);
    }
  }

  return (
    <SectionCard
      title="Incoming shipments"
      subtitle={`${pending.length} pending item${pending.length === 1 ? "" : "s"} ready to release`}
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-[#2d8f98]/10 px-3 py-1.5 text-xs font-bold text-[#2d8f98]">
          <Package className="size-3.5" />
          Staging
        </span>
      }
    >
      <div className="space-y-3">
        {pending.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{row.item_name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Qty {row.quantity}
                {row.expiry_date ? ` · Exp ${row.expiry_date}` : ""}
              </p>
            </div>
            <button
              type="button"
              disabled={Boolean(releasingId)}
              onClick={() => releaseRow(row)}
              className="rounded-xl bg-[#4FB8B3] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {releasingId === row.id ? "Releasing…" : "Release"}
            </button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export default InventoryStagingQueue;
