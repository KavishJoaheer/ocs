const { db } = require("../db");
const { isLinkhamInsuranceProvider } = require("./insuranceProvider");
const { getTodayLocal } = require("./utils");

const LINKHAM_PATIENT_SQL = "lower(trim(p.insurance_provider)) = 'linkham'";

function getMonthStartLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function calculateAgeFromDateOfBirth(dateOfBirth) {
  const normalized = String(dateOfBirth || "").trim();
  if (!normalized) {
    return null;
  }

  const today = new Date();
  const birthDate = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) {
    return null;
  }

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();
  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function parseMauritianNicAge(nationalId) {
  const cleanId = String(nationalId || "").trim().toUpperCase();
  if (cleanId.length !== 14) {
    return null;
  }

  const day = Number.parseInt(cleanId.substring(1, 3), 10);
  const month = Number.parseInt(cleanId.substring(3, 5), 10);
  const shortYear = Number.parseInt(cleanId.substring(5, 7), 10);
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }

  const currentYearShort = new Date().getFullYear() % 100;
  const centuryPrefix = shortYear <= currentYearShort ? "20" : "19";
  const fullYear = Number.parseInt(`${centuryPrefix}${cleanId.substring(5, 7)}`, 10);
  const isoDob = `${fullYear}-${cleanId.substring(3, 5)}-${cleanId.substring(1, 3)}`;
  return calculateAgeFromDateOfBirth(isoDob);
}

function formatClaimRow(row) {
  const total = Number(row.total_amount || 0);
  return {
    id: Number(row.id),
    visit_date: row.visit_date || null,
    patient_name: row.patient_name,
    patient_identifier: row.patient_identifier || "",
    id_short: row.patient_identifier || `BILL-${row.id}`,
    total_amount: roundMoney(total),
    patient_copay_amount: roundMoney(total * 0.2),
    linkham_share_amount: roundMoney(total * 0.8),
    billing_status: row.billing_status,
    linkham_claim_status: row.linkham_claim_status || "pending",
    copay_paid: row.billing_status === "paid",
  };
}

