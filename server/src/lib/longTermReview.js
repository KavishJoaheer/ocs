const { db } = require("../db");

function getAssignedReviewFilterSql(alias = "p") {
  return `
    AND COALESCE(${alias}.review_assigned_doctor_id, ${alias}.assigned_doctor_id) = @caseloadDoctorId
  `;
}

function resolveReviewDoctorId(patient) {
  return (
    Number(patient?.review_assigned_doctor_id || patient?.assigned_doctor_id || 0) || null
  );
}

function getGlobalLongTermReviewPatients({ caseloadDoctorId } = {}) {
  const scopedDoctorId = Number(caseloadDoctorId) || 0;
  const caseloadSql = scopedDoctorId > 0 ? getAssignedReviewFilterSql("p") : "";
  const stmt = db.prepare(`
      SELECT
        p.id,
        p.full_name,
        p.patient_identifier,
        p.patient_contact_number,
        p.location,
        p.status,
        p.ongoing_treatment,
        p.particularity,
        p.review_reason_note,
        p.review_due_date,
        p.review_appointment_time,
        p.assigned_doctor_id,
        p.review_assigned_doctor_id,
        p.created_at,
        d.full_name AS assigned_doctor_name,
        d.specialization AS assigned_doctor_specialization,
        rd.full_name AS review_assigned_doctor_name,
        rd.specialization AS review_assigned_doctor_specialization,
        MAX(c.consultation_date) AS last_consultation_date
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      LEFT JOIN doctors rd ON rd.id = COALESCE(p.review_assigned_doctor_id, p.assigned_doctor_id)
      LEFT JOIN consultations c ON c.patient_id = p.id
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'
        AND p.is_under_review = 1
        ${caseloadSql}
      GROUP BY
        p.id,
        p.full_name,
        p.patient_identifier,
        p.patient_contact_number,
        p.location,
        p.status,
        p.ongoing_treatment,
        p.particularity,
        p.review_reason_note,
        p.review_due_date,
        p.review_appointment_time,
        p.assigned_doctor_id,
        p.review_assigned_doctor_id,
        p.created_at,
        d.full_name,
        d.specialization,
        rd.full_name,
        rd.specialization
      ORDER BY
        CASE
          WHEN p.review_due_date IS NULL OR trim(p.review_due_date) = '' THEN 1
          ELSE 0
        END ASC,
        p.review_due_date ASC,
        p.full_name ASC
    `);
  return scopedDoctorId > 0 ? stmt.all({ caseloadDoctorId: scopedDoctorId }) : stmt.all();
}

function getLongTermReviewCount({ caseloadDoctorId } = {}) {
  const scopedDoctorId = Number(caseloadDoctorId) || 0;
  const caseloadSql = scopedDoctorId > 0 ? getAssignedReviewFilterSql("p") : "";
  const stmt = db.prepare(`
      SELECT COUNT(*) AS count
      FROM patients p
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'
        AND p.is_under_review = 1
        ${caseloadSql}
    `);
  const row = scopedDoctorId > 0 ? stmt.get({ caseloadDoctorId: scopedDoctorId }) : stmt.get();
  return Number(row?.count || 0);
}

function syncReviewAppointmentSlot({ patientId, doctorId, date, time }) {
  const pid = Number(patientId);
  const did = Number(doctorId);
  const day = String(date || "").trim();
  const slot = String(time || "").trim();

  if (!pid || !did || !day) {
    return null;
  }

  const existing = db
    .prepare(`
      SELECT id
      FROM appointments
      WHERE patient_id = ?
        AND appointment_date = ?
        AND status = 'scheduled'
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(pid, day);

  if (slot) {
    if (existing) {
      db.prepare("UPDATE appointments SET doctor_id = ?, appointment_time = ? WHERE id = ?").run(
        did,
        slot,
        existing.id,
      );
      return existing.id;
    }

    return db
      .prepare(`
        INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status)
        VALUES (?, ?, ?, ?, 'scheduled')
      `)
      .run(pid, did, day, slot).lastInsertRowid;
  }

  if (existing) {
    db.prepare("UPDATE appointments SET doctor_id = ? WHERE id = ?").run(did, existing.id);
    return existing.id;
  }

  return null;
}

module.exports = {
  getGlobalLongTermReviewPatients,
  getLongTermReviewCount,
  resolveReviewDoctorId,
  syncReviewAppointmentSlot,
};
