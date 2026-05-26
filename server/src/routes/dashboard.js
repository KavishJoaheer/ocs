const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { db, rosterDir } = require("../db");
const { notifyDoctorLowStockSummary, notifyOcsLowStockSubscribers } = require("../lib/push");
const { serializeUser } = require("../lib/auth");
const {
  getTodayLocal,
  offsetLocalDate,
  parseBillingRow,
  toNumber,
} = require("../lib/utils");

const router = express.Router();
const DEFAULT_OPERATOR_ACCESS_HOURS = 24;
const OPERATION_STATUSES = new Set(["available", "active", "offline"]);
const REPORT_PERIODS = new Set(["daily", "weekly", "monthly", "annual"]);
const CURRENT_ROSTER_FILE_NAME = "current_roster.pdf";
const CURRENT_ROSTER_PATH = path.join(rosterDir, CURRENT_ROSTER_FILE_NAME);

const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
  fileFilter(_req, file, callback) {
    if (String(file.mimetype || "").toLowerCase() !== "application/pdf") {
      callback(new Error("Only PDF roster uploads are allowed."));
      return;
    }
    callback(null, true);
  },
});

function normalizeSqlDateTime(value) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function getDefaultOperatorExpiry() {
  return normalizeSqlDateTime(Date.now() + DEFAULT_OPERATOR_ACCESS_HOURS * 60 * 60 * 1000);
}

