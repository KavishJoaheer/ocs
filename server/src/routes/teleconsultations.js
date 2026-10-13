const express = require("express");
const crypto = require("node:crypto");
const { db, ensureBillingForConsultation } = require("../db");
const { getTodayLocal } = require("../lib/utils");
const { normalizeMobile } = require("../lib/patientMagicLinks");
const { CONSENT_VERSION, CONSENT, SELECT, getTeleconsultation, serializeTeleconsultation } = require("../lib/teleconsultations");
const { publishPatientDataChange } = require("../lib/inventoryRealtime");
const { normalizeConsultationNotesPayload } = require("../lib/consultationNotes");
const { sendPushToRole, sendPushToUser, sendPushToPatientUser } = require("../lib/push");
const patientRouter = express.Router();
const staffRouter = express.Router();
function changed(row) { publishPatientDataChange(row.patient_id, { reason: "teleconsultation", notifyDoctorIds: [row.assigned_doctor_id] }); }
function notifyPatient(row, title, body) {
  void sendPushToPatientUser(row.patient_user_id, { title, body, url: "/teleconsultation", tag: `teleconsultation-${row.id}` }).catch(() => {});
}
function patientId(req) { return Number(req.portalPatientId || req.patientAuth.patient_id); }
function allowed(req, row) { return req.auth.role === "admin" || (req.auth.role === "doctor" && Number(req.auth.doctor_id) > 0 && Number(req.auth.doctor_id) === Number(row.assigned_doctor_id)); }
function dispatch(req) { return ["admin", "operator"].includes(req.auth.role); }
function screening(id) {
  return db.prepare(`SELECT s.* FROM teleconsultation_screenings s JOIN patients p ON p.id=s.patient_id
    WHERE s.patient_id=? AND s.screened_at > datetime('now','-24 hours') AND p.deleted_at IS NULL`).get(id);
}
patientRouter.get("/", (req, res) => {
  const id = patientId(req);
  const patient = db.prepare("SELECT * FROM patients WHERE id=? AND deleted_at IS NULL").get(id);
  const review = screening(id);
  return res.json({ consent_version: CONSENT_VERSION, consent: CONSENT,
    eligible: Boolean(patient && review && review.mobile_snapshot === normalizeMobile(patient.patient_contact_number)),
    requests: db.prepare(`${SELECT} WHERE t.patient_id=? ORDER BY t.id DESC LIMIT 20`).all(id).map(row => serializeTeleconsultation(row)) });
});
patientRouter.post("/", (req, res) => {
  const id = patientId(req);
  if (id !== Number(req.patientAuth.patient_id)) return res.status(400).json({ error: "Please contact OCS to arrange a consultation for a dependent." });
  if (req.body.consent_version !== CONSENT_VERSION || req.body.terms_accepted !== true || req.body.clinical_consent !== true) return res.status(400).json({ error: "Read the current terms and limitations and confirm your consent before requesting a consultation." });
  const reason = String(req.body.reason || "").trim();
  const location = String(req.body.current_location || "").trim();
  const callback = normalizeMobile(req.body.callback_number);
  if (!reason || reason.length > 2000 || !location || location.length > 1000 || !callback) return res.status(400).json({ error: "Provide your reason, current location and a valid Mauritius mobile callback number." });
  const patient = db.prepare("SELECT * FROM patients WHERE id=? AND deleted_at IS NULL").get(id);
  const review = screening(id);
  if (!patient || !review || review.mobile_snapshot !== normalizeMobile(patient.patient_contact_number)) return res.status(409).json({ error: "Please call OCS for screening before requesting a teleconsultation." });
  if (callback !== review.mobile_snapshot) return res.status(409).json({ error: "Use the mobile confirmed with OCS. Call the hotline to change it." });
  if (db.prepare("SELECT id FROM teleconsultation_requests WHERE patient_id=? AND status IN ('pending','assigned','in_consultation')").get(id)) return res.status(409).json({ error: "You already have an active teleconsultation request." });
  const code = String(crypto.randomInt(100000, 1000000));
  const result = db.prepare(`INSERT INTO teleconsultation_requests (patient_id, patient_user_id, reason, current_location, callback_number, consultation_code, consent_version, consent_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, req.patientAuth.id, reason, location, callback, code, CONSENT_VERSION, JSON.stringify(CONSENT));
  const row = getTeleconsultation(result.lastInsertRowid);
  changed(row);
  for (const role of ["operator", "admin"]) {
    void sendPushToRole(role, { title: "New teleconsultation request", body: "A patient has accepted consent and is awaiting doctor assignment.", url: "/teleconsultations" }).catch(() => {});
  }
  return res.status(201).json({ request: serializeTeleconsultation(row) });
});
patientRouter.post("/:id/cancel", (req, res) => {
  const row = getTeleconsultation(Number(req.params.id));
  if (!row || Number(row.patient_id) !== patientId(req)) return res.status(404).json({ error: "Request not found." });
  if (!["pending", "assigned"].includes(row.status)) return res.status(409).json({ error: "This request cannot be cancelled here. Please contact OCS." });
  db.prepare("UPDATE teleconsultation_requests SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
  changed(row);
  return res.json({ request: serializeTeleconsultation(getTeleconsultation(row.id)) });
});
staffRouter.get("/", (req, res) => {
  const where = req.auth.role === "doctor" ? " AND t.assigned_doctor_id=?" : "";
  const params = req.auth.role === "doctor" ? [req.auth.doctor_id || -1] : [];
  const rows = db.prepare(`${SELECT} WHERE 1=1 ${where} ORDER BY CASE WHEN t.status IN ('pending','assigned','in_consultation') THEN 0 ELSE 1 END, t.id DESC LIMIT 100`).all(...params);
  return res.json({ requests: rows.map(row => serializeTeleconsultation(row, { clinical: req.auth.role !== "operator" })) });
});
staffRouter.post("/:id/assign", (req, res) => {
  if (!dispatch(req)) return res.status(403).json({ error: "Only dispatch staff can assign a doctor." });
  const row = getTeleconsultation(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Request not found." });
  if (!["pending", "assigned"].includes(row.status)) return res.status(409).json({ error: "This request cannot be reassigned." });
  const doctorId = Number(req.body.doctor_id);
  const doctor = db.prepare(`SELECT d.id, u.id AS user_id FROM doctors d JOIN users u ON u.doctor_id=d.id
    WHERE d.id=? AND d.is_active=1 AND d.deleted_at IS NULL AND u.role='doctor' AND u.is_active=1 AND u.deleted_at IS NULL`).get(doctorId);
  if (!doctor) return res.status(400).json({ error: "Select an active doctor with a linked account." });
  db.prepare(`UPDATE teleconsultation_requests SET assigned_doctor_id=?, assigned_by=?, assigned_at=CURRENT_TIMESTAMP,
    status='assigned', code_attempts=0, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(doctorId, req.auth.id, row.id);
  notifyPatient(row, "Doctor assigned", "Your OCS teleconsultation has been assigned. Open Care to see your doctor and consultation code.");
  changed({ ...row, assigned_doctor_id: doctorId });
  publishPatientDataChange(row.patient_id, { reason: "teleconsultation", notifyDoctorIds: [row.assigned_doctor_id, doctorId] });
  void sendPushToUser(doctor.user_id, { title: "Teleconsultation assigned", body: "Open VP to review your assigned request and contact the patient.", url: "/teleconsultations" }).catch(() => {});
  return res.json({ request: serializeTeleconsultation(getTeleconsultation(row.id)) });
});
staffRouter.post("/:id/start", (req, res) => {
  const row = getTeleconsultation(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Request not found." });
  if (!allowed(req, row)) return res.status(403).json({ error: "Only the assigned doctor can start this consultation." });
  if (row.status !== "assigned") return res.status(409).json({ error: "This request is not awaiting consultation." });
  if (row.code_attempts >= 5) return res.status(429).json({ error: "Too many incorrect codes. Contact dispatch to review the assignment." });
  if (req.body.checks_confirmed !== true) return res.status(400).json({ error: "Confirm identity, location, privacy, consent and clinical suitability first." });
  if (String(req.body.consultation_code || "").trim() !== row.consultation_code) {
    db.prepare("UPDATE teleconsultation_requests SET code_attempts=code_attempts+1 WHERE id=?").run(row.id);
    return res.status(400).json({ error: "The consultation code does not match. Recheck it with the patient." });
  }
  db.prepare("UPDATE teleconsultation_requests SET status='in_consultation', code_verified_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
  changed(row);
  return res.json({ request: serializeTeleconsultation(getTeleconsultation(row.id)) });
});
staffRouter.post("/:id/complete", (req, res) => {
  const row = getTeleconsultation(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Request not found." });
  if (!allowed(req, row)) return res.status(403).json({ error: "Only the assigned doctor can complete this consultation." });
  if (row.status !== "in_consultation" || !row.code_verified_at) return res.status(409).json({ error: "Verify the patient and begin the consultation first." });
  const summary = String(req.body.patient_summary || "").trim();
  const followUp = String(req.body.follow_up || "").trim();
  const notes = normalizeConsultationNotesPayload(req.body);
  if (notes.error || !summary || !followUp || summary.length > 10000 || followUp.length > 2000) return res.status(400).json({ error: notes.error || "Provide a patient summary and clear follow-up arrangements." });
  const consultationId = db.transaction(() => {
    const date = getTodayLocal();
    const time = new Date(Date.now() + 4 * 3600000).toISOString().slice(11, 16);
    const appointmentId = db.prepare(`INSERT INTO appointments (patient_id, doctor_id, appointment_date, appointment_time, status) VALUES (?, ?, ?, ?, 'completed')`).run(row.patient_id, row.assigned_doctor_id, date, time).lastInsertRowid;
    const id = db.prepare(`INSERT INTO consultations (appointment_id, patient_id, doctor_id, consultation_date, doctor_notes, clinical_note, patient_diagnosis, patient_prescription) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(appointmentId, row.patient_id, row.assigned_doctor_id, date, notes.doctor_notes, notes.clinical_note, notes.patient_diagnosis, notes.patient_prescription).lastInsertRowid;
    ensureBillingForConsultation(id, row.patient_id, req.auth, req.body.consultation_type || null);
    db.prepare("UPDATE teleconsultation_requests SET status='completed', consultation_id=?, patient_summary=?, follow_up=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id, summary, followUp, row.id);
    return id;
  })();
  changed(row);
  notifyPatient(row, "Your care plan is ready", "Your consultation summary and any prescription are available in OCS Care.");
  return res.json({ request: serializeTeleconsultation(getTeleconsultation(row.id)), consultation_id: Number(consultationId) });
});
staffRouter.post("/:id/close", (req, res) => {
  const row = getTeleconsultation(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Request not found." });
  const referred = req.body.outcome === "referred";
  if (referred ? !allowed(req, row) : !dispatch(req)) return res.status(403).json({ error: "You cannot close this request." });
  if (!["pending", "assigned", "in_consultation"].includes(row.status)) return res.status(409).json({ error: "This request is already closed." });
  const note = String(req.body.outcome_note || "").trim();
  const followUp = String(req.body.follow_up || "").trim();
  if (!note || !followUp) return res.status(400).json({ error: "Provide the patient-facing reason and next step / responsible team member." });
  db.prepare("UPDATE teleconsultation_requests SET status=?, outcome_note=?, follow_up=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(referred ? "referred" : "cancelled", note, followUp, row.id);
  changed(row);
  notifyPatient(row, referred ? "Next step for your care" : "Teleconsultation cancelled", "Open OCS Care to review the next steps from your care team.");
  return res.json({ request: serializeTeleconsultation(getTeleconsultation(row.id)) });
});
module.exports = { patientRouter, staffRouter };
