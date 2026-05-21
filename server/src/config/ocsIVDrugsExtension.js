/**
 * IV Drugs rows for OCS master warehouse upsert.
 *
 * Source: ocsIVDrugsPdfCatalog.js (OCS Stock - IV DRUGS.pdf)
 * Upserted via seedOcsIVDrugsExtension.js (not loaded on app startup).
 */
const { ocsIVDrugsPdfCatalog } = require("./ocsIVDrugsPdfCatalog");

const ocsIVDrugsExtension = [...ocsIVDrugsPdfCatalog];

module.exports = {
  ocsIVDrugsExtension,
  ocsIVDrugsPdfCatalog,
};
