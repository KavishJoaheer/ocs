#!/usr/bin/env node
/**
 * Permanently remove specific patients and all linked clinical/portal records.
 * Requires ALLOW_DB_PURGE=true
 *
 * Usage:
 *   ALLOW_DB_PURGE=true PATIENT_IDS=75,152 node src/scripts/purgePatientsByIds.js
 *   ALLOW_DB_PURGE=true PATIENT_NAMES="Kavish Joaheer,JOHN WICK" node src/scripts/purgePatientsByIds.js
 *   docker exec -e ALLOW_DB_PURGE=true -e PATIENT_IDS=75,152 clinicflow-app node src/scripts/purgePatientsByIds.js
 */

const { db, initializeDatabase } = require("../db");
const { purgePatientRecordsSync } = require("../lib/purgePatientRecords");

function assertPurgeAllowed() {
  if (String(process.env.ALLOW_DB_PURGE || "").trim().toLowerCase() !== "true") {
    console.error("[abort] Set ALLOW_DB_PURGE=true to permanently remove patients.");
    process.exit(1);
  }
}

function resolvePatientIds() {
  const rawIds = String(process.env.PATIENT_IDS || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (rawIds.length) {
    return [...new Set(rawIds)];
  }

  const rawNames = String(process.env.PATIENT_NAMES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!rawNames.length) {
    console.error("[abort] Set PATIENT_IDS or PATIENT_NAMES.");
    process.exit(1);
  }

  const ids = [];

  rawNames.forEach((name) => {
    const rows = db
      .prepare(
        `
          SELECT id
          FROM patients
          WHERE lower(trim(full_name)) = lower(trim(?))
        `,
      )
      .all(name);

    if (!rows.length) {
      console.warn(`[skip] No patient found for name: ${name}`);
      return;
    }

    rows.forEach((row) => ids.push(Number(row.id)));
  });

  return [...new Set(ids)];
}

function purgePatientsByIdsSync(patientIds = resolvePatientIds()) {
  assertPurgeAllowed();
  initializeDatabase();

  const removed = [];

  patientIds.forEach((patientId) => {
    const result = purgePatientRecordsSync(patientId);
    if (result) {
      removed.push(result);
    } else {
      console.warn(`[skip] Patient #${patientId} not found.`);
    }
  });

  return removed;
}

if (require.main === module) {
  try {
    const removed = purgePatientsByIdsSync();
    if (!removed.length) {
      console.log("No matching patients were removed.");
    } else {
      console.log(`Permanently removed ${removed.length} patient(s).`);
      removed.forEach((row) => {
        const label = row.full_name || row.patient_identifier || `#${row.id}`;
        console.log(`  - ${label} (#${row.id})`);
      });
    }
  } catch (error) {
    console.error("Purge failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { purgePatientsByIdsSync };
