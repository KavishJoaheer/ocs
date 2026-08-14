const { db } = require("../db");
const {
  getDoctorUserId,
  sendPushToPatientUser,
  sendPushToRole,
  sendPushToUser,
} = require("./push");
const { getStatusLabel } = require("./visitRequests");

const STAFF_DISPATCH_ROLES = ["admin", "operator"];

function buildPatientVisitPayload(visit, { previousStatus, previousDoctorId } = {}) {
  const status = String(visit?.status || "").trim();
  const doctorName = String(visit.doctor_name || "Your doctor").trim();
  const doctorNow = Number(visit?.assigned_doctor_id || 0);
  const doctorBefore = Number(previousDoctorId || 0);
  const doctorJustAssigned = Boolean(doctorNow && doctorNow !== doctorBefore);
  const etaSuffix =
    visit.eta_minutes != null && Number(visit.eta_minutes) >= 0
      ? ` — ETA ${visit.eta_minutes} min`
      : "";

  const messages = {
    acknowledged: {
      title: "Visit request received",
      body: "Our care team is reviewing your home visit request.",
    },
    assigned: {
      title: "Doctor assigned",
      body: `${doctorName} has been assigned to your home visit.`,
    },
    en_route: {
      title: "Doctor en route",
      body: `${doctorName} is on the way${etaSuffix}.`,
    },
    arrived: {
      title: "Doctor arrived",
      body: `${doctorName} has arrived at your location.`,
    },
    in_consultation: {
      title: "Consultation started",
      body: `${doctorName} has started your consultation.`,
    },
    completed: {
      title: "Visit completed",
      body: "Your home visit is complete. Thank you for choosing OCS.",
    },
    cancelled: {
      title: "Visit cancelled",
      body: "Your home visit request has been cancelled.",
    },
  };

  // Dispatch often assigns a doctor while flipping pending → acknowledged, so
  // the assigned message would never fire if we only watched status.
  if (doctorJustAssigned && (status === "assigned" || status === "acknowledged" || !status || status === previousStatus)) {
    return {
      ...messages.assigned,
      url: "/request-visit/tracking",
      icon: "/pwa-192.png",
      tag: `patient-visit-${visit.id}-assigned`,
      requireInteraction: false,
    };
  }

  if (!status || status === previousStatus) {
    return null;
  }

  const message = messages[status];
  if (!message) {
    return null;
  }

  return {
    title: message.title,
    body: message.body,
    url: "/request-visit/tracking",
    icon: "/pwa-192.png",
    tag: `patient-visit-${visit.id}-${status}`,
    requireInteraction: status === "arrived" || status === "en_route",
  };
}

