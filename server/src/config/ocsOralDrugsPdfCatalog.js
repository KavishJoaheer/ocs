/**
 * Oral Drugs catalog parsed from ORAL DRUGS.pdf (Entry Name list).
 * Quantities default to 0; par_level inferred from pack/sachet size when present.
 */

function inferParLevel(name) {
  const box = name.match(/box of (\d+)/i);
  if (box) return Math.max(3, Math.floor(Number(box[1]) / 2));
  const pack = name.match(/pack of (\d+)/i);
  if (pack) return Math.max(3, Math.floor(Number(pack[1]) / 2));
  const sachet = name.match(/sachet of (\d+)/i);
  if (sachet) return Math.max(3, Math.floor(Number(sachet[1]) / 2));
  return 5;
}

function oralDrug(name, current_quantity = 0, par_level = null, nearest_expiry = null) {
  return {
    name,
    category: "Oral Drugs",
    current_quantity,
    par_level: par_level ?? inferParLevel(name),
    nearest_expiry,
  };
}

/** @type {Array<{name:string,category:string,current_quantity:number,par_level:number,nearest_expiry:string|null}>} */
const ocsOralDrugsPdfCatalog = [
  oralDrug("Dulopro sachet of 6 Nebules"),
  oralDrug("Pulmicort 0.5mg (pack of 5)"),
  oralDrug("Azithromycin 500mg x3"),
  oralDrug("Monuril 3g"),
  oralDrug("Nifedipine"),
  oralDrug("Norflex tab"),
  oralDrug("Nugene -O"),
  oralDrug("Tab Phenergan"),
  oralDrug("Tab Valium 10mg"),
  oralDrug("Algic-P"),
  oralDrug("Solpadeine"),
  oralDrug("SmectSa"),
  oralDrug("Flagly 500mg"),
];

module.exports = { ocsOralDrugsPdfCatalog, oralDrug, inferParLevel };
