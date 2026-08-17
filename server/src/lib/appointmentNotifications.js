const { db } = require("../db");
const { sendPushToPatientUser } = require("./push");

function resolvePatientUserIdForChart(patientId) {
  const id = Number(patientId || 0);
  if (!id) {
    return null;
  }

  const own = db
    .prepare(`
      SELECT id
      FROM patient_users
      WHERE patient_id = ?
        AND is_active = 1
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(id);
  if (own?.id) {
    return Number(own.id);
  }

  const parent = db
    .prepare(`
      SELECT parent_patient_id
      FROM patients
      WHERE id = ?
        AND deleted_at IS NULL
    `)
    .get(id);
  const parentId = Number(parent?.parent_patient_id || 0);
  if (!parentId) {
    return null;
  }

  const guardian = db
    .prepare(`
      SELECT id
      FROM patient_users
      WHERE patient_id = ?
        AND is_active = 1
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(parentId);

  return guardian?.id ? Number(guardian.id) : null;
}

function formatAppointmentStamp(date, time) {
  const rawDate = String(date || "").slice(0, 10);
  const rawTime = String(time || "").slice(0, 5);
  const parts = [];

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const [, year, month, day] = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    parts.push(`${Number(day)} ${months[Number(month) - 1]} ${year}`);
  } else if (rawDate) {
    parts.push(rawDate);
  }

  if (rawTime) {
    parts.push(rawTime);
  }

  return parts.join(" at ");
}

function buildPatientAppointmentPayload(kind, appointment) {
  const doctorName = String(appointment?.doctor_name || "your doctor").trim();
  const when = formatAppointmentStamp(appointment?.appointment_date, appointment?.appointment_time);
  const id = Number(appointment?.id || 0) || "new";

  if (kind === "booked") {
    return {
      title: "Appointment booked",
      body: when ? `${doctorName} · ${when}` : `A visit with ${doctorName} has been booked.`,
      url: "/appointments",
      icon: "/pwa-192.png",
      tag: `appointment-${id}-booked`,
    };
  }

  if (kind === "cancelled") {
    return {
      title: "Appointment cancelled",
      body: when ? `Your visit on ${when} has been cancelled.` : "Your appointment has been cancelled.",
      url: "/appointments",
      icon: "/pwa-192.png",
      tag: `appointment-${id}-cancelled`,
    };
  }

  return null;
}

async function notifyPatientAppointment(kind, appointment) {
  const payload = buildPatientAppointmentPayload(kind, appointment);
  if (!payload) {
    return { ok: false, skipped: true, reason: "no_payload" };
  }

  const userId = resolvePatientUserIdForChart(appointment?.patient_id);
  if (!userId) {
    return { ok: false, skipped: true, reason: "no_patient_user" };
  }

  return sendPushToPatientUser(userId, payload);
}

function notifyPatientAppointmentBooked(appointment) {
  return notifyPatientAppointment("booked", appointment);
}

function notifyPatientAppointmentCancelled(appointment) {
  return notifyPatientAppointment("cancelled", appointment);
}

function notifyStaffAppointmentMutation(before, after) {
  if (!after) {
    return;
  }

  const previousStatus = String(before?.status || "").trim();
  const nextStatus = String(after.status || "").trim();

  if (!before && nextStatus === "scheduled") {
    void notifyPatientAppointmentBooked(after).catch((error) => {
      console.warn("[push] appointment booked notification failed:", error?.message || error);
    });
    return;
  }

  if (previousStatus === "scheduled" && nextStatus === "cancelled") {
    void notifyPatientAppointmentCancelled(after).catch((error) => {
      console.warn("[push] appointment cancelled notification failed:", error?.message || error);
    });
    return;
  }

  if (previousStatus === "cancelled" && nextStatus === "scheduled") {
    void notifyPatientAppointmentBooked(after).catch((error) => {
      console.warn("[push] appointment booked notification failed:", error?.message || error);
    });
  }
}

module.exports = {
  buildPatientAppointmentPayload,
  notifyPatientAppointmentBooked,
  notifyPatientAppointmentCancelled,
  notifyStaffAppointmentMutation,
  resolvePatientUserIdForChart,
};
