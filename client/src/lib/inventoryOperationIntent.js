// Keep a submission's identity across an uncertain network result, but never
// replay it after the user changes the form or opens a different item.
export function operationIdForIntent(ref, intent) {
  const key = JSON.stringify(intent);
  if (!ref.current || ref.current.key !== key) {
    ref.current = {
      key,
      id: globalThis.crypto?.randomUUID?.() || `inventory-${Date.now()}-${Math.random()}`,
    };
  }
  return ref.current.id;
}
