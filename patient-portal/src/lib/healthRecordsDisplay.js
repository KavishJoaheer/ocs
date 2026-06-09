import dayjs from "dayjs";

const ISO_DATE_REGEX = /\b(\d{4}-\d{2}-\d{2})\b/g;

const MEDICAL_CONDITION_NAMES = {
  DM: "Diabetes Mellitus (DM)",
  HBP: "High Blood Pressure (HBP)",
  HTN: "High Blood Pressure (HBP)",
};

export function formatHealthDate(value) {
  if (!value) return "";
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("D MMMM YYYY") : String(value);
}

export function formatIsoDatesInText(text) {
  return String(text || "").replace(ISO_DATE_REGEX, (match) => formatHealthDate(match) || match);
}

export function formatDoctorName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "Doctor";
  if (/^dr\.?\s/i.test(trimmed)) return trimmed;
  return `Dr. ${trimmed}`;
}

export function formatHealthRecordsText(text) {
  return formatIsoDatesInText(text).replace(
    /\bwith\s+([^—\n]+?)\s*—/gi,
    (_, doctorName) => `with ${formatDoctorName(doctorName.trim())} —`,
  );
}

export function formatMedicalConditionName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return trimmed;

  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((part) => formatMedicalConditionName(part.trim()))
      .filter(Boolean)
      .join(" · ");
  }

  const mapped = MEDICAL_CONDITION_NAMES[trimmed.toUpperCase()];
  if (mapped) return mapped;

  if (/\(.+\)/.test(trimmed) || trimmed.split(/\s+/).length > 1) {
    return trimmed;
  }

  return trimmed;
}

export function isNilAllergyValue(name) {
  const normalized = String(name || "").trim().toUpperCase();
  return (
    normalized === "NIL" ||
    normalized === "N/A" ||
    normalized === "NA" ||
    normalized === "NONE" ||
    normalized === "NKDA" ||
    normalized === "NO KNOWN ALLERGIES" ||
    normalized === "NO KNOWN DRUG ALLERGIES"
  );
}

export function shouldShowPlainSummary(diagnosis, plainSummary) {
  const summary = String(plainSummary || "").trim();
  if (!summary) return false;
  const dx = String(diagnosis || "").trim();
  return summary.toLowerCase() !== dx.toLowerCase();
}

export function countVitalsDataPoints(vitalsTrends) {
  return (
    (vitalsTrends?.blood_pressure?.length || 0) +
    (vitalsTrends?.glucose?.length || 0) +
    (vitalsTrends?.hba1c?.length || 0)
  );
}
