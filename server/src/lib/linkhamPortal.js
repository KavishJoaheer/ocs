const { db } = require("../db");

const LINKHAM_PATIENT_SQL = "lower(trim(p.insurance_provider)) = 'linkham'";

function getMonthStartLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
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
        p.full_name,
        p.patient_identifier,
        p.patient_contact_number,
        p.status,
        p.insurance_provider,
        MAX(c.consultation_date) AS last_visit_date
      FROM patients p
      LEFT JOIN consultations c ON c.patient_id = p.id
      WHERE p.deleted_at IS NULL
        AND ${LINKHAM_PATIENT_SQL}
      GROUP BY
        p.id,
        p.full_name,
        p.patient_identifier,
        p.patient_contact_number,
        p.status,
        p.insurance_provider
      ORDER BY p.full_name ASC
    `)
    .all();
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

module.exports = {
  approveLinkhamClaim,
  getLinkhamClaimById,
  getLinkhamDashboardMetrics,
  listLinkhamClaims,
  listLinkhamPatients,
};
