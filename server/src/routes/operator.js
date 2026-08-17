const express = require("express");
const { db } = require("../db");
const { getTodayLocal } = require("../lib/utils");
const { ACTIVE_VISIT_STATUSES } = require("../lib/visitRequests");

const router = express.Router();

const UNASSIGNED_VISIT_STATUSES = ["pending", "acknowledged"];

function formatLocalSqlDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentWeekRange(today = getTodayLocal()) {
  const start = new Date(`${today}T12:00:00`);
  const weekday = start.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  start.setDate(start.getDate() + mondayOffset);

  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  return {
    weekStart: formatLocalSqlDate(start),
    weekEnd: formatLocalSqlDate(end),
  };
}

/**
 * Aggregated operator dashboard counts for the Personal operation updates grid.
 * Maps spec fields to SQLite schema: appointments (visits), billing (invoices), patients.
 */
function getOperatorDashboardMetrics() {
  const today = getTodayLocal();
  const { weekStart, weekEnd } = getCurrentWeekRange(today);
  const activeVisitPlaceholders = ACTIVE_VISIT_STATUSES.map(() => "?").join(", ");
  const unassignedPlaceholders = UNASSIGNED_VISIT_STATUSES.map(() => "?").join(", ");

  const pendingDispatchRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      LEFT JOIN consultations c ON c.appointment_id = a.id
      WHERE p.deleted_at IS NULL
        AND a.appointment_date = ?
        AND a.status = 'scheduled'
        AND c.id IS NULL
    `)
    .get(today);

  const totalScheduledRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE p.deleted_at IS NULL
        AND a.appointment_date = ?
        AND a.status != 'cancelled'
    `)
    .get(today);

  const visitsThisWeekRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE p.deleted_at IS NULL
        AND a.status != 'cancelled'
        AND a.appointment_date BETWEEN ? AND ?
    `)
    .get(weekStart, weekEnd);

  const unpaidBillsRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      WHERE p.deleted_at IS NULL
        AND b.status = 'unpaid'
    `)
    .get();

  const unpaidThisWeekRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      WHERE p.deleted_at IS NULL
        AND b.status = 'unpaid'
        AND c.consultation_date BETWEEN ? AND ?
    `)
    .get(weekStart, weekEnd);

  const activeFollowupRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM patients p
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'
        AND p.is_under_review = 1
    `)
    .get();

  const activeSubscribersRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM patients p
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'
        AND p.is_subscribed = 1
    `)
    .get();

  const activeVisitRequestsRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM visit_requests v
      JOIN patients p ON p.id = v.patient_id AND p.deleted_at IS NULL
      WHERE v.status IN (${activeVisitPlaceholders})
    `)
    .get(...ACTIVE_VISIT_STATUSES);

  const unassignedVisitRequestsRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM visit_requests v
      JOIN patients p ON p.id = v.patient_id AND p.deleted_at IS NULL
      WHERE v.status IN (${unassignedPlaceholders})
        AND v.assigned_doctor_id IS NULL
    `)
    .get(...UNASSIGNED_VISIT_STATUSES);

  const unassignedVisitRequests = db
    .prepare(`
      SELECT
        v.id,
        v.status,
        v.reason,
        v.urgency,
        v.created_at,
        p.id AS patient_id,
        p.full_name AS patient_name
      FROM visit_requests v
      JOIN patients p ON p.id = v.patient_id AND p.deleted_at IS NULL
      WHERE v.status IN (${unassignedPlaceholders})
        AND v.assigned_doctor_id IS NULL
      ORDER BY
        CASE v.urgency WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END,
        v.created_at ASC,
        v.id ASC
      LIMIT 5
    `)
    .all(...UNASSIGNED_VISIT_STATUSES);

  const upcomingVisits = db
    .prepare(`
      SELECT
        a.id,
        a.patient_id,
        a.appointment_date,
        a.appointment_time,
        a.status,
        p.full_name AS patient_name,
        p.location,
        d.full_name AS doctor_name
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN doctors d ON d.id = a.doctor_id
      WHERE p.deleted_at IS NULL
        AND a.status = 'scheduled'
        AND a.appointment_date >= ?
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT 3
    `)
    .all(today);

  const doctorsThisWeekRow = db
    .prepare(`
      SELECT COUNT(DISTINCT a.doctor_id) AS count
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE p.deleted_at IS NULL
        AND a.status != 'cancelled'
        AND a.appointment_date BETWEEN ? AND ?
    `)
    .get(weekStart, weekEnd);

  const onCallRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM doctors d
      JOIN users u
        ON u.doctor_id = d.id
       AND u.role = 'doctor'
       AND u.is_active = 1
       AND u.deleted_at IS NULL
      WHERE d.deleted_at IS NULL
        AND u.operation_status IN ('available', 'active')
    `)
    .get();

  return {
    scheduled_visits: {
      pending_dispatch: Number(pendingDispatchRow?.count || 0),
      total_scheduled: Number(totalScheduledRow?.count || 0),
      this_week: Number(visitsThisWeekRow?.count || 0),
    },
    pending_payment: {
      unpaid_bills_count: Number(unpaidBillsRow?.count || 0),
      unpaid_this_week_count: Number(unpaidThisWeekRow?.count || 0),
    },
    long_term_review: {
      active_followup_count: Number(activeFollowupRow?.count || 0),
    },
    health_plans: {
      active_subscribers_count: Number(activeSubscribersRow?.count || 0),
    },
    visit_requests: {
      active_count: Number(activeVisitRequestsRow?.count || 0),
      unassigned_count: Number(unassignedVisitRequestsRow?.count || 0),
      unassigned: unassignedVisitRequests,
    },
    coverage: {
      doctors_this_week: Number(doctorsThisWeekRow?.count || 0),
      on_call_count: Number(onCallRow?.count || 0),
    },
    upcoming_visits: upcomingVisits,
    periods: {
      today,
      weekStart,
      weekEnd,
    },
  };
}

router.get("/dashboard-metrics", (req, res) => {
  if (req.auth.role !== "operator") {
    return res.status(403).json({ error: "Only operator accounts can access dashboard metrics." });
  }

  res.json(getOperatorDashboardMetrics());
});

module.exports = router;
module.exports.getOperatorDashboardMetrics = getOperatorDashboardMetrics;
