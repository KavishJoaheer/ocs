/** Dispatched when the signed-in doctor's bag inventory changes (restock, deduct, etc.). */
export const DOCTOR_BAG_INVENTORY_EVENT = "doctor-bag-inventory-updated";

/** Dispatched when OCS master stock changes (operator/admin replenishment, adjustments). */
export const OCS_INVENTORY_EVENT = "ocs-inventory-updated";

/** Dispatched when supply / restock request lists change (doctor or operator views). */
export const SUPPLY_REQUESTS_EVENT = "supply-requests-updated";

/** Dispatched when the practice-wide long-term review queue changes. */
export const LONG_TERM_REVIEW_EVENT = "long-term-review-updated";

/** Dispatched when Linkham-insured patient directory changes. */
export const LINKHAM_PATIENTS_EVENT = "linkham-patients-updated";

/** Dispatched when Linkham claims ledger or clearance state changes. */
export const LINKHAM_CLAIMS_EVENT = "linkham-claims-updated";

/** Dispatched when any patient record / appointment / consultation / bill / lab report changes (cross-portal live sync). */
export const PATIENTS_LIVE_EVENT = "patients-live-updated";

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
    if (
      eventName === DOCTOR_BAG_INVENTORY_EVENT ||
      eventName === OCS_INVENTORY_EVENT ||
      eventName === SUPPLY_REQUESTS_EVENT ||
      eventName === LONG_TERM_REVIEW_EVENT ||
      eventName === LINKHAM_PATIENTS_EVENT ||
      eventName === LINKHAM_CLAIMS_EVENT ||
      eventName === PATIENTS_LIVE_EVENT
    ) {
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

export function notifySupplyRequestsUpdated() {
  dispatch(SUPPLY_REQUESTS_EVENT);
}

export function notifyLongTermReviewUpdated() {
  dispatch(LONG_TERM_REVIEW_EVENT);
}

export function notifyLinkhamPatientsUpdated() {
  dispatch(LINKHAM_PATIENTS_EVENT);
}

export function notifyLinkhamClaimsUpdated() {
  dispatch(LINKHAM_CLAIMS_EVENT);
}

export function notifyPatientsLiveUpdated() {
  dispatch(PATIENTS_LIVE_EVENT);
}
