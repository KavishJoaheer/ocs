/**
 * Consumable catalog parsed from CONSUMABLES.pdf / "OCS Stock - consumable.pdf"
 * (Entry Name + Attribute).
 * Quantities default to 0 where not listed in the PDF; par_level inferred from pack/box size when present.
 */

function inferParLevel(name) {
  const box = name.match(/box of (\d+)/i);
  if (box) return Math.max(5, Math.floor(Number(box[1]) / 2));
  const pack = name.match(/pack of (\d+)/i);
  if (pack) return Math.max(3, Math.floor(Number(pack[1]) / 2));
  return 10;
}

function consumable(name, current_quantity = 0, par_level = null, nearest_expiry = null) {
  return {
    name,
    category: "Consumable",
    current_quantity,
    par_level: par_level ?? inferParLevel(name),
    nearest_expiry,
  };
}

/** @type {Array<{name:string,category:string,current_quantity:number,par_level:number,nearest_expiry:string|null}>} */
const ocsConsumablesPdfCatalog = [
  consumable("2 Way Foley Catheter (Ch/Fr 14)"),
  consumable("2 Way Foley Catheter (Ch/Fr 16)"),
  consumable("2 Way Foley Catheter (Ch/Fr 18)"),
  consumable("2 Way Foley Catheter (Ch/Fr 20)"),
  consumable("2 Way Foley Catheter (Ch/Fr 22)"),
  consumable("Alcohol Pad box of 100 (3cmx3cm)"),
  consumable("Atomic Enema 20ml box of 2", 2, 1),
  consumable("Atomic enema 10ml box of 2", 2, 1),
  consumable("BIB Roll"),
  consumable("Cannula (Blue)"),
  consumable("Cannula (Pink)"),
  consumable("Cannula (Green)"),
  consumable("Cannula (Yellow)"),
  consumable("Cannula Strapping"),
  consumable("Crepe Bandage (Small) (5cmx4.5M)"),
  consumable("Crepe Bandage (Large) (7.5cmx4.5M)"),
  consumable("Disposal face mask (box of 50)", 0, 25),
  consumable("Disposal gloves (box of 100) (M)", 0, 50),
  consumable("Disposal gloves (box of 100) (L)", 0, 50),
  consumable("Ethylchloride Spray (ZK-INA spray)"),
  consumable("Gauze Non Sterile pack of 100pcs (10cmx10cm)", 0, 50),
  consumable("Gauze Non Sterile pack of 100pcs (5cmx5cm)", 0, 50),
  consumable("Gauze Sterile pack of 10pcs (10cmx10cm)", 0, 5),
  consumable("Glucose 50% / Dextrose 50% (10/20/50ml)"),
  consumable("Gown"),
  consumable("Intrafix (Drip Set / Infusion set)"),
  consumable("Irrigation Syringe (50ml)"),
  consumable("Lidocaine gel 2%"),
  consumable("Micropore (2.5cm)"),
  consumable("Micropore (5cm)"),
  consumable("White Adhesive Tape"),
  consumable("N/S 100ml"),
  consumable("N/S 500ml"),
  consumable("NGT (14fg x105cm)"),
  consumable("NGT (16fg x105cm)"),
  consumable("NGT (18fg x105cm)"),
  consumable("Nasal Oxygen Cannula"),
  consumable("Nebulizer Mask (Adult)"),
  consumable("Nebulizer Mask (Paediatric)"),
  consumable("Needle box of 100 (Black 22G)", 0, 50),
  consumable("Needle box of 100 (Blue 22G)", 0, 50),
  consumable("Needle box of 100 (Pink 22G)", 0, 50),
  consumable("Sterile Gloves (7.5)"),
  consumable("Sterile Gloves (7.0)"),
  consumable("Strapping 7.5cm"),
  consumable("Suction Tube"),
  consumable("Syringe (3ml)", 0, 50),
  consumable("Syringe (5ml)", 0, 50),
  consumable("Syringe (10ml)", 0, 25),
  consumable("Syringe (20ml)", 0, 25),
  consumable("Tongue-depressor box of 100", 0, 50),
  consumable("Tourniquet"),
  consumable("Urine bag"),
];

module.exports = { ocsConsumablesPdfCatalog };
