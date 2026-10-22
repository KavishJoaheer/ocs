const { ACUTE_CARE_GUIDES } = require("../config/acuteCareClinicalGuides");
const { BUSCOPAN_IM_IV, BUSCOPAN_INJECTION_NAMES, ONDANSETRON_IM_IV, ONDANSETRON_INJECTION_NAMES, PHENERGAN_IM_IV, PHENERGAN_INJECTION_NAMES,
  TRAMADOL_IM_IV, TRAMADOL_INJECTION_NAMES, DIAZEPAM_IM_IV, DIAZEPAM_INJECTION_NAMES,
  HYDROCORTISONE_IM_IV, HYDROCORTISONE_INJECTION_NAMES, DEXAMETHASONE_IM_IV, DEXAMETHASONE_INJECTION_NAMES,
  CHLORPHENAMINE_IM_IV, CHLORPHENAMINE_INJECTION_NAMES } = require("../config/clinicalGuides");

const nameKey = value => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
const acuteCareNames = new Map(ACUTE_CARE_GUIDES.flatMap(entry => entry.names.map(name => [nameKey(name), entry])));
const injectionNames = new Set(BUSCOPAN_INJECTION_NAMES.map(nameKey));
const ondansetronNames = new Set(ONDANSETRON_INJECTION_NAMES.map(nameKey));
const phenerganNames = new Set(PHENERGAN_INJECTION_NAMES.map(nameKey));
const tramadolNames = new Set(TRAMADOL_INJECTION_NAMES.map(nameKey));
const diazepamNames = new Set(DIAZEPAM_INJECTION_NAMES.map(nameKey));
const hydrocortisoneNames = new Set(HYDROCORTISONE_INJECTION_NAMES.map(nameKey));
const dexamethasoneNames = new Set(DEXAMETHASONE_INJECTION_NAMES.map(nameKey));
const chlorphenamineNames = new Set(CHLORPHENAMINE_INJECTION_NAMES.map(nameKey));

function getClinicalGuideForItem(item) {
  if (!item || item.item_kind === "service") return null;
  const name = nameKey(item.item_name);
  if (acuteCareNames.has(name)) return acuteCareNames.get(name).guide;
  if (ondansetronNames.has(name)) return ONDANSETRON_IM_IV;
  if (phenerganNames.has(name)) return PHENERGAN_IM_IV;
  if (tramadolNames.has(name)) return TRAMADOL_IM_IV;
  if (diazepamNames.has(name)) return DIAZEPAM_IM_IV;
  if (hydrocortisoneNames.has(name)) return HYDROCORTISONE_IM_IV;
  if (dexamethasoneNames.has(name)) return DEXAMETHASONE_IM_IV;
  if (chlorphenamineNames.has(name)) return CHLORPHENAMINE_IM_IV;
  // The imported "Valium" entry has no route or strength in its name.
  // Only its injectable folder establishes that this is an injection reference.
  if (name === "valium" && ["imdrugs", "ivdrugs"].includes(nameKey(item.folder_name))) return DIAZEPAM_IM_IV;
  // The imported catalogue also has an unqualified name in injectable folders.
  const importedInjection = name === nameKey("Buscopan (Hyoscine Butylbromide)")
    && ["imdrugs", "ivdrugs"].includes(nameKey(item.folder_name));
  return injectionNames.has(name) || importedInjection ? BUSCOPAN_IM_IV : null;
}

function getInventoryItemAttributes(item) {
  const attributes = String(item?.attributes ?? "");
  // Fill missing catalogue metadata for known injections in both stock scopes.
  // Preserve meaningful custom attributes and never infer from a partial name.
  if (!attributes.trim() || /^n\s*\/\s*a$/i.test(attributes.trim())) {
    const guide = getClinicalGuideForItem(item);
    const acuteCare = ACUTE_CARE_GUIDES.find(entry => entry.guide === guide);
    if (acuteCare) return acuteCare.ingredient;
    if (guide === PHENERGAN_IM_IV) return "Promethazine";
    if (guide === TRAMADOL_IM_IV) return "Tramadol hydrochloride";
    if (guide === DIAZEPAM_IM_IV) return "Diazepam";
    if (guide === HYDROCORTISONE_IM_IV) return "Hydrocortisone";
    if (guide === DEXAMETHASONE_IM_IV) return "Dexamethasone";
    if (guide === CHLORPHENAMINE_IM_IV) return "Chlorphenamine";
  }
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
