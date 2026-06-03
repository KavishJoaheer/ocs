const { db } = require("../db");

function getGlobalLongTermReviewPatients() {
  return db
    .prepare(`
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
        p.created_at,
        d.full_name AS assigned_doctor_name,
        d.specialization AS assigned_doctor_specialization,
        MAX(c.consultation_date) AS last_consultation_date
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      LEFT JOIN consultations c ON c.patient_id = p.id
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'
        AND p.is_under_review = 1
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
        p.created_at,
        d.full_name,
        d.specialization
      ORDER BY
        CASE
          WHEN p.review_due_date IS NULL OR trim(p.review_due_date) = '' THEN 1
          ELSE 0
        END ASC,
        p.review_due_date ASC,
        p.full_name ASC
    `)
    .all();
}

function getLongTermReviewCount() {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM patients p
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'
        AND p.is_under_review = 1
    `)
    .get();
  return Number(row?.count || 0);
}

module.exports = {
  getGlobalLongTermReviewPatients,
  getLongTermReviewCount,
};
