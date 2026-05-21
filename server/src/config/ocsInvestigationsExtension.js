/**
 * Investigation rows for OCS master warehouse upsert.
 *
 * Source: ocsInvestigationsPdfCatalog.js (OCS Stock - INVESTIGATIONS.pdf)
 * Upserted via seedOcsInvestigationsExtension.js (not loaded on app startup).
 */
const { ocsInvestigationsPdfCatalog } = require("./ocsInvestigationsPdfCatalog");

const ocsInvestigationsExtension = [...ocsInvestigationsPdfCatalog];

module.exports = {
  ocsInvestigationsExtension,
  ocsInvestigationsPdfCatalog,
};
