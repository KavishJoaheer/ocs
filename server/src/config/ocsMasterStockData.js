/**
 * OCS master warehouse stock — base seed matrix (Consumable only).
 *
 * IM Drugs, IV Drugs, Wound Dressing, Oral Drugs, Pediatric Drugs, and Investigation
 * are loaded via separate extension manifests / PDF imports, not this file.
 *
 * Field mapping to SQLite `inventory` table:
 *   name            -> item_name
 *   category        -> folder_id (via inventory_folders.name)
 *   current_quantity -> quantity
 *   par_level       -> minimum_quantity
 *   nearest_expiry  -> expiry_date (+ inventory_batches.expiry_date)
 */
const ocsMasterStockData = [
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
];

module.exports = { ocsMasterStockData };
