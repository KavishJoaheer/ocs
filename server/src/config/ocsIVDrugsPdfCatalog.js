/**
 * IV Drugs catalog parsed from "OCS Stock - IV DRUGS.pdf" (Entry Name list).
 * Quantities default to 0; par_level inferred from box size when present.
 */

function inferParLevel(name) {
  const box = name.match(/box of (\d+)/i);
  if (box) return Math.max(3, Math.floor(Number(box[1]) / 2));
  return 5;
}

function ivDrug(name, current_quantity = 0, par_level = null, nearest_expiry = null) {
  return {
    name,
    category: "IV Drugs",
    current_quantity,
    par_level: par_level ?? inferParLevel(name),
    nearest_expiry,
  };
}

/** @type {Array<{name:string,category:string,current_quantity:number,par_level:number,nearest_expiry:string|null}>} */
const ocsIVDrugsPdfCatalog = [
  ivDrug("Augmentin 1g"),
  ivDrug("Gentamycin 80mg"),
  ivDrug("IV Flagyl (Metrodinazole)"),
  ivDrug("IV Ocid 40mg"),
  ivDrug("IV Perfalgan 1g (Paracetamol)"),
  ivDrug("Levofloxacin 500mg/ Levobact/ Leflox"),
  ivDrug("Nexium"),
  ivDrug("Pabrinex 5ml (box of 6)/ Previta"),
  ivDrug("Profenid 100mg"),
];

module.exports = { ocsIVDrugsPdfCatalog, ivDrug, inferParLevel };
