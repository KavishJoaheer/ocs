const { BUSCOPAN_IM_IV, BUSCOPAN_INJECTION_NAMES } = require("../config/clinicalGuides");

const nameKey = value => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
const injectionNames = new Set(BUSCOPAN_INJECTION_NAMES.map(nameKey));

function getClinicalGuideForItem(item) {
  if (!item || item.item_kind === "service") return null;
  const name = nameKey(item.item_name);
  // The imported catalogue also has an unqualified name in injectable folders.
  const importedInjection = name === nameKey("Buscopan (Hyoscine Butylbromide)")
    && ["imdrugs", "ivdrugs"].includes(nameKey(item.folder_name));
  return injectionNames.has(name) || importedInjection ? BUSCOPAN_IM_IV : null;
}

function clinicalGuideWriteError(body, existing = null) {
  if (Object.hasOwn(body, "clinical_guide")) return "Clinical guides are managed by the OCS backend and cannot be edited in the app.";
  // Permit unchanged values from older clients without allowing writes or clears.
  if (Object.hasOwn(body, "moa_notes") && body.moa_notes !== (existing?.moa_notes || "")) {
    return "Clinical guides are managed by the OCS backend and cannot be edited in the app.";
  }
  return null;
}

module.exports = { getClinicalGuideForItem, clinicalGuideWriteError };
