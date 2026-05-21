/**
 * Wound Dressing catalog parsed from WOUND DRESSING.pdf (Entry Name list).
 * Quantities default to 0; par_level inferred from box/pouch size when present.
 */

function inferParLevel(name) {
  const box = name.match(/box of (\d+)/i);
  if (box) return Math.max(3, Math.floor(Number(box[1]) / 2));
  const pouch = name.match(/(\d+)\s*pouch/i);
  if (pouch) return Math.max(3, Math.floor(Number(pouch[1]) / 2));
  return 5;
}

function woundDressing(name, current_quantity = 0, par_level = null, nearest_expiry = null) {
  return {
    name,
    category: "Wound Dressing",
    current_quantity,
    par_level: par_level ?? inferParLevel(name),
    nearest_expiry,
  };
}

/** @type {Array<{name:string,category:string,current_quantity:number,par_level:number,nearest_expiry:string|null}>} */
const ocsWoundDressingPdfCatalog = [
  woundDressing("Betadine Tulle"),
  woundDressing("Iodine Tulle dressing (box of 10 pouch)"),
  woundDressing("Betadine 125ml"),
  woundDressing("H2O2"),
  woundDressing("Alcohol 250ml"),
  woundDressing("Alcohol 500ml"),
  woundDressing("Micropore 5cm"),
  woundDressing("Strapping (Dermoplast)"),
  woundDressing("Blade 15T"),
  woundDressing("Blade 24"),
  woundDressing("Blade No.10"),
  woundDressing("Ethilon 3-0"),
  woundDressing("Ethilon 4-0"),
  woundDressing('Sterile Gauze 3"x3"'),
  woundDressing("Tegaderm 9x10cm"),
  woundDressing("Tegaderm 9x15cm"),
  woundDressing("Tegaderm 9x25cm"),
  woundDressing("Positon cream"),
  woundDressing("Diprosone cream"),
  woundDressing("Silverderma"),
  woundDressing("Chlorhexidine Gauze Dressing B.P .93 box of 10 pouch"),
  woundDressing("Silver Sulphadiazine tulle"),
];

module.exports = { ocsWoundDressingPdfCatalog, woundDressing, inferParLevel };
