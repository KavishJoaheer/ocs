const express = require("express");
const { db } = require("../db");
const { publishPatientDataChange } = require("../lib/inventoryRealtime");
const {
  notifyStaffNewVisitRequest,
  notifyVisitRequestUpdated,
} = require("../lib/visitRequestNotifications");
const {
  ACTIVE_VISIT_STATUSES,
  ALL_VISIT_STATUSES,
  DOCTOR_VISIBLE_STATUSES,
  VISIT_REQUEST_SELECT,
  serializeVisitRequest,
  getVisitRequestById,
} = require("../lib/visitRequests");

const router = express.Router();

const DOCTOR_ADVANCE_STATUSES = ["en_route", "arrived", "in_consultation", "completed"];

function getDoctorIdForUser(userId) {
  if (!userId) {
    return null;
  }
  const row = db.prepare("SELECT doctor_id FROM users WHERE id = ? LIMIT 1").get(userId);
  return row?.doctor_id ? Number(row.doctor_id) : null;
}

function isDispatchRole(role) {
  return role === "admin" || role === "operator";
}

// GET /api/visit-requests?status=active|all|<status>
router.get("/", (req, res) => {
  const statusFilter = String(req.query.status || "active").trim().toLowerCase();
  const role = req.auth?.role;
  const doctorId = role === "doctor" ? getDoctorIdForUser(req.auth.id) : null;

  const whereParts = [];
  const params = [];

  if (role === "doctor") {
    if (!doctorId) {
      return res.json({ visit_requests: [], active_count: 0 });
    }
    whereParts.push("v.assigned_doctor_id = ?");
    params.push(doctorId);
  }

  if (statusFilter === "active") {
    const activeStatuses = role === "doctor" ? DOCTOR_VISIBLE_STATUSES : ACTIVE_VISIT_STATUSES;
    const placeholders = activeStatuses.map(() => "?").join(", ");
    whereParts.push(`v.status IN (${placeholders})`);
    params.push(...activeStatuses);
  } else if (statusFilter !== "all" && ALL_VISIT_STATUSES.includes(statusFilter)) {
    whereParts.push("v.status = ?");
    params.push(statusFilter);
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const rows = db
    .prepare(`${VISIT_REQUEST_SELECT} ${whereClause} ORDER BY v.created_at DESC, v.id DESC`)
    .all(...params);

  const countWhere =
    role === "doctor" && doctorId
      ? `WHERE assigned_doctor_id = ? AND status IN (${DOCTOR_VISIBLE_STATUSES.map(() => "?").join(", ")})`
      : `WHERE status IN (${ACTIVE_VISIT_STATUSES.map(() => "?").join(", ")})`;
  const countParams =
    role === "doctor" && doctorId
      ? [doctorId, ...DOCTOR_VISIBLE_STATUSES]
      : [...ACTIVE_VISIT_STATUSES];

  const activeCount = db
    .prepare(`SELECT COUNT(*) AS count FROM visit_requests ${countWhere}`)
    .get(...countParams)?.count;

  return res.json({
    visit_requests: rows.map(serializeVisitRequest),
    active_count: Number(activeCount || 0),
  });
});

// PATCH /api/visit-requests/:id
router.patch("/:id", (req, res) => {
  const requestId = Number(req.params.id);

  if (!Number.isInteger(requestId)) {
    return res.status(404).json({ error: "Visit request not found." });
  }

  const existing = db.prepare("SELECT * FROM visit_requests WHERE id = ?").get(requestId);

  if (!existing) {
    return res.status(404).json({ error: "Visit request not found." });
  }

  const role = req.auth?.role;
  const doctorId = role === "doctor" ? getDoctorIdForUser(req.auth.id) : null;

  if (role === "doctor") {
    if (!doctorId || Number(existing.assigned_doctor_id) !== doctorId) {
      return res.status(403).json({ error: "You can only update visits assigned to you." });
    }

    if (req.body.assigned_doctor_id !== undefined) {
      return res.status(403).json({ error: "Only dispatch staff can assign doctors." });
    }

    if (req.body.status !== undefined) {
      const status = String(req.body.status).trim().toLowerCase();
      if (!DOCTOR_ADVANCE_STATUSES.includes(status)) {
        return res.status(403).json({ error: "You cannot move this visit to that status." });
      }
    }
  } else if (!isDispatchRole(role)) {
    return res.status(403).json({ error: "You are not allowed to update visit requests." });
  }

  const updates = [];
  const params = [];

  if (req.body.status !== undefined) {
    const status = String(req.body.status).trim().toLowerCase();
    if (!ALL_VISIT_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid visit request status." });
    }
    updates.push("status = ?");
    params.push(status);
    if (status === "cancelled") {
      updates.push("cancelled_by = 'staff'");
    }
  }

  if (req.body.assigned_doctor_id !== undefined) {
    const doctorIdRaw = req.body.assigned_doctor_id;
    if (doctorIdRaw === null || doctorIdRaw === "") {
      updates.push("assigned_doctor_id = NULL");
    } else {
      const nextDoctorId = Number(doctorIdRaw);
      if (!Number.isInteger(nextDoctorId) || nextDoctorId <= 0) {
        return res.status(400).json({ error: "Invalid doctor selection." });
      }
      const doctor = db
        .prepare("SELECT id FROM doctors WHERE id = ? AND deleted_at IS NULL")
        .get(nextDoctorId);
      if (!doctor) {
        return res.status(400).json({ error: "Selected doctor was not found." });
      }
      updates.push("assigned_doctor_id = ?");
      params.push(nextDoctorId);
    }
  }

  if (req.body.eta_minutes !== undefined) {
    const etaRaw = req.body.eta_minutes;
    if (etaRaw === null || etaRaw === "") {
      updates.push("eta_minutes = NULL");
    } else {
      const eta = Number(etaRaw);
      if (!Number.isInteger(eta) || eta < 0) {
        return res.status(400).json({ error: "Estimated arrival must be a positive number of minutes." });
      }
      updates.push("eta_minutes = ?");
      params.push(eta);
    }
  }

  if (req.body.staff_notes !== undefined) {
    updates.push("staff_notes = ?");
    params.push(String(req.body.staff_notes).trim());
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid fields provided for update." });
  }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(requestId);

  db.prepare(`UPDATE visit_requests SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  const updated = getVisitRequestById(requestId);
  const notifyDoctorIds = [existing.assigned_doctor_id, updated.assigned_doctor_id]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  publishPatientDataChange(existing.patient_id, {
    reason: "visit_request",
    notifyDoctorIds,
  });
  void notifyVisitRequestUpdated(updated, { before: existing }).catch((error) => {
    console.warn("[push] visit request update notification failed:", error?.message || error);
  });

  return res.json({ visit_request: updated });
});

module.exports = router;
