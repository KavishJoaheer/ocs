export const CLINICAL_GUIDE_FORMAT = "ocs-clinical-guide-v1";

const FIELDS = [
  "presentation", "population", "routes", "dose", "dose_detail", "repeat", "maximum",
  "administration", "contraindications", "indications", "side_effects", "pharmacology",
  "notes", "source_title", "source_url", "source_updated",
];

export function clinicalGuideValues(guide) {
  return Object.fromEntries(FIELDS.map(key => [key,
    guide?.format === CLINICAL_GUIDE_FORMAT && typeof guide[key] === "string" ? guide[key].trim() : "",
  ]));
}

export function clinicalGuideSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
