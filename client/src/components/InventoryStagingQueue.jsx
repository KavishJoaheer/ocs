import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { formatRupees } from "../lib/format.js";
import { requiresOperationalOverride, withOperationalOverride } from "../lib/inventoryAccess.js";
import OperationalOverrideFields from "./inventory/OperationalOverrideFields.jsx";

function lineExpiry(line) {
  if (line?.is_non_expiring) return "Does not expire";
  return line?.expiry_date || "Expiry missing";
}

function historyLabel(status) {
  if (status === "released") return "Added to stock";
  if (status === "cancelled") return "Cancelled";
  return status || "Closed";
}

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
  const selectedValid = validPending.filter((line) => selected[line.id]);
  const selectedQty = selectedValid.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const selectedValue = selectedValid.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.cost_price || 0),
    0,
  );
  const partial = selectedValid.length > 0 && selectedValid.length < validPending.length;
  const supplierName = openShipment?.supplier || "This supplier";
  const note = openShipment?.delivery_note ? ` · ${openShipment.delivery_note}` : "";

  function overridePayload(body) {
    return withOperationalOverride(user, body, overrideReason);
  }

  async function leaveOutProblems() {
    if (!openShipment || openShipment.id === "ungrouped") return;
    const lines = invalidPending
      .filter((line) => String(excludeReason[line.id] || "").trim().length >= 3)
      .map((line) => ({ id: line.id, reason: excludeReason[line.id].trim() }));
    if (!lines.length) {
      toast.error("Write a short reason for each line you are leaving out.");
      return;
    }
    if (requiresOperationalOverride(user) && String(overrideReason).trim().length < 10) {
      toast.error("Administrators must enter an operational override reason.");
      return;
    }
    setReleasing(true);
    try {
      await api.post(`/inventory/shipments/${openShipment.id}/exclude`, overridePayload({ lines }));
      toast.success("Those lines were left out.");
      await onReleased?.();
    } catch (error) {
      toast.error(error.message || "Could not leave these lines out.");
    } finally {
      setReleasing(false);
    }
  }

  async function addToStock() {
    if (requiresOperationalOverride(user) && String(overrideReason).trim().length < 10) {
      toast.error("Administrators must enter an operational override reason.");
      return;
    }
    if (!openShipment || !selectedValid.length) {
      toast.error("Choose at least one line to add.");
      return;
    }
    if (!openShipment.id || openShipment.id === "ungrouped") {
      const line = selectedValid[0];
      setReleasing(true);
      try {
        await api.post(`/inventory/staging/${line.id}/release`, overridePayload({}));
        toast.success("Added to stock.");
        setConfirmMode(null);
        await onReleased?.();
      } catch (error) {
        toast.error(error.message || "Could not add this to stock.");
      } finally {
        setReleasing(false);
      }
      return;
    }
    setReleasing(true);
    try {
      const payload = await api.post(
        `/inventory/shipments/${openShipment.id}/release`,
        overridePayload({
          mode: partial ? "selected" : "all_valid",
          row_ids: partial ? selectedValid.map((line) => line.id) : [],
        }),
      );
      toast.success(payload.idempotent ? "This delivery was already added." : "Added to stock.");
      setConfirmMode(null);
      await onReleased?.();
    } catch (error) {
      toast.error(error.message || "Could not add this delivery to stock.");
    } finally {
      setReleasing(false);
    }
  }

  return (
    <SectionCard
      title="Add to the shelf"
      subtitle="These deliveries are saved. Add to stock when the goods are on the shelf."
    >
      {grouped.length ? (
        <div className="space-y-4">
          {grouped.length > 1 ? (
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
                  {shipment.supplier || shipment.delivery_note || `Delivery #${shipment.id}`}
                </button>
              ))}
            </div>
          ) : null}

          {openShipment ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-800">
                {supplierName}
                {note}
              </p>
              <div className="space-y-2">
                {validPending.map((line) => (
                  <label key={line.id} className="flex items-start gap-3 rounded-2xl border border-slate-100 px-4 py-3">
                    <input
                      type="checkbox"
                      className="mt-1 size-5"
                      checked={Boolean(selected[line.id])}
                      onChange={(event) =>
                        setSelected((current) => ({ ...current, [line.id]: event.target.checked }))
                      }
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{line.item_name}</span>
                      <span className="block text-xs text-slate-500">
                        {line.quantity} · {lineExpiry(line)} · {formatRupees(line.cost_price || 0)} each
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {invalidPending.length ? (
                <div className="space-y-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3">
                  <p className="text-sm font-semibold text-rose-900">These lines cannot be added yet</p>
                  {invalidPending.map((line) => (
                    <div key={line.id} className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900">{line.item_name}</p>
                      <p className="text-xs text-rose-700">{(line.validation_errors || []).join("; ")}</p>
                      <input
                        value={excludeReason[line.id] || ""}
                        onChange={(event) =>
                          setExcludeReason((current) => ({ ...current, [line.id]: event.target.value }))
                        }
                        placeholder="Why leave this out?"
                        aria-label={`Reason for leaving out ${line.item_name}`}
                        className="w-full min-h-11 rounded-lg border border-rose-200 bg-white px-3 text-sm"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={releasing}
                    onClick={leaveOutProblems}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 disabled:opacity-60"
                  >
                    Leave these out
                  </button>
                </div>
              ) : null}

              <OperationalOverrideFields user={user} reason={overrideReason} onChange={setOverrideReason} />

              <button
                type="button"
                disabled={releasing || !selectedValid.length}
                onClick={() => setConfirmMode(partial ? "selected" : "all_valid")}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white disabled:opacity-60 sm:w-auto"
              >
                {partial ? `Add ${selectedValid.length} selected to stock` : "Add to stock"}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">No deliveries waiting. Save a delivery above, then add it to stock.</p>
      )}

      {history.length ? (
        <details className="mt-6 border-t border-slate-100 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">Earlier deliveries</summary>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {history.slice(0, 6).map((shipment) => (
              <li key={shipment.id}>
                {shipment.supplier || "Supplier"}
                {shipment.delivery_note ? ` · ${shipment.delivery_note}` : ""} · {historyLabel(shipment.status)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmMode)}
        onClose={() => setConfirmMode(null)}
        onConfirm={addToStock}
        title="Add this delivery to stock?"
        description={`${selectedQty} units from ${supplierName} will be available to dispatch. Value ${formatRupees(selectedValue)}.`}
        confirmLabel={releasing ? "Adding…" : "Add to stock"}
        tone="primary"
        busy={releasing}
      />
    </SectionCard>
  );
}

export default InventoryStagingQueue;
