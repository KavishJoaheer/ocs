export const LINKHAM_INSURANCE_PROVIDER = "Linkham";

export function resolveInsuranceProviderFromTags(locationTags = [], explicitProvider = "") {
  const explicit = String(explicitProvider || "").trim();
  if (explicit) {
    return explicit;
  }

  const insuranceNames = locationTags
    .filter((tag) => String(tag?.category || "") === "Insurance")
    .map((tag) => String(tag?.name || "").trim())
    .filter(Boolean);

  if (insuranceNames.some((name) => name.toLowerCase() === "linkham")) {
    return LINKHAM_INSURANCE_PROVIDER;
  }

  return insuranceNames[0] || "";
}

export function syncInsuranceProviderWithTags(currentForm, nextTags) {
  return {
    ...currentForm,
    location_tags: nextTags,
    insurance_provider: resolveInsuranceProviderFromTags(nextTags, currentForm.insurance_provider),
  };
}
