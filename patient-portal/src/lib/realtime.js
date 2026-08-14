import { api, getStoredAuthToken } from "./api.js";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const RECONNECT_DELAY_MS = 2500;

/** Window event the pages listen to in order to refetch live. */
export const PATIENT_DATA_EVENT = "patient:data";

let eventSource = null;
let reconnectTimer = null;
let isConnected = false;
let connecting = false;

function clearReconnectTimer() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (!getStoredAuthToken() || reconnectTimer) {
    return;
  }

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    startPatientRealtime();
  }, RECONNECT_DELAY_MS);
}

export function isPatientRealtimeConnected() {
  return isConnected;
}

/**
 * Open the patient realtime (SSE) stream. The backend pushes a
 * `patient_data_change` event whenever this patient's record, appointments,
 * consultations, bills or lab reports change — from staff, the insurer, or
 * another of the patient's own devices — and we re-broadcast it as a DOM event
 * the pages refetch on.
 */
export function startPatientRealtime() {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return;
  }

  if (!getStoredAuthToken()) {
    stopPatientRealtime();
    return;
  }

  if (eventSource || connecting) {
    return;
  }

  isConnected = false;
  connecting = true;

  void (async () => {
    try {
      const minted = await api.post("/patient-portal/stream-token");
      const streamToken = minted?.token;
      if (!streamToken || eventSource) {
        if (!streamToken) {
          scheduleReconnect();
        }
        return;
      }

      const url = `${API_BASE}/patient-portal/stream?access_token=${encodeURIComponent(streamToken)}`;
      const source = new EventSource(url);
      eventSource = source;

      source.addEventListener("connected", () => {
        isConnected = true;
        clearReconnectTimer();
      });

      source.addEventListener("patient_data_change", () => {
        window.dispatchEvent(new CustomEvent(PATIENT_DATA_EVENT));
      });

      source.onerror = () => {
        isConnected = false;

        if (eventSource === source) {
          source.close();
          eventSource = null;
        }

        scheduleReconnect();
      };
    } catch {
      scheduleReconnect();
    } finally {
      connecting = false;
    }
  })();
}

export function stopPatientRealtime() {
  connecting = false;
  clearReconnectTimer();
  isConnected = false;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}
