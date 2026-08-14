const { db } = require("../db");

const CHANGE_SELECT = `
  SELECT
    r.*,
    a.appointment_date,
    a.appointment_time,
    a.status AS appointment_status,
    a.doctor_id,
    p.full_name AS patient_name,
    p.patient_identifier,
    d.full_name AS doctor_name
  FROM appointment_change_requests r
  JOIN appointments a ON a.id = r.appointment_id
  JOIN patients p ON p.id = r.patient_id
  JOIN doctors d ON d.id = a.doctor_id
`;

function serializeChangeRequest(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    appointment_id: Number(row.appointment_id),
    patient_id: Number(row.patient_id),
    patient_user_id: row.patient_user_id ? Number(row.patient_user_id) : null,
    request_type: row.request_type,
    status: row.status,
    patient_message: row.patient_message || "",
    preferred_date: row.preferred_date || null,
    preferred_time: row.preferred_time || null,
    staff_notes: row.staff_notes || "",
    appointment_date: row.appointment_date,
    appointment_time: row.appointment_time,
    appointment_status: row.appointment_status,
    doctor_id: row.doctor_id ? Number(row.doctor_id) : null,
    patient_name: row.patient_name || null,
    patient_identifier: row.patient_identifier || null,
    doctor_name: row.doctor_name || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getChangeRequestById(id) {
  return serializeChangeRequest(
    db.prepare(`${CHANGE_SELECT} WHERE r.id = ?`).get(id),
  );
}

function listChangeRequests({ status = "pending", doctorId = null } = {}) {
  const clauses = ["p.deleted_at IS NULL"];
  const params = [];

  if (status && status !== "all") {
    clauses.push("r.status = ?");
    params.push(status);
  }
  if (doctorId) {
    clauses.push("a.doctor_id = ?");
    params.push(doctorId);
  }

  return db
    .prepare(
      `
        ${CHANGE_SELECT}
        WHERE ${clauses.join(" AND ")}
        ORDER BY r.created_at DESC, r.id DESC
      `,
    )
    .all(...params)
    .map(serializeChangeRequest);
}

function getPendingChangeForAppointment(appointmentId, patientId) {
  return serializeChangeRequest(
    db
      .prepare(
        `
          ${CHANGE_SELECT}
          WHERE r.appointment_id = ?
            AND r.patient_id = ?
            AND r.status IN ('pending', 'acknowledged')
          ORDER BY r.id DESC
          LIMIT 1
        `,
      )
      .get(appointmentId, patientId),
  );
}

module.exports = {
  getChangeRequestById,
  getPendingChangeForAppointment,
  listChangeRequests,
  serializeChangeRequest,
};
