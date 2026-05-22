/** Dispatched when the signed-in doctor's bag inventory changes (restock, deduct, etc.). */
export const DOCTOR_BAG_INVENTORY_EVENT = "doctor-bag-inventory-updated";

/** Dispatched when OCS master stock changes (operator/admin replenishment, adjustments). */
export const OCS_INVENTORY_EVENT = "ocs-inventory-updated";

const CHANNEL_NAME = "ocs-inventory-sync";

const broadcastChannel =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

function dispatch(eventName) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(eventName));
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: eventName });
    } catch {
      /* channel closed during HMR */
    }
  }
}

if (broadcastChannel && typeof window !== "undefined") {
  broadcastChannel.addEventListener("message", (event) => {
    const eventName = event?.data?.type;
    if (eventName === DOCTOR_BAG_INVENTORY_EVENT || eventName === OCS_INVENTORY_EVENT) {
      window.dispatchEvent(new CustomEvent(eventName));
    }
  });
}

export function notifyDoctorBagInventoryUpdated() {
  dispatch(DOCTOR_BAG_INVENTORY_EVENT);
}

export function notifyOcsInventoryUpdated() {
  dispatch(OCS_INVENTORY_EVENT);
}
