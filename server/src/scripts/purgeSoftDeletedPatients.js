#!/usr/bin/env node
/**
 * Permanently remove all soft-deleted patients and their clinical records.
 * Requires ALLOW_DB_PURGE=true
 *
 * Usage:
 *   ALLOW_DB_PURGE=true node src/scripts/purgeSoftDeletedPatients.js
 *   docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeSoftDeletedPatients.js
 */

const { db, initializeDatabase } = require("../db");
const { purgePatientRecordsSync } = require("../lib/purgePatientRecords");

function assertPurgeAllowed() {
  if (String(process.env.ALLOW_DB_PURGE || "").trim().toLowerCase() !== "true") {
    console.error(
      "[abort] Set ALLOW_DB_PURGE=true to permanently remove soft-deleted patients.",
    );
    process.exit(1);
  }
}

function purgeSoftDeletedPatientsSync() {
  assertPurgeAllowed();
  initializeDatabase();

  const patientIds = db
    .prepare("SELECT id, full_name, patient_identifier FROM patients WHERE deleted_at IS NOT NULL")
    .all()
    .map((row) => ({
      id: Number(row.id),
      full_name: row.full_name,
      patient_identifier: row.patient_identifier,
    }));

  if (!patientIds.length) {
    return { removed: 0, names: [] };
  }

  const removed = patientIds
    .map((row) => purgePatientRecordsSync(row.id))
    .filter(Boolean);

  return {
    removed: removed.length,
    names: removed.map((row) => row.full_name || row.patient_identifier || `#${row.id}`),
  };
}

if (require.main === module) {
  try {
    const result = purgeSoftDeletedPatientsSync();
    if (result.removed === 0) {
      console.log("No soft-deleted patients to remove.");
    } else {
      console.log(`Permanently removed ${result.removed} soft-deleted patient(s).`);
      result.names.forEach((name) => console.log(`  - ${name}`));
    }
  } catch (error) {
    console.error("Purge failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { purgeSoftDeletedPatientsSync };
