const { db } = require("../db");

function purgePatientRecordsSync(patientId) {
  const id = Number(patientId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("A valid patient id is required.");
  }

  const patient = db
    .prepare("SELECT id, full_name, patient_identifier FROM patients WHERE id = ?")
    .get(id);

  if (!patient) {
    return null;
  }

  const patientUserIds = db
    .prepare("SELECT id FROM patient_users WHERE patient_id = ?")
    .all(id)
    .map((row) => Number(row.id));

  let detachedDependents = 0;

  const run = db.transaction(() => {
    // Change requests cascade from both the patient and the appointment, but
    // delete them first so the purge does not depend on the foreign_keys pragma.
    db.prepare("DELETE FROM appointment_change_requests WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM lab_report_attachments WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM lab_reports WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM billing WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM consultations WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM appointments WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM patient_revisions WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM patient_operator_access WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM visit_requests WHERE patient_id = ?").run(id);
    // Visits a guardian booked for this patient are this patient's clinical data.
    db.prepare("DELETE FROM visit_requests WHERE dependent_patient_id = ?").run(id);
    db.prepare("DELETE FROM patient_locations WHERE patient_id = ?").run(id);

    // parent_patient_id has no foreign key, so dependents would keep pointing at
    // a row that no longer exists. Detach them rather than deleting other
    // patients' medical records as a side effect of this purge.
    detachedDependents = Number(
      db
        .prepare("UPDATE patients SET parent_patient_id = NULL WHERE parent_patient_id = ?")
        .run(id).changes || 0,
    );

    if (patientUserIds.length) {
      const placeholders = patientUserIds.map(() => "?").join(", ");
      db.prepare(
        `DELETE FROM patient_auth_sessions WHERE patient_user_id IN (${placeholders})`,
      ).run(...patientUserIds);
      db.prepare(
        `DELETE FROM patient_push_subscriptions WHERE patient_user_id IN (${placeholders})`,
      ).run(...patientUserIds);
    }

    db.prepare("DELETE FROM patient_users WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM patients WHERE id = ?").run(id);
  });

  run();

  return {
    id,
    full_name: patient.full_name,
    patient_identifier: patient.patient_identifier,
    detached_dependents: detachedDependents,
  };
}

module.exports = { purgePatientRecordsSync };
