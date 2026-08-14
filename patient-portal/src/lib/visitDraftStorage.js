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
      const parsed = JSON.parse(saved);
      return {
        ...INITIAL_DRAFT,
        ...parsed,
        visitFor: "myself",
      };
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
