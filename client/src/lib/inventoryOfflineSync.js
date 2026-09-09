import toast from "react-hot-toast";
import { api, ApiError } from "./api.js";
import { isBrowserOffline, isNetworkFailure } from "./networkErrors.js";
import {
  countOfflineMutations,
  enqueueOfflineMutation,
  listOfflineMutations,
  removeOfflineMutation,
} from "./offlineQueue.js";
import { notifyDoctorBagInventoryUpdated } from "./inventorySync.js";

let activeUserId = null;

export function setOfflineQueueUserContext(userId) {
  activeUserId = userId != null ? Number(userId) : null;
}

export function getOfflineQueueUserContext() {
  return activeUserId;
}

export const OFFLINE_SAVED_TOAST =
  "Transaction saved locally. Will sync automatically once your connection is restored.";

export const OFFLINE_QUEUE_ITEM_SYNCED = "offline-queue-item-synced";
export const OFFLINE_QUEUE_FLUSH_COMPLETE = "offline-queue-flush-complete";
export const OFFLINE_QUEUE_CHANGED = "offline-queue-changed";

const INVENTORY_QUEUE_KINDS = new Set(["inventory_deduct", "inventory_restock"]);

let flushPromise = null;
let listenerStarted = false;

function dispatchQueueEvent(name, detail = {}) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function notifyQueueChanged() {
  dispatchQueueEvent(OFFLINE_QUEUE_CHANGED);
}

export function applyOptimisticBagDeduct(inventoryPayload, itemId, quantity) {
  if (!inventoryPayload?.my_stock) {
    return inventoryPayload;
  }

  const qty = Number(quantity || 0);
  const my_stock = inventoryPayload.my_stock.map((item) =>
    Number(item.id) === Number(itemId)
      ? { ...item, quantity: Math.max(0, Number(item.quantity || 0) - qty),
          on_hand_quantity: Math.max(0, Number(item.on_hand_quantity ?? item.quantity ?? 0) - qty),
          available_to_use: Math.max(0, Number(item.available_to_use ?? item.quantity ?? 0) - qty),
          available_to_promise: Math.max(0, Number(item.available_to_promise ?? item.quantity ?? 0) - qty),
          row_version: Number(item.row_version || 0) + 1 }
      : item,
  );

  return { ...inventoryPayload, my_stock };
}

export function applyOptimisticBagRestock(inventoryPayload, { ocsItemId, itemName, quantity }) {
  const qty = Number(quantity || 0);
  const normalizedName = String(itemName || "").trim().toLowerCase();

  const my_stock = (inventoryPayload?.my_stock || []).map((item) => {
    const matches =
      Number(item.id) === Number(ocsItemId) ||
      String(item.item_name || "")
        .trim()
        .toLowerCase() === normalizedName;
    return matches ? { ...item, quantity: Number(item.quantity || 0) + qty } : item;
  });

  const ocs_stock = (inventoryPayload?.ocs_stock || []).map((item) =>
    Number(item.id) === Number(ocsItemId)
      ? { ...item, quantity: Math.max(0, Number(item.quantity || 0) - qty) }
      : item,
  );

  return { ...inventoryPayload, my_stock, ocs_stock };
}

export async function queueInventoryMutation({
  kind,
  method = "POST",
  endpoint,
  payload,
  meta = {},
  userId = activeUserId,
}) {
  if (!INVENTORY_QUEUE_KINDS.has(kind)) {
    throw new Error("Unsupported offline inventory mutation.");
  }

  const record = await enqueueOfflineMutation({
    kind,
    method,
    endpoint,
    payload: { ...payload, operation_id: payload.operation_id || crypto.randomUUID() },
    meta,
    userId: userId != null ? Number(userId) : null,
  });

  notifyQueueChanged();
  return record;
}

export function shouldQueueInventoryMutation(error) {
  return isBrowserOffline() || isNetworkFailure(error);
}

export async function getPendingInventoryQueueCount() {
  const entries = await listOfflineMutations({ userId: activeUserId });
  return entries.filter((entry) => INVENTORY_QUEUE_KINDS.has(entry.kind)).length;
}

export function flushOfflineQueue(options = {}) {
  if (!flushPromise) {
    flushPromise = runOfflineQueue(options).finally(() => { flushPromise = null; });
  }
  return flushPromise;
}