function formatLocalSqlDate(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function parseAnchorDate(value) {
  const normalized = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const parsed = new Date(`${normalized}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getReferenceDate(value) {
  return parseAnchorDate(value) || parseAnchorDate(getTodayLocal()) || new Date();
}

function getCurrentWeekRange() {
  const start = new Date(getReferenceDate(getTodayLocal()));
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

function getCurrentMonthRange() {
  const now = getReferenceDate(getTodayLocal());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    monthStart: formatLocalSqlDate(monthStart),
    monthEnd: formatLocalSqlDate(monthEnd),
    monthLabel: now.toLocaleString("en-US", { month: "long" }),
  };
}

function getCurrentYearRange() {
  const now = getReferenceDate(getTodayLocal());
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear(), 11, 31);

  return {
    yearStart: formatLocalSqlDate(yearStart),
    yearEnd: formatLocalSqlDate(yearEnd),
    yearLabel: String(now.getFullYear()),
  };
}

function normalizeReportPeriod(value, fallback = "monthly") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  return REPORT_PERIODS.has(normalized) ? normalized : fallback;
}

function getReportRange(period, anchorDateValue) {
  const anchorDate = getReferenceDate(anchorDateValue);
  const anchorDateLabel = formatLocalSqlDate(anchorDate);

  if (period === "daily") {
    return {
      period,
      anchorDate: anchorDateLabel,
      start: anchorDateLabel,
      end: anchorDateLabel,
      label: anchorDateLabel,
    };
  }

  if (period === "weekly") {
    const start = new Date(anchorDate);
    const weekday = start.getDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    start.setDate(start.getDate() + mondayOffset);

    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    const weekStart = formatLocalSqlDate(start);
    const weekEnd = formatLocalSqlDate(end);

    return {
      period,
      anchorDate: anchorDateLabel,
      start: weekStart,
      end: weekEnd,
      label: `${weekStart} to ${weekEnd}`,
    };
  }

  if (period === "annual") {
    const yearStart = formatLocalSqlDate(new Date(anchorDate.getFullYear(), 0, 1));
    const yearEnd = formatLocalSqlDate(new Date(anchorDate.getFullYear(), 11, 31));
    const yearLabel = String(anchorDate.getFullYear());

    return {
      period,
      anchorDate: anchorDateLabel,
      start: yearStart,
      end: yearEnd,
      label: `${yearLabel} (${yearStart} to ${yearEnd})`,
      yearLabel,
    };
  }

  const monthStart = formatLocalSqlDate(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1));
  const monthEnd = formatLocalSqlDate(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0));
  const monthLabel = anchorDate.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  return {
    period: "monthly",
    anchorDate: anchorDateLabel,
    start: monthStart,
    end: monthEnd,
    label: `${monthLabel} (${monthStart} to ${monthEnd})`,
    monthLabel,
  };
}

function createDateRangeSlots(startDate, endDate) {
  const slots = [];
  const cursor = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  while (cursor <= end) {
    slots.push(formatLocalSqlDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}

function getVolumeRows(period, range, doctorId = null) {
  if (period === "daily") {
    const grouped = db
      .prepare(`
        SELECT
          CAST(strftime('%H', c.created_at) AS INTEGER) AS slot_hour,
          COUNT(*) AS patient_count
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        WHERE p.deleted_at IS NULL
          AND c.consultation_date = @targetDate
          AND (@doctorId IS NULL OR c.doctor_id = @doctorId)
        GROUP BY slot_hour
        ORDER BY slot_hour ASC
      `)
      .all({
        targetDate: range.start,
        doctorId,
      });

    const byHour = new Map(grouped.map((row) => [Number(row.slot_hour), Number(row.patient_count || 0)]));
    return Array.from({ length: 24 }).map((_, hour) => ({
      slot: String(hour).padStart(2, "0"),
      label: `${String(hour).padStart(2, "0")}:00`,
      patient_count: byHour.get(hour) || 0,
    }));
  }

  if (period === "annual") {
    const grouped = db
      .prepare(`
        SELECT
          CAST(strftime('%m', c.consultation_date) AS INTEGER) AS slot_month,
          COUNT(*) AS patient_count
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        WHERE p.deleted_at IS NULL
          AND c.consultation_date BETWEEN @startDate AND @endDate
          AND (@doctorId IS NULL OR c.doctor_id = @doctorId)
        GROUP BY slot_month
        ORDER BY slot_month ASC
      `)
      .all({
        startDate: range.start,
        endDate: range.end,
        doctorId,
      });

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const byMonth = new Map(grouped.map((row) => [Number(row.slot_month), Number(row.patient_count || 0)]));
    return monthNames.map((name, index) => ({
      slot: String(index + 1).padStart(2, "0"),
      label: name,
      patient_count: byMonth.get(index + 1) || 0,
    }));
  }

  const groupedByDate = db
    .prepare(`
      SELECT
        c.consultation_date AS slot_date,
        COUNT(*) AS patient_count
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      WHERE p.deleted_at IS NULL
        AND c.consultation_date BETWEEN @startDate AND @endDate
        AND (@doctorId IS NULL OR c.doctor_id = @doctorId)
      GROUP BY c.consultation_date
      ORDER BY c.consultation_date ASC
    `)
    .all({
      startDate: range.start,
      endDate: range.end,
      doctorId,
    });

  const byDate = new Map(groupedByDate.map((row) => [String(row.slot_date), Number(row.patient_count || 0)]));
  const dateSlots = createDateRangeSlots(range.start, range.end);

  return dateSlots.map((slotDate) => {
    const date = new Date(`${slotDate}T12:00:00`);
    let label = slotDate;

    if (period === "weekly") {
      label = date.toLocaleDateString("en-US", { weekday: "short" });
    } else if (period === "monthly") {
      label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    return {
      slot: slotDate,
      label,
      patient_count: byDate.get(slotDate) || 0,
    };
  });
}

function getDoctorPatientCounts(startDate, endDate, doctorId = null) {
  return db
    .prepare(`
      SELECT
        d.id AS doctor_id,
        d.full_name AS doctor_name,
        COUNT(DISTINCT c.patient_id) AS patient_count
      FROM doctors d
      LEFT JOIN consultations c
        ON c.doctor_id = d.id
       AND c.consultation_date BETWEEN @startDate AND @endDate
      WHERE d.deleted_at IS NULL
        AND (@doctorId IS NULL OR d.id = @doctorId)
      GROUP BY d.id, d.full_name
      HAVING @doctorId IS NOT NULL OR patient_count > 0
      ORDER BY patient_count DESC, doctor_name ASC
    `)
    .all({
      startDate,
      endDate,
      doctorId,
    })
    .map((row) => ({
      ...row,
      patient_count: Number(row.patient_count || 0),
    }));
}

function getPaidRevenueTotal(startDate, endDate, doctorId = null) {
  const row = db
    .prepare(`
      SELECT COALESCE(SUM(b.total_amount), 0) AS total
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      WHERE b.status = 'paid'
        AND p.deleted_at IS NULL
        AND substr(COALESCE(NULLIF(b.payment_date, ''), b.created_at), 1, 10) BETWEEN ? AND ?
        AND (? IS NULL OR c.doctor_id = ?)
    `)
    .get(startDate, endDate, doctorId, doctorId);

  return toNumber(row?.total, 0);
}

function getDashboardOperatorAccessPayload() {
  const patients = db
    .prepare(`
      SELECT id, full_name, patient_identifier, patient_id_number
      FROM patients
      WHERE deleted_at IS NULL
      ORDER BY full_name ASC
    `)
    .all();

  const operators = db
    .prepare(`
      SELECT id, username, full_name
      FROM users
      WHERE role = 'operator'
        AND is_active = 1
        AND deleted_at IS NULL
      ORDER BY full_name ASC
    `)
    .all();

  const access = db
    .prepare(`
      SELECT
        poa.*,
        p.full_name AS patient_name,
        p.patient_identifier,
        p.patient_id_number,
        operator_user.full_name AS operator_name,
        operator_user.username AS operator_username,
        admin_user.full_name AS granted_by_name
      FROM patient_operator_access poa
      JOIN patients p ON p.id = poa.patient_id
      JOIN users operator_user
        ON operator_user.id = poa.operator_user_id
       AND operator_user.role = 'operator'
      LEFT JOIN users admin_user ON admin_user.id = poa.granted_by_user_id
      WHERE poa.expires_at > CURRENT_TIMESTAMP
        AND p.deleted_at IS NULL
      ORDER BY poa.expires_at ASC, poa.id DESC
    `)
    .all();

  return { patients, operators, access };
}

function getCurrentUserRow(userId) {
  return db
    .prepare(`
      SELECT
        u.*,
        d.full_name AS doctor_name
      FROM users u
      LEFT JOIN doctors d ON d.id = u.doctor_id
      WHERE u.id = ?
    `)
    .get(userId);
}

function getRosterMeta() {
  if (!fs.existsSync(CURRENT_ROSTER_PATH)) {
    return {
      has_roster: false,
      file_name: CURRENT_ROSTER_FILE_NAME,
      updated_at: null,
    };
  }

  const stats = fs.statSync(CURRENT_ROSTER_PATH);
  return {
    has_roster: true,
    file_name: CURRENT_ROSTER_FILE_NAME,
    updated_at: stats.mtime.toISOString(),
  };
}

function getDoctorStatuses() {
  return db
    .prepare(`
      SELECT
        d.id,
        d.full_name,
        d.specialization,
        u.username,
        u.operation_status,
        u.operation_status_updated_at
      FROM doctors d
      LEFT JOIN users u
        ON u.doctor_id = d.id
       AND u.role = 'doctor'
       AND u.is_active = 1
       AND u.deleted_at IS NULL
      WHERE d.deleted_at IS NULL
      ORDER BY d.full_name ASC
    `)
    .all();
}

function getOcsLowStockAlert() {
  try {
    const rows = db
      .prepare(`
        SELECT
          id,
          item_name,
          quantity AS current_quantity,
          minimum_quantity AS par_level
        FROM inventory
        WHERE stock_scope = 'ocs'
          AND minimum_quantity > 0
      `)
      .all()
      .map((row) => ({
        item_id: Number(row.id),
        item_name: row.item_name,
        par_level: Number(row.par_level || 0),
        current_quantity: Number(row.current_quantity || 0),
      }))
      .filter((row) => row.par_level > 0 && row.current_quantity <= row.par_level);

    return {
      triggered: rows.length > 0,
      total_items: rows.length,
      items: rows,
    };
  } catch (_error) {
    return { triggered: false, total_items: 0, items: [] };
  }
}

function getDoctorLowStockAlert(doctorId) {
  try {
    const rows = db
      .prepare(`
        SELECT
          i.id AS my_item_id,
          i.folder_id,
          i.item_name,
          i.quantity AS my_quantity,
          i.minimum_quantity AS par_level,
          o.id AS ocs_item_id,
          o.quantity AS ocs_quantity
        FROM inventory i
        LEFT JOIN inventory o
          ON o.stock_scope = 'ocs'
         AND o.owner_doctor_id IS NULL
         AND o.folder_id = i.folder_id
         AND o.item_name = i.item_name
        WHERE i.stock_scope = 'doctor'
          AND i.owner_doctor_id = ?
          AND i.minimum_quantity > 0
      `)
      .all(doctorId)
      .map((row) => {
        const parLevel = Number(row.par_level || 0);
        const quantity = Number(row.my_quantity || 0);
        const ratio = parLevel > 0 ? quantity / parLevel : 1;
        const needed = Math.max(parLevel - quantity, 0);
        return {
          my_item_id: Number(row.my_item_id),
          ocs_item_id: Number(row.ocs_item_id || 0),
          item_name: row.item_name,
          folder_id: Number(row.folder_id || 0),
          par_level: parLevel,
          current_quantity: quantity,
          required_quantity: needed,
          ocs_available: Number(row.ocs_quantity || 0),
          ratio,
        };
      })
      .filter((row) => row.par_level > 0 && row.current_quantity <= row.par_level);

    return {
      triggered: rows.length > 0,
      total_items: rows.length,
      items: rows,
    };
  } catch (_error) {
    return { triggered: false, total_items: 0, items: [] };
  }
}

function getDoctorWorkspacePayload(doctorId) {
  const today = getTodayLocal();
  const { weekStart, weekEnd } = getCurrentWeekRange();
  const { monthStart, monthEnd, monthLabel } = getCurrentMonthRange();

  const doctor = db
    .prepare(`
      SELECT id, full_name, specialization
      FROM doctors
      WHERE id = ?
    `)
    .get(doctorId);

  const appointmentSelect = `
    SELECT
      a.id,
      a.appointment_date,
      a.appointment_time,
      a.status,
      a.created_at,
      a.patient_id,
      p.full_name AS patient_name,
      p.patient_identifier,
      p.location,
      c.id AS consultation_id
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN consultations c ON c.appointment_id = a.id
    WHERE a.doctor_id = ?
      AND p.deleted_at IS NULL
  `;

  const currentWeekRoster = db
    .prepare(`
      ${appointmentSelect}
        AND a.appointment_date BETWEEN ? AND ?
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
    `)
    .all(doctorId, weekStart, weekEnd);

  const currentMonthRoster = db
    .prepare(`
      ${appointmentSelect}
        AND a.appointment_date BETWEEN ? AND ?
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
    `)
    .all(doctorId, monthStart, monthEnd);

  const scheduledVisits = db
    .prepare(`
      ${appointmentSelect}
        AND a.status = 'scheduled'
        AND a.appointment_date >= ?
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
    `)
    .all(doctorId, today);

  const pendingPayments = db
    .prepare(`
      SELECT
        b.*,
        p.id AS patient_id,
        p.full_name AS patient_name,
        p.patient_identifier,
        c.id AS consultation_id,
        c.consultation_date,
        c.doctor_notes
      FROM billing b
      JOIN consultations c ON c.id = b.consultation_id
      JOIN patients p ON p.id = b.patient_id
      WHERE c.doctor_id = ?
        AND p.deleted_at IS NULL
        AND b.status = 'unpaid'
      ORDER BY c.consultation_date DESC, b.created_at DESC
    `)
    .all(doctorId)
    .map(parseBillingRow);

  const assignedPatients = db
    .prepare(`
      SELECT
        p.id,
        p.full_name,
        p.patient_identifier,
        p.patient_contact_number,
        p.location,
        p.gender,
        p.status,
        p.date_of_birth,
        p.created_at,
        p.is_under_review,
        p.is_subscribed,
        p.review_due_date,
        MAX(c.consultation_date) AS last_consultation_date
      FROM patients p
      LEFT JOIN consultations c ON c.patient_id = p.id
      WHERE p.assigned_doctor_id = ?
        AND p.deleted_at IS NULL
      GROUP BY
        p.id,
        p.full_name,
        p.patient_identifier,
        p.patient_contact_number,
        p.location,
        p.gender,
        p.status,
        p.date_of_birth,
        p.created_at,
        p.is_under_review,
        p.is_subscribed,
        p.review_due_date
      ORDER BY p.full_name ASC
    `)
    .all(doctorId);

  const longTermReviewAssignedCount = assignedPatients.filter(
    (patient) => Number(patient.is_under_review) === 1,
  ).length;
  const subscribedAssignedCount = assignedPatients.filter(
    (patient) => Number(patient.is_subscribed) === 1,
  ).length;

  const monthConsultations = db
    .prepare(`
      SELECT
        c.id,
        c.consultation_date,
        c.created_at,
        c.patient_id,
        c.appointment_id,
        p.full_name AS patient_name,
        p.patient_identifier
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      WHERE c.doctor_id = ?
        AND p.deleted_at IS NULL
        AND c.consultation_date BETWEEN ? AND ?
      ORDER BY c.consultation_date DESC, c.created_at DESC
    `)
    .all(doctorId, monthStart, monthEnd);

  const patientsSeenThisMonthMap = new Map();
  for (const consultation of monthConsultations) {
    if (!patientsSeenThisMonthMap.has(consultation.patient_id)) {
      patientsSeenThisMonthMap.set(consultation.patient_id, consultation);
    }
  }
  const patientsSeenThisMonth = Array.from(patientsSeenThisMonthMap.values());

  const hcmUpdates = db
    .prepare(`
      SELECT *
      FROM (
        SELECT
          'appointment' AS type,
          a.created_at AS activity_at,
          CASE
            WHEN a.status = 'completed' THEN 'Visit completed'
            WHEN a.status = 'cancelled' THEN 'Visit cancelled'
            ELSE 'Visit scheduled'
          END AS title,
          p.id AS patient_id,
          p.full_name AS patient_name,
          a.id AS appointment_id,
          c.id AS consultation_id,
          a.appointment_date AS reference_date,
          a.appointment_time AS reference_time,
          'Status: ' || a.status AS detail
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        LEFT JOIN consultations c ON c.appointment_id = a.id
        WHERE a.doctor_id = ?
          AND p.deleted_at IS NULL

        UNION ALL

        SELECT
          'consultation' AS type,
          c.created_at AS activity_at,
          'Consultation note saved' AS title,
          p.id AS patient_id,
          p.full_name AS patient_name,
          c.appointment_id,
          c.id AS consultation_id,
          c.consultation_date AS reference_date,
          NULL AS reference_time,
          substr(c.doctor_notes, 1, 120) AS detail
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        WHERE c.doctor_id = ?
          AND p.deleted_at IS NULL

        UNION ALL

        SELECT
          'billing' AS type,
          b.created_at AS activity_at,
          CASE WHEN b.status = 'paid' THEN 'Payment completed' ELSE 'Payment pending' END AS title,
          p.id AS patient_id,
          p.full_name AS patient_name,
          c.appointment_id,
          c.id AS consultation_id,
          COALESCE(b.payment_date, c.consultation_date) AS reference_date,
          NULL AS reference_time,
          'Amount: Rs ' || printf('%.2f', b.total_amount) AS detail
        FROM billing b
        JOIN consultations c ON c.id = b.consultation_id
        JOIN patients p ON p.id = b.patient_id
        WHERE c.doctor_id = ?
          AND p.deleted_at IS NULL
      )
      ORDER BY activity_at DESC
      LIMIT 12
    `)
    .all(doctorId, doctorId, doctorId);

  const pendingPaymentAmount = pendingPayments.reduce(
    (total, bill) => total + toNumber(bill.total_amount, 0),
    0,
  );

  return {
    doctor,
    periods: {
      today,
      weekStart,
      weekEnd,
      monthStart,
      monthEnd,
      monthLabel,
    },
    summary: {
      currentWeekRosterCount: currentWeekRoster.length,
      currentMonthRosterCount: currentMonthRoster.length,
      scheduledVisitsCount: scheduledVisits.length,
      pendingPaymentsCount: pendingPayments.length,
      pendingPaymentAmount: Number(pendingPaymentAmount.toFixed(2)),
      assignedPatientsCount: assignedPatients.length,
      patientsSeenThisMonthCount: patientsSeenThisMonth.length,
      completedAppointmentsThisMonth: currentMonthRoster.filter(
        (appointment) => appointment.status === "completed",
      ).length,
      cancelledAppointmentsThisMonth: currentMonthRoster.filter(
        (appointment) => appointment.status === "cancelled",
      ).length,
      activeAssignedPatientsCount: assignedPatients.filter((patient) => patient.status === "active")
        .length,
      dischargedAssignedPatientsCount: assignedPatients.filter(
        (patient) => patient.status === "discharged",
      ).length,
      longTermReviewAssignedCount,
      subscribedAssignedCount,
    },
    currentWeekRoster,
    currentMonthRoster,
    scheduledVisits,
    pendingPayments,
    assignedPatients,
    patientsSeenThisMonth,
    monthConsultations,
    hcmUpdates,
  };
}

function getOperatorWorkspacePayload() {
  const today = getTodayLocal();
  const { weekStart, weekEnd } = getCurrentWeekRange();
  const { monthStart, monthEnd, monthLabel } = getCurrentMonthRange();

  const appointmentSelect = `
    SELECT
      a.id,
      a.appointment_date,
      a.appointment_time,
      a.status,
      a.created_at,
      a.patient_id,
      p.full_name AS patient_name,
      p.patient_identifier,
      p.location,
      d.id AS doctor_id,
      d.full_name AS doctor_name,
      d.specialization,
      c.id AS consultation_id
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN doctors d ON d.id = a.doctor_id
    LEFT JOIN consultations c ON c.appointment_id = a.id
    WHERE p.deleted_at IS NULL
  `;

  const currentWeekRoster = db
    .prepare(`
      ${appointmentSelect}
        AND a.appointment_date BETWEEN ? AND ?
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
    `)
    .all(weekStart, weekEnd);

  const currentMonthRoster = db
    .prepare(`
      ${appointmentSelect}
        AND a.appointment_date BETWEEN ? AND ?
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
    `)
    .all(monthStart, monthEnd);

  const scheduledVisits = db
    .prepare(`
      ${appointmentSelect}
        AND a.status = 'scheduled'
        AND a.appointment_date >= ?
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
    `)
    .all(today);

  const pendingPayments = db
    .prepare(`
      SELECT
        b.*,
        p.id AS patient_id,
        p.full_name AS patient_name,
        p.patient_identifier,
        d.id AS doctor_id,
        d.full_name AS doctor_name,
        c.id AS consultation_id,
        c.consultation_date
      FROM billing b
      JOIN consultations c ON c.id = b.consultation_id
      JOIN patients p ON p.id = b.patient_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE b.status = 'unpaid'
        AND p.deleted_at IS NULL
      ORDER BY c.consultation_date DESC, b.created_at DESC
    `)
    .all()
    .map(parseBillingRow);

  const longTermReview = db
    .prepare(`
      SELECT
        p.id,
        p.full_name,
        p.patient_identifier,
        p.patient_contact_number,
        p.location,
        p.status,
        p.ongoing_treatment,
        p.particularity,
        p.review_reason_note,
        p.review_due_date,
        p.created_at,
        d.full_name AS assigned_doctor_name,
        d.specialization AS assigned_doctor_specialization,
        MAX(c.consultation_date) AS last_consultation_date
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      LEFT JOIN consultations c ON c.patient_id = p.id
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'
        AND p.is_under_review = 1
      GROUP BY
        p.id,
        p.full_name,
        p.patient_identifier,
        p.patient_contact_number,
        p.location,
        p.status,
        p.ongoing_treatment,
        p.particularity,
        p.review_reason_note,
        p.review_due_date,
        p.created_at,
        d.full_name,
        d.specialization
      ORDER BY
        CASE
          WHEN p.review_due_date IS NULL OR trim(p.review_due_date) = '' THEN 1
          ELSE 0
        END ASC,
        p.review_due_date ASC,
        p.full_name ASC
    `)
    .all();

  const reviewAppointmentsThisMonth = currentMonthRoster;
  const pendingPaymentAmount = pendingPayments.reduce(
    (total, bill) => total + toNumber(bill.total_amount, 0),
    0,
  );

  const activeSubscriptionPatientsRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM patients
      WHERE deleted_at IS NULL
        AND status = 'active'
        AND is_subscribed = 1
    `)
    .get();
  const activeSubscriptionPatientsCount = Number(activeSubscriptionPatientsRow?.count || 0);

  const pendingDispatchRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      LEFT JOIN consultations c ON c.appointment_id = a.id
      WHERE p.deleted_at IS NULL
        AND a.status = 'scheduled'
        AND a.appointment_date = ?
        AND c.id IS NULL
    `)
    .get(today);
  const pendingDispatchCount = Number(pendingDispatchRow?.count || 0);

  const scheduledTodayRow = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE p.deleted_at IS NULL
        AND a.status = 'scheduled'
        AND a.appointment_date = ?
    `)
    .get(today);
  const scheduledTodayCount = Number(scheduledTodayRow?.count || 0);

  return {
    periods: {
      today,
      weekStart,
      weekEnd,
      monthStart,
      monthEnd,
      monthLabel,
    },
    summary: {
      currentWeekRosterCount: currentWeekRoster.length,
      currentMonthRosterCount: currentMonthRoster.length,
      scheduledVisitsCount: scheduledVisits.length,
      pendingPaymentsCount: pendingPayments.length,
      pendingPaymentAmount: Number(pendingPaymentAmount.toFixed(2)),
      longTermReviewCount: longTermReview.length,
      reviewAppointmentsCount: reviewAppointmentsThisMonth.length,
      activeSubscriptionPatientsCount,
      pendingDispatchCount,
      scheduledTodayCount,
    },
    currentWeekRoster,
    currentMonthRoster,
    scheduledVisits,
    pendingPayments,
    longTermReview,
    reviewAppointmentsThisMonth,
  };
}

