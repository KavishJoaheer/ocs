import { useEffect, useState } from "react";
import { listOfflineMutations } from "../../lib/offlineQueue.js";
import { flushOfflineQueue, OFFLINE_QUEUE_CHANGED } from "../../lib/inventoryOfflineSync.js";

export default function PendingInventorySync({ userId }) {
  const [entries, setEntries] = useState([]);
  const [syncing, setSyncing] = useState(false);
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
    <ul className="mt-3 space-y-2">{entries.map(entry => <li key={entry.id}>
      <span className="font-medium">{entry.meta?.itemName || "Inventory item"}</span> · {entry.payload?.quantity} unit(s) · {entry.sync_status === "needs_attention" ? "Needs attention" : "Pending sync"}
      {entry.sync_error && <p>{entry.sync_error} This entry has been retained; contact an administrator if retrying does not resolve it.</p>}
    </li>)}</ul>
  </section>;
}
