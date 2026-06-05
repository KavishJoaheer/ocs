const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/dashboard", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({
      patient: null,
      upcoming_appointments_count: 0,
      pending_bills_count: 0,
      next_appointment: null,
    });
  }

  const patient = db
    .prepare(`
      SELECT p.*, d.full_name AS assigned_doctor_name
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      WHERE p.id = ? AND p.deleted_at IS NULL
    `)
    .get(patientId);

  const upcomingCount = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM appointments
      WHERE patient_id = ?
        AND appointment_date >= date('now')
        AND status = 'scheduled'
    `)
    .get(patientId);

  const pendingBills = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM billing
      WHERE patient_id = ? AND status = 'unpaid'
    `)
    .get(patientId);

  const nextAppointment = db
    .prepare(`
      SELECT
        a.*,
        d.full_name AS doctor_name
      FROM appointments a
      JOIN doctors d ON d.id = a.doctor_id
      WHERE a.patient_id = ?
        AND a.appointment_date >= date('now')
        AND a.status = 'scheduled'
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT 1
    `)
    .get(patientId);

  return res.json({
    patient: patient || null,
    upcoming_appointments_count: upcomingCount?.count || 0,
    pending_bills_count: pendingBills?.count || 0,
    next_appointment: nextAppointment || null,
  });
});

router.get("/appointments", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({ appointments: [] });
  }

  const appointments = db
    .prepare(`
      SELECT
        a.*,
        d.full_name AS doctor_name
      FROM appointments a
      JOIN doctors d ON d.id = a.doctor_id
      WHERE a.patient_id = ?
      ORDER BY a.appointment_date DESC, a.appointment_time DESC
    `)
    .all(patientId);

  return res.json({ appointments });
});

router.get("/billing", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({ billing: [] });
  }

  const billing = db
    .prepare(`
      SELECT
        b.*,
        c.consultation_date,
        c.doctor_notes,
        d.full_name AS doctor_name
      FROM billing b
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE b.patient_id = ?
      ORDER BY b.created_at DESC
    `)
    .all(patientId);

  return res.json({ billing });
});

router.get("/profile", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.json({ patient: null });
  }

  const patient = db
    .prepare(`
      SELECT p.*, d.full_name AS assigned_doctor_name
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      WHERE p.id = ? AND p.deleted_at IS NULL
    `)
    .get(patientId);

  return res.json({ patient: patient || null });
});

router.put("/profile", (req, res) => {
  const patientId = req.patientAuth.patient_id;

  if (!patientId) {
    return res.status(404).json({ error: "Patient record not found." });
  }

  const patient = db
    .prepare("SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL")
    .get(patientId);

  if (!patient) {
    return res.status(404).json({ error: "Patient record not found." });
  }

  const phone = req.body.phone !== undefined ? String(req.body.phone).trim() : undefined;
  const address = req.body.address !== undefined ? String(req.body.address).trim() : undefined;
  const location = req.body.location !== undefined ? String(req.body.location).trim() : undefined;
  const nextOfKinName =
    req.body.next_of_kin_name !== undefined ? String(req.body.next_of_kin_name).trim() : undefined;
  const nextOfKinRelationship =
    req.body.next_of_kin_relationship !== undefined
      ? String(req.body.next_of_kin_relationship).trim()
      : undefined;
  const nextOfKinContactNumber =
    req.body.next_of_kin_contact_number !== undefined
      ? String(req.body.next_of_kin_contact_number).trim()
      : undefined;
  const nextOfKinEmail =
    req.body.next_of_kin_email !== undefined ? String(req.body.next_of_kin_email).trim() : undefined;
  const nextOfKinAddress =
    req.body.next_of_kin_address !== undefined
      ? String(req.body.next_of_kin_address).trim()
      : undefined;

  const updates = [];
  const params = [];

  if (phone !== undefined) {
    updates.push("patient_contact_number = ?");
    params.push(phone);
  }

  if (address !== undefined) {
    updates.push("address = ?");
    params.push(address);
  }

  if (location !== undefined) {
    updates.push("location = ?");
    params.push(location);
  }

  if (nextOfKinName !== undefined) {
    updates.push("next_of_kin_name = ?");
    params.push(nextOfKinName);
  }

  if (nextOfKinRelationship !== undefined) {
    updates.push("next_of_kin_relationship = ?");
    params.push(nextOfKinRelationship);
  }

  if (nextOfKinContactNumber !== undefined) {
    updates.push("next_of_kin_contact_number = ?");
    params.push(nextOfKinContactNumber);
  }

  if (nextOfKinEmail !== undefined) {
    updates.push("next_of_kin_email = ?");
    params.push(nextOfKinEmail);
  }

  if (nextOfKinAddress !== undefined) {
    updates.push("next_of_kin_address = ?");
    params.push(nextOfKinAddress);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid fields provided for update." });
  }

  params.push(patientId);

  db.prepare(`UPDATE patients SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  if (phone !== undefined) {
    db.prepare("UPDATE patient_users SET phone = ? WHERE patient_id = ?").run(phone, patientId);
  }

  const updated = db
    .prepare(`
      SELECT p.*, d.full_name AS assigned_doctor_name
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      WHERE p.id = ?
    `)
    .get(patientId);

  return res.json({ patient: updated });
});

module.exports = router;
