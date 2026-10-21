export const CLINICAL_GUIDE_FORMAT = "ocs-clinical-guide-v1";

export const CLINICAL_GUIDE_FIELDS = [
  { key: "presentation", label: "Strength / presentation", placeholder: "e.g. 20 mg/mL · 1 mL ampoule" },
  { key: "population", label: "Patient group", placeholder: "e.g. Adults" },
  { key: "routes", label: "Routes", placeholder: "e.g. IM / IV" },
  { key: "dose", label: "Dose" },
  { key: "dose_detail", label: "Dose detail", placeholder: "e.g. 1 ampoule · 1 mL" },
  { key: "repeat", label: "Repeat interval" },
  { key: "maximum", label: "Maximum dose" },
  { key: "administration", label: "Administration cautions", multiline: true },
  { key: "contraindications", label: "Contraindications", multiline: true },
  { key: "indications", label: "Indications", multiline: true },
  { key: "side_effects", label: "Side effects", multiline: true },
  { key: "pharmacology", label: "Drug class & pharmacology", multiline: true },
  { key: "notes", label: "Additional clinical notes", multiline: true },
  { key: "source_title", label: "Source name" },
  { key: "source_url", label: "Source link (HTTPS)", type: "url" },
];

export function clinicalGuideValues(raw) {
  const empty = Object.fromEntries(CLINICAL_GUIDE_FIELDS.map(({ key }) => [key, ""]));
  const text = String(raw ?? "").trim();
  if (!text) return empty;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.format === CLINICAL_GUIDE_FORMAT) {
      for (const { key } of CLINICAL_GUIDE_FIELDS) {
        if (typeof parsed[key] === "string") empty[key] = parsed[key].trim();
      }
      return empty;
    }
  } catch { /* Existing free-text notes remain readable and editable. */ }
  return { ...empty, notes: text };
}

export function serializeClinicalGuide(values) {
  const fields = Object.fromEntries(CLINICAL_GUIDE_FIELDS.map(({ key }) => [key, String(values[key] ?? "").trim()]));
  return Object.values(fields).some(Boolean)
    ? JSON.stringify({ format: CLINICAL_GUIDE_FORMAT, ...fields }) : "";
}

export function clinicalGuideSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
