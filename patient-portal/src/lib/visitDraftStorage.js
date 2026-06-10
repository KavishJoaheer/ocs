const INITIAL_DRAFT = {
  visitFor: "myself",
  address: "",
  reason: "",
  urgency: "routine",
  submittedAt: null,
};

export function getVisitDraftStorageKey(user) {
  const id = user?.id ?? user?.patient_id ?? user?.email;
  return id ? `ocs-visit-draft:${id}` : "ocs-visit-draft:anonymous";
}

export function readVisitDraft(storageKey) {
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (saved) {
      return { ...INITIAL_DRAFT, ...JSON.parse(saved) };
    }
  } catch {
    // Ignore corrupt storage.
  }
  return { ...INITIAL_DRAFT };
}

export function writeVisitDraft(storageKey, draft) {
  sessionStorage.setItem(storageKey, JSON.stringify(draft));
}

export function clearVisitDraft(storageKey) {
  sessionStorage.removeItem(storageKey);
}

export { INITIAL_DRAFT };
