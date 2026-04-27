const express = require("express");
const { db } = require("../db");
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

function getPaidRevenueTotal(startDate, endDate) {
  const row = db
    .prepare(`
      SELECT COALESCE(SUM(b.total_amount), 0) AS total
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      WHERE b.status = 'paid'
        AND p.deleted_at IS NULL
        AND substr(COALESCE(NULLIF(b.payment_date, ''), b.created_at), 1, 10) BETWEEN ? AND ?
    `)
    .get(startDate, endDate);

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
        p.created_at
      ORDER BY p.full_name ASC
    `)
    .all(doctorId);

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
        p.created_at,
        d.full_name AS assigned_doctor_name,
        d.specialization AS assigned_doctor_specialization,
        MAX(c.consultation_date) AS last_consultation_date
      FROM patients p
      LEFT JOIN doctors d ON d.id = p.assigned_doctor_id
      LEFT JOIN consultations c ON c.patient_id = p.id
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'
        AND (
          COALESCE(NULLIF(trim(p.ongoing_treatment), ''), '') != ''
          OR COALESCE(NULLIF(trim(p.particularity), ''), '') != ''
        )
      GROUP BY
        p.id,
        p.full_name,
        p.patient_identifier,
        p.patient_contact_number,
        p.location,
        p.status,
        p.ongoing_treatment,
        p.particularity,
        p.created_at,
        d.full_name,
        d.specialization
      ORDER BY last_consultation_date DESC, p.full_name ASC
    `)
    .all();

  const reviewAppointmentsThisMonth = currentMonthRoster;
  const pendingPaymentAmount = pendingPayments.reduce(
    (total, bill) => total + toNumber(bill.total_amount, 0),
    0,
  );

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
    },
    currentWeekRoster,
    currentMonthRoster,
    scheduledVisits,
    pendingPayments,
    longTermReview,
    reviewAppointmentsThisMonth,
  };
}

router.get("/", (_req, res) => {
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

        UNION ALL

        SELECT
          'billing' AS type,
          b.created_at AS activity_at,
          CASE WHEN b.status = 'paid' THEN 'Payment recorded' ELSE 'Bill generated' END AS title,
          p.full_name AS patient_name,
          NULL AS doctor_name,
          COALESCE(b.payment_date, b.created_at) AS reference_date,
          NULL AS reference_time,
          'Amount: Rs ' || printf('%.2f', b.total_amount) AS detail
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        WHERE p.deleted_at IS NULL
      )
      ORDER BY activity_at DESC
      LIMIT 8
    `)
    .all();

  const doctorStatuses = getDoctorStatuses();

  res.json({
    summary: {
      totalPatients,
      todaysAppointments,
      pendingBills,
      totalRevenue: toNumber(revenueRow.total, 0),
    },
    upcomingAppointments,
    recentActivity,
    doctorStatuses,
  });
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

  res.json(getOperatorWorkspacePayload());
});

router.get("/live-report", (req, res) => {
  if (!["admin", "doctor"].includes(req.auth.role)) {
    return res.status(403).json({ error: "Only admin and doctor can open live reports." });
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
      : doctors[0]?.id ?? null;

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

  const doctorRows = selectedDoctorId
    ? getDoctorPatientCounts(doctorRange.start, doctorRange.end, selectedDoctorId)
    : [];

  const volumeRows = db
    .prepare(`
      SELECT
        c.consultation_date AS date,
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
      startDate: doctorRange.start,
      endDate: doctorRange.end,
      doctorId: selectedDoctorId,
    })
    .map((row) => ({ ...row, patient_count: Number(row.patient_count || 0) }));

  const revenueRanges = {
    daily: getReportRange("daily", revenueAnchorDate),
    weekly: getReportRange("weekly", revenueAnchorDate),
    monthly: getReportRange("monthly", revenueAnchorDate),
    annual: getReportRange("annual", revenueAnchorDate),
  };

  const revenueSummary = {
    daily: getPaidRevenueTotal(revenueRanges.daily.start, revenueRanges.daily.end),
    weekly: getPaidRevenueTotal(revenueRanges.weekly.start, revenueRanges.weekly.end),
    monthly: getPaidRevenueTotal(revenueRanges.monthly.start, revenueRanges.monthly.end),
    annual: getPaidRevenueTotal(revenueRanges.annual.start, revenueRanges.annual.end),
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
  const paymentMethodBreakdown = ["cash", "juice", "ib"].map((method) => ({
    method,
    amount: revenueRows
      .filter((row) => row.status === "paid" && row.payment_method === method)
      .reduce((sum, row) => sum + toNumber(row.total_amount, 0), 0),
  }));

  res.json({
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
      rangeLabel: doctorRange.label,
      rows: volumeRows,
    },
    billingRevenueReport: {
      rows: revenueRows,
      period: doctorRange.period,
      rangeLabel: doctorRange.label,
    },
    revenueStatement: {
      totalRevenue,
      ocsCommission,
      doctorCommission,
      transportBenefits,
      doctorNetRevenue,
      paidRevenue,
      unpaidRevenue,
      paymentMethodBreakdown,
    },
    revenueReport: {
      anchorDate: revenueAnchorDate,
      ranges: revenueRanges,
      summary: revenueSummary,
    },
  });
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
