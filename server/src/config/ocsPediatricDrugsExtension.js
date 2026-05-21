/**
 * Pediatric Drugs rows for OCS master warehouse upsert.
 *
 * Source: ocsPediatricDrugsPdfCatalog.js (PAEDIATRIC DRUGS.pdf)
 * Upserted via seedOcsPediatricDrugsExtension.js (not loaded on app startup).
 */
const { ocsPediatricDrugsPdfCatalog } = require("./ocsPediatricDrugsPdfCatalog");

const ocsPediatricDrugsExtension = [...ocsPediatricDrugsPdfCatalog];

module.exports = {
  ocsPediatricDrugsExtension,
  ocsPediatricDrugsPdfCatalog,
};
