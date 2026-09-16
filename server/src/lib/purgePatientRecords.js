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
  let financialRecordsRetained = false;

  const run = db.transaction(() => {
    const billCount = Number(
      db.prepare("SELECT COUNT(*) AS count FROM billing WHERE patient_id = ?").get(id)?.count || 0,
    );
    financialRecordsRetained = billCount > 0;

    // Change requests cascade from both the patient and the appointment, but
    // delete them first so the purge does not depend on the foreign_keys pragma.
    db.prepare("DELETE FROM appointment_change_requests WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM lab_report_attachments WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM lab_reports WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM patient_revisions WHERE patient_id = ?").run(id);
    db.prepare("DELETE FROM patient_lifecycle_events WHERE patient_id = ?").run(id);
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

    if (financialRecordsRetained) {
      // Preserve the financial chain and its foreign keys, but erase clinical
      // content and direct identifiers. Invoice snapshots retain the OCS care
      // number, doctor, category and visit date required for accounting.
      db.prepare(`
        UPDATE billing
        SET patient_identifier_snapshot = COALESCE(NULLIF(patient_identifier_snapshot, ''), ?),
            patient_name_snapshot = 'Deleted patient'
        WHERE patient_id = ?
      `).run(patient.patient_identifier, id);
      db.prepare(`
        UPDATE consultations
        SET doctor_notes = '', clinical_note = '', patient_diagnosis = '',
            patient_prescription = '', vital_bp = '', vital_temperature = '',
            vital_glycemia = '', vital_spo2 = '', vital_rs = '', vital_pulse = ''
        WHERE patient_id = ?
      `).run(id);
      db.prepare(`
        UPDATE patients
        SET full_name = ?, first_name = 'Deleted', last_name = 'Patient',
            patient_identifier = ?, patient_id_number = '', age = 0,
            date_of_birth = '', gender = 'M', assigned_doctor_id = NULL,
            contact_number = '', patient_contact_number = '', contact_relationship = '',
            address = '', location = '', past_medical_history = '',
            past_surgical_history = '', drug_history = '', drug_allergy_history = '',
            particularity = '', consultation_notes = '', next_of_kin_name = '',
            next_of_kin_relationship = '', next_of_kin_contact_number = '',
            next_of_kin_email = '', next_of_kin_address = '', status = 'discharged',
            ongoing_treatment = '', is_subscribed = 0, is_under_review = 0,
            review_reason_note = NULL, review_due_date = NULL,
            insurance_provider = '', insurance_policy_number = '',
            review_appointment_time = NULL, review_assigned_doctor_id = NULL,
            parent_patient_id = NULL, family_relationship = '',
            deleted_reason = 'Identity anonymized; financial records retained',
            deleted_by_user_id = NULL, restored_at = NULL, restored_by_user_id = NULL,
            restore_reason = '', deleted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(`Deleted patient #${id}`, `PURGED-${id}`, id);
    } else {
      db.prepare("DELETE FROM consultations WHERE patient_id = ?").run(id);
      db.prepare("DELETE FROM appointments WHERE patient_id = ?").run(id);
      db.prepare("DELETE FROM patients WHERE id = ?").run(id);
    }
  });

  run();

  return {
    id,
    full_name: patient.full_name,
    patient_identifier: patient.patient_identifier,
    detached_dependents: detachedDependents,
    financial_records_retained: financialRecordsRetained,
  };
}

module.exports = { purgePatientRecordsSync };