async function runOfflineQueue({ silent = false } = {}) {
  if (typeof window === "undefined" || isBrowserOffline()) {
    return { synced: 0, remaining: await countOfflineMutations({ userId: activeUserId }) };
  }

  // Refuse to flush before a user is bound to the queue. Without this guard
  // a stale entry from a previous session could be replayed under whatever
  // bearer token the next user lands with.
  if (activeUserId == null) {
    return { synced: 0, remaining: 0 };
  }

  // Only flush entries that belong to the currently signed-in user. This
  // protects against scenarios where User A queues an offline action and
  // then User B signs in on the same device — without this scope, B's
  // bearer token would replay A's mutation against the server.
  const queueUserId = activeUserId;
  const entries = await listOfflineMutations({ userId: queueUserId });
  let synced = 0;

  for (const entry of entries) {
    if (activeUserId !== queueUserId) break;
    if (!INVENTORY_QUEUE_KINDS.has(entry.kind)) {
      continue;
    }

    try {
      const send = payload => entry.method === "PUT" ? api.put(entry.endpoint, payload)
        : entry.method === "PATCH" ? api.patch(entry.endpoint, payload) : api.post(entry.endpoint, payload);
      let result;
      try {
        result = await send(entry.payload);
      } catch (error) {
        // A stock deduction is an additive intent. Rebase only identified
        // operations on an explicit version conflict; the server rechecks lot,
        // ownership, expiry and stock. Receipts prevent lost-response duplicates.
        const item = error.data?.inventory?.my_stock?.find(row => Number(row.id) === Number(entry.meta?.itemId));
        if (entry.kind !== "inventory_deduct" || !entry.payload.operation_id ||
            error.data?.code !== "INVENTORY_VERSION_CONFLICT" || !item || activeUserId !== queueUserId) throw error;
        result = await send({ ...entry.payload, expected_version: Number(item.row_version) });
      }

      await removeOfflineMutation(entry.id);
      synced += 1;
      if (activeUserId === queueUserId) {
        notifyDoctorBagInventoryUpdated();
        dispatchQueueEvent(OFFLINE_QUEUE_ITEM_SYNCED, { entry, result });
      }
    } catch (error) {
      if (activeUserId !== queueUserId) break;
      if (error instanceof ApiError && error.status === 409) {
        await enqueueOfflineMutation({ ...entry, sync_status: "needs_attention", sync_error: error.message });
        notifyDoctorBagInventoryUpdated();
        if (!silent) {
          const label = entry.meta?.itemName || "inventory update";
          toast.error(`${label} needs attention: ${error.message}. The pending entry is retained.`);
        }
        continue;
      }

      if (isNetworkFailure(error)) {
        break;
      }

      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        await enqueueOfflineMutation({ ...entry, sync_status: "needs_attention", sync_error: error.message });
        notifyQueueChanged();
        if (!silent) {
          const label = entry.meta?.itemName || "inventory update";
          toast.error(
            error.status === 410
              ? `${label} was rejected by the server (${error.message}).`
              : `${label} needs attention: ${error.message}. Re-open the item to retry.`,
          );
        }
        continue;
      }

      // Server-side (5xx) or unknown failures are not the doctor's fault and
      // are usually transient, so keep the entry queued for the next pass.
      // Dropping it here would silently lose a real sale.
      if (!silent) {
        const label = entry.meta?.itemName || "inventory update";
        toast.error(`Could not sync ${label} yet: ${error.message}. It stays queued.`);
      }
      break;
    }
  }

  const remaining = await countOfflineMutations({ userId: activeUserId });
  notifyQueueChanged();
  dispatchQueueEvent(OFFLINE_QUEUE_FLUSH_COMPLETE, { synced, remaining });

  if (synced > 0 && !silent && activeUserId === queueUserId) {
    toast.success(
      synced === 1
        ? "1 pending inventory update synced."
        : `${synced} pending inventory updates synced.`,
    );
  }

  return { synced, remaining };
}

export function startOfflineSyncListener() {
  if (listenerStarted || typeof window === "undefined") {
    return () => {};
  }

  listenerStarted = true;

  const scheduleFlush = () => flushOfflineQueue({ silent: false });

  const handleOnline = () => {
    void scheduleFlush();
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      void scheduleFlush();
    }
  };

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);

  if (navigator.onLine) {
    void scheduleFlush();
  }

  return () => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
    listenerStarted = false;
  };
}
