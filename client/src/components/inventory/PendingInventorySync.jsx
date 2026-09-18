import { useEffect, useState } from "react";
import { listOfflineMutations } from "../../lib/offlineQueue.js";
import toast from "react-hot-toast";
import {
  discardQueuedInventoryMutation,
  flushOfflineQueue,
  inventoryOfflineEntryQuantity,
  OFFLINE_QUEUE_CHANGED,
  updateQueuedInventoryQuantity,
} from "../../lib/inventoryOfflineSync.js";

export default function PendingInventorySync({ userId }) {
  const [entries, setEntries] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draftQuantity, setDraftQuantity] = useState("");
  useEffect(() => {
    let ignore = false;
    const refresh = () => listOfflineMutations({ userId }).then(rows => {
      if (!ignore) setEntries(rows.filter(row => row.kind === "inventory_deduct" || row.kind === "inventory_restock"));
    });
    void refresh();
    window.addEventListener(OFFLINE_QUEUE_CHANGED, refresh);
    return () => { ignore = true; window.removeEventListener(OFFLINE_QUEUE_CHANGED, refresh); };
  }, [userId]);
  if (!entries.length) return null;
  return <section className="mx-4 mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" aria-label="Pending inventory updates">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">{entries.length} inventory update{entries.length === 1 ? "" : "s"} pending</h2>
      <button type="button" disabled={syncing} className="rounded-xl border border-amber-300 px-3 py-2 font-semibold disabled:opacity-50" onClick={async () => {
        setSyncing(true);
        try { await flushOfflineQueue(); } finally { setSyncing(false); }
      }}>{syncing ? "Syncing…" : "Retry sync"}</button>
    </div>
    <p className="mt-2">These updates are saved on this device and are not yet confirmed by the server.</p>
    <ul className="mt-3 space-y-3">{entries.map(entry => {
      const needsAttention = entry.sync_status === "needs_attention";
      const quantity = inventoryOfflineEntryQuantity(entry);
      const editing = editingId === entry.id;
      return <li key={entry.id} className="rounded-xl border border-amber-200 bg-white/70 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p><span className="font-medium">{entry.meta?.itemName || "Inventory item"}</span> · {quantity} unit(s)</p>
          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold">
            {needsAttention ? "Needs attention" : "Pending sync"}
          </span>
        </div>
        {entry.sync_error && <p className="mt-2 text-xs">{entry.sync_error}</p>}
        {editing && <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 font-medium">
            Correct quantity
            <input
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={draftQuantity}
              onChange={event => setDraftQuantity(event.target.value)}
              className="w-36 rounded-lg border border-amber-300 bg-white px-3 py-2"
            />
          </label>
          <button type="button" className="rounded-lg bg-amber-900 px-3 py-2 font-semibold text-white" onClick={async () => {
            try {
              await updateQueuedInventoryQuantity(entry, draftQuantity);
              setEditingId(null);
              toast.success("Pending quantity updated. Retry sync when ready.");
            } catch (error) {
              toast.error(error.message);
            }
          }}>Save correction</button>
          <button type="button" className="rounded-lg border border-amber-300 px-3 py-2" onClick={() => setEditingId(null)}>Cancel</button>
        </div>}
        {needsAttention && !editing && <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded-lg border border-amber-300 px-3 py-2 font-semibold" onClick={() => {
            setEditingId(entry.id);
            setDraftQuantity(String(quantity || ""));
          }}>Edit quantity</button>
          <button type="button" className="rounded-lg border border-red-300 px-3 py-2 font-semibold text-red-700" onClick={async () => {
            if (!window.confirm("Discard this rejected offline inventory update? This cannot be undone.")) return;
            await discardQueuedInventoryMutation(entry.id);
            if (editingId === entry.id) setEditingId(null);
            toast.success("Rejected offline update discarded.");
          }}>Discard rejected update</button>
        </div>}
      </li>;
    })}</ul>
  </section>;
}
