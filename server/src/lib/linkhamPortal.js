const { db } = require("../db");
const { isLinkhamInsuranceProvider } = require("./insuranceProvider");

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

function getLinkhamDashboardMetrics() {
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

  const monthStart = getMonthStartLocal();

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
    totalInsuredClients,
    monthlyClaimsSettled,
    outstandingEightyLedger,
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
  getLinkhamClaimById,
  getLinkhamDashboardMetrics,
  getLinkhamPatientById,
  isLinkhamInsuranceProvider,
  listLinkhamClaims,
  listLinkhamPatients,
};