function getLongTermReviewCount() {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM patients p
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'
        AND p.is_under_review = 1
    `)
    .get();
  return Number(row?.count || 0);
}

function getActiveSubscriptionPatientsCount() {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM patients
      WHERE deleted_at IS NULL
        AND status = 'active'
        AND is_subscribed = 1
    `)
    .get();
  return Number(row?.count || 0);
}

router.get("/", (_req, res) => {
  const req = _req;
  const includeGlobalFinancials = ["admin", "accountant"].includes(req.auth.role);
  const activityDoctorId =
    req.auth.role === "doctor" && req.auth.doctor_id
      ? Number(req.auth.doctor_id)
      : null;
  const today = getTodayLocal();
  const nextWeek = offsetLocalDate(7);

  const totalPatients = db
    .prepare("SELECT COUNT(*) AS count FROM patients WHERE deleted_at IS NULL")
    .get().count;
  const todaysAppointments = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      WHERE a.appointment_date = ?
        AND p.deleted_at IS NULL
    `)
    .get(today).count;
  const pendingBills = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      WHERE b.status = 'unpaid'
        AND p.deleted_at IS NULL
    `)
    .get().count;
  const revenueRow = db
    .prepare(`
      SELECT COALESCE(SUM(b.total_amount), 0) AS total
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      WHERE b.status = 'paid'
        AND p.deleted_at IS NULL
    `)
    .get();

  const upcomingAppointments = db
    .prepare(`
      SELECT
        a.id,
        a.appointment_date,
        a.appointment_time,
        a.status,
        p.full_name AS patient_name,
        d.full_name AS doctor_name,
        d.specialization
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id
      JOIN doctors d ON d.id = a.doctor_id
      WHERE a.appointment_date BETWEEN ? AND ?
        AND p.deleted_at IS NULL
      ORDER BY a.appointment_date ASC, a.appointment_time ASC
      LIMIT 10
    `)
    .all(today, nextWeek);

  const recentActivity = db
    .prepare(`
      SELECT * FROM (
        SELECT
          'appointment' AS type,
          a.created_at AS activity_at,
          CASE
            WHEN a.status = 'completed' THEN 'Appointment completed'
            WHEN a.status = 'cancelled' THEN 'Appointment cancelled'
            ELSE 'Appointment scheduled'
          END AS title,
          p.full_name AS patient_name,
          d.full_name AS doctor_name,
          a.appointment_date AS reference_date,
          a.appointment_time AS reference_time,
          'Status: ' || a.status AS detail
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        JOIN doctors d ON d.id = a.doctor_id
        WHERE p.deleted_at IS NULL
          AND (@activityDoctorId IS NULL OR d.id = @activityDoctorId)

        UNION ALL

        SELECT
          'consultation' AS type,
          c.created_at AS activity_at,
          'Consultation saved' AS title,
          p.full_name AS patient_name,
          d.full_name AS doctor_name,
          c.consultation_date AS reference_date,
          NULL AS reference_time,
          substr(c.doctor_notes, 1, 110) AS detail
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        JOIN doctors d ON d.id = c.doctor_id
        WHERE p.deleted_at IS NULL
          AND (@activityDoctorId IS NULL OR c.doctor_id = @activityDoctorId)

        UNION ALL

        SELECT
          'billing' AS type,
          b.created_at AS activity_at,
          CASE WHEN b.status = 'paid' THEN 'Payment recorded' ELSE 'Bill generated' END AS title,
          p.full_name AS patient_name,
          d.full_name AS doctor_name,
          COALESCE(b.payment_date, b.created_at) AS reference_date,
          NULL AS reference_time,
          'Amount: Rs ' || printf('%.2f', b.total_amount) AS detail
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        JOIN consultations c ON c.id = b.consultation_id
        JOIN doctors d ON d.id = c.doctor_id
        WHERE p.deleted_at IS NULL
          AND (@activityDoctorId IS NULL OR c.doctor_id = @activityDoctorId)
      )
      ORDER BY activity_at DESC
      LIMIT 8
    `)
    .all({ activityDoctorId });

  const doctorStatuses = getDoctorStatuses();
  const doctorLowStockAlert =
    req.auth.role === "doctor" && req.auth.doctor_id
      ? getDoctorLowStockAlert(Number(req.auth.doctor_id))
      : { triggered: false, total_items: 0, items: [] };

  const ocsLowStockAlert = ["admin", "operator"].includes(req.auth.role)
    ? getOcsLowStockAlert()
    : { triggered: false, total_items: 0, items: [] };

  if (doctorLowStockAlert.triggered && req.auth.doctor_id) {
    void notifyDoctorLowStockSummary({
      doctorId: Number(req.auth.doctor_id),
      userId: Number(req.auth.id),
    }).catch((error) => {
      console.warn("[push] low stock dashboard notification failed:", error?.message || error);
    });
  }

  if (["admin", "operator"].includes(req.auth.role)) {
    void notifyOcsLowStockSubscribers({ userIds: [Number(req.auth.id)] }).catch((error) => {
      console.warn("[push] OCS low stock dashboard notification failed:", error?.message || error);
    });
  }

  const summary = {
    totalPatients,
    todaysAppointments,
    pendingBills,
    longTermReviewCount: getLongTermReviewCount(),
    activeSubscriptionPatientsCount: getActiveSubscriptionPatientsCount(),
  };

  if (includeGlobalFinancials) {
    summary.totalRevenue = toNumber(revenueRow.total, 0);
  }

  res.json({
    summary,
    upcomingAppointments,
    recentActivity,
    doctorStatuses,
    doctor_low_stock_alert: doctorLowStockAlert,
    ocs_low_stock_alert: ocsLowStockAlert,
  });
});

