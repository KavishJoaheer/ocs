/**
 * Consumable rows for OCS master warehouse upsert.
 * Merged: spreadsheet manifest + PDF catalog (CONSUMABLES.pdf).
 *
 * Upserted by seedOcsConsumablesExtension.js and ensureOcsCatalog on startup.
 */
const { ocsConsumablesPdfCatalog } = require("./ocsConsumablesPdfCatalog");

/** Original manifest extract (explicit qty / par). */
const ocsConsumablesManifest = [
  { name: "Syringe 2cc (Box of 100)", category: "Consumable", current_quantity: 100, par_level: 50, nearest_expiry: null },
  { name: "Syringe 5cc (Box of 100)", category: "Consumable", current_quantity: 100, par_level: 50, nearest_expiry: null },
  { name: "Syringe 10cc (Box of 100)", category: "Consumable", current_quantity: 50, par_level: 25, nearest_expiry: null },
  { name: "Needle G21 Green (Box of 100)", category: "Consumable", current_quantity: 100, par_level: 40, nearest_expiry: null },
  { name: "Needle G23 Blue (Box of 100)", category: "Consumable", current_quantity: 100, par_level: 40, nearest_expiry: null },
  { name: "Needle G25 Orange (Box of 100)", category: "Consumable", current_quantity: 50, par_level: 20, nearest_expiry: null },
  { name: "Alcohol Swabs (Box of 200)", category: "Consumable", current_quantity: 200, par_level: 100, nearest_expiry: null },
  { name: "Micropore 1 inch (Box of 12)", category: "Consumable", current_quantity: 12, par_level: 6, nearest_expiry: null },
  { name: "Sterile Gauze Swabs 10x10 (Pkt of 50)", category: "Consumable", current_quantity: 50, par_level: 25, nearest_expiry: null },
  { name: "Non-Sterile Gauze Swabs 10x10 (Pkt of 100)", category: "Consumable", current_quantity: 100, par_level: 40, nearest_expiry: null },
  { name: "IV Infusion Sets (Pack of 50)", category: "Consumable", current_quantity: 50, par_level: 20, nearest_expiry: null },
  { name: "Tegaderm 6x7cm (Box of 100)", category: "Consumable", current_quantity: 100, par_level: 30, nearest_expiry: null },
  { name: "Venflon G20 Pink (Pack of 50)", category: "Consumable", current_quantity: 50, par_level: 20, nearest_expiry: null },
  { name: "Venflon G22 Blue (Pack of 50)", category: "Consumable", current_quantity: 50, par_level: 20, nearest_expiry: null },
  { name: "Venflon G24 Yellow (Pack of 50)", category: "Consumable", current_quantity: 50, par_level: 20, nearest_expiry: null },
];

function mergeConsumablesCatalog(manifestRows, pdfRows) {
  const seen = new Set();
  const merged = [];

  [...manifestRows, ...pdfRows].forEach((row) => {
    const key = String(row.name || "")
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(row);
  });

  return merged;
}

const ocsConsumablesExtension = mergeConsumablesCatalog(
  ocsConsumablesManifest,
  ocsConsumablesPdfCatalog,
);

module.exports = {
  ocsConsumablesExtension,
  ocsConsumablesManifest,
  ocsConsumablesPdfCatalog,
};
