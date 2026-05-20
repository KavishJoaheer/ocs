/**
 * IM Drugs rows for OCS master warehouse upsert.
 *
 * Sources: ocsIMDrugsPdfCatalog.js (IM DRUGS.pdf) + legacy manifest rows (deduped by name).
 * Upserted via seedOcsIMDrugsExtension.js only (not loaded on app startup).
 */
const { ocsIMDrugsPdfCatalog } = require("./ocsIMDrugsPdfCatalog");

/** Legacy box-SKU manifest (kept when not duplicated in PDF catalog). */
const ocsIMDrugsManifest = [
  { name: "Voltaren 75mg/3ml Ampoule (Box of 5)", category: "IM Drugs", current_quantity: 0, par_level: 20, nearest_expiry: null },
  { name: "Profenid 100mg Ampoule (Box of 6)", category: "IM Drugs", current_quantity: 0, par_level: 15, nearest_expiry: null },
  { name: "Plasil 10mg Ampoule (Box of 10)", category: "IM Drugs", current_quantity: 0, par_level: 15, nearest_expiry: null },
  { name: "Buscopan 20mg Ampoule (Box of 10)", category: "IM Drugs", current_quantity: 0, par_level: 15, nearest_expiry: null },
  { name: "Tramal 100mg/2ml Ampoule (Box of 5)", category: "IM Drugs", current_quantity: 0, par_level: 10, nearest_expiry: null },
  { name: "Solumedrol 40mg Act-O-Vial (Single Unit)", category: "IM Drugs", current_quantity: 0, par_level: 10, nearest_expiry: null },
  { name: "Phenergan 50mg/2ml Ampoule (Box of 10)", category: "IM Drugs", current_quantity: 0, par_level: 8, nearest_expiry: null },
];

function mergeIMDrugsCatalog(pdfRows, manifestRows) {
  const seen = new Set();
  const merged = [];

  [...pdfRows, ...manifestRows].forEach((row) => {
    const key = String(row.name || "")
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(row);
  });

  return merged;
}

const ocsIMDrugsExtension = mergeIMDrugsCatalog(ocsIMDrugsPdfCatalog, ocsIMDrugsManifest);

module.exports = {
  ocsIMDrugsExtension,
  ocsIMDrugsManifest,
  ocsIMDrugsPdfCatalog,
};
