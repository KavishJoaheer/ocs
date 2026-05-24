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
      ? { ...item, quantity: Math.max(0, Number(item.quantity || 0) - qty) }
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
}) {
  if (!INVENTORY_QUEUE_KINDS.has(kind)) {
    throw new Error("Unsupported offline inventory mutation.");
  }

  const record = await enqueueOfflineMutation({
    kind,
    method,
    endpoint,
    payload,
    meta,
  });

  notifyQueueChanged();
  return record;
}

export function shouldQueueInventoryMutation(error) {
  return isBrowserOffline() || isNetworkFailure(error);
}

export async function getPendingInventoryQueueCount() {
  const entries = await listOfflineMutations();
  return entries.filter((entry) => INVENTORY_QUEUE_KINDS.has(entry.kind)).length;
}

export async function flushOfflineQueue({ silent = false } = {}) {
  if (typeof window === "undefined" || isBrowserOffline()) {
    return { synced: 0, remaining: await countOfflineMutations() };
  }

  const entries = await listOfflineMutations();
  let synced = 0;

  for (const entry of entries) {
    if (!INVENTORY_QUEUE_KINDS.has(entry.kind)) {
      continue;
    }

    try {
      const result =
        entry.method === "PUT"
          ? await api.put(entry.endpoint, entry.payload)
          : entry.method === "PATCH"
            ? await api.patch(entry.endpoint, entry.payload)
            : await api.post(entry.endpoint, entry.payload);

      await removeOfflineMutation(entry.id);
      synced += 1;
      notifyDoctorBagInventoryUpdated();
      dispatchQueueEvent(OFFLINE_QUEUE_ITEM_SYNCED, { entry, result });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        notifyDoctorBagInventoryUpdated();
        if (!silent) {
          const label = entry.meta?.itemName || "inventory update";
          toast.error(`${label} conflicted with a newer server update. Refreshing latest stock.`);
        }
        break;
      }

      if (isNetworkFailure(error)) {
        break;
      }

      await removeOfflineMutation(entry.id);
      notifyQueueChanged();
      if (!silent) {
        const label = entry.meta?.itemName || "inventory update";
        toast.error(`Could not sync ${label}: ${error.message}`);
      }
    }
  }

  const remaining = await countOfflineMutations();
  notifyQueueChanged();
  dispatchQueueEvent(OFFLINE_QUEUE_FLUSH_COMPLETE, { synced, remaining });

  if (synced > 0 && !silent) {
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

  const scheduleFlush = () => {
    if (flushPromise) {
      return flushPromise;
    }

    flushPromise = flushOfflineQueue({ silent: true })
      .then((result) => {
        if (result.synced > 0) {
          toast.success(
            result.synced === 1
              ? "1 pending inventory update synced."
              : `${result.synced} pending inventory updates synced.`,
          );
        }
        return result;
      })
      .finally(() => {
        flushPromise = null;
      });

    return flushPromise;
  };

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
