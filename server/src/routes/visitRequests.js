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
  VISIT_REQUEST_SELECT,
  serializeVisitRequest,
  getVisitRequestById,
} = require("../lib/visitRequests");

const router = express.Router();

// GET /api/visit-requests?status=active|all|<status>
router.get("/", (req, res) => {
  const statusFilter = String(req.query.status || "active").trim().toLowerCase();

  let whereClause = "";
  let params = [];

  if (statusFilter === "active") {
    const placeholders = ACTIVE_VISIT_STATUSES.map(() => "?").join(", ");
    whereClause = `WHERE v.status IN (${placeholders})`;
    params = [...ACTIVE_VISIT_STATUSES];
  } else if (statusFilter !== "all" && ALL_VISIT_STATUSES.includes(statusFilter)) {
    whereClause = "WHERE v.status = ?";
    params = [statusFilter];
  }

  const rows = db
    .prepare(`${VISIT_REQUEST_SELECT} ${whereClause} ORDER BY v.created_at DESC, v.id DESC`)
    .all(...params);

  const counts = db
    .prepare(`
      SELECT status, COUNT(*) AS count
      FROM visit_requests
      GROUP BY status
    `)
    .all();

  const activeCount = counts
    .filter((row) => ACTIVE_VISIT_STATUSES.includes(row.status))
    .reduce((sum, row) => sum + row.count, 0);

  return res.json({
    visit_requests: rows.map(serializeVisitRequest),
    active_count: activeCount,
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
      const doctorId = Number(doctorIdRaw);
      if (!Number.isInteger(doctorId) || doctorId <= 0) {
        return res.status(400).json({ error: "Invalid doctor selection." });
      }
      const doctor = db
        .prepare("SELECT id FROM doctors WHERE id = ? AND deleted_at IS NULL")
        .get(doctorId);
      if (!doctor) {
        return res.status(400).json({ error: "Selected doctor was not found." });
      }
      updates.push("assigned_doctor_id = ?");
      params.push(doctorId);
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

  // Push the change to the patient's live stream so their tracker updates the
  // instant staff assign a doctor or move the status.
  publishPatientDataChange(existing.patient_id, { reason: "visit_request" });

  const updated = getVisitRequestById(requestId);
  void notifyVisitRequestUpdated(updated, { before: existing }).catch((error) => {
    console.warn("[push] visit request update notification failed:", error?.message || error);
  });

  return res.json({ visit_request: updated });
});

module.exports = router;
