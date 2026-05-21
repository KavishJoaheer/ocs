/**
 * Investigation catalog parsed from "OCS Stock - INVESTIGATIONS.pdf" (Entry Name list).
 * Quantities default to 0; par_level inferred from box size when present.
 */

function inferParLevel(name) {
  const box = name.match(/box of (\d+)/i);
  if (box) return Math.max(3, Math.floor(Number(box[1]) / 2));
  return 5;
}

function investigation(name, current_quantity = 0, par_level = null, nearest_expiry = null) {
  return {
    name,
    category: "Investigation",
    current_quantity,
    par_level: par_level ?? inferParLevel(name),
    nearest_expiry,
  };
}

/** @type {Array<{name:string,category:string,current_quantity:number,par_level:number,nearest_expiry:string|null}>} */
const ocsInvestigationsPdfCatalog = [
  investigation("Covid Test"),
  investigation("ECG Roll (L)"),
  investigation("ECG Rolls (S)"),
  investigation("Echo Gel"),
  investigation("Influenza Rapid Test"),
  investigation("Lancet"),
  investigation("On Call Extra Strips"),
  investigation("On call Plus Strips"),
  investigation("Pregnancy Test"),
  investigation("Sinocare strip"),
  investigation("Urine dip stick"),
];

module.exports = { ocsInvestigationsPdfCatalog, investigation, inferParLevel };
