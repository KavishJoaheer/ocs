const { db } = require("../db");

function doctorCanAccessPatient(patient, auth) {
  if (!patient || auth?.role !== "doctor") {
    return true;
  }

  const doctorId = Number(auth?.doctor_id || 0);
  if (!doctorId) {
    return false;
  }

  if (Number(patient.assigned_doctor_id) === doctorId) {
    return true;
  }

  if (Number(patient.review_assigned_doctor_id) === doctorId) {
    return true;
  }

  const patientId = Number(patient.id);
  if (!patientId) {
    return false;
  }

  const linked = db
    .prepare(
      `
      SELECT 1 AS ok
      WHERE EXISTS (
        SELECT 1 FROM visit_requests
        WHERE patient_id = ? AND assigned_doctor_id = ?
      )
      OR EXISTS (
        SELECT 1 FROM consultations
        WHERE patient_id = ? AND doctor_id = ?
      )
      OR EXISTS (
        SELECT 1 FROM appointments
        WHERE patient_id = ? AND doctor_id = ?
      )
      LIMIT 1
    `,
    )
    .get(patientId, doctorId, patientId, doctorId, patientId, doctorId);

  return Boolean(linked);
}

function doctorPatientAccessError(auth) {
  if (auth?.role === "doctor" && !auth?.doctor_id) {
    return "Your doctor account is not linked to a doctor profile.";
  }
  return "You do not have access to this patient record.";
}

function getDoctorCaseloadFilterSql(alias = "p") {
  return `
    AND (
      ${alias}.assigned_doctor_id = @caseloadDoctorId
      OR ${alias}.review_assigned_doctor_id = @caseloadDoctorId
      OR EXISTS (
        SELECT 1 FROM visit_requests vr
        WHERE vr.patient_id = ${alias}.id AND vr.assigned_doctor_id = @caseloadDoctorId
      )
      OR EXISTS (
        SELECT 1 FROM consultations cx
        WHERE cx.patient_id = ${alias}.id AND cx.doctor_id = @caseloadDoctorId
      )
      OR EXISTS (
        SELECT 1 FROM appointments ax
        WHERE ax.patient_id = ${alias}.id AND ax.doctor_id = @caseloadDoctorId
      )
    )
  `;
}

module.exports = {
  doctorCanAccessPatient,
  doctorPatientAccessError,
  getDoctorCaseloadFilterSql,
};
