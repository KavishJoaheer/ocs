const { BUSCOPAN_IM_IV, BUSCOPAN_INJECTION_NAMES, ONDANSETRON_IM_IV, ONDANSETRON_INJECTION_NAMES, PHENERGAN_IM_IV, PHENERGAN_INJECTION_NAMES } = require("../config/clinicalGuides");

const nameKey = value => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
const injectionNames = new Set(BUSCOPAN_INJECTION_NAMES.map(nameKey));
const ondansetronNames = new Set(ONDANSETRON_INJECTION_NAMES.map(nameKey));
const phenerganNames = new Set(PHENERGAN_INJECTION_NAMES.map(nameKey));

function getClinicalGuideForItem(item) {
  if (!item || item.item_kind === "service") return null;
  const name = nameKey(item.item_name);
  if (ondansetronNames.has(name)) return ONDANSETRON_IM_IV;
  if (phenerganNames.has(name)) return PHENERGAN_IM_IV;
  // The imported catalogue also has an unqualified name in injectable folders.
  const importedInjection = name === nameKey("Buscopan (Hyoscine Butylbromide)")
    && ["imdrugs", "ivdrugs"].includes(nameKey(item.folder_name));
  return injectionNames.has(name) || importedInjection ? BUSCOPAN_IM_IV : null;
}

function getInventoryItemAttributes(item) {
  const attributes = String(item?.attributes ?? "");
  // Fill missing catalogue metadata for known injections in both stock scopes.
  // Preserve meaningful custom attributes and never infer from a partial name.
  if ((!attributes.trim() || /^n\s*\/\s*a$/i.test(attributes.trim()))
    && getClinicalGuideForItem(item) === PHENERGAN_IM_IV) return "Promethazine";
  return attributes;
}

function clinicalGuideWriteError(body, existing = null) {
  if (Object.hasOwn(body, "clinical_guide")) return "Clinical guides are managed by the OCS backend and cannot be edited in the app.";
  // Permit unchanged values from older clients without allowing writes or clears.
  if (Object.hasOwn(body, "moa_notes") && body.moa_notes !== (existing?.moa_notes || "")) {
    return "Clinical guides are managed by the OCS backend and cannot be edited in the app.";
  }
  return null;
}

module.exports = { getClinicalGuideForItem, getInventoryItemAttributes, clinicalGuideWriteError };
