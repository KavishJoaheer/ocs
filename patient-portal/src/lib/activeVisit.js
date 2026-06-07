const STORAGE_KEY = "ocs_active_visit";

export function getActiveVisit() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setActiveVisit(visit) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visit));
  } catch {
    // Storage unavailable — non-blocking.
  }
}

export function clearActiveVisit() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — non-blocking.
  }
}
