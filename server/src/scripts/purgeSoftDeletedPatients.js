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

  const deleteAttachments = db.prepare(
    "DELETE FROM lab_report_attachments WHERE patient_id = ?",
  );
  const deleteLabReports = db.prepare("DELETE FROM lab_reports WHERE patient_id = ?");
  const deleteBilling = db.prepare("DELETE FROM billing WHERE patient_id = ?");
  const deleteConsultations = db.prepare("DELETE FROM consultations WHERE patient_id = ?");
  const deleteAppointments = db.prepare("DELETE FROM appointments WHERE patient_id = ?");
  const deleteRevisions = db.prepare("DELETE FROM patient_revisions WHERE patient_id = ?");
  const deleteOperatorAccess = db.prepare(
    "DELETE FROM patient_operator_access WHERE patient_id = ?",
  );
  const deleteLocations = db.prepare("DELETE FROM patient_locations WHERE patient_id = ?");
  const deletePatient = db.prepare("DELETE FROM patients WHERE id = ?");

  const run = db.transaction((rows) => {
    rows.forEach(({ id }) => {
      deleteAttachments.run(id);
      deleteLabReports.run(id);
      deleteBilling.run(id);
      deleteConsultations.run(id);
      deleteAppointments.run(id);
      deleteRevisions.run(id);
      deleteOperatorAccess.run(id);
      deleteLocations.run(id);
      deletePatient.run(id);
    });
  });

  run(patientIds);

  return {
    removed: patientIds.length,
    names: patientIds.map((row) => row.full_name || row.patient_identifier || `#${row.id}`),
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
