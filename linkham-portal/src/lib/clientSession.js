// Per-tab client session id used to distinguish concurrent windows/devices
// that belong to the same authenticated user. The id is stable for the life
// of a single browser tab (sessionStorage), but every new tab gets its own
// value so cross-device/cross-tab real-time fan-out can deliver updates
// without an originating tab echoing its own mutation back to itself.

const STORAGE_KEY = "ocs_client_session_id";

let cachedId = null;

function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function getClientSessionId() {
  if (cachedId) {
    return cachedId;
  }

  if (typeof window === "undefined") {
    cachedId = generateId();
    return cachedId;
  }

  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      cachedId = stored;
      return stored;
    }
  } catch {
    // sessionStorage may be unavailable (privacy mode); fall through.
  }

  cachedId = generateId();

  try {
    window.sessionStorage.setItem(STORAGE_KEY, cachedId);
  } catch {
    // best effort only; in-memory value is still stable for the tab
  }

  return cachedId;
}

export const CLIENT_SESSION_HEADER = "X-Client-Session-Id";
