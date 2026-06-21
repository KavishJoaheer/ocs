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

  const run = db.transaction(() => {
    db.prepare("DELETE FROM lab_report_attachments WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM lab_reports WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM billing WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM consultations WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM appointments WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM patient_revisions WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM patient_operator_access WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM visit_requests WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM patient_locations WHERE patient_id = ?").run(id);

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
  };
}

module.exports = { purgePatientRecordsSync };
