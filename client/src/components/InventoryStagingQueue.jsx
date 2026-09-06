import { useMemo, useState } from "react";
import { Package } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { api } from "../lib/api.js";

function InventoryStagingQueue({ rows = [], shipments = [], onReleased }) {
  const grouped = useMemo(() => {
    if (Array.isArray(shipments) && shipments.length) {
      return shipments.filter((row) => row.status === "pending" || (row.lines || []).some((line) => line.status === "pending"));
    }
    const pending = (Array.isArray(rows) ? rows : []).filter((row) => row.status === "pending");
    if (!pending.length) return [];
    return [
      {
        id: "ungrouped",
        supplier: "",
        delivery_note: "",
        lines: pending,
        status: "pending",
      },
    ];
  }, [rows, shipments]);
  const [openId, setOpenId] = useState(null);
  const [excluded, setExcluded] = useState({});
  const [releasing, setReleasing] = useState(false);

  const openShipment = grouped.find((row) => String(row.id) === String(openId)) || grouped[0] || null;

  async function release(mode) {
    if (!openShipment || openShipment.id === "ungrouped") {
      const line = (openShipment?.lines || []).find((row) => row.status === "pending");
      if (!line) return;
      setReleasing(true);
      try {
        await api.post(`/inventory/staging/${line.id}/release`);
        toast.success("Row released.");
        await onReleased?.();
      } catch (error) {
        toast.error(error.message || "Could not release this row.");
      } finally {
        setReleasing(false);
      }
      return;
    }
    setReleasing(true);
    try {
      const exclude = Object.entries(excluded)
        .filter(([, reason]) => String(reason || "").trim())
        .map(([id, reason]) => ({ id: Number(id), reason }));
      const payload = await api.post(`/inventory/shipments/${openShipment.id}/release`, {
        mode,
        exclude,
        row_ids:
          mode === "selected"
            ? (openShipment.lines || [])
                .filter((line) => line.status === "pending" && !excluded[line.id])
                .map((line) => line.id)
            : [],
      });
      toast.success(
        payload.idempotent ? "Shipment already released." : "Selected shipment lines released.",
      );
      await onReleased?.();
    } catch (error) {
      toast.error(error.message || "Could not release this shipment.");
    } finally {
      setReleasing(false);
    }
  }

  return (
    <SectionCard
      title="Incoming shipments"
      subtitle="Release a whole import batch after checking quantities, value and expiry."
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-[#2d8f98]/10 px-3 py-1.5 text-xs font-bold text-[#2d8f98]">
          <Package className="size-3.5" />
          Shipments
        </span>
      }
    >
      {grouped.length ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {grouped.map((shipment) => (
              <button
                key={shipment.id}
                type="button"
                onClick={() => setOpenId(shipment.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  String(openShipment?.id) === String(shipment.id)
                    ? "bg-[#2d8f98] text-white"
                    : "border border-slate-200 text-slate-600"
                }`}
              >
                {shipment.supplier || shipment.delivery_note || `Shipment #${shipment.id}`}
              </button>
            ))}
          </div>
          {openShipment ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                {openShipment.total_rows || openShipment.lines?.length || 0} rows
                {openShipment.imported_by_name ? ` · imported by ${openShipment.imported_by_name}` : ""}
              </p>
              <div className="space-y-2">
                {(openShipment.lines || []).map((line) => {
                  const errors = line.validation_errors || [];
                  return (
                    <div key={line.id} className="rounded-2xl border border-slate-100 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{line.item_name}</p>
                          <p className="text-xs text-slate-500">
                            Qty {line.quantity}
                            {line.expiry_date ? ` · Exp ${line.expiry_date}` : line.is_non_expiring ? " · Non-expiring" : " · Missing expiry"}
                            {` · ${line.status}`}
                          </p>
                          {errors.length ? (
                            <p className="mt-1 text-xs text-rose-600">{errors.join("; ")}</p>
                          ) : null}
                        </div>
                        {line.status === "pending" ? (
                          <input
                            value={excluded[line.id] || ""}
                            onChange={(event) =>
                              setExcluded((current) => ({ ...current, [line.id]: event.target.value }))
                            }
                            placeholder="Exclude reason"
                            className="w-40 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={releasing}
                  onClick={() => release("selected")}
                  className="rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                >
                  Release selected
                </button>
                <button
                  type="button"
                  disabled={releasing}
                  onClick={() => release("all_valid")}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                >
                  Release all valid
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No incoming shipments waiting.</p>
      )}
    </SectionCard>
  );
}

export default InventoryStagingQueue;
