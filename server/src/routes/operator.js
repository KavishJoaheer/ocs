const express = require("express");
const { db } = require("../db");
const { getTodayLocal } = require("../lib/utils");

const router = express.Router();

/**
 * Aggregated operator dashboard counts for the Personal operation updates grid.
 * Maps spec fields to SQLite schema: appointments (visits), billing (invoices), patients.
 */
function getOperatorDashboardMetrics() {
  const today = getTodayLocal();

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

  const unpaidBillsRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      WHERE p.deleted_at IS NULL
        AND b.status = 'unpaid'
    `)
    .get();

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

  return {
    scheduled_visits: {
      pending_dispatch: Number(pendingDispatchRow?.count || 0),
      total_scheduled: Number(totalScheduledRow?.count || 0),
    },
    pending_payment: {
      unpaid_bills_count: Number(unpaidBillsRow?.count || 0),
    },
    long_term_review: {
      active_followup_count: Number(activeFollowupRow?.count || 0),
    },
    health_plans: {
      active_subscribers_count: Number(activeSubscribersRow?.count || 0),
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