function resolvePatientUserId(visit) {
  const direct = Number(visit?.patient_user_id || 0);
  if (direct) {
    return direct;
  }

  const patientId = Number(visit?.patient_id || 0);
  if (!patientId) {
    return null;
  }

  const row = db
    .prepare(`
      SELECT id
      FROM patient_users
      WHERE patient_id = ?
        AND is_active = 1
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(patientId);

  return row?.id ? Number(row.id) : null;
}

async function notifyStaffNewVisitRequest(visit) {
  if (!visit?.id) {
    return { ok: false, skipped: true, reason: "missing_visit" };
  }

  const patientName = String(visit.patient_name || "A patient").trim();
  const urgency = String(visit.urgency || "routine").trim();
  const urgencyLabel = urgency !== "routine" ? ` (${urgency})` : "";

  const payload = {
    title: "New home visit request",
    body: `${patientName} requested a home visit${urgencyLabel}.`,
    url: "/visit-requests",
    icon: "/icon-192.png",
    tag: `visit-request-new-${visit.id}`,
    requireInteraction: urgency === "emergency" || urgency === "urgent",
  };

  const results = await Promise.all(
    STAFF_DISPATCH_ROLES.map((role) => sendPushToRole(role, payload)),
  );

  if (!visit.assigned_doctor_id) {
    const onCallDoctorIds = db
      .prepare(
        `
          SELECT DISTINCT u.id
          FROM users u
          INNER JOIN user_push_subscriptions s ON s.user_id = u.id
          WHERE u.role = 'doctor'
            AND u.is_active = 1
            AND u.deleted_at IS NULL
            AND u.operation_status IN ('available', 'active')
        `,
      )
      .all()
      .map((row) => Number(row.id));

    const doctorResults = await Promise.all(
      onCallDoctorIds.map((userId) => sendPushToUser(userId, payload)),
    );
    results.push(...doctorResults);
  }

  const delivered = results.flat().filter((entry) => entry?.ok).length;

  return { ok: delivered > 0, delivered, attempted: results.flat().length };
}

async function notifyStaffVisitCancelled(visit) {
  if (!visit?.id) {
    return { ok: false, skipped: true, reason: "missing_visit" };
  }

  const patientName = String(visit.patient_name || "A patient").trim();
  const payload = {
    title: "Home visit cancelled",
    body: `${patientName} cancelled their home visit request.`,
    url: "/visit-requests",
    icon: "/icon-192.png",
    tag: `visit-request-cancelled-${visit.id}`,
  };

  const results = await Promise.all(
    STAFF_DISPATCH_ROLES.map((role) => sendPushToRole(role, payload)),
  );

  const assignedDoctorId = Number(visit.assigned_doctor_id || 0);
  if (assignedDoctorId) {
    const doctorUserId = getDoctorUserId(assignedDoctorId);
    if (doctorUserId) {
      results.push(await sendPushToUser(doctorUserId, payload));
    }
  }

  const delivered = results.flat().filter((entry) => entry?.ok).length;

  return { ok: delivered > 0, delivered, attempted: results.flat().length };
}

async function notifyAssignedDoctor(visit, { previousDoctorId } = {}) {
  const doctorId = Number(visit?.assigned_doctor_id || 0);
  const previous = Number(previousDoctorId || 0);

  if (!doctorId || doctorId === previous) {
    return { ok: false, skipped: true, reason: "doctor_unchanged" };
  }

  const userId = getDoctorUserId(doctorId);
  if (!userId) {
    return { ok: false, skipped: true, reason: "missing_doctor_user" };
  }

  const patientName = String(visit.patient_name || "A patient").trim();
  const payload = {
    title: "Home visit assigned",
    body: `You have been assigned to ${patientName}'s home visit.`,
    url: "/visit-requests",
    icon: "/icon-192.png",
    tag: `visit-request-doctor-${visit.id}`,
    requireInteraction: true,
  };

  return sendPushToUser(userId, payload);
}

async function notifyPatientVisitUpdate(visit, { previousStatus, previousDoctorId } = {}) {
  const payload = buildPatientVisitPayload(visit, { previousStatus, previousDoctorId });
  if (!payload) {
    return { ok: false, skipped: true, reason: "no_patient_message" };
  }

  const patientUserId = resolvePatientUserId(visit);
  if (!patientUserId) {
    return { ok: false, skipped: true, reason: "missing_patient_user" };
  }

  return sendPushToPatientUser(patientUserId, payload);
}

async function notifyVisitRequestUpdated(visit, { before } = {}) {
  const previousStatus = before?.status || null;
  const previousDoctorId = before?.assigned_doctor_id || null;

  const [patientResult, doctorResult] = await Promise.all([
    notifyPatientVisitUpdate(visit, { previousStatus, previousDoctorId }),
    notifyAssignedDoctor(visit, { previousDoctorId }),
  ]);

  return {
    ok: Boolean(patientResult?.ok || doctorResult?.ok),
    patient: patientResult,
    doctor: doctorResult,
    statusLabel: getStatusLabel(visit?.status),
  };
}

module.exports = {
  buildPatientVisitPayload,
  notifyPatientVisitUpdate,
  notifyStaffNewVisitRequest,
  notifyStaffVisitCancelled,
  notifyVisitRequestUpdated,
};
