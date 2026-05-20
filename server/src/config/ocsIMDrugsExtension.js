/**
 * IM Drugs extension rows from the master warehouse manifest (spreadsheet extract).
 * Upserted only via seedOcsIMDrugsExtension.js (not loaded on app startup).
 *
 * Field mapping matches ocsMasterStockData.js / SQLite inventory:
 *   name            -> item_name (upsert match token)
 *   category        -> inventory_folders.name ("IM Drugs")
 *   current_quantity -> quantity (+ inventory_batches)
 *   par_level       -> minimum_quantity
 *   nearest_expiry  -> expiry_date
 */
const ocsIMDrugsExtension = [
  { name: "Voltaren 75mg/3ml Ampoule (Box of 5)", category: "IM Drugs", current_quantity: 50, par_level: 20, nearest_expiry: "2027-11-30" },
  { name: "Profenid 100mg Ampoule (Box of 6)", category: "IM Drugs", current_quantity: 30, par_level: 15, nearest_expiry: "2027-08-15" },
  { name: "Plasil 10mg Ampoule (Box of 10)", category: "IM Drugs", current_quantity: 40, par_level: 15, nearest_expiry: "2027-04-20" },
  { name: "Buscopan 20mg Ampoule (Box of 10)", category: "IM Drugs", current_quantity: 35, par_level: 15, nearest_expiry: "2028-01-10" },
  { name: "Tramal 100mg/2ml Ampoule (Box of 5)", category: "IM Drugs", current_quantity: 25, par_level: 10, nearest_expiry: "2027-06-05" },
  { name: "Solumedrol 40mg Act-O-Vial (Single Unit)", category: "IM Drugs", current_quantity: 20, par_level: 10, nearest_expiry: "2026-12-18" },
  { name: "Phenergan 50mg/2ml Ampoule (Box of 10)", category: "IM Drugs", current_quantity: 15, par_level: 8, nearest_expiry: "2027-09-22" },
];

module.exports = { ocsIMDrugsExtension };
