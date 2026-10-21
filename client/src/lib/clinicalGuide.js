export const CLINICAL_GUIDE_FORMAT = "ocs-clinical-guide-v1";

const FIELDS = [
  "presentation", "population", "routes", "dose", "dose_detail", "repeat", "maximum",
  "critical_warning", "dose_limits", "administration", "contraindications", "precautions", "indications", "side_effects", "pharmacology",
  "notes", "source_title", "source_url", "source_updated", "additional_source_title", "additional_source_url",
];

export function clinicalGuideValues(guide) {
  const values = Object.fromEntries(FIELDS.map(key => [key,
    guide?.format === CLINICAL_GUIDE_FORMAT && typeof guide[key] === "string" ? guide[key].trim() : "",
  ]));
  if (guide?.format === CLINICAL_GUIDE_FORMAT && Array.isArray(guide.dose_sections)) {
    const sections = guide.dose_sections.filter(section =>
      section && ["label", "dose", "detail"].every(key => typeof section[key] === "string" && section[key].trim())
    ).map(section => Object.fromEntries(["label", "dose", "detail"].map(key => [key, section[key].trim()])));
    if (sections.length) values.dose_sections = sections;
  }
  return values;
}

export function clinicalGuidePopulations(raw) {
  const primary = clinicalGuideValues(raw);
  const populations = [{ id: "primary", label: primary.population || "Adults", guide: primary }];
  const paediatric = clinicalGuideValues(raw?.format === CLINICAL_GUIDE_FORMAT ? raw.paediatric : null);
  // Each population supplies its own dosing, routes and limits. Never inherit adult doses.
  if (paediatric.population === "Paediatrics" && (paediatric.dose || paediatric.dose_sections?.length)) {
    populations.push({ id: "paediatric", label: "Paediatrics", guide: paediatric });
  }
  return populations;
}

export function clinicalGuideSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
