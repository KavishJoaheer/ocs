/**
 * Oral Drugs rows for OCS master warehouse upsert.
 *
 * Source: ocsOralDrugsPdfCatalog.js (ORAL DRUGS.pdf)
 * Upserted via seedOcsOralDrugsExtension.js (not loaded on app startup).
 */
const { ocsOralDrugsPdfCatalog } = require("./ocsOralDrugsPdfCatalog");

const ocsOralDrugsExtension = [...ocsOralDrugsPdfCatalog];

module.exports = {
  ocsOralDrugsExtension,
  ocsOralDrugsPdfCatalog,
};
