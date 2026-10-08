const { db } = require("../db");
const { resolveIcd10FromText } = require("./icd10Lookup");
const { isLinkhamInsuranceProvider } = require("./insuranceProvider");
const { buildInsurerTreatmentSummaries } = require("./insurerClinicalSummary");
const { listLinkhamPolicies } = require("./linkhamPolicyRegistry");
const { getTodayLocal, offsetLocalDate } = require("./utils");

const LINKHAM_PATIENT_SQL = "lower(trim(p.insurance_provider)) = 'linkham'";
const LINKHAM_CLAIM_SQL = `
  lower(trim(COALESCE(NULLIF(b.partner_category_snapshot, ''), p.insurance_provider))) = 'linkham'
  AND b.voided_at IS NULL
  AND b.finalized_at IS NOT NULL
  AND (
    b.linkham_coverage_status_snapshot = 'green'
    OR (
      COALESCE(b.linkham_coverage_status_snapshot, '') = ''
      AND b.status = 'paid'
    )
  )
  AND EXISTS (
    SELECT 1
    FROM consultations claim_consultation
    WHERE claim_consultation.id = b.consultation_id
      AND claim_consultation.voided_at IS NULL
  )
`;
const LINKHAM_MONTHLY_BUDGET_THRESHOLD = Number(process.env.LINKHAM_MONTHLY_BUDGET_THRESHOLD || 200000);

const MAURITIUS_REGIONS = [
  { id: "port-louis", name: "Port Louis", x: 42, y: 38, aliases: ["port louis"] },
  { id: "triolet", name: "Triolet", x: 48, y: 32, aliases: ["triolet", "pamplemousses"] },
  { id: "flacq", name: "Flacq", x: 72, y: 48, aliases: ["flacq", "centre de flacq", "bel air"] },
  { id: "quatre-bornes", name: "Quatre Bornes", x: 38, y: 52, aliases: ["quatre bornes", "q-borns"] },
  { id: "curepipe", name: "Curepipe", x: 42, y: 58, aliases: ["curepipe"] },
  { id: "vacoas", name: "Vacoas", x: 35, y: 55, aliases: ["vacoas", "phoenix"] },
  { id: "rose-hill", name: "Rose Hill", x: 40, y: 48, aliases: ["rose hill", "beau bassin"] },
  { id: "mahebourg", name: "Mahebourg", x: 65, y: 72, aliases: ["mahebourg", "grand port"] },
  { id: "grand-baie", name: "Grand Baie", x: 52, y: 22, aliases: ["grand baie", "grand bay"] },
];

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

function normalizeDisputeStatus(value) {
  return String(value || "Clean").trim() === "Flagged_Review" ? "Flagged_Review" : "Clean";
}

function hasPolicyNumber(value) {
  return Boolean(String(value || "").trim());
}

