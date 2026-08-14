import { useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { api } from "../lib/api.js";

function InventoryStocktakePanel({ items = [], onApplied }) {
  const [counts, setCounts] = useState({});
  const [savingId, setSavingId] = useState(null);

  const rows = useMemo(
    () => (Array.isArray(items) ? items.slice(0, 40) : []),
    [items],
  );

  async function submitRow(item) {
    const physical = Number(counts[item.id]);
    if (!Number.isInteger(physical) || physical < 0) {
      toast.error("Enter a whole number count.");
      return;
    }
    setSavingId(item.id);
    try {
      const result = await api.post("/inventory/stocktake", {
        item_id: item.id,
        physical_quantity: physical,
        note: "UI stocktake",
      });
      const discrepancy = Number(result.discrepancy || 0);
      if (discrepancy !== 0) {
        const apply = window.confirm(
          `${item.item_name}: counted ${physical}, system ${item.quantity} (difference ${discrepancy}). Apply this count to OCS stock?`,
        );
        if (apply) {
          await api.put(`/inventory/items/${item.id}`, {
            quantity: physical,
            adjustment_note: `Stocktake ${new Date().toISOString().slice(0, 10)}`,
          });
          toast.success("Stock quantity updated.");
        } else {
          toast.success("Stocktake logged without changing quantity.");
        }
      } else {
        toast.success("Count matches the system.");
      }
      setCounts((current) => ({ ...current, [item.id]: "" }));
      await onApplied?.();
    } catch (error) {
      toast.error(error.message || "Could not save this stocktake.");
    } finally {
      setSavingId(null);
    }
  }

  if (!rows.length) {
    return null;
  }

  return (
    <SectionCard
      title="Stocktake"
      subtitle="Count OCS stock, log the difference, and optionally apply the correction."
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
          <ClipboardCheck className="size-3.5" />
          Count
        </span>
      }
    >
      <div className="space-y-2">
        {rows.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{item.item_name}</p>
              <p className="text-xs text-slate-500">System qty {item.quantity}</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="1"
                value={counts[item.id] ?? ""}
                onChange={(event) =>
                  setCounts((current) => ({ ...current, [item.id]: event.target.value }))
                }
                placeholder="Count"
                className="w-24 rounded-xl border border-slate-200 px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={savingId === item.id}
                onClick={() => submitRow(item)}
                className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {savingId === item.id ? "Saving…" : "Log"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export default InventoryStocktakePanel;
