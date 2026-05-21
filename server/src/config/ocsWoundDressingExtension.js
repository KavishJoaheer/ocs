/**
 * Wound Dressing rows for OCS master warehouse upsert.
 *
 * Source: ocsWoundDressingPdfCatalog.js (WOUND DRESSING.pdf)
 * Upserted via seedOcsWoundDressingExtension.js (not loaded on app startup).
 */
const { ocsWoundDressingPdfCatalog } = require("./ocsWoundDressingPdfCatalog");

const ocsWoundDressingExtension = [...ocsWoundDressingPdfCatalog];

module.exports = {
  ocsWoundDressingExtension,
  ocsWoundDressingPdfCatalog,
};