function normalizeSearchTerm(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase();
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseYearMonth(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    return null;
  }
  const [year, month] = normalized.split("-").map((part) => Number(part));
  if (month < 1 || month > 12) {
    return null;
  }
  const start = `${normalized}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { start, nextStart: nextMonth, label: normalized };
}

function normalizeClaimStatusFilter(value) {
  const normalized = String(value || "pending").trim().toLowerCase();
  if (["pending", "flagged", "approved", "settled", "all"].includes(normalized)) {
    return normalized;
  }
  return "pending";
}

function claimStatusClauses(statusFilter) {
  if (statusFilter === "pending") {
    return [
      `COALESCE(b.linkham_claim_status, 'pending') = 'pending'`,
      `COALESCE(b.dispute_status, 'Clean') = 'Clean'`,
    ];
  }
  if (statusFilter === "flagged") {
    return [
      `COALESCE(b.linkham_claim_status, 'pending') = 'pending'`,
      `COALESCE(b.dispute_status, 'Clean') = 'Flagged_Review'`,
    ];
  }
  if (statusFilter === "approved") {
    return [`b.linkham_claim_status = 'approved'`];
  }
  if (statusFilter === "settled") {
    return [`b.linkham_claim_status = 'settled'`];
  }
  return [];
}

const LINKHAM_NET_AMOUNT_SQL = `(b.total_amount - COALESCE((SELECT SUM(refund.amount) FROM billing_refunds refund WHERE refund.billing_id = b.id), 0))`;
const LINKHAM_SHARE_AMOUNT_SQL = `(CASE
  WHEN b.linkham_claim_status IN ('approved', 'settled')
    THEN COALESCE(b.linkham_approved_share_amount, b.linkham_share_amount, ${LINKHAM_NET_AMOUNT_SQL} * 0.8)
  ELSE COALESCE(b.linkham_share_amount, ${LINKHAM_NET_AMOUNT_SQL} * 0.8)
END)`;

const LINKHAM_CLAIM_SELECT = `
  b.id,
  b.total_amount,
  ${LINKHAM_NET_AMOUNT_SQL} AS net_amount,
  b.status AS billing_status,
  COALESCE(b.linkham_claim_status, 'pending') AS linkham_claim_status,
  COALESCE(b.dispute_status, 'Clean') AS dispute_status,
  b.dispute_reason,
  b.dispute_flagged_at,
  b.linkham_claim_reviewed_at,
  b.linkham_claim_settled_at,
  b.linkham_patient_share_amount,
  b.linkham_share_amount AS linkham_share_amount_snapshot,
  b.linkham_approved_share_amount,
  b.linkham_settlement_amount,
  b.linkham_settlement_reference,
  b.linkham_settlement_date,
  b.linkham_coverage_status_snapshot,
  b.linkham_coverage_verified_at,
  c.consultation_date AS visit_date,
  p.full_name AS patient_name,
  p.patient_identifier,
  COALESCE(NULLIF(b.linkham_policy_number_snapshot, ''), p.insurance_policy_number) AS insurance_policy_number,
  COALESCE(NULLIF(b.linkham_national_id_snapshot, ''), p.patient_id_number) AS patient_id_number,
  COALESCE((
    SELECT SUM(ledger.amount)
    FROM billing_payment_ledger ledger
    WHERE ledger.billing_id = b.id
      AND ledger.operation_id NOT LIKE 'linkham-settlement:%'
  ), 0) AS patient_received_amount,
  d.full_name AS doctor_name,
  reviewer.full_name AS reviewed_by_name,
  settler.full_name AS settled_by_name,
  flagger.full_name AS flagged_by_name
`;

const LINKHAM_CLAIM_FROM = `
  FROM billing b
  JOIN patients p ON p.id = b.patient_id
  JOIN consultations c ON c.id = b.consultation_id
  JOIN doctors d ON d.id = c.doctor_id
  LEFT JOIN users reviewer ON reviewer.id = b.linkham_claim_reviewed_by_user_id
  LEFT JOIN users settler ON settler.id = b.linkham_claim_settled_by_user_id
  LEFT JOIN users flagger ON flagger.id = b.dispute_flagged_by_user_id
`;

function formatClaimRow(row) {
  const grossTotal = Number(row.total_amount || 0);
  const total = Number(row.net_amount ?? grossTotal);
  const disputeStatus = normalizeDisputeStatus(row.dispute_status);
  const policyNumber = String(row.insurance_policy_number || "").trim();
  const patientCopayAmount = roundMoney(
    row.linkham_patient_share_amount == null ? total * 0.2 : row.linkham_patient_share_amount,
  );
  const calculatedLinkhamShare = roundMoney(
    row.linkham_share_amount_snapshot == null
      ? total - patientCopayAmount
      : row.linkham_share_amount_snapshot,
  );
  const linkhamShareAmount = ["approved", "settled"].includes(row.linkham_claim_status)
    && row.linkham_approved_share_amount != null
    ? roundMoney(row.linkham_approved_share_amount)
    : calculatedLinkhamShare;
  const visitDate = String(row.visit_date || "").trim();
  const today = new Date(`${getTodayLocal()}T00:00:00`);
  const visited = /^\d{4}-\d{2}-\d{2}$/.test(visitDate)
    ? new Date(`${visitDate}T00:00:00`)
    : null;
  const ageDays = visited && !Number.isNaN(visited.getTime())
    ? Math.max(0, Math.floor((today.getTime() - visited.getTime()) / 86_400_000))
    : 0;
  return {
    id: Number(row.id),
    visit_date: row.visit_date || null,
    patient_name: row.patient_name,
    patient_identifier: row.patient_identifier || "",
    patient_id_number: row.patient_id_number || "",
    id_short: row.patient_identifier || `BILL-${row.id}`,
    policy_number: policyNumber,
    has_policy_number: Boolean(policyNumber),
    doctor_name: row.doctor_name || "",
    total_amount: roundMoney(total),
    gross_total_amount: roundMoney(grossTotal),
    refunded_amount: roundMoney(Math.max(0, grossTotal - total)),
    patient_copay_amount: patientCopayAmount,
    linkham_share_amount: linkhamShareAmount,
    billing_status: row.billing_status,
    linkham_claim_status: row.linkham_claim_status || "pending",
    dispute_status: disputeStatus,
    dispute_reason: disputeStatus === "Flagged_Review" ? String(row.dispute_reason || "").trim() : "",
    copay_paid: Number(row.patient_received_amount || 0) + 0.000001 >= patientCopayAmount,
    patient_paid_amount: roundMoney(row.patient_received_amount || 0),
    coverage_status_snapshot: row.linkham_coverage_status_snapshot || "legacy_paid",
    coverage_verified_at: row.linkham_coverage_verified_at || null,
    reviewed_at: row.linkham_claim_reviewed_at || null,
    reviewed_by_name: row.reviewed_by_name || "",
    settled_at: row.linkham_claim_settled_at || null,
    settled_by_name: row.settled_by_name || "",
    settlement_amount: roundMoney(row.linkham_settlement_amount || 0),
    settlement_reference: row.linkham_settlement_reference || "",
    settlement_date: row.linkham_settlement_date || null,
    flagged_at: row.dispute_flagged_at || null,
    flagged_by_name: row.flagged_by_name || "",
    age_days: ageDays,
  };
}

function listRecentPolicyActivity(limit = 8) {
  return db
    .prepare(`
      SELECT
        audit.id,
        audit.action,
        audit.outcome,
        audit.previous_outcome,
        audit.policy_number,
        audit.national_id,
        audit.created_at,
        COALESCE(NULLIF(trim(policy.holder_name), ''), 'Policy holder not recorded') AS holder_name,
        COALESCE(NULLIF(trim(actor.full_name), ''), 'Linkham operator') AS actor_name
      FROM linkham_policy_audit_log audit
      LEFT JOIN linkham_policies policy ON policy.id = audit.policy_id
      LEFT JOIN users actor ON actor.id = audit.actor_user_id
      WHERE audit.action IN ('created', 'updated')
      ORDER BY audit.created_at DESC, audit.id DESC
      LIMIT ?
    `)
    .all(Math.max(1, Math.min(Number(limit || 8), 20)))
    .map((row) => ({
      id: Number(row.id),
      action: row.action,
      coverage_status: row.outcome,
      previous_coverage_status: row.previous_outcome || "",
      policy_number: row.policy_number || "",
      national_id: row.national_id || "",
      holder_name: row.holder_name,
      actor_name: row.actor_name,
      created_at: row.created_at,
    }));
}

function resolveMauritiusRegion(locationText) {
  const normalized = String(locationText || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const region of MAURITIUS_REGIONS) {
    if (region.aliases.some((alias) => normalized.includes(alias))) {
      return region;
    }
  }

  return {
    id: "unspecified",
    name: String(locationText || "Unspecified").trim() || "Unspecified",
    x: 50,
    y: 50,
    aliases: [],
  };
}

function getLinkhamBudgetExposure() {
  const monthStart = getMonthStartLocal();
  const currentMonthClaimsTotal = roundMoney(
    db
      .prepare(`
        SELECT COALESCE(SUM(${LINKHAM_SHARE_AMOUNT_SQL}), 0) AS total
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        JOIN consultations c ON c.id = b.consultation_id
        WHERE ${LINKHAM_CLAIM_SQL}
          AND c.consultation_date >= date(?)
      `)
      .get(monthStart)?.total || 0,
  );

  const monthlyThreshold = LINKHAM_MONTHLY_BUDGET_THRESHOLD;
  const exposurePercent =
    monthlyThreshold > 0
      ? roundMoney((currentMonthClaimsTotal / monthlyThreshold) * 100)
      : 0;
  const thresholdWarningLevel = exposurePercent >= 80;

  return {
    monthlyThreshold,
    currentMonthClaimsTotal,
    exposurePercent,
    thresholdWarningLevel,
    remainingBudget: roundMoney(Math.max(monthlyThreshold - currentMonthClaimsTotal, 0)),
  };
}

function getLinkhamGeographicHeatmap() {
  const recentStart = offsetLocalDate(-13);
  const priorStart = offsetLocalDate(-27);
  const priorEnd = offsetLocalDate(-14);

  const rows = db
    .prepare(`
      SELECT
        COALESCE(NULLIF(trim(p.location), ''), (
          SELECT l.name
          FROM patient_locations pl
          JOIN locations l ON l.id = pl.location_id
          WHERE pl.patient_id = p.id
            AND l.category = 'Village'
          ORDER BY l.name ASC
          LIMIT 1
        ), 'Unspecified') AS location_label,
        c.consultation_date
      FROM consultations c
      JOIN patients p ON p.id = c.patient_id
      WHERE p.deleted_at IS NULL
        AND ${LINKHAM_PATIENT_SQL}
        AND c.consultation_date >= date(?)
    `)
    .all(priorStart);

  const regionMap = new Map(
    MAURITIUS_REGIONS.map((region) => [
      region.id,
      {
        ...region,
        case_count: 0,
        recent_count: 0,
        prior_count: 0,
        intensity: 0,
      },
    ]),
  );

  rows.forEach((row) => {
    const region = resolveMauritiusRegion(row.location_label);
    if (!region || region.id === "unspecified") {
      return;
    }

    const bucket = regionMap.get(region.id);
    if (!bucket) {
      return;
    }

    bucket.case_count += 1;
    if (row.consultation_date >= recentStart) {
      bucket.recent_count += 1;
    } else if (row.consultation_date >= priorStart && row.consultation_date <= priorEnd) {
      bucket.prior_count += 1;
    }
  });

  const clusters = Array.from(regionMap.values())
    .filter((region) => region.case_count > 0)
    .map((region) => {
      const maxRecent = Math.max(...Array.from(regionMap.values()).map((item) => item.recent_count), 1);
      return {
        id: region.id,
        name: region.name,
        x: region.x,
        y: region.y,
        case_count: region.case_count,
        recent_count: region.recent_count,
        prior_count: region.prior_count,
        intensity: Number((region.recent_count / maxRecent).toFixed(2)),
      };
    })
    .sort((left, right) => right.recent_count - left.recent_count);

  let predictiveInsight = {
    region_name: "Mauritius",
    change_percent: 0,
    message:
      "Regional visit density is stable across monitored districts. No acute localized surges detected in the last 14 days.",
  };

  const trendCandidates = clusters
    .map((cluster) => {
      const prior = cluster.prior_count || 0;
      const recent = cluster.recent_count || 0;
      const changePercent =
        prior > 0 ? roundMoney(((recent - prior) / prior) * 100) : recent > 0 ? 100 : 0;
      return { ...cluster, change_percent: changePercent };
    })
    .filter((cluster) => cluster.recent_count > 0)
    .sort((left, right) => right.change_percent - left.change_percent);

  if (trendCandidates.length) {
    const leader = trendCandidates[0];
    predictiveInsight = {
      region_name: leader.name,
      change_percent: leader.change_percent,
      message: `Over the last 14 days, OCS has noted a ${Math.abs(leader.change_percent)}% ${
        leader.change_percent >= 0 ? "increase" : "decrease"
      } in home-visits centered around ${leader.name}. Anticipating a localized rise in nebulizer and chronic antibiotic claims over the coming week.`,
    };
  }

  return {
    clusters,
    predictiveInsight,
  };
}

function formatLinkhamClientRow(row) {
  const village = String(row.village || "").trim() || String(row.location || "").trim();
  const ageFromDob = calculateAgeFromDateOfBirth(row.date_of_birth);
  const ageFromNic = parseMauritianNicAge(row.national_id);

  const hasPolicy = hasPolicyNumber(row.insurance_policy_number);
  const registeredCoverageStatus = String(row.registered_coverage_status || "").trim();
  const coverageStatus = !hasPolicy
    ? "needs_policy"
    : registeredCoverageStatus || "unregistered";

  return {
    id: Number(row.id),
    case_number: row.case_number || `PT-${row.id}`,
    full_name: row.full_name,
    date_of_birth: row.date_of_birth || "",
    national_id: row.national_id || "",
    address: row.address || "",
    village,
    patient_contact_number: row.patient_contact_number || "",
    insurance_provider: row.insurance_provider || "",
    insurance_policy_number: row.insurance_policy_number || "",
    has_policy_number: hasPolicy,
    coverage_status: coverageStatus,
    coverage_allowed: coverageStatus === "green",
    coverage_status_reason: String(row.coverage_status_reason || "").trim(),
    policy_holder_name: String(row.policy_holder_name || "").trim(),
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
          COALESCE(SUM(${LINKHAM_SHARE_AMOUNT_SQL}), 0) AS linkham_outlay
        FROM billing b
        JOIN consultations c ON c.id = b.consultation_id
        JOIN patients p ON p.id = b.patient_id
        WHERE p.deleted_at IS NULL
          AND ${LINKHAM_CLAIM_SQL}
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
        COALESCE(SUM(${LINKHAM_SHARE_AMOUNT_SQL}), 0) AS linkham_outlay
      FROM billing b
      JOIN consultations c ON c.id = b.consultation_id
      JOIN patients p ON p.id = b.patient_id
      WHERE p.deleted_at IS NULL
        AND ${LINKHAM_CLAIM_SQL}
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
        WHERE ${LINKHAM_CLAIM_SQL}
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

  const pendingCleanCount = Number(
    db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        WHERE ${LINKHAM_CLAIM_SQL}
          AND COALESCE(b.linkham_claim_status, 'pending') = 'pending'
          AND COALESCE(b.dispute_status, 'Clean') = 'Clean'
      `)
      .get()?.count || 0,
  );

  const monthlyApprovedAmount = roundMoney(
    db
      .prepare(`
        SELECT COALESCE(SUM(${LINKHAM_SHARE_AMOUNT_SQL}), 0) AS total
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        WHERE ${LINKHAM_CLAIM_SQL}
          AND b.linkham_claim_status = 'approved'
          AND date(COALESCE(b.linkham_claim_reviewed_at, b.payment_date, b.created_at)) >= date(?)
      `)
      .get(monthStart)?.total || 0,
  );

  const monthlyClaimsSettled = roundMoney(
    db
      .prepare(`
        SELECT COALESCE(SUM(${LINKHAM_SHARE_AMOUNT_SQL}), 0) AS total
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        WHERE ${LINKHAM_CLAIM_SQL}
          AND b.linkham_claim_status IN ('approved', 'settled')
          AND date(COALESCE(b.linkham_claim_reviewed_at, b.payment_date, b.created_at)) >= date(?)
      `)
      .get(monthStart)?.total || 0,
  );

  const approvedAwaitingPayment = db
    .prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(${LINKHAM_SHARE_AMOUNT_SQL}), 0) AS total
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      WHERE ${LINKHAM_CLAIM_SQL}
        AND b.linkham_claim_status = 'approved'
    `)
    .get();

  const settledThisMonth = db
    .prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(${LINKHAM_SHARE_AMOUNT_SQL}), 0) AS total
      FROM billing b
      JOIN patients p ON p.id = b.patient_id
      WHERE ${LINKHAM_CLAIM_SQL}
        AND b.linkham_claim_status = 'settled'
        AND date(COALESCE(b.linkham_claim_settled_at, b.updated_at, b.created_at)) >= date(?)
    `)
    .get(monthStart);

  const policySummary = db
    .prepare(`
      SELECT
        SUM(CASE WHEN coverage_status = 'green' THEN 1 ELSE 0 END) AS green_count,
        SUM(CASE WHEN coverage_status = 'red' THEN 1 ELSE 0 END) AS red_count
      FROM linkham_policies
    `)
    .get();

  const unregisteredPolicyCount = Number(
    db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM patients p
        WHERE p.deleted_at IS NULL
          AND ${LINKHAM_PATIENT_SQL}
          AND p.insurance_policy_number IS NOT NULL
          AND trim(p.insurance_policy_number) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM linkham_policies policy
            WHERE upper(replace(trim(policy.policy_number), ' ', '')) = upper(replace(trim(p.insurance_policy_number), ' ', ''))
              AND upper(replace(trim(policy.national_id), ' ', '')) = upper(replace(trim(p.patient_id_number), ' ', ''))
          )
      `)
      .get()?.count || 0,
  );

  const outstandingEightyLedger = roundMoney(
    db
      .prepare(`
        SELECT COALESCE(SUM(${LINKHAM_SHARE_AMOUNT_SQL}), 0) AS total
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        WHERE ${LINKHAM_CLAIM_SQL}
          AND COALESCE(b.linkham_claim_status, 'pending') = 'pending'
      `)
      .get()?.total || 0,
  );

  const outstandingCleanEightyLedger = roundMoney(
    db
      .prepare(`
        SELECT COALESCE(SUM(${LINKHAM_SHARE_AMOUNT_SQL}), 0) AS total
        FROM billing b
        JOIN patients p ON p.id = b.patient_id
        WHERE ${LINKHAM_CLAIM_SQL}
          AND COALESCE(b.linkham_claim_status, 'pending') = 'pending'
          AND COALESCE(b.dispute_status, 'Clean') = 'Clean'
      `)
      .get()?.total || 0,
  );

  return {
    currentMonthName,
    monthlySeenPatientsCount,
    pendingClaimsCount,
    pendingCleanCount,
    monthlyApprovedAmount,
    approvedAwaitingPaymentCount: Number(approvedAwaitingPayment?.count || 0),
    approvedAwaitingPaymentAmount: roundMoney(approvedAwaitingPayment?.total || 0),
    settledThisMonthCount: Number(settledThisMonth?.count || 0),
    settledThisMonthAmount: roundMoney(settledThisMonth?.total || 0),
    dueLongTermReviews: listLinkhamDueLongTermReviews(),
    flaggedClaimsCount: Number(
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM billing b
          JOIN patients p ON p.id = b.patient_id
          WHERE ${LINKHAM_CLAIM_SQL}
            AND COALESCE(b.linkham_claim_status, 'pending') = 'pending'
            AND COALESCE(b.dispute_status, 'Clean') = 'Flagged_Review'
        `)
        .get()?.count || 0,
    ),
    missingPolicyCount: Number(
      db
        .prepare(`
          SELECT COUNT(*) AS count
          FROM patients p
          WHERE p.deleted_at IS NULL
            AND ${LINKHAM_PATIENT_SQL}
            AND (p.insurance_policy_number IS NULL OR trim(p.insurance_policy_number) = '')
        `)
        .get()?.count || 0,
    ),
    unregisteredPolicyCount,
    greenPolicyCount: Number(policySummary?.green_count || 0),
    redPolicyCount: Number(policySummary?.red_count || 0),
    flaggedClaims: listLinkhamClaims({ status: "flagged" }).slice(0, 8),
    pendingClaims: listLinkhamClaims({ status: "pending" })
      .sort((left, right) => Number(right.age_days || 0) - Number(left.age_days || 0))
      .slice(0, 8),
    missingPolicies: listLinkhamPatients({ missingPolicy: true, limit: 8 }),
    unregisteredPolicies: listLinkhamPatients({ coverageStatus: "unregistered", limit: 8 }),
    redPolicies: listLinkhamPolicies({ status: "red", limit: 8 }),
    recentPolicyActivity: listRecentPolicyActivity(8),
    budgetExposure: getLinkhamBudgetExposure(),
    totalInsuredClients,
    monthlyClaimsSettled,
    outstandingEightyLedger,
    outstandingCleanEightyLedger,
    currentMonthKey: monthStart.slice(0, 7),
    refreshedAt: new Date().toISOString(),
  };
}

