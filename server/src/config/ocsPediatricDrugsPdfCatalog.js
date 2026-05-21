/**
 * Pediatric Drugs catalog parsed from PAEDIATRIC DRUGS.pdf (Entry Name list).
 * Quantities default to 0; par_level inferred from box size when present.
 */

function inferParLevel(name) {
  const box = name.match(/box of (\d+)/i);
  if (box) return Math.max(3, Math.floor(Number(box[1]) / 2));
  return 5;
}

function pediatricDrug(name, current_quantity = 0, par_level = null, nearest_expiry = null) {
  return {
    name,
    category: "Pediatric Drugs",
    current_quantity,
    par_level: par_level ?? inferParLevel(name),
    nearest_expiry,
  };
}

/** @type {Array<{name:string,category:string,current_quantity:number,par_level:number,nearest_expiry:string|null}>} */
const ocsPediatricDrugsPdfCatalog = [
  pediatricDrug("Aerius 0.5mg/ml - 60ml/ Xylergy/ Zyrtec/ Allercet Syr"),
  pediatricDrug("Augmentin ES-600 - 50ml (enfant)"),
  pediatricDrug("Augmentin Nourrisson"),
  pediatricDrug("Azithro Suspension (Zocin)"),
  pediatricDrug("Celestene 0.05%"),
  pediatricDrug("Nurofen Syr"),
  pediatricDrug("Emefilm. 4mg"),
  pediatricDrug("Panotile"),
  pediatricDrug("Rehydratat"),
  pediatricDrug("Supp Diclowal 12.5mg"),
  pediatricDrug("Supp Diclowal 25mg"),
  pediatricDrug("Bactrim sulfaméthoxazole+triméthoprime"),
];

module.exports = { ocsPediatricDrugsPdfCatalog, pediatricDrug, inferParLevel };
