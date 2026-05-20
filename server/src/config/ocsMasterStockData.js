/**
 * OCS master warehouse stock — source matrix for seed/upsert scripts.
 *
 * Field mapping to SQLite `inventory` table:
 *   name            -> item_name
 *   category        -> folder_id (via inventory_folders.name)
 *   current_quantity -> quantity
 *   par_level       -> minimum_quantity
 *   nearest_expiry  -> expiry_date (+ inventory_batches.expiry_date)
 */
const ocsMasterStockData = [
  // CATEGORY 1: CONSUMABLE
  { name: "Syringe 2cc", category: "Consumable", current_quantity: 100, par_level: 50, nearest_expiry: null },
  { name: "Syringe 5cc", category: "Consumable", current_quantity: 100, par_level: 50, nearest_expiry: null },
  { name: "Syringe 10cc", category: "Consumable", current_quantity: 50, par_level: 25, nearest_expiry: null },
  { name: "Needle G21 (Green)", category: "Consumable", current_quantity: 100, par_level: 40, nearest_expiry: null },
  { name: "Needle G23 (Blue)", category: "Consumable", current_quantity: 100, par_level: 40, nearest_expiry: null },
  { name: "Needle G25 (Orange)", category: "Consumable", current_quantity: 50, par_level: 20, nearest_expiry: null },
  { name: "IV Cannula G20 (Pink)", category: "Consumable", current_quantity: 30, par_level: 15, nearest_expiry: null },
  { name: "IV Cannula G22 (Blue)", category: "Consumable", current_quantity: 40, par_level: 20, nearest_expiry: null },
  { name: "IV Cannula G24 (Yellow)", category: "Consumable", current_quantity: 20, par_level: 10, nearest_expiry: null },
  { name: "Alcohol Swabs", category: "Consumable", current_quantity: 500, par_level: 200, nearest_expiry: null },
  { name: "Micropore Tape", category: "Consumable", current_quantity: 12, par_level: 6, nearest_expiry: null },
  { name: "Sterile Gauze Swabs 10x10", category: "Consumable", current_quantity: 150, par_level: 75, nearest_expiry: null },
  { name: "IV Infusion Sets", category: "Consumable", current_quantity: 40, par_level: 20, nearest_expiry: null },

  // CATEGORY 2: IM DRUGS
  { name: "Voltaren 75mg/3ml Ampoule", category: "IM Drugs", current_quantity: 50, par_level: 20, nearest_expiry: "2027-11-30" },
  { name: "Profenid 100mg Ampoule", category: "IM Drugs", current_quantity: 30, par_level: 15, nearest_expiry: "2027-08-15" },
  { name: "Plasil 10mg Ampoule", category: "IM Drugs", current_quantity: 40, par_level: 15, nearest_expiry: "2027-04-20" },
  { name: "Buscopan 20mg Ampoule", category: "IM Drugs", current_quantity: 35, par_level: 15, nearest_expiry: "2028-01-10" },
  { name: "Tramal 100mg/2ml Ampoule", category: "IM Drugs", current_quantity: 25, par_level: 10, nearest_expiry: "2027-06-05" },
  { name: "Solumedrol 40mg Act-O-Vial", category: "IM Drugs", current_quantity: 20, par_level: 10, nearest_expiry: "2026-12-18" },
  { name: "Phenergan 50mg/2ml Ampoule", category: "IM Drugs", current_quantity: 15, par_level: 8, nearest_expiry: "2027-09-22" },

  // CATEGORY 3: IV DRUGS
  { name: "Perfalgan 1g/100ml Infusion", category: "IV Drugs", current_quantity: 24, par_level: 12, nearest_expiry: "2027-03-14" },
  { name: "Normal Saline 0.9% 100ml Bag", category: "IV Drugs", current_quantity: 60, par_level: 30, nearest_expiry: "2028-02-28" },
  { name: "Normal Saline 0.9% 500ml Bag", category: "IV Drugs", current_quantity: 40, par_level: 20, nearest_expiry: "2028-05-15" },
  { name: "Spasfon Infusion Ampoule", category: "IV Drugs", current_quantity: 30, par_level: 15, nearest_expiry: "2027-10-01" },
  { name: "Lasix 20mg/2ml IV Ampoule", category: "IV Drugs", current_quantity: 40, par_level: 15, nearest_expiry: "2027-07-19" },

  // CATEGORY 4: WOUND DRESSING
  { name: "Jaloplast Cream 25g", category: "Wound Dressing", current_quantity: 10, par_level: 5, nearest_expiry: "2027-02-10" },
  { name: "Betadine Dermique 10% 125ml", category: "Wound Dressing", current_quantity: 8, par_level: 4, nearest_expiry: "2027-05-25" },
  { name: "Normal Saline 0.9% 500ml (Washing)", category: "Wound Dressing", current_quantity: 24, par_level: 12, nearest_expiry: "2028-03-20" },
  { name: "Crepe Bandage 10cm", category: "Wound Dressing", current_quantity: 20, par_level: 10, nearest_expiry: null },
  { name: "Steristrips (Closure Strips)", category: "Wound Dressing", current_quantity: 50, par_level: 20, nearest_expiry: null },

  // CATEGORY 5: PEDIATRIC DRUGS
  { name: "Paracetamol Syrup 120mg/5ml", category: "Pediatric Drugs", current_quantity: 15, par_level: 8, nearest_expiry: "2027-01-15" },
  { name: "Augmentin Kids Syrup 156mg/5ml", category: "Pediatric Drugs", current_quantity: 12, par_level: 6, nearest_expiry: "2026-11-04" },
  { name: "Motilium Suspension 100ml", category: "Pediatric Drugs", current_quantity: 10, par_level: 5, nearest_expiry: "2027-06-30" },
  { name: "Spasfon Expan Pediatric Drops", category: "Pediatric Drugs", current_quantity: 8, par_level: 4, nearest_expiry: "2027-09-12" },
];

module.exports = { ocsMasterStockData };