function getLinkhamAnalyticsReports({ seenTimeFilter = "month", claimsTimeFilter = "month" } = {}) {
  const seenPeriod = mapSeenTimeFilter(seenTimeFilter);
  const claimsPeriod = mapClaimsTimeFilter(claimsTimeFilter);
  const seenRange = getLinkhamReportRange(seenPeriod);
  const claimsRange = getLinkhamReportRange(claimsPeriod);

  const geographicHeatmap = getLinkhamGeographicHeatmap();

  return {
    seenTimeFilter: seenTimeFilter || "month",
    claimsTimeFilter: claimsTimeFilter || "month",
    seenRangeLabel: seenRange.label,
    claimsRangeLabel: claimsRange.label,
    patientsSeen: getLinkhamPatientsSeenVolume(seenPeriod, seenRange),
    locationDistribution: getLinkhamLocationDistribution(seenRange),
    claimsVolume: getLinkhamClaimsVolume(claimsPeriod, claimsRange),
    geographicHeatmap,
    predictiveInsight: geographicHeatmap.predictiveInsight,
  };
}

function listLinkhamPatients({ search = "", missingPolicy = false, coverageStatus = "", limit = 0 } = {}) {
  const term = normalizeSearchTerm(search);
  const params = {};
  const filters = [`p.deleted_at IS NULL`, LINKHAM_PATIENT_SQL];

  if (missingPolicy) {
    filters.push("(p.insurance_policy_number IS NULL OR trim(p.insurance_policy_number) = '')");
  }

  if (coverageStatus === "unregistered") {
    filters.push(`
      p.insurance_policy_number IS NOT NULL
      AND trim(p.insurance_policy_number) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM linkham_policies lp
        WHERE upper(replace(trim(lp.policy_number), ' ', '')) = upper(replace(trim(p.insurance_policy_number), ' ', ''))
          AND upper(replace(trim(lp.national_id), ' ', '')) = upper(replace(trim(p.patient_id_number), ' ', ''))
      )
    `);
  }

  if (term) {
    params.search = `%${term}%`;
    filters.push(`(
      lower(p.full_name) LIKE @search
      OR lower(COALESCE(p.patient_identifier, '')) LIKE @search
      OR lower(COALESCE(p.patient_id_number, '')) LIKE @search
      OR lower(COALESCE(p.insurance_policy_number, '')) LIKE @search
    )`);
  }

  const normalizedLimit = Math.max(0, Math.min(Number(limit || 0), 5000));
  if (normalizedLimit) {
    params.limit = normalizedLimit;
  }

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
        p.insurance_provider,
        p.insurance_policy_number,
        (
          SELECT lp.coverage_status
          FROM linkham_policies lp
          WHERE upper(replace(trim(lp.policy_number), ' ', '')) = upper(replace(trim(p.insurance_policy_number), ' ', ''))
            AND upper(replace(trim(lp.national_id), ' ', '')) = upper(replace(trim(p.patient_id_number), ' ', ''))
          LIMIT 1
        ) AS registered_coverage_status,
        (
          SELECT lp.status_reason
          FROM linkham_policies lp
          WHERE upper(replace(trim(lp.policy_number), ' ', '')) = upper(replace(trim(p.insurance_policy_number), ' ', ''))
            AND upper(replace(trim(lp.national_id), ' ', '')) = upper(replace(trim(p.patient_id_number), ' ', ''))
          LIMIT 1
        ) AS coverage_status_reason,
        (
          SELECT lp.holder_name
          FROM linkham_policies lp
          WHERE upper(replace(trim(lp.policy_number), ' ', '')) = upper(replace(trim(p.insurance_policy_number), ' ', ''))
            AND upper(replace(trim(lp.national_id), ' ', '')) = upper(replace(trim(p.patient_id_number), ' ', ''))
          LIMIT 1
        ) AS policy_holder_name,
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
      WHERE ${filters.join(" AND ")}
      ORDER BY p.created_at DESC, p.full_name ASC
      ${normalizedLimit ? "LIMIT @limit" : ""}
    `)
    .all(params)
    .map(formatLinkhamClientRow);
}

function getLinkhamPatientFinancing(patientId) {
  const visits = db
    .prepare(`
      SELECT ${LINKHAM_CLAIM_SELECT}
      ${LINKHAM_CLAIM_FROM}
      WHERE b.patient_id = ?
        AND ${LINKHAM_CLAIM_SQL}
      ORDER BY c.consultation_date DESC, b.id DESC
    `)
    .all(Number(patientId))
    .map(formatClaimRow);

  const patientCopayCollected = visits.reduce(
    (sum, visit) => sum + Math.min(visit.patient_paid_amount, visit.patient_copay_amount),
    0,
  );
  const linkhamCoverageObligation = visits.reduce(
    (sum, visit) => sum + visit.linkham_share_amount,
    0,
  );
  const linkhamApprovedAmount = visits
    .filter((visit) => ["approved", "settled"].includes(visit.linkham_claim_status))
    .reduce((sum, visit) => sum + visit.linkham_share_amount, 0);
  const linkhamOutstandingAmount = visits
    .filter((visit) => visit.linkham_claim_status !== "settled")
    .reduce((sum, visit) => sum + visit.linkham_share_amount, 0);

  return {
    total_visit_amount: roundMoney(visits.reduce((sum, visit) => sum + visit.total_amount, 0)),
    patient_copay_collected: roundMoney(patientCopayCollected),
    linkham_coverage_obligation: roundMoney(linkhamCoverageObligation),
    linkham_approved_amount: roundMoney(linkhamApprovedAmount),
    linkham_outstanding_amount: roundMoney(linkhamOutstandingAmount),
    visits: visits.map((visit) => ({
      billing_id: visit.id,
      visit_date: visit.visit_date,
      total_amount: visit.total_amount,
      gross_total_amount: visit.gross_total_amount,
      refunded_amount: visit.refunded_amount,
      patient_copay_amount: visit.patient_copay_amount,
      linkham_share_amount: visit.linkham_share_amount,
      copay_collected: visit.copay_paid,
      claim_status: visit.linkham_claim_status,
    })),
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
        p.insurance_provider,
        p.insurance_policy_number,
        (
          SELECT lp.coverage_status
          FROM linkham_policies lp
          WHERE upper(replace(trim(lp.policy_number), ' ', '')) = upper(replace(trim(p.insurance_policy_number), ' ', ''))
            AND upper(replace(trim(lp.national_id), ' ', '')) = upper(replace(trim(p.patient_id_number), ' ', ''))
          LIMIT 1
        ) AS registered_coverage_status,
        (
          SELECT lp.status_reason
          FROM linkham_policies lp
          WHERE upper(replace(trim(lp.policy_number), ' ', '')) = upper(replace(trim(p.insurance_policy_number), ' ', ''))
            AND upper(replace(trim(lp.national_id), ' ', '')) = upper(replace(trim(p.patient_id_number), ' ', ''))
          LIMIT 1
        ) AS coverage_status_reason,
        (
          SELECT lp.holder_name
          FROM linkham_policies lp
          WHERE upper(replace(trim(lp.policy_number), ' ', '')) = upper(replace(trim(p.insurance_policy_number), ' ', ''))
            AND upper(replace(trim(lp.national_id), ' ', '')) = upper(replace(trim(p.patient_id_number), ' ', ''))
          LIMIT 1
        ) AS policy_holder_name,
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
  const caseHistoryRecords = db
    .prepare(`
      SELECT
        d.full_name AS doctor_name,
        c.doctor_notes AS raw_text,
        c.consultation_date AS visit_date
      FROM consultations c
      JOIN doctors d ON d.id = c.doctor_id
      WHERE c.patient_id = ?
        AND c.doctor_notes IS NOT NULL
        AND trim(c.doctor_notes) <> ''
      ORDER BY c.consultation_date ASC, c.id ASC
    `)
    .all(client.id);

  const treatmentSummaries = buildInsurerTreatmentSummaries(caseHistoryRecords);
  const icd10Match = resolveIcd10FromText(
    ...treatmentSummaries.map((item) => item.diagnosis),
  );

  return {
    ...client,
    treatment_summaries: treatmentSummaries,
    active_icd10_code: icd10Match?.code || null,
    active_icd10_label: icd10Match?.label || null,
    financing: getLinkhamPatientFinancing(client.id),
  };
}

function buildClaimQueryFilters({ status = "all", month = "", search = "" } = {}) {
  const statusFilter = normalizeClaimStatusFilter(status);
  const monthBounds = parseYearMonth(month);
  const term = normalizeSearchTerm(search);
  const clauses = [LINKHAM_CLAIM_SQL];
  const params = {};

  clauses.push(...claimStatusClauses(statusFilter));

  if (monthBounds) {
    params.monthStart = monthBounds.start;
    params.monthNext = monthBounds.nextStart;
    if (statusFilter === "approved") {
      clauses.push(
        "date(COALESCE(b.linkham_claim_reviewed_at, b.payment_date, b.created_at)) >= date(@monthStart)",
      );
      clauses.push(
        "date(COALESCE(b.linkham_claim_reviewed_at, b.payment_date, b.created_at)) < date(@monthNext)",
      );
    } else if (statusFilter === "settled") {
      clauses.push(
        "date(COALESCE(b.linkham_claim_settled_at, b.linkham_claim_reviewed_at, b.payment_date, b.created_at)) >= date(@monthStart)",
      );
      clauses.push(
        "date(COALESCE(b.linkham_claim_settled_at, b.linkham_claim_reviewed_at, b.payment_date, b.created_at)) < date(@monthNext)",
      );
    } else {
      clauses.push("c.consultation_date >= date(@monthStart)");
      clauses.push("c.consultation_date < date(@monthNext)");
    }
  }

  if (term) {
    params.search = `%${term}%`;
    clauses.push(`(
      lower(p.full_name) LIKE @search
      OR lower(COALESCE(p.patient_identifier, '')) LIKE @search
      OR lower(COALESCE(p.insurance_policy_number, '')) LIKE @search
    )`);
  }

  return {
    statusFilter,
    monthBounds,
    whereSql: clauses.join(" AND "),
    params,
  };
}

function listLinkhamClaims(options = {}) {
  const { whereSql, params } = buildClaimQueryFilters({
    status: options.status == null ? "all" : options.status,
    month: options.month,
    search: options.search,
  });

  return db
    .prepare(`
      SELECT ${LINKHAM_CLAIM_SELECT}
      ${LINKHAM_CLAIM_FROM}
      WHERE ${whereSql}
      ORDER BY c.consultation_date DESC, b.id DESC
    `)
    .all(params)
    .map(formatClaimRow);
}

function getLinkhamClaimById(claimId) {
  const row = db
    .prepare(`
      SELECT ${LINKHAM_CLAIM_SELECT}
      ${LINKHAM_CLAIM_FROM}
      WHERE b.id = ?
        AND ${LINKHAM_CLAIM_SQL}
    `)
    .get(Number(claimId || 0));

  if (!row) {
    return null;
  }

  return formatClaimRow(row);
}

function summarizeLinkhamClaimsLedger(claims = []) {
  const pendingClaims = claims.filter((claim) => claim.linkham_claim_status === "pending");
  const cleanPendingClaims = pendingClaims.filter((claim) => claim.dispute_status === "Clean");
  const flaggedPendingClaims = pendingClaims.filter(
    (claim) => claim.dispute_status === "Flagged_Review",
  );
  const approvedClaims = claims.filter((claim) => claim.linkham_claim_status === "approved");
  const settledClaims = claims.filter((claim) => claim.linkham_claim_status === "settled");

  return {
    totalOutstandingClaims: roundMoney(
      pendingClaims.reduce((sum, claim) => sum + Number(claim.linkham_share_amount || 0), 0),
    ),
    clearableBatchTotal: roundMoney(
      cleanPendingClaims.reduce((sum, claim) => sum + Number(claim.linkham_share_amount || 0), 0),
    ),
    approvedShareTotal: roundMoney(
      approvedClaims.reduce((sum, claim) => sum + Number(claim.linkham_share_amount || 0), 0),
    ),
    settledShareTotal: roundMoney(
      settledClaims.reduce((sum, claim) => sum + Number(claim.linkham_share_amount || 0), 0),
    ),
    pendingCount: cleanPendingClaims.length,
    cleanPendingCount: cleanPendingClaims.length,
    flaggedPendingCount: flaggedPendingClaims.length,
    approvedCount: approvedClaims.length,
    settledCount: settledClaims.length,
  };
}

function setLinkhamClaimDisputeStatus(claimId, disputeStatus, { reason = "", userId = null } = {}) {
  const existing = getLinkhamClaimById(claimId);
  if (!existing) {
    return { error: "not_found" };
  }

  if (existing.linkham_claim_status === "approved" || existing.linkham_claim_status === "settled") {
    return { error: "locked" };
  }

  const normalizedStatus = normalizeDisputeStatus(disputeStatus);
  const trimmedReason = String(reason || "").trim();

  if (normalizedStatus === "Flagged_Review" && !trimmedReason) {
    return { error: "reason_required" };
  }

  if (normalizedStatus === "Flagged_Review") {
    db.prepare(`
      UPDATE billing
      SET
        dispute_status = 'Flagged_Review',
        dispute_reason = ?,
        dispute_flagged_at = CURRENT_TIMESTAMP,
        dispute_flagged_by_user_id = ?
      WHERE id = ?
    `).run(trimmedReason.slice(0, 500), userId ? Number(userId) : null, Number(claimId));
  } else {
    db.prepare(`
      UPDATE billing
      SET
        dispute_status = 'Clean',
        dispute_reason = NULL,
        dispute_flagged_at = NULL,
        dispute_flagged_by_user_id = NULL
      WHERE id = ?
    `).run(Number(claimId));
  }

  return { claim: getLinkhamClaimById(claimId) };
}

function approveLinkhamClaim(claimId, userId = null) {
  const existing = getLinkhamClaimById(claimId);

  if (!existing) {
    return null;
  }

  if (existing.dispute_status === "Flagged_Review") {
    return null;
  }

  if (existing.linkham_claim_status === "approved" || existing.linkham_claim_status === "settled") {
    return existing;
  }

  db.prepare(`
    UPDATE billing
    SET
      linkham_claim_status = 'approved',
      linkham_approved_share_amount = ?,
      linkham_claim_reviewed_at = CURRENT_TIMESTAMP,
      linkham_claim_reviewed_by_user_id = ?
    WHERE id = ?
  `).run(existing.linkham_share_amount, userId ? Number(userId) : null, Number(claimId));

  return getLinkhamClaimById(claimId);
}

function validateSettlementDate(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return "";
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) return "";
  return normalized;
}

function settleLinkhamClaim(claimId, userId = null, settlement = {}) {
  const existing = getLinkhamClaimById(claimId);
  if (!existing) {
    return null;
  }
  if (existing.linkham_claim_status === "settled") {
    return existing;
  }
  if (existing.linkham_claim_status !== "approved") {
    return null;
  }

  const paymentDate = validateSettlementDate(settlement.payment_date);
  const remittanceReference = String(settlement.remittance_reference || "").trim().slice(0, 120);
  const amount = settlement.amount == null || settlement.amount === ""
    ? Number(existing.linkham_share_amount)
    : Number(settlement.amount);
  if (!paymentDate || paymentDate > getTodayLocal()) {
    throw Object.assign(new Error("Enter a valid non-future Linkham payment date."), { status: 400 });
  }
  if (remittanceReference.length < 3) {
    throw Object.assign(new Error("Enter the Linkham bank transfer or remittance reference."), { status: 400 });
  }
  if (!Number.isFinite(amount) || Math.abs(amount - Number(existing.linkham_share_amount)) > 0.009) {
    throw Object.assign(new Error(`The settlement amount must match the approved Linkham share of Rs ${Number(existing.linkham_share_amount).toFixed(2)}.`), { status: 409 });
  }

  const transactionReference = `${remittanceReference}/${Number(claimId)}`;
  const operationId = `linkham-settlement:${Number(claimId)}:${remittanceReference}`;
  const actor = userId
    ? db.prepare("SELECT id, full_name, role FROM users WHERE id = ?").get(Number(userId))
    : null;

  db.transaction(() => {
    const closedDay = db.prepare("SELECT id FROM financial_day_closings WHERE business_date = ?").get(paymentDate);
    if (closedDay) {
      throw Object.assign(new Error(`The finance day for ${paymentDate} is closed.`), { status: 409 });
    }

    const bill = db.prepare("SELECT * FROM billing WHERE id = ? AND voided_at IS NULL").get(Number(claimId));
    if (!bill) throw Object.assign(new Error("Claim invoice is no longer active."), { status: 409 });
    const received = roundMoney(db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM billing_payment_ledger
      WHERE billing_id = ?
    `).get(Number(claimId))?.total || 0);
    const outstanding = roundMoney(Math.max(0, Number(bill.total_amount || 0) - received));

    if (bill.status !== "paid") {
      if (outstanding + 0.000001 < amount) {
        throw Object.assign(new Error("The invoice balance is smaller than the approved Linkham settlement. Finance must review it before settlement."), { status: 409 });
      }
      db.prepare(`
        INSERT INTO billing_payment_transactions (
          billing_id, amount, payment_method, payment_date, external_reference,
          operation_id, recorded_by_user_id, recorded_by_name, recorded_by_role, source
        ) VALUES (?, ?, 'ib', ?, ?, ?, ?, ?, ?, 'recorded')
      `).run(
        Number(claimId),
        roundMoney(amount),
        paymentDate,
        transactionReference,
        operationId,
        actor?.id || null,
        String(actor?.full_name || "Linkham insurer"),
        String(actor?.role || "linkham_admin"),
      );
    }

    const totalReceived = roundMoney(db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM billing_payment_ledger
      WHERE billing_id = ?
    `).get(Number(claimId))?.total || 0);
    db.prepare(`
      UPDATE billing
      SET linkham_claim_status = 'settled',
          linkham_claim_settled_at = CURRENT_TIMESTAMP,
          linkham_claim_settled_by_user_id = ?,
          linkham_settlement_amount = ?,
          linkham_settlement_reference = ?,
          linkham_settlement_date = ?,
          status = CASE WHEN status = 'paid' OR ? + 0.000001 >= total_amount THEN 'paid' ELSE 'unpaid' END,
          payment_method = CASE WHEN status = 'paid' THEN payment_method WHEN ? + 0.000001 >= total_amount THEN 'ib' ELSE payment_method END,
          payment_date = CASE WHEN status = 'paid' THEN payment_date WHEN ? + 0.000001 >= total_amount THEN ? ELSE payment_date END,
          updated_at = CURRENT_TIMESTAMP,
          updated_by_user_id = ?
      WHERE id = ? AND linkham_claim_status = 'approved'
    `).run(
      actor?.id || null,
      roundMoney(amount),
      remittanceReference,
      paymentDate,
      totalReceived,
      totalReceived,
      totalReceived,
      paymentDate,
      actor?.id || null,
      Number(claimId),
    );
  }).immediate();

  return getLinkhamClaimById(claimId);
}

function approveLinkhamCleanClaimsBatch(userId = null) {
  const cleanPendingClaims = listLinkhamClaims({ status: "pending" });

  if (!cleanPendingClaims.length) {
    return { approvedCount: 0, approvedClaims: [] };
  }

  const approveStatement = db.prepare(`
    UPDATE billing
    SET
      linkham_claim_status = 'approved',
      linkham_approved_share_amount = ?,
      linkham_claim_reviewed_at = CURRENT_TIMESTAMP,
      linkham_claim_reviewed_by_user_id = ?
    WHERE id = ?
      AND COALESCE(dispute_status, 'Clean') = 'Clean'
      AND COALESCE(linkham_claim_status, 'pending') = 'pending'
  `);

  const approvedClaims = [];

  db.transaction(() => {
    cleanPendingClaims.forEach((claim) => {
      const result = approveStatement.run(
        Number(claim.linkham_share_amount),
        userId ? Number(userId) : null,
        Number(claim.id),
      );
      if (result.changes > 0) {
        approvedClaims.push(getLinkhamClaimById(claim.id));
      }
    });
  })();

  return {
    approvedCount: approvedClaims.length,
    approvedClaims,
  };
}

function settleLinkhamApprovedClaimsBatch(userId = null, { month = "", ...settlement } = {}) {
  const approvedClaims = listLinkhamClaims({ status: "approved", month });
  if (!approvedClaims.length) {
    return { settledCount: 0, settledClaims: [] };
  }

  const settledClaims = [];
  db.transaction(() => {
    approvedClaims.forEach((claim) => {
      const settled = settleLinkhamClaim(claim.id, userId, {
        ...settlement,
        amount: claim.linkham_share_amount,
      });
      if (settled) settledClaims.push(settled);
    });
  })();

  return {
    settledCount: settledClaims.length,
    settledClaims,
  };
}

function buildLinkhamStatementCsv(claims = []) {
  const headers = [
    "Visit date",
    "Patient",
    "OCS number",
    "Policy number",
    "Doctor",
    "Total",
    "Patient copay 20%",
    "Linkham share 80%",
    "Claim status",
    "Dispute",
    "Dispute reason",
    "Approved by",
    "Approved at",
    "Settled by",
    "Settled at",
    "Settlement date",
    "Settlement amount",
    "Remittance reference",
  ];

  const lines = [headers.map(csvEscape).join(",")];
  claims.forEach((claim) => {
    lines.push(
      [
        claim.visit_date || "",
        claim.patient_name || "",
        claim.patient_identifier || "",
        claim.policy_number || "",
        claim.doctor_name || "",
        claim.total_amount,
        claim.patient_copay_amount,
        claim.linkham_share_amount,
        claim.linkham_claim_status || "",
        claim.dispute_status || "",
        claim.dispute_reason || "",
        claim.reviewed_by_name || "",
        claim.reviewed_at || "",
        claim.settled_by_name || "",
        claim.settled_at || "",
        claim.settlement_date || "",
        claim.settlement_amount || "",
        claim.settlement_reference || "",
      ]
        .map(csvEscape)
        .join(","),
    );
  });

  return `${lines.join("\n")}\n`;
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
  approveLinkhamCleanClaimsBatch,
  backfillLinkhamInsuranceFromTags,
  buildLinkhamStatementCsv,
  getLinkhamAnalyticsReports,
  getLinkhamClaimById,
  getLinkhamDashboardMetrics,
  getLinkhamPatientById,
  isLinkhamInsuranceProvider,
  listLinkhamClaims,
  listLinkhamPatients,
  setLinkhamClaimDisputeStatus,
  settleLinkhamApprovedClaimsBatch,
  settleLinkhamClaim,
  summarizeLinkhamClaimsLedger,
};
