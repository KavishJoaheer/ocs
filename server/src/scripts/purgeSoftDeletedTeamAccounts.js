#!/usr/bin/env node
/**
 * Permanently remove soft-deleted doctor, operator, and accountant accounts.
 * Requires ALLOW_DB_PURGE=true
 *
 * Doctors with assigned patients are skipped (reported) to avoid FK violations.
 *
 * Usage:
 *   ALLOW_DB_PURGE=true node src/scripts/purgeSoftDeletedTeamAccounts.js
 *   docker exec -e ALLOW_DB_PURGE=true clinicflow-app node src/scripts/purgeSoftDeletedTeamAccounts.js
 */

const { db, initializeDatabase } = require("../db");

function assertPurgeAllowed() {
  if (String(process.env.ALLOW_DB_PURGE || "").trim().toLowerCase() !== "true") {
    console.error(
      "[abort] Set ALLOW_DB_PURGE=true to permanently remove soft-deleted team accounts.",
    );
    process.exit(1);
  }
}

function purgeSoftDeletedTeamAccountsSync() {
  assertPurgeAllowed();
  initializeDatabase();

  const deletedDoctors = db
    .prepare(`
      SELECT d.id, d.full_name, u.id AS user_id
      FROM doctors d
      LEFT JOIN users u ON u.doctor_id = d.id AND u.role = 'doctor'
      WHERE d.deleted_at IS NOT NULL
    `)
    .all();

  const deletedSupport = db
    .prepare(`
      SELECT id, full_name, role, username
      FROM users
      WHERE role IN ('operator', 'accountant', 'linkham_admin')
        AND deleted_at IS NOT NULL
    `)
    .all();

  const countPatients = db.prepare(
    "SELECT COUNT(*) AS count FROM patients WHERE assigned_doctor_id = ? AND deleted_at IS NULL",
  );
  const deleteSessions = db.prepare("DELETE FROM auth_sessions WHERE user_id = ?");
  const deleteUser = db.prepare("DELETE FROM users WHERE id = ?");
  const deleteDoctor = db.prepare("DELETE FROM doctors WHERE id = ?");

  const removed = [];
  const skipped = [];

  const run = db.transaction(() => {
    deletedDoctors.forEach((doctor) => {
      const patientCount = Number(
        countPatients.get(doctor.id)?.count || 0,
      );
      if (patientCount > 0) {
        skipped.push({
          label: doctor.full_name || `Doctor #${doctor.id}`,
          reason: `${patientCount} assigned patient(s)`,
        });
        return;
      }

      if (doctor.user_id) {
        deleteSessions.run(doctor.user_id);
        deleteUser.run(doctor.user_id);
      } else {
        const orphanUsers = db
          .prepare(
            "SELECT id FROM users WHERE doctor_id = ? AND role = 'doctor'",
          )
          .all(doctor.id);
        orphanUsers.forEach((row) => {
          deleteSessions.run(row.id);
          deleteUser.run(row.id);
        });
      }

      deleteDoctor.run(doctor.id);
      removed.push(doctor.full_name || `Doctor #${doctor.id}`);
    });

    deletedSupport.forEach((account) => {
      deleteSessions.run(account.id);
      deleteUser.run(account.id);
      removed.push(
        `${account.full_name || account.username} (${account.role})`,
      );
    });
  });

  run();

  return { removed, skipped };
}

if (require.main === module) {
  try {
    const { removed, skipped } = purgeSoftDeletedTeamAccountsSync();
    if (!removed.length && !skipped.length) {
      console.log("No soft-deleted team accounts to remove.");
    } else {
      if (removed.length) {
        console.log(`Permanently removed ${removed.length} team account(s).`);
        removed.forEach((name) => console.log(`  - ${name}`));
      }
      if (skipped.length) {
        console.log(`Skipped ${skipped.length} doctor(s) with assigned patients:`);
        skipped.forEach((entry) =>
          console.log(`  - ${entry.label}: ${entry.reason}`),
        );
      }
    }
  } catch (error) {
    console.error("Purge failed:", error.message);
    process.exitCode = 1;
  }
}

module.exports = { purgeSoftDeletedTeamAccountsSync };
