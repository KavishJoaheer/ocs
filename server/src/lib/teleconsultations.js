const { db } = require("../db");
const CONSENT_VERSION = "2026-10-13-v1";
const CONSENT = [
  { title: "How your consultation works", text: "OCS will assign a doctor who will call you through WhatsApp. Keep your consultation code ready. The doctor will confirm your identity, current location, privacy and consent before assessing you." },
  { title: "Benefits and limitations", text: "Remote consultation can make care easier to access, but it cannot replace every physical examination. The doctor decides whether remote assessment is appropriate and may recommend tests, an in-person assessment or urgent care." },
  { title: "Urgent care and connection problems", text: "This service is not an emergency service. Seek urgent care for an emergency rather than waiting for a callback or message. If the connection fails, OCS will try your confirmed callback number; an in-person assessment may be needed." },
  { title: "Privacy and your records", text: "The consultation uses WhatsApp and therefore involves a third-party communication service. Technical failures and confidentiality risks remain possible. Use a private place and tell the doctor who else is present. OCS stores consultation records and any prescription in your patient record. OCS does not routinely record calls." },
  { title: "Your choice and next steps", text: "You can ask questions, decline or stop teleconsultation and discuss another route to care. Prescriptions and certificates depend on the doctor’s clinical judgement. Confirm the fee and any additional in-person or follow-up charges with OCS before agreeing. A clinical outcome is not guaranteed." },
];
const SELECT = `SELECT t.*, p.full_name AS patient_name, p.patient_identifier, d.full_name AS doctor_name, acceptor.full_name AS accepted_by_name
  FROM teleconsultation_requests t JOIN patients p ON p.id=t.patient_id AND p.deleted_at IS NULL
  LEFT JOIN doctors d ON d.id=t.assigned_doctor_id AND d.deleted_at IS NULL
  LEFT JOIN users acceptor ON acceptor.id=t.accepted_by AND acceptor.deleted_at IS NULL`;
function getTeleconsultation(id) { return db.prepare(`${SELECT} WHERE t.id=?`).get(id); }
function serializeTeleconsultation(row, { clinical = false, staff = false } = {}) {
  if (!row) return null;
  return { id: row.id, patient_id: row.patient_id, patient_name: row.patient_name, patient_identifier: row.patient_identifier,
    reason: row.reason, current_location: row.current_location, callback_number: row.callback_number, status: row.status,
    consultation_code: ["pending", "assigned", "in_consultation"].includes(row.status) ? row.consultation_code : null,
    consent_version: row.consent_version, consented_at: row.consented_at, assigned_doctor_id: row.assigned_doctor_id,
    doctor_name: row.doctor_name, assigned_at: row.assigned_at, code_verified_at: row.code_verified_at,
    accepted_at: row.accepted_at,
    consultation_id: row.consultation_id, patient_summary: row.patient_summary, follow_up: row.follow_up,
    outcome_note: row.outcome_note, created_at: row.created_at, updated_at: row.updated_at,
    ...(staff ? { accepted_by: row.accepted_by, accepted_by_name: row.accepted_by_name } : {}),
    ...(clinical ? { code_attempts: row.code_attempts } : {}) };
}
module.exports = { CONSENT_VERSION, CONSENT, SELECT, getTeleconsultation, serializeTeleconsultation };
