const STRUCTURED_LOCATION_CATEGORIES = new Set([
  "Village",
  "Town",
  "Neighborhood",
  "Clinic",
]);

const LEGACY_LOCATION_CATEGORY = "Legacy Location";

function normalizeLocationTag(tag) {
  const category = String(tag?.category ?? "").trim();
  const name = String(tag?.name ?? "").trim();
  return category && name ? { category, name } : null;
}

export function normalizeLocationTags(tags) {
  const deduped = new Map();

  for (const tag of tags || []) {
    const normalized = normalizeLocationTag(tag);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.category.toLowerCase()}::${normalized.name.toLowerCase()}`;
    if (!deduped.has(key)) {
      deduped.set(key, normalized);
    }
  }

  return Array.from(deduped.values());
}

export function hasStructuredLocationTags(tags) {
  return normalizeLocationTags(tags).some((tag) =>
    STRUCTURED_LOCATION_CATEGORIES.has(tag.category),
  );
}

export function sanitizeLocationTagsForDisplay(tags) {
  const normalized = normalizeLocationTags(tags);
  if (!hasStructuredLocationTags(normalized)) {
    return normalized;
  }

  return normalized.filter((tag) => tag.category !== LEGACY_LOCATION_CATEGORY);
}

export function buildPatientLocationFieldFromTags(tags) {
  const sanitized = sanitizeLocationTagsForDisplay(tags);

  return sanitized
    .filter((tag) => tag.category !== "Insurance")
    .map((tag) => tag.name)
    .join(", ");
}