function formatLinkhamClientRow(row) {
  const village = String(row.village || "").trim() || String(row.location || "").trim();
  const ageFromDob = calculateAgeFromDateOfBirth(row.date_of_birth);
  const ageFromNic = parseMauritianNicAge(row.national_id);

  return {
    id: Number(row.id),
    case_number: row.case_number || `PT-${row.id}`,
    full_name: row.full_name,
    date_of_birth: row.date_of_birth || "",
    national_id: row.national_id || "",
    address: row.address || "",
    village,
    patient_contact_number: row.patient_contact_number || "",
    status: row.status || "active",
    created_at: row.created_at,
    age: ageFromDob ?? ageFromNic,
  };
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

function mapSeenTimeFilter(value) {
  const normalized = String(value || "month").trim().toLowerCase();
  if (normalized === "day") return "daily";
  if (normalized === "week") return "weekly";
  if (normalized === "year") return "annual";
  return "monthly";
}

function mapClaimsTimeFilter(value) {
  const normalized = String(value || "month").trim().toLowerCase();
  if (normalized === "week") return "weekly";
  if (normalized === "year") return "annual";
  return "monthly";
}

function getLinkhamReportRange(period, anchorDateValue) {
  const anchorDate = getReferenceDate(anchorDateValue);
  const anchorDateLabel = formatLocalSqlDate(anchorDate);

  if (period === "daily") {
    return {
      period,
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
      start: weekStart,
      end: weekEnd,
      label: `${weekStart} to ${weekEnd}`,
    };
  }

  if (period === "annual") {
    const yearStart = formatLocalSqlDate(new Date(anchorDate.getFullYear(), 0, 1));
    const yearEnd = formatLocalSqlDate(new Date(anchorDate.getFullYear(), 11, 31));
    return {
      period,
      start: yearStart,
      end: yearEnd,
      label: String(anchorDate.getFullYear()),
      yearLabel: String(anchorDate.getFullYear()),
    };
  }

  const monthStart = formatLocalSqlDate(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1));
  const monthEnd = formatLocalSqlDate(new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0));
  return {
    period: "monthly",
    start: monthStart,
    end: monthEnd,
    label: anchorDate.toLocaleString("en-US", { month: "long", year: "numeric" }),
    monthLabel: anchorDate.toLocaleString("en-US", { month: "long" }),
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

function formatReviewDueDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "Not scheduled";
  }
  const parsed = new Date(`${normalized}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function listLinkhamDueLongTermReviews() {
  return db
    .prepare(`
      SELECT
        p.id,
        p.full_name AS patient_name,
        p.patient_identifier AS case_number,
        p.review_due_date
      FROM patients p
      WHERE p.deleted_at IS NULL
        AND p.status = 'active'
        AND p.is_under_review = 1
        AND ${LINKHAM_PATIENT_SQL}
      ORDER BY
        CASE
          WHEN p.review_due_date IS NULL OR trim(p.review_due_date) = '' THEN 1
          ELSE 0
        END ASC,
        p.review_due_date ASC,
        p.full_name ASC
      LIMIT 12
    `)
    .all()
    .map((row) => ({
      id: Number(row.id),
      patient_name: row.patient_name,
      case_number: row.case_number || `PT-${row.id}`,
      due_date_string: formatReviewDueDate(row.review_due_date),
      review_due_date: row.review_due_date || null,
    }));
}

function listLinkhamHcmNewsFeed(limit = 5) {
  return db
    .prepare(`
      SELECT
        post.id,
        post.title,
        post.body,
        post.updated_at,
        post.created_at
      FROM hcm_news_posts post
      WHERE post.status = 'active'
      ORDER BY post.updated_at DESC, post.created_at DESC
      LIMIT ?
    `)
    .all(Math.max(1, Number(limit) || 5))
    .map((row) => ({
      id: Number(row.id),
      title: row.title || "Announcement",
      body: row.body || "",
      updated_at: row.updated_at || row.created_at,
    }));
}

function getLinkhamPatientsSeenVolume(period, range) {
  if (period === "daily") {
    const grouped = db
      .prepare(`
        SELECT
          CAST(strftime('%H', c.created_at) AS INTEGER) AS slot_hour,
          COUNT(DISTINCT c.patient_id) AS patient_count
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        WHERE p.deleted_at IS NULL
          AND ${LINKHAM_PATIENT_SQL}
          AND c.consultation_date = @targetDate
        GROUP BY slot_hour
        ORDER BY slot_hour ASC
      `)
      .all({ targetDate: range.start });

    const byHour = new Map(
      grouped.map((row) => [Number(row.slot_hour), Number(row.patient_count || 0)]),
    );
    return Array.from({ length: 24 }).map((_, hour) => ({
      label: `${String(hour).padStart(2, "0")}:00`,
      patient_count: byHour.get(hour) || 0,
    }));
  }

  if (period === "annual") {
    const grouped = db
      .prepare(`
        SELECT
          CAST(strftime('%m', c.consultation_date) AS INTEGER) AS slot_month,
          COUNT(DISTINCT c.patient_id) AS patient_count
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        WHERE p.deleted_at IS NULL
          AND ${LINKHAM_PATIENT_SQL}
          AND c.consultation_date BETWEEN @startDate AND @endDate
        GROUP BY slot_month
        ORDER BY slot_month ASC
      `)
      .all({
        startDate: range.start,
        endDate: range.end,
      });

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const byMonth = new Map(
      grouped.map((row) => [Number(row.slot_month), Number(row.patient_count || 0)]),
    );
    return monthNames.map((name, index) => ({
      label: name,
      patient_count: byMonth.get(index + 1) || 0,
    }));
  }

  const groupedByDate = db
    .prepare(`
      SELECT
        c.consultation_date AS slot_date,
        COUNT(DISTINCT c.patient_id) AS patient_count
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      WHERE p.deleted_at IS NULL
        AND ${LINKHAM_PATIENT_SQL}
        AND c.consultation_date BETWEEN @startDate AND @endDate
      GROUP BY c.consultation_date
      ORDER BY c.consultation_date ASC
    `)
    .all({
      startDate: range.start,
      endDate: range.end,
    });

  const byDate = new Map(
    groupedByDate.map((row) => [String(row.slot_date), Number(row.patient_count || 0)]),
  );
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
      label,
      patient_count: byDate.get(slotDate) || 0,
    };
  });
}

function getLinkhamLocationDistribution(range) {
  return db
    .prepare(`
      SELECT
        COALESCE(NULLIF(trim(p.location), ''), 'Unspecified') AS location,
        COUNT(DISTINCT c.patient_id) AS patient_count
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      WHERE p.deleted_at IS NULL
        AND ${LINKHAM_PATIENT_SQL}
        AND c.consultation_date BETWEEN @startDate AND @endDate
      GROUP BY location
      ORDER BY patient_count DESC, location ASC
    `)
    .all({
      startDate: range.start,
      endDate: range.end,
    })
    .map((row) => ({
      location: row.location,
      patient_count: Number(row.patient_count || 0),
    }));
}

function getLinkhamClaimsVolume(period, range) {
  if (period === "annual") {
    const grouped = db
      .prepare(`
        SELECT
          CAST(strftime('%m', c.consultation_date) AS INTEGER) AS slot_month,
          COALESCE(SUM(b.total_amount * 0.8), 0) AS linkham_outlay
        FROM billing b
        JOIN consultations c ON c.id = b.consultation_id
        JOIN patients p ON p.id = b.patient_id
        WHERE p.deleted_at IS NULL
          AND ${LINKHAM_PATIENT_SQL}
          AND b.status = 'paid'
          AND c.consultation_date BETWEEN @startDate AND @endDate
        GROUP BY slot_month
        ORDER BY slot_month ASC
      `)
      .all({
        startDate: range.start,
        endDate: range.end,
      });

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const byMonth = new Map(
      grouped.map((row) => [Number(row.slot_month), roundMoney(row.linkham_outlay)]),
    );
    return monthNames.map((name, index) => ({
      label: name,
      linkham_outlay: byMonth.get(index + 1) || 0,
    }));
  }

  const groupedByDate = db
    .prepare(`
      SELECT
        c.consultation_date AS slot_date,
        COALESCE(SUM(b.total_amount * 0.8), 0) AS linkham_outlay
      FROM billing b
      JOIN consultations c ON c.id = b.consultation_id
      JOIN patients p ON p.id = b.patient_id
      WHERE p.deleted_at IS NULL
        AND ${LINKHAM_PATIENT_SQL}
        AND b.status = 'paid'
        AND c.consultation_date BETWEEN @startDate AND @endDate
      GROUP BY c.consultation_date
      ORDER BY c.consultation_date ASC
    `)
    .all({
      startDate: range.start,
      endDate: range.end,
    });

  const byDate = new Map(
    groupedByDate.map((row) => [String(row.slot_date), roundMoney(row.linkham_outlay)]),
  );
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
      label,
      linkham_outlay: byDate.get(slotDate) || 0,
    };
  });
}

function getLinkhamDashboardMetrics() {
  const monthStart = getMonthStartLocal();
  const now = getReferenceDate(getTodayLocal());
  const currentMonthName = now.toLocaleString("en-US", { month: "long" });

  const monthlySeenPatientsCount = Number(
    db
      .prepare(`
        SELECT COUNT(DISTINCT c.patient_id) AS count
        FROM consultations c
        JOIN patients p ON p.id = c.patient_id
        WHERE p.deleted_at IS NULL
          AND ${LINKHAM_PATIENT_SQL}
          AND c.consultation_date >= date(?)
      `)
      .get(monthStart)?.count || 0,
  );

  const pendingClaimsCount = Number(
    db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        WHERE ${LINKHAM_PATIENT_SQL}
          AND b.status = 'paid'
          AND COALESCE(b.linkham_claim_status, 'pending') = 'pending'
      `)
      .get()?.count || 0,
  );

  const totalInsuredClients = Number(
    db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM patients p
        WHERE p.deleted_at IS NULL
          AND ${LINKHAM_PATIENT_SQL}
      `)
      .get()?.count || 0,
  );

  const monthlyClaimsSettled = roundMoney(
    db
      .prepare(`
        SELECT COALESCE(SUM(b.total_amount * 0.8), 0) AS total
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        WHERE ${LINKHAM_PATIENT_SQL}
          AND b.status = 'paid'
          AND b.linkham_claim_status IN ('approved', 'settled')
          AND date(COALESCE(b.linkham_claim_reviewed_at, b.payment_date, b.created_at)) >= date(?)
      `)
      .get(monthStart)?.total || 0,
  );

  const outstandingEightyLedger = roundMoney(
    db
      .prepare(`
        SELECT COALESCE(SUM(b.total_amount * 0.8), 0) AS total
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        WHERE ${LINKHAM_PATIENT_SQL}
          AND b.status = 'paid'
          AND COALESCE(b.linkham_claim_status, 'pending') = 'pending'
      `)
      .get()?.total || 0,
  );

  return {
    currentMonthName,
    monthlySeenPatientsCount,
    pendingClaimsCount,
    dueLongTermReviews: listLinkhamDueLongTermReviews(),
    hcmNews: listLinkhamHcmNewsFeed(4),
    totalInsuredClients,
    monthlyClaimsSettled,
    outstandingEightyLedger,
  };
}

function getLinkhamAnalyticsReports({ seenTimeFilter = "month", claimsTimeFilter = "month" } = {}) {
  const seenPeriod = mapSeenTimeFilter(seenTimeFilter);
  const claimsPeriod = mapClaimsTimeFilter(claimsTimeFilter);
  const seenRange = getLinkhamReportRange(seenPeriod);
  const claimsRange = getLinkhamReportRange(claimsPeriod);

  return {
    seenTimeFilter: seenTimeFilter || "month",
    claimsTimeFilter: claimsTimeFilter || "month",
    seenRangeLabel: seenRange.label,
    claimsRangeLabel: claimsRange.label,
    patientsSeen: getLinkhamPatientsSeenVolume(seenPeriod, seenRange),
    locationDistribution: getLinkhamLocationDistribution(seenRange),
    claimsVolume: getLinkhamClaimsVolume(claimsPeriod, claimsRange),
  };
}

function listLinkhamPatients() {
  return db
    .prepare(`
      SELECT
        p.id,
        p.patient_identifier AS case_number,
        p.full_name,
        p.date_of_birth,
        p.patient_id_number AS national_id,
        p.address,
        p.location,
        p.patient_contact_number,
        p.status,
        p.created_at,
        (
          SELECT l.name
          FROM patient_locations pl
          JOIN locations l ON l.id = pl.location_id
          WHERE pl.patient_id = p.id
            AND l.category = 'Village'
          ORDER BY l.name ASC
          LIMIT 1
        ) AS village
      FROM patients p
      WHERE p.deleted_at IS NULL
        AND ${LINKHAM_PATIENT_SQL}
      ORDER BY p.created_at DESC, p.full_name ASC
    `)
    .all()
    .map(formatLinkhamClientRow);
}

function getLinkhamPatientFinancing(patientId) {
  const rows = db
    .prepare(`
      SELECT
        b.id,
        b.total_amount,
        b.status,
        COALESCE(b.linkham_claim_status, 'pending') AS linkham_claim_status,
        c.consultation_date AS visit_date
      FROM billing b
      JOIN consultations c ON c.id = b.consultation_id
      JOIN patients p ON p.id = b.patient_id
      WHERE b.patient_id = ?
        AND ${LINKHAM_PATIENT_SQL}
      ORDER BY c.consultation_date DESC, b.id DESC
    `)
    .all(Number(patientId));

  let totalVisitAmount = 0;
  let patientCopayCollected = 0;
  let linkhamCoverageObligation = 0;
  let linkhamApprovedAmount = 0;
  let linkhamOutstandingAmount = 0;

  const visits = rows.map((row) => {
    const total = Number(row.total_amount || 0);
    const copay = roundMoney(total * 0.2);
    const linkhamShare = roundMoney(total * 0.8);
    const paid = row.status === "paid";

    totalVisitAmount += total;
    if (paid) {
      patientCopayCollected += copay;
      linkhamCoverageObligation += linkhamShare;
      if (["approved", "settled"].includes(row.linkham_claim_status)) {
        linkhamApprovedAmount += linkhamShare;
      } else {
        linkhamOutstandingAmount += linkhamShare;
      }
    }

    return {
      billing_id: Number(row.id),
      visit_date: row.visit_date,
      total_amount: roundMoney(total),
      patient_copay_amount: copay,
      linkham_share_amount: linkhamShare,
      copay_collected: paid,
      claim_status: row.linkham_claim_status,
    };
  });

  return {
    total_visit_amount: roundMoney(totalVisitAmount),
    patient_copay_collected: roundMoney(patientCopayCollected),
    linkham_coverage_obligation: roundMoney(linkhamCoverageObligation),
    linkham_approved_amount: roundMoney(linkhamApprovedAmount),
    linkham_outstanding_amount: roundMoney(linkhamOutstandingAmount),
    visits,
  };
}

function getLinkhamPatientById(patientId) {
  const row = db
    .prepare(`
      SELECT
        p.id,
        p.patient_identifier AS case_number,
        p.full_name,
        p.date_of_birth,
        p.patient_id_number AS national_id,
        p.address,
        p.location,
        p.patient_contact_number,
        p.status,
        p.created_at,
        (
          SELECT l.name
          FROM patient_locations pl
          JOIN locations l ON l.id = pl.location_id
          WHERE pl.patient_id = p.id
            AND l.category = 'Village'
          ORDER BY l.name ASC
          LIMIT 1
        ) AS village
      FROM patients p
      WHERE p.id = ?
        AND p.deleted_at IS NULL
        AND ${LINKHAM_PATIENT_SQL}
    `)
    .get(Number(patientId || 0));

  if (!row) {
    return null;
  }

  const client = formatLinkhamClientRow(row);
  return {
    ...client,
    financing: getLinkhamPatientFinancing(client.id),
  };
}

function listLinkhamClaims() {
  return db
    .prepare(`
      SELECT
        b.id,
        b.total_amount,
        b.status AS billing_status,
        COALESCE(b.linkham_claim_status, 'pending') AS linkham_claim_status,
        c.consultation_date AS visit_date,
        p.full_name AS patient_name,
        p.patient_identifier
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      WHERE ${LINKHAM_PATIENT_SQL}
        AND b.status = 'paid'
      ORDER BY c.consultation_date DESC, b.id DESC
    `)
    .all()
    .map(formatClaimRow);
}

function getLinkhamClaimById(claimId) {
  const row = db
    .prepare(`
      SELECT
        b.id,
        b.total_amount,
        b.status AS billing_status,
        COALESCE(b.linkham_claim_status, 'pending') AS linkham_claim_status,
        b.payment_method,
        b.payment_date,
        c.consultation_date AS visit_date,
        p.full_name AS patient_name,
        p.patient_identifier,
        p.patient_id_number,
        d.full_name AS doctor_name
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      JOIN consultations c ON c.id = b.consultation_id
      JOIN doctors d ON d.id = c.doctor_id
      WHERE b.id = ?
        AND ${LINKHAM_PATIENT_SQL}
    `)
    .get(Number(claimId || 0));

  if (!row) {
    return null;
  }

  return {
    ...formatClaimRow(row),
    payment_method: row.payment_method,
    payment_date: row.payment_date,
    patient_id_number: row.patient_id_number || "",
    doctor_name: row.doctor_name || "",
  };
}

function approveLinkhamClaim(claimId) {
  const existing = getLinkhamClaimById(claimId);

  if (!existing) {
    return null;
  }

  if (existing.linkham_claim_status === "approved" || existing.linkham_claim_status === "settled") {
    return existing;
  }

  db.prepare(`
    UPDATE billing
    SET
      linkham_claim_status = 'approved',
      linkham_claim_reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(Number(claimId));

  return getLinkhamClaimById(claimId);
}

function backfillLinkhamInsuranceFromTags() {
  db.prepare(`
    UPDATE patients
    SET insurance_provider = 'Linkham'
    WHERE deleted_at IS NULL
      AND (insurance_provider IS NULL OR trim(insurance_provider) = '')
      AND id IN (
        SELECT pl.patient_id
        FROM patient_locations pl
        JOIN locations l ON l.id = pl.location_id
        WHERE l.category = 'Insurance'
          AND lower(trim(l.name)) = 'linkham'
      )
  `).run();
}

module.exports = {
  approveLinkhamClaim,
  backfillLinkhamInsuranceFromTags,
  getLinkhamAnalyticsReports,
  getLinkhamClaimById,
  getLinkhamDashboardMetrics,
  getLinkhamPatientById,
  isLinkhamInsuranceProvider,
  listLinkhamClaims,
  listLinkhamPatients,
};