router.get("/roster", (req, res) => {
  if (!["admin", "doctor", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "You do not have permission to access the roster." });
  }
  res.json(getRosterMeta());
});

router.post("/roster", rosterUpload.single("roster"), (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can upload the roster PDF." });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Roster PDF file is required." });
  }

  fs.mkdirSync(rosterDir, { recursive: true });
  fs.writeFileSync(CURRENT_ROSTER_PATH, req.file.buffer);
  res.status(201).json(getRosterMeta());
});

router.get("/roster/file", (req, res) => {
  if (!["admin", "doctor", "operator"].includes(req.auth.role)) {
    return res.status(403).json({ error: "You do not have permission to access the roster PDF." });
  }

  if (!fs.existsSync(CURRENT_ROSTER_PATH)) {
    return res.status(404).json({ error: "Current roster PDF has not been uploaded yet." });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("X-File-Name", encodeURIComponent(CURRENT_ROSTER_FILE_NAME));
  res.setHeader("Content-Disposition", `inline; filename="${CURRENT_ROSTER_FILE_NAME}"`);
  res.sendFile(CURRENT_ROSTER_PATH);
});

router.get("/doctor-workspace", (req, res) => {
  if (req.auth.role !== "doctor" || !req.auth.doctor_id) {
    return res.status(403).json({ error: "Only doctor accounts can open this workspace." });
  }

  const payload = getDoctorWorkspacePayload(Number(req.auth.doctor_id));

  if (!payload.doctor) {
    return res.status(404).json({ error: "Doctor profile could not be found." });
  }

  res.json(payload);
});

router.get("/operator-workspace", (req, res) => {
  if (req.auth.role !== "operator") {
    return res.status(403).json({ error: "Only operator accounts can open this workspace." });
  }

  void notifyOcsLowStockSubscribers({ userIds: [Number(req.auth.id)] }).catch((error) => {
    console.warn("[push] OCS low stock operator workspace notification failed:", error?.message || error);
  });

  res.json(getOperatorWorkspacePayload());
});

router.get("/live-report", (req, res) => {
  if (!["admin", "doctor", "accountant"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only authorized staff can open live reports." });
  }

  const doctors = db
    .prepare(`
      SELECT
        id,
        full_name,
        specialization
      FROM doctors
      WHERE deleted_at IS NULL
        AND is_active = 1
      ORDER BY full_name ASC
    `)
    .all();

  const requestedDoctorId = Number(req.query.doctorId);
  const selectedDoctorId = req.auth.role === "doctor"
    ? Number(req.auth.doctor_id || 0) || null
    : Number.isInteger(requestedDoctorId) &&
        requestedDoctorId > 0 &&
        doctors.some((doctor) => Number(doctor.id) === requestedDoctorId)
      ? requestedDoctorId
      : null;

  const locationRange = getReportRange(
    normalizeReportPeriod(req.query.locationPeriod, "monthly"),
    req.query.locationDate,
  );
  const doctorRange = getReportRange(
    normalizeReportPeriod(req.query.doctorPeriod, "monthly"),
    req.query.doctorDate,
  );
  const revenueAnchorDate = formatLocalSqlDate(getReferenceDate(req.query.revenueDate));

  const locationDistribution = db
    .prepare(`
      SELECT
        COALESCE(NULLIF(trim(p.location), ''), 'Unspecified') AS location,
        COUNT(DISTINCT c.patient_id) AS patient_count
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      WHERE p.deleted_at IS NULL
        AND c.consultation_date BETWEEN @startDate AND @endDate
        AND (@doctorId IS NULL OR c.doctor_id = @doctorId)
      GROUP BY location
      ORDER BY patient_count DESC, location ASC
    `)
    .all({
      startDate: locationRange.start,
      endDate: locationRange.end,
      doctorId: selectedDoctorId,
    })
    .map((row) => ({
      ...row,
      patient_count: Number(row.patient_count || 0),
    }));

  const totalPatientsSeen = locationDistribution.reduce(
    (sum, row) => sum + Number(row.patient_count || 0),
    0,
  );

  const doctorRows = getDoctorPatientCounts(doctorRange.start, doctorRange.end, selectedDoctorId);

  const volumeRows = getVolumeRows(doctorRange.period, doctorRange, selectedDoctorId);
  const activeEntityLabel = selectedDoctorId
    ? doctors.find((doctor) => Number(doctor.id) === Number(selectedDoctorId))?.full_name || "Selected doctor"
    : "All doctors";

  const includeFinancials = ["admin", "accountant", "doctor"].includes(req.auth.role);

  let billingRevenueReport;
  let revenueStatement;
  let revenueReport;

  if (includeFinancials) {
    const revenueRanges = {
      daily: getReportRange("daily", revenueAnchorDate),
      weekly: getReportRange("weekly", revenueAnchorDate),
      monthly: getReportRange("monthly", revenueAnchorDate),
      annual: getReportRange("annual", revenueAnchorDate),
    };

    const revenueSummary = {
      daily: getPaidRevenueTotal(
        revenueRanges.daily.start,
        revenueRanges.daily.end,
        selectedDoctorId,
      ),
      weekly: getPaidRevenueTotal(
        revenueRanges.weekly.start,
        revenueRanges.weekly.end,
        selectedDoctorId,
      ),
      monthly: getPaidRevenueTotal(
        revenueRanges.monthly.start,
        revenueRanges.monthly.end,
        selectedDoctorId,
      ),
      annual: getPaidRevenueTotal(
        revenueRanges.annual.start,
        revenueRanges.annual.end,
        selectedDoctorId,
      ),
    };

    const revenueRows = db
      .prepare(`
        SELECT
          p.id AS patient_id,
          p.full_name AS patient_name,
          b.id AS bill_id,
          c.consultation_date,
          b.total_amount,
          b.status,
          COALESCE(NULLIF(b.payment_method, ''), 'unpaid') AS payment_method
        FROM billing b
        JOIN consultations c ON c.id = b.consultation_id
        JOIN patients p ON p.id = b.patient_id
        WHERE p.deleted_at IS NULL
          AND c.consultation_date BETWEEN @startDate AND @endDate
          AND (@doctorId IS NULL OR c.doctor_id = @doctorId)
        ORDER BY c.consultation_date DESC, b.id DESC
      `)
      .all({
        startDate: doctorRange.start,
        endDate: doctorRange.end,
        doctorId: selectedDoctorId,
      });

    const totalRevenue = revenueRows.reduce((sum, row) => sum + toNumber(row.total_amount, 0), 0);
    const uniquePatients = new Set(revenueRows.map((row) => row.patient_id)).size;
    const paidRevenue = revenueRows
      .filter((row) => row.status === "paid")
      .reduce((sum, row) => sum + toNumber(row.total_amount, 0), 0);
    const unpaidRevenue = revenueRows
      .filter((row) => row.status !== "paid")
      .reduce((sum, row) => sum + toNumber(row.total_amount, 0), 0);
    const doctorCommission = totalRevenue * 0.4;
    const ocsCommission = totalRevenue * 0.6;
    const transportBenefits = uniquePatients * 300;
    const doctorNetRevenue = doctorCommission + transportBenefits;
    const paymentMethodBreakdown = ["cash", "juice", "card", "ib"].map((method) => ({
      method,
      amount: revenueRows
        .filter((row) => row.status === "paid" && row.payment_method === method)
        .reduce((sum, row) => sum + toNumber(row.total_amount, 0), 0),
    }));

    billingRevenueReport = {
      rows: revenueRows,
      period: doctorRange.period,
      rangeLabel: doctorRange.label,
    };

    revenueStatement =
      req.auth.role === "doctor"
        ? {
            totalRevenue,
            doctorCommission,
            transportBenefits,
            doctorNetRevenue,
            paidRevenue,
            unpaidRevenue,
            paymentMethodBreakdown,
          }
        : {
            totalRevenue,
            ocsCommission,
            doctorCommission,
            transportBenefits,
            doctorNetRevenue,
            paidRevenue,
            unpaidRevenue,
            paymentMethodBreakdown,
          };

    revenueReport = {
      anchorDate: revenueAnchorDate,
      ranges: revenueRanges,
      summary: revenueSummary,
    };
  }

  const responseBody = {
    doctors,
    locationReport: {
      period: locationRange.period,
      anchorDate: locationRange.anchorDate,
      rangeStart: locationRange.start,
      rangeEnd: locationRange.end,
      rangeLabel: locationRange.label,
      totalPatientsSeen,
      rows: locationDistribution,
    },
    doctorReport: {
      period: doctorRange.period,
      anchorDate: doctorRange.anchorDate,
      rangeStart: doctorRange.start,
      rangeEnd: doctorRange.end,
      rangeLabel: doctorRange.label,
      selectedDoctorId,
      rows: doctorRows,
    },
    volumeReport: {
      period: doctorRange.period,
      anchorDate: doctorRange.anchorDate,
      rangeStart: doctorRange.start,
      rangeEnd: doctorRange.end,
      rangeLabel: `${doctorRange.label} - ${activeEntityLabel}`,
      entityLabel: activeEntityLabel,
      rows: volumeRows,
    },
  };

  if (includeFinancials) {
    responseBody.billingRevenueReport = billingRevenueReport;
    responseBody.revenueStatement = revenueStatement;
    responseBody.revenueReport = revenueReport;
  }

  res.json(responseBody);
});

router.put("/my-status", (req, res) => {
  const nextStatus = String(req.body.status ?? "").trim().toLowerCase();

  if (!OPERATION_STATUSES.has(nextStatus)) {
    return res.status(400).json({ error: "Operation status is invalid." });
  }

  db.prepare(`
    UPDATE users
    SET
      operation_status = ?,
      operation_status_updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nextStatus, req.auth.id);

  const updatedUser = getCurrentUserRow(req.auth.id);
  res.json({ user: serializeUser(updatedUser) });
});

router.get("/operator-access", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can manage operator access." });
  }

  res.json(getDashboardOperatorAccessPayload());
});

router.post("/operator-access", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can manage operator access." });
  }

  const patientId = Number(req.body.patient_id);
  const operatorUserId = Number(req.body.operator_user_id);

  if (!Number.isInteger(patientId) || patientId <= 0) {
    return res.status(400).json({ error: "Patient selection is required." });
  }

  if (!Number.isInteger(operatorUserId) || operatorUserId <= 0) {
    return res.status(400).json({ error: "Operator selection is required." });
  }

  const patient = db
    .prepare("SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL")
    .get(patientId);
  const operatorUser = db
    .prepare(`
      SELECT id
      FROM users
      WHERE id = ?
        AND role = 'operator'
        AND is_active = 1
        AND deleted_at IS NULL
    `)
    .get(operatorUserId);

  if (!patient) {
    return res.status(404).json({ error: "Patient not found." });
  }

  if (!operatorUser) {
    return res.status(400).json({ error: "Selected operator could not be found." });
  }

  const expiresAt = normalizeSqlDateTime(req.body.expires_at) || getDefaultOperatorExpiry();

  if (!expiresAt || expiresAt <= normalizeSqlDateTime(Date.now())) {
    return res.status(400).json({ error: "Operator access expiry must be in the future." });
  }

  db.transaction(() => {
    db.prepare(`
      DELETE FROM patient_operator_access
      WHERE patient_id = ?
        AND operator_user_id = ?
    `).run(patientId, operatorUserId);

    db.prepare(`
      INSERT INTO patient_operator_access (
        patient_id,
        operator_user_id,
        granted_by_user_id,
        expires_at
      )
      VALUES (?, ?, ?, ?)
    `).run(patientId, operatorUserId, req.auth.id, expiresAt);
  })();

  res.status(201).json(getDashboardOperatorAccessPayload());
});

router.delete("/operator-access/:accessId", (req, res) => {
  if (req.auth.role !== "admin") {
    return res.status(403).json({ error: "Only admin can manage operator access." });
  }

  const accessId = Number(req.params.accessId);
  const existing = db
    .prepare("SELECT id FROM patient_operator_access WHERE id = ?")
    .get(accessId);

  if (!existing) {
    return res.status(404).json({ error: "Operator access record not found." });
  }

  db.prepare("DELETE FROM patient_operator_access WHERE id = ?").run(accessId);
  res.status(204).send();
});

module.exports = router;
