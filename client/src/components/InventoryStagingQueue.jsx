import { useMemo, useState } from "react";
import { Package } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { formatRupees } from "../lib/format.js";
import { requiresOperationalOverride, withOperationalOverride } from "../lib/inventoryAccess.js";
import OperationalOverrideFields from "./inventory/OperationalOverrideFields.jsx";

function InventoryStagingQueue({ rows = [], shipments = [], incomingShipments, onReleased }) {
  const { user } = useAuth();
  const grouped = useMemo(() => {
    if (Array.isArray(incomingShipments) && incomingShipments.length) {
      return incomingShipments;
    }
    if (Array.isArray(shipments) && shipments.length) {
      return shipments.filter((row) => row.in_incoming_queue || row.status === "pending");
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
  }, [rows, shipments, incomingShipments]);
  const history = useMemo(
    () =>
      (Array.isArray(shipments) ? shipments : []).filter(
        (row) => !row.in_incoming_queue && row.status !== "pending",
      ),
    [shipments],
  );
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState({});
  const [excludeReason, setExcludeReason] = useState({});
  const [overrideReason, setOverrideReason] = useState("");
  const [confirmMode, setConfirmMode] = useState(null);
  const [releasing, setReleasing] = useState(false);

  const openShipment = grouped.find((row) => String(row.id) === String(openId)) || grouped[0] || null;
  const shipmentKey = String(openShipment?.id || "");
  const [syncedShipmentKey, setSyncedShipmentKey] = useState(shipmentKey);

  if (syncedShipmentKey !== shipmentKey) {
    setSyncedShipmentKey(shipmentKey);
    if (!openShipment) {
      setSelected({});
    } else {
      const next = {};
      (openShipment.lines || []).forEach((line) => {
        if (line.status === "pending" && !(line.validation_errors || []).length) {
          next[line.id] = true;
        }
      });
      setSelected(next);
    }
  }

  const pendingLines = (openShipment?.lines || []).filter((line) => line.status === "pending");
  const validPending = pendingLines.filter((line) => !(line.validation_errors || []).length);
  const invalidPending = pendingLines.filter((line) => (line.validation_errors || []).length);
  const excludedLines = (openShipment?.lines || []).filter((line) => line.status === "excluded");
  const selectedValid = validPending.filter((line) => selected[line.id]);
  const selectedQty = selectedValid.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const selectedValue = selectedValid.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.cost_price || 0),
    0,
  );
  const allValidQty = validPending.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const allValidValue = validPending.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.cost_price || 0),
    0,
  );

  function overridePayload(body) {
    return withOperationalOverride(user, body, overrideReason);
  }

  async function excludeSelectedInvalid() {
    if (!openShipment || openShipment.id === "ungrouped") return;
    const lines = pendingLines
      .filter((line) => excludeReason[line.id]?.trim())
      .map((line) => ({ id: line.id, reason: excludeReason[line.id].trim() }));
    if (!lines.length) {
      toast.error("Enter an exclusion reason for each line you want to exclude.");
      return;
    }
    setReleasing(true);
    try {
      await api.post(`/inventory/shipments/${openShipment.id}/exclude`, overridePayload({ lines }));
      toast.success("Selected lines excluded.");
      await onReleased?.();
    } catch (error) {
      toast.error(error.message || "Could not exclude these lines.");
    } finally {
      setReleasing(false);
    }
  }

  async function release(mode) {
    if (requiresOperationalOverride(user) && String(overrideReason).trim().length < 10) {
      toast.error("Administrators must enter an operational override reason.");
      return;
    }
    if (!openShipment || openShipment.id === "ungrouped") {
      const line = pendingLines[0];
      if (!line) return;
      setReleasing(true);
      try {
        await api.post(`/inventory/staging/${line.id}/release`, overridePayload({}));
        toast.success("Row released.");
        setConfirmMode(null);
        await onReleased?.();
      } catch (error) {
        toast.error(error.message || "Could not release this row.");
      } finally {
        setReleasing(false);
      }
      return;
    }
    if (mode === "selected" && !selectedValid.length) {
      toast.error("Select at least one valid row to release.");
      return;
    }
    if (confirmMode !== mode) {
      setConfirmMode(mode);
      return;
    }
    setReleasing(true);
    try {
      const exclude = pendingLines
        .filter((line) => excludeReason[line.id]?.trim())
        .map((line) => ({ id: line.id, reason: excludeReason[line.id].trim() }));
      const payload = await api.post(
        `/inventory/shipments/${openShipment.id}/release`,
        overridePayload({
          mode,
          exclude,
          row_ids: mode === "selected" ? selectedValid.map((line) => line.id) : [],
        }),
      );
      toast.success(payload.idempotent ? "Shipment already released." : "Shipment lines released.");
      setConfirmMode(null);
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
      subtitle="Exclude invalid lines, then release selected or all valid rows into OCS stock."
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-[#2d8f98]/10 px-3 py-1.5 text-xs font-bold text-[#2d8f98]">
          <Package className="size-3.5" />
          Shipments
        </span>
      }
    >
      {grouped.length ? (
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {grouped.map((shipment) => (
              <button
                key={shipment.id}
                type="button"
                aria-current={String(openShipment?.id) === String(shipment.id) ? "true" : undefined}
                onClick={() => setOpenId(shipment.id)}
                className={`min-h-11 shrink-0 rounded-full px-3 text-xs font-semibold ${
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
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-700 md:grid-cols-4">
                <p>Valid pending: <strong>{validPending.length}</strong></p>
                <p>Invalid: <strong>{invalidPending.length}</strong></p>
                <p>Excluded: <strong>{excludedLines.length}</strong></p>
                <p>Value of valid: <strong>{formatRupees(allValidValue)}</strong></p>
              </div>
              <p className="text-xs text-slate-500">
                {(openShipment.total_rows || openShipment.lines?.length || 0)} rows
                {openShipment.imported_by_name ? ` · imported by ${openShipment.imported_by_name}` : ""}
                {` · ${selectedValid.length} selected · ${selectedQty} units · ${formatRupees(selectedValue)}`}
              </p>
              <div className="space-y-2">
                {(openShipment.lines || []).map((line) => {
                  const errors = line.validation_errors || [];
                  const selectable = line.status === "pending" && !errors.length;
                  return (
                    <div key={line.id} className="rounded-2xl border border-slate-100 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <label className="flex min-w-0 items-start gap-3">
                          {selectable ? (
                            <input
                              type="checkbox"
                              className="mt-1 size-5"
                              checked={Boolean(selected[line.id])}
                              onChange={(event) =>
                                setSelected((current) => ({ ...current, [line.id]: event.target.checked }))
                              }
                            />
                          ) : null}
                          <span>
                            <span className="block text-sm font-semibold text-slate-900">{line.item_name}</span>
                            <span className="block text-xs text-slate-500">
                              Qty {line.quantity}
                              {line.expiry_date
                                ? ` · Exp ${line.expiry_date}`
                                : line.is_non_expiring
                                  ? " · Non-expiring"
                                  : " · Missing expiry"}
                              {` · ${line.status}`}
                            </span>
                            {errors.length ? (
                              <span className="mt-1 block text-xs text-rose-600">{errors.join("; ")}</span>
                            ) : null}
                            {line.exclude_reason ? (
                              <span className="mt-1 block text-xs text-slate-500">Excluded: {line.exclude_reason}</span>
                            ) : null}
                          </span>
                        </label>
                        {line.status === "pending" ? (
                          <label className="space-y-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                            Exclusion reason
                            <input
                              value={excludeReason[line.id] || ""}
                              onChange={(event) =>
                                setExcludeReason((current) => ({ ...current, [line.id]: event.target.value }))
                              }
                              className="w-40 min-h-11 rounded-lg border border-slate-200 px-2 py-1 text-xs font-normal normal-case"
                            />
                          </label>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <OperationalOverrideFields user={user} reason={overrideReason} onChange={setOverrideReason} />
              {confirmMode ? (
                <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  Confirm {confirmMode === "selected" ? "selected" : "all valid"} release:{" "}
                  {confirmMode === "selected" ? selectedQty : allValidQty} units ·{" "}
                  {formatRupees(confirmMode === "selected" ? selectedValue : allValidValue)}. Press the same button again to post.
                </p>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  disabled={releasing || !selectedValid.length}
                  onClick={() => release("selected")}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  {confirmMode === "selected" ? "Confirm release selected" : "Release selected"}
                </button>
                <button
                  type="button"
                  disabled={releasing || !validPending.length}
                  onClick={() => release("all_valid")}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
                >
                  {confirmMode === "all_valid" ? "Confirm release all valid" : "Release all valid"}
                </button>
                <button
                  type="button"
                  disabled={releasing}
                  onClick={excludeSelectedInvalid}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-700 disabled:opacity-60"
                >
                  Exclude lines with reasons
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No incoming shipments waiting.</p>
      )}

      {history.length ? (
        <div className="mt-6 border-t border-slate-100 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Shipment history</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {history.slice(0, 8).map((shipment) => (
              <li key={shipment.id}>
                #{shipment.id} · {shipment.supplier || "Shipment"} · {shipment.status}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}

export default InventoryStagingQueue;
