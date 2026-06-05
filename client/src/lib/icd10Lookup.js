const ICD10_MAPPINGS = [
  {
    code: "N40.1",
    label: "Benign prostatic hyperplasia with lower urinary tract symptoms",
    patterns: [/benign prostatic/i, /bph/i, /urinary retention/i, /prostatic hyperplasia/i],
  },
  {
    code: "I10",
    label: "Essential (primary) hypertension",
    patterns: [/hypertension/i, /high blood pressure/i, /\bhtn\b/i],
  },
  {
    code: "E11.9",
    label: "Type 2 diabetes mellitus without complications",
    patterns: [/type 2 diabetes/i, /diabetes mellitus/i, /\bdm\b/i, /diabetic/i],
  },
  {
    code: "J44.9",
    label: "Chronic obstructive pulmonary disease, unspecified",
    patterns: [/copd/i, /chronic obstructive/i],
  },
  {
    code: "I50.9",
    label: "Heart failure, unspecified",
    patterns: [/heart failure/i, /cardiac failure/i],
  },
  {
    code: "M81.0",
    label: "Age-related osteoporosis without current pathological fracture",
    patterns: [/osteoporosis/i],
  },
  {
    code: "F03.90",
    label: "Unspecified dementia without behavioral disturbance",
    patterns: [/dementia/i, /alzheimer/i, /cognitive decline/i],
  },
  {
    code: "J18.9",
    label: "Pneumonia, unspecified organism",
    patterns: [/pneumonia/i],
  },
  {
    code: "J45.909",
    label: "Unspecified asthma, uncomplicated",
    patterns: [/asthma/i, /wheez/i],
  },
  {
    code: "N39.0",
    label: "Urinary tract infection, site not specified",
    patterns: [/urinary tract infection/i, /\buti\b/i],
  },
  {
    code: "I63.9",
    label: "Cerebral infarction, unspecified",
    patterns: [/stroke/i, /cerebral infarction/i],
  },
  {
    code: "E78.5",
    label: "Hyperlipidemia, unspecified",
    patterns: [/hyperlipid/i, /high cholesterol/i, /dyslipid/i],
  },
];

function normalizeSearchText(...values) {
  return values
    .flat()
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function resolveIcd10FromText(...sources) {
  const haystack = normalizeSearchText(...sources);
  if (!haystack) {
    return null;
  }

  for (const entry of ICD10_MAPPINGS) {
    if (entry.patterns.some((pattern) => pattern.test(haystack))) {
      return {
        code: entry.code,
        label: entry.label,
      };
    }
  }

  return null;
}
