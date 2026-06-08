export const LINKHAM_INSURANCE_PROVIDER = "Linkham";

export function isLinkhamInsuranceProvider(value) {
  return String(value || "").trim().toLowerCase() === "linkham";
}

export function resolveInsuranceProviderFromTags(locationTags = [], explicitProvider = "") {
  const insuranceNames = locationTags
    .filter((tag) => String(tag?.category || "") === "Insurance")
    .map((tag) => String(tag?.name || "").trim())
    .filter(Boolean);

  if (insuranceNames.some((name) => name.toLowerCase() === "linkham")) {
    return LINKHAM_INSURANCE_PROVIDER;
  }

  if (insuranceNames.length) {
    return insuranceNames[0];
  }

  return String(explicitProvider || "").trim();
}

export function syncInsuranceProviderWithTags(currentForm, nextTags) {
  const insuranceProvider = resolveInsuranceProviderFromTags(nextTags, "");
  const keepPolicyNumber = isLinkhamInsuranceProvider(insuranceProvider);

  return {
    ...currentForm,
    location_tags: nextTags,
    insurance_provider: insuranceProvider,
    insurance_policy_number: keepPolicyNumber ? currentForm.insurance_policy_number || "" : "",
  };
}

export function syncInsuranceSelection(currentForm, { insurance_provider, insurance_policy_number }) {
  const provider = String(insurance_provider || "").trim();
  const nextTags = (currentForm.location_tags || []).filter((tag) => tag.category !== "Insurance");

  if (provider) {
    nextTags.push({ category: "Insurance", name: provider });
  }

  const keepPolicyNumber = isLinkhamInsuranceProvider(provider);

  return {
    ...currentForm,
    location_tags: nextTags,
    insurance_provider: provider,
    insurance_policy_number: keepPolicyNumber
      ? String(
          insurance_policy_number !== undefined
            ? insurance_policy_number
            : currentForm.insurance_policy_number || "",
        ).trim()
      : "",
  };
}
