const listeners = new Set();
const dirtyKeys = new Set();

function notify() {
  const dirty = dirtyKeys.size > 0;
  listeners.forEach((listener) => listener(dirty));
}

export function setUnsavedWork(key, dirty) {
  const id = String(key || "default");
  if (dirty) dirtyKeys.add(id);
  else dirtyKeys.delete(id);
  notify();
}

export function hasUnsavedWork() {
  return dirtyKeys.size > 0;
}

export function subscribeUnsavedWork(listener) {
  listeners.add(listener);
  listener(hasUnsavedWork());
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.__OCS_UNSAVED_WORK__ = {
    set: setUnsavedWork,
    has: hasUnsavedWork,
  };
}
