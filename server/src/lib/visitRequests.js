const { db } = require("../db");

// Statuses that mean the request is still live (not yet closed out). These are
// what the patient portal treats as an "active visit" and what the staff inbox
// surfaces as actionable.
const ACTIVE_VISIT_STATUSES = [
  "pending",
  "acknowledged",
  "assigned",
  "en_route",
  "arrived",
  "in_consultation",
];
const ALL_VISIT_STATUSES = [...ACTIVE_VISIT_STATUSES, "completed", "cancelled"];

// Patients may cancel while dispatch is still coordinating; once the doctor has
// arrived the visit is too far along to cancel from the portal.
const PATIENT_CANCELLABLE_STATUSES = ["pending", "acknowledged", "assigned", "en_route"];

const DOCTOR_VISIBLE_STATUSES = ["assigned", "en_route", "arrived", "in_consultation"];

const STATUS_LABELS = {
  pending: "Request received",
  acknowledged: "Care team reviewing",
  assigned: "Doctor assigned",
  en_route: "Doctor en route",
  arrived: "Doctor arrived",
  in_consultation: "Consultation in progress",
  completed: "Visit completed",
  cancelled: "Cancelled",
};

function getStatusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function serializeVisitRequest(row, { includeStaffNotes = true } = {}) {
  if (!row) {
    return null;
  }

  const payload = {
    id: Number(row.id),
    patient_id: row.patient_id ? Number(row.patient_id) : null,
    patient_user_id: row.patient_user_id ? Number(row.patient_user_id) : null,
    patient_name: row.patient_name || null,
    patient_identifier: row.patient_identifier || null,
    patient_contact_number: row.patient_contact_number || null,
    visit_for: row.visit_for || "myself",
    dependent_patient_id: row.dependent_patient_id ? Number(row.dependent_patient_id) : null,
    dependent_name: row.dependent_name || null,
    address: row.address || "",
    reason: row.reason || "",
    urgency: row.urgency || "routine",
    status: row.status || "pending",
    status_label: getStatusLabel(row.status || "pending"),
    assigned_doctor_id: row.assigned_doctor_id ? Number(row.assigned_doctor_id) : null,
    doctor_name: row.doctor_name || null,
    eta_minutes: row.eta_minutes != null ? Number(row.eta_minutes) : null,
    appointment_id: row.appointment_id ? Number(row.appointment_id) : null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };

  if (includeStaffNotes) {
    payload.staff_notes = row.staff_notes || "";
  }

  return payload;
}

const VISIT_REQUEST_SELECT = `
  SELECT
    v.*,
    p.full_name AS patient_name,
    p.patient_identifier AS patient_identifier,
    p.patient_contact_number AS patient_contact_number,
    dep.full_name AS dependent_name,
    d.full_name AS doctor_name
  FROM visit_requests v
  JOIN patients p ON p.id = v.patient_id AND p.deleted_at IS NULL
  LEFT JOIN patients dep ON dep.id = v.dependent_patient_id
  LEFT JOIN doctors d ON d.id = v.assigned_doctor_id
`;

function getVisitRequestById(id, options) {
  const row = db.prepare(`${VISIT_REQUEST_SELECT} WHERE v.id = ?`).get(id);
  return serializeVisitRequest(row, options);
}

function getActiveVisitRequestForPatient(patientId) {
  const placeholders = ACTIVE_VISIT_STATUSES.map(() => "?").join(", ");
  const row = db
    .prepare(
      `${VISIT_REQUEST_SELECT}
       WHERE v.patient_id = ? AND v.status IN (${placeholders})
       ORDER BY v.created_at DESC, v.id DESC
       LIMIT 1`,
    )
    .get(patientId, ...ACTIVE_VISIT_STATUSES);
  return serializeVisitRequest(row, { includeStaffNotes: false });
}

function getActiveVisitRequestsForDependents(guardianId) {
  const placeholders = ACTIVE_VISIT_STATUSES.map(() => "?").join(", ");
  return db
    .prepare(
      `${VISIT_REQUEST_SELECT}
       WHERE v.patient_id IN (
         SELECT id FROM patients
         WHERE parent_patient_id = ? AND deleted_at IS NULL
       )
         AND v.status IN (${placeholders})
       ORDER BY v.created_at DESC, v.id DESC`,
    )
    .all(guardianId, ...ACTIVE_VISIT_STATUSES)
    .map((row) => serializeVisitRequest(row, { includeStaffNotes: false }));
}

module.exports = {
  ACTIVE_VISIT_STATUSES,
  ALL_VISIT_STATUSES,
  PATIENT_CANCELLABLE_STATUSES,
  DOCTOR_VISIBLE_STATUSES,
  STATUS_LABELS,
  VISIT_REQUEST_SELECT,
  getStatusLabel,
  serializeVisitRequest,
  getVisitRequestById,
  getActiveVisitRequestForPatient,
  getActiveVisitRequestsForDependents,
};
