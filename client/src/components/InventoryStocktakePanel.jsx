import { useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "./ConfirmDialog.jsx";
import SectionCard from "./SectionCard.jsx";
import { api } from "../lib/api.js";

function InventoryStocktakePanel({ items = [], folders = [], onApplied }) {
  const [counts, setCounts] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [folderId, setFolderId] = useState("all");
  const [search, setSearch] = useState("");
  const [pendingApply, setPendingApply] = useState(null);

  const rows = useMemo(() => {
    const source = Array.isArray(items) ? items : [];
    const query = search.trim().toLowerCase();
    return source.filter((item) => {
      if (folderId !== "all" && String(item.folder_id) !== String(folderId)) {
        return false;
      }
      if (!query) return true;
      return String(item.item_name || "").toLowerCase().includes(query);
    });
  }, [items, folderId, search]);

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
      setCounts((current) => ({ ...current, [item.id]: "" }));
      if (discrepancy !== 0) {
        setPendingApply({ item, physical, discrepancy });
      } else {
        toast.success("Count matches the system.");
        await onApplied?.();
      }
    } catch (error) {
      toast.error(error.message || "Could not save this stocktake.");
    } finally {
      setSavingId(null);
    }
  }

  async function applyPending() {
    if (!pendingApply) return;
    const { item, physical } = pendingApply;
    try {
      await api.put(`/inventory/items/${item.id}`, {
        quantity: physical,
        adjustment_note: `Stocktake ${new Date().toISOString().slice(0, 10)}`,
      });
      toast.success("Stock quantity updated.");
      setPendingApply(null);
      await onApplied?.();
    } catch (error) {
      toast.error(error.message || "Could not apply this count.");
    }
  }

  function dismissPending() {
    toast.success("Stocktake logged without changing quantity.");
    setPendingApply(null);
    void onApplied?.();
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
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search items"
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm sm:max-w-xs"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setFolderId("all")}
            className={`rounded-2xl px-3 py-1.5 text-xs font-semibold ${
              folderId === "all" ? "bg-[#2d8f98] text-white" : "border border-slate-200 bg-white text-slate-700"
            }`}
          >
            All folders
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setFolderId(String(folder.id))}
              className={`rounded-2xl px-3 py-1.5 text-xs font-semibold ${
                folderId === String(folder.id)
                  ? "bg-[#2d8f98] text-white"
                  : "border border-slate-200 bg-white text-slate-700"
              }`}
            >
              {folder.name}
            </button>
          ))}
        </div>
      </div>

      {rows.length ? (
        <div className="max-h-[70vh] space-y-2 overflow-y-auto">
          {rows.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{item.item_name}</p>
                <p className="text-xs text-slate-500">
                  {item.folder_name ? `${item.folder_name} · ` : ""}
                  System qty {item.quantity}
                </p>
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
                  className="rounded-xl bg-[#2d8f98] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {savingId === item.id ? "Saving…" : "Save count"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          {items.length ? "No items in this folder." : "No OCS stock items to count."}
        </p>
      )}

      <ConfirmDialog
        open={Boolean(pendingApply)}
        onClose={dismissPending}
        onConfirm={applyPending}
        title="Apply this count?"
        description={
          pendingApply
            ? `${pendingApply.item.item_name}: counted ${pendingApply.physical}, system ${pendingApply.item.quantity} (difference ${pendingApply.discrepancy}). Apply this count to OCS stock?`
            : ""
        }
        confirmLabel="Apply count"
        tone="default"
      />
    </SectionCard>
  );
}

export default InventoryStocktakePanel;
