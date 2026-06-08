import { getStoredAuthToken, resolveApiPath } from "./api.js";
import { getClientSessionId } from "./clientSession.js";
import {
  DOCTOR_BAG_INVENTORY_EVENT,
  OCS_INVENTORY_EVENT,
  notifyDoctorBagInventoryUpdated,
  notifyLinkhamClaimsUpdated,
  notifyLinkhamPatientsUpdated,
  notifyLongTermReviewUpdated,
  notifyOcsInventoryUpdated,
  notifySupplyRequestsUpdated,
} from "./inventorySync.js";

const INVENTORY_REALTIME_ROLES = new Set(["admin", "doctor", "operator", "linkham_admin"]);
const INVALIDATION_DEBOUNCE_MS = 120;

let eventSource = null;
let reconnectTimer = null;
let invalidationTimer = null;
let pendingInvalidation = null;
let activeSessionKey = "";

function buildSessionKey(user) {
  if (!user?.role) {
    return "";
  }

  return `${user.role}:${user.id}:${user.doctor_id || 0}`;
}

function shouldProcessInventoryEvent(event, user) {
  if (!event || !user?.role) {
    return false;
  }

  if (user.role === "admin" || user.role === "operator") {
    return true;
  }

  if (user.role === "doctor") {
    if (event.stockScope === "ocs") {
      return true;
    }

    if (event.stockScope === "doctor" && Number(event.ownerDoctorId || 0) === Number(user.doctor_id || 0)) {
      return true;
    }
  }

  return false;
}

function scheduleInventoryInvalidation(user, event) {
  pendingInvalidation = { user, event };

  if (invalidationTimer) {
    return;
  }

  invalidationTimer = window.setTimeout(() => {
    invalidationTimer = null;
    const payload = pendingInvalidation;
    pendingInvalidation = null;

    if (!payload?.user) {
      return;
    }

    if (payload.user.role === "doctor") {
      notifyDoctorBagInventoryUpdated();
      if (payload.event?.stockScope === "ocs") {
        notifyOcsInventoryUpdated();
      }
      return;
    }

    if (payload.user.role === "admin" || payload.user.role === "operator") {
      notifyOcsInventoryUpdated();
      if (payload.event?.stockScope === "doctor") {
        notifyDoctorBagInventoryUpdated();
      }
    }
  }, INVALIDATION_DEBOUNCE_MS);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(user) {
  if (!user || buildSessionKey(user) !== activeSessionKey) {
    return;
  }

  clearReconnectTimer();
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    startInventoryRealtimeSync(user);
  }, 2500);
}

export function stopInventoryRealtimeSync() {
  activeSessionKey = "";
  clearReconnectTimer();

  if (invalidationTimer) {
    window.clearTimeout(invalidationTimer);
    invalidationTimer = null;
  }

  pendingInvalidation = null;

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

export function startInventoryRealtimeSync(user) {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return;
  }

  if (!user?.role || !INVENTORY_REALTIME_ROLES.has(user.role)) {
    stopInventoryRealtimeSync();
    return;
  }

  const token = getStoredAuthToken();
  if (!token) {
    stopInventoryRealtimeSync();
    return;
  }

  const sessionKey = buildSessionKey(user);
  if (sessionKey === activeSessionKey && eventSource) {
    return;
  }

  stopInventoryRealtimeSync();
  activeSessionKey = sessionKey;

  const tabSessionId = getClientSessionId();
  const streamUrl = `${resolveApiPath("/inventory/stream")}?access_token=${encodeURIComponent(
    token,
  )}&client_session_id=${encodeURIComponent(tabSessionId)}`;
  const source = new EventSource(streamUrl);
  eventSource = source;

  source.addEventListener("connected", () => {
    clearReconnectTimer();
  });

  source.addEventListener("inventory_resync", () => {
    notifyDoctorBagInventoryUpdated();
    if (user.role === "admin" || user.role === "operator") {
      notifyOcsInventoryUpdated();
    }
  });

  source.addEventListener("supply_request_change", () => {
    notifySupplyRequestsUpdated();
  });

  source.addEventListener("linkham_claims_change", (message) => {
    try {
      const event = JSON.parse(message.data);
      if (
        event.changedByClientSessionId &&
        String(event.changedByClientSessionId) === tabSessionId
      ) {
        return;
      }
    } catch {
      /* fall through to invalidation */
    }
    notifyLinkhamClaimsUpdated();
  });

  source.addEventListener("linkham_patients_change", (message) => {
    try {
      const event = JSON.parse(message.data);
      if (
        event.changedByClientSessionId &&
        String(event.changedByClientSessionId) === tabSessionId
      ) {
        return;
      }
    } catch {
      /* fall through to invalidation */
    }
    notifyLinkhamPatientsUpdated();
  });

  source.addEventListener("long_term_review_change", (message) => {
    try {
      const event = JSON.parse(message.data);
      if (
        event.changedByClientSessionId &&
        String(event.changedByClientSessionId) === tabSessionId
      ) {
        return;
      }
    } catch {
      /* fall through to invalidation */
    }
    notifyLongTermReviewUpdated();
  });

  source.addEventListener("patient_data_change", (message) => {
    try {
      const event = JSON.parse(message.data);
      if (
        event.changedByClientSessionId &&
        String(event.changedByClientSessionId) === tabSessionId
      ) {
        return;
      }
    } catch {
      /* fall through to invalidation */
    }
    // The insurer portal surfaces patient coverage + claims, both of which can
    // shift when an insured patient's record or bill changes.
    notifyLinkhamPatientsUpdated();
    notifyLinkhamClaimsUpdated();
  });

  source.addEventListener("inventory_change", (message) => {
    try {
      const event = JSON.parse(message.data);
      if (!shouldProcessInventoryEvent(event, user)) {
        return;
      }

      // Only suppress the originating tab. A second tab/device for the same
      // user must still receive and apply the change so the inventory stays
      // in sync across devices.
      if (
        event.changedByClientSessionId &&
        String(event.changedByClientSessionId) === tabSessionId
      ) {
        return;
      }

      scheduleInventoryInvalidation(user, event);
    } catch {
      scheduleInventoryInvalidation(user, null);
    }
  });

  source.onerror = () => {
    if (eventSource === source) {
      source.close();
      eventSource = null;
    }
    scheduleReconnect(user);
  };
}

export function isInventoryRealtimeActive() {
  return Boolean(eventSource && activeSessionKey);
}

export const INVENTORY_SYNC_EVENTS = {
  doctorBag: DOCTOR_BAG_INVENTORY_EVENT,
  ocs: OCS_INVENTORY_EVENT,
};
