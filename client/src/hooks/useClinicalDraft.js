import { useCallback, useEffect, useRef, useState } from "react";
import { hasUnsavedWork, setUnsavedWork } from "../lib/unsavedWork.js";

const PREFIX = "ocs-clinical-draft:";
const memory = new Map();
const EMPTY = { note: "", diagnosis: "", prescription: "", summary: "", outcomeNote: "", outcomeNextStep: "" };

export function clearClinicalDrafts() {
  memory.clear();
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith(PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch { /* Storage may be unavailable in private browsing. */ }
}

export function hasClinicalDrafts(user) {
  const scope = `${PREFIX}${user?.id}:${user?.doctor_id}:`;
  if ([...memory.entries()].some(([key, saved]) => key.startsWith(scope) && Object.values(saved.values).some(Boolean))) return true;
  try {
    return Object.keys(window.sessionStorage).some(key => {
      if (!key.startsWith(scope)) return false;
      const saved = JSON.parse(window.sessionStorage.getItem(key));
      return saved?.values && Object.values(saved.values).some(Boolean);
    });
  } catch { return false; }
}

function read(key) {
  if (!key) return EMPTY;
  const cached = memory.get(key);
  if (cached && Date.now() - cached.at < 12 * 60 * 60 * 1000) return cached.values;
  memory.delete(key);
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(key));
    if (saved?.values && Date.now() - saved.at < 12 * 60 * 60 * 1000) {
      return Object.fromEntries(Object.keys(EMPTY).map(field => [field, typeof saved.values[field] === "string" ? saved.values[field].slice(0, 10000) : ""]));
    }
    window.sessionStorage.removeItem(key);
  } catch { /* Keep the in-memory draft if storage is unavailable. */ }
  return EMPTY;
}

// Clinical drafts are scoped to the signed-in doctor and request, limited to
// this browser tab's session, expire after 12 hours, and are removed on logout.
// Patient verification codes and confirmations are deliberately never stored.
export function useClinicalDraft(user, request) {
  const key = user.role === "doctor" ? `${PREFIX}${user.id}:${user.doctor_id}:${request.id}` : null;
  const [draft, setDraft] = useState(() => read(key));
  const currentDraft = useRef(draft);
  const [retained, setRetained] = useState(() => {
    try { return Boolean(key && window.sessionStorage.getItem(key)); }
    catch { return false; }
  });
  const dirty = Object.values(draft).some(Boolean);
  const patch = useCallback((field, value) => {
    const next = { ...currentDraft.current, [field]: value };
    currentDraft.current = next;
    if (key) {
      memory.set(key, { values: next, at: Date.now() });
      try {
        window.sessionStorage.setItem(key, JSON.stringify({ values: next, at: Date.now() }));
        setRetained(true);
      } catch { setRetained(false); }
    }
    setDraft(next);
  }, [key]);
  const clear = useCallback(() => {
    if (key) {
      memory.delete(key);
      try { window.sessionStorage.removeItem(key); } catch { /* Best effort. */ }
      setUnsavedWork(key, false);
    }
    currentDraft.current = EMPTY;
    setDraft(EMPTY);
    setRetained(false);
  }, [key]);
  useEffect(() => {
    if (!key) return undefined;
    setUnsavedWork(key, dirty);
    return () => setUnsavedWork(key, false);
  }, [key, dirty]);
  return { draft, patch, clear, dirty, retained };
}

// BrowserRouter cannot use useBlocker. Warn on links/reload, while session
// drafts also protect browser Back and programmatic navigation.
export function useDraftNavigationProtection() {
  useEffect(() => {
    const unload = event => {
      if (!hasUnsavedWork()) return;
      event.preventDefault(); event.returnValue = "";
    };
    const navigate = event => {
      if (!hasUnsavedWork() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm("You have an unfinished consultation. Leave this page? Your draft is kept in this tab when browser storage is available. It has not been saved to the patient record.")) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, []);
}
