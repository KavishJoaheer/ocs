const LINKHAM_CANONICAL = "Linkham";

function resolveInsuranceProviderFromTags(locationTags, explicitProvider = "") {
  const explicit = String(explicitProvider || "").trim();
  if (explicit) {
    return explicit;
  }

  const insuranceNames = (locationTags || [])
    .filter((tag) => String(tag?.category || "") === "Insurance")
    .map((tag) => String(tag?.name || "").trim())
    .filter(Boolean);

  if (insuranceNames.some((name) => name.toLowerCase() === "linkham")) {
    return LINKHAM_CANONICAL;
  }

  return insuranceNames[0] || "";
}

function isLinkhamInsuranceProvider(value) {
  return String(value || "").trim().toLowerCase() === "linkham";
}

module.exports = {
  LINKHAM_CANONICAL,
  isLinkhamInsuranceProvider,
  resolveInsuranceProviderFromTags,
};
