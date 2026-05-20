/**
 * IM Drugs catalog parsed from "IM DRUGS.pdf" (Entry Name list).
 * Quantities default to 0; par_level inferred from box/amp pack size when present.
 */

function inferParLevel(name) {
  const box = name.match(/box of (\d+)/i);
  if (box) return Math.max(3, Math.floor(Number(box[1]) / 2));
  return 5;
}

function imDrug(name, current_quantity = 0, par_level = null, nearest_expiry = null) {
  return {
    name,
    category: "IM Drugs",
    current_quantity,
    par_level: par_level ?? inferParLevel(name),
    nearest_expiry,
  };
}

/** @type {Array<{name:string,category:string,current_quantity:number,par_level:number,nearest_expiry:string|null}>} */
const ocsIMDrugsPdfCatalog = [
  imDrug("Aciloc box of 5 amp"),
  imDrug("Acupan 20mg/2ml box of 5 amp"),
  imDrug("Ceftriaxone 1g/ Triaxone/ Zefone IV/IM"),
  imDrug("Chlorohistol 10mg/1ml box of 5 amp"),
  imDrug("Dexamethasone 4mg/ Dexona"),
  imDrug("Diprostene (RA) I.A"),
  imDrug("Dynapar (Diclofenac) box of 5 Amp"),
  imDrug("Emetino 4mg (IV/IM) box of 10"),
  imDrug("Gynospan"),
  imDrug("Buscopan (Hyoscine Butylbromide)"),
  imDrug("IM Remicaine 2% box of 5"),
  imDrug("Konakion Vit K 2mg box of 5"),
  imDrug("Lasilix (IV/IM)"),
  imDrug("Lovenox 0.2ml"),
  imDrug("Lovenox 0.4ml"),
  imDrug("Lovenox 0.6ml"),
  imDrug("Meloxicam 15mg/1.5ml box of 10 amp"),
  imDrug("MethylPrednisolne 40mg"),
  imDrug("Morphine 10mg"),
  imDrug("NosPa box of 5 amp (IV/IM)"),
  imDrug("Nurorubin box of 5amp"),
  imDrug("Phenergan inj box of 5"),
  imDrug("Solu-cortef 100MG IM/IV (Hisone)"),
  imDrug("Spasfon Amp box of 6"),
  imDrug("Stemetil 12.5mg/1ml (Prochlorperazine)"),
  imDrug("Tramadol 100mg/2ml"),
  imDrug("Valium"),
  imDrug("Vogalene 10mg (IV/IM)"),
  imDrug("Xeforapid 8MG box of 5"),
  imDrug("Meropenem inj"),
  imDrug("Loxen inj box of 5"),
  imDrug("Triamcinolone inj"),
];

module.exports = { ocsIMDrugsPdfCatalog, imDrug, inferParLevel };
