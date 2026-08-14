const express = require("express");
const { db } = require("../db");
const { publishPatientDataChange } = require("../lib/inventoryRealtime");
const {
  getChangeRequestById,
  listChangeRequests,
} = require("../lib/appointmentChangeRequests");
const { sendPushToPatientUser } = require("../lib/push");

const router = express.Router();

router.get("/", (req, res) => {
  const status = String(req.query.status || "pending").trim() || "pending";
  const doctorId =
    req.auth.role === "doctor" && req.auth.doctor_id
      ? Number(req.auth.doctor_id)
      : null;

  return res.json({
    requests: listChangeRequests({ status, doctorId }),
  });
});

router.patch("/:id", (req, res) => {
  const requestId = Number(req.params.id);
  const existing = getChangeRequestById(requestId);
  if (!existing) {
    return res.status(404).json({ error: "Change request not found." });
  }

  if (req.auth.role === "doctor" && Number(req.auth.doctor_id) !== existing.doctor_id) {
    return res.status(403).json({ error: "You can only action your own appointments." });
  }

  const nextStatus = String(req.body.status || "").trim().toLowerCase();
  const staffNotes = String(req.body.staff_notes ?? existing.staff_notes ?? "").trim();

  if (!["acknowledged", "resolved", "rejected"].includes(nextStatus)) {
    return res.status(400).json({ error: "status must be acknowledged, resolved, or rejected." });
  }

  if (existing.status === "resolved" || existing.status === "rejected") {
    return res.status(400).json({ error: "This request has already been closed." });
  }

  if (nextStatus === "resolved" && existing.request_type === "reschedule") {
    const nextDate = String(req.body.appointment_date || existing.preferred_date || existing.appointment_date).trim();
    if (!nextDate) {
      return res.status(400).json({ error: "A new appointment date is required to reschedule." });
    }
  }

  const nextDate = String(req.body.appointment_date || existing.preferred_date || existing.appointment_date || "").trim();
  const nextTime = String(req.body.appointment_time || existing.preferred_time || existing.appointment_time || "").trim();

  db.transaction(() => {
    if (nextStatus === "resolved" && existing.request_type === "cancel") {
      db.prepare(
        `
          UPDATE appointments
          SET status = 'cancelled'
          WHERE id = ? AND status = 'scheduled'
        `,
      ).run(existing.appointment_id);
    }

    if (nextStatus === "resolved" && existing.request_type === "reschedule") {
      db.prepare(
        `
          UPDATE appointments
          SET appointment_date = ?, appointment_time = ?
          WHERE id = ? AND status = 'scheduled'
        `,
      ).run(nextDate, nextTime, existing.appointment_id);
    }

    db.prepare(
      `
        UPDATE appointment_change_requests
        SET status = ?, staff_notes = ?, resolved_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
    ).run(nextStatus, staffNotes, req.auth.id, requestId);
  })();

  const updated = getChangeRequestById(requestId);
  publishPatientDataChange(existing.patient_id, { reason: "appointment" });

  if (existing.patient_user_id && (nextStatus === "resolved" || nextStatus === "rejected")) {
    void sendPushToPatientUser(existing.patient_user_id, {
      title: nextStatus === "resolved" ? "Appointment updated" : "Appointment change declined",
      body:
        nextStatus === "resolved"
          ? existing.request_type === "cancel"
            ? "Your appointment has been cancelled."
            : "Your appointment has been rescheduled."
          : "The clinic could not make this appointment change. Please call if you still need help.",
      url: "/appointments",
      tag: `appointment-change-${requestId}`,
    }).catch(() => {});
  }

  return res.json({ request: updated });
});

module.exports = router;
