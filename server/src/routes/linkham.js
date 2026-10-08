const express = require("express");
const { db } = require("../db");
const {
  publishLinkhamClaimsChange,
  publishLinkhamPatientsChange,
  publishPatientDataChange,
} = require("../lib/inventoryRealtime");
const {
  approveLinkhamClaim,
  approveLinkhamCleanClaimsBatch,
  buildLinkhamStatementCsv,
  getLinkhamAnalyticsReports,
  getLinkhamClaimById,
  getLinkhamDashboardMetrics,
  getLinkhamPatientById,
  listLinkhamClaims,
  listLinkhamPatients,
  setLinkhamClaimDisputeStatus,
  settleLinkhamApprovedClaimsBatch,
  settleLinkhamClaim,
  summarizeLinkhamClaimsLedger,
} = require("../lib/linkhamPortal");
const {
  createLinkhamPolicy,
  importLinkhamPolicies,
  listLinkhamPolicies,
  lookupLinkhamPolicyCoverage,
  updateLinkhamPolicy,
} = require("../lib/linkhamPolicyRegistry");

const router = express.Router();

function publishPolicyCoverageChanges(changes, changedByUserId = null) {
  publishLinkhamPatientsChange({ changedByUserId });
  const patientIds = new Set();
  changes.forEach(({ policy, previousPolicy = null }) => {
    [policy, previousPolicy].filter(Boolean).forEach((candidate) => {
      db.prepare(`
        SELECT id
        FROM patients
        WHERE deleted_at IS NULL
          AND lower(trim(insurance_provider)) = 'linkham'
          AND (
            upper(trim(insurance_policy_number)) = upper(trim(?))
            OR upper(trim(patient_id_number)) = upper(trim(?))
          )
      `).all(candidate.policy_number || "", candidate.national_id || "")
        .forEach(({ id }) => patientIds.add(Number(id)));
    });
  });
  patientIds.forEach((id) => {
    publishPatientDataChange(Number(id), { reason: "insurance_coverage", changedByUserId });
  });
}

function publishPolicyCoverageChange(policy, changedByUserId = null, previousPolicy = null) {
  if (!policy) return;
  publishPolicyCoverageChanges([{ policy, previousPolicy }], changedByUserId);
}

function publishPatientBillingChangeForClaim(claim) {
  const billingId = Number(claim?.id || 0);
  if (!billingId) {
    return;
  }

  const row = db.prepare("SELECT patient_id FROM billing WHERE id = ?").get(billingId);
  if (row?.patient_id) {
    publishPatientDataChange(row.patient_id, { reason: "billing" });
  }
}

function publishPatientBillingChangesForClaims(claims = []) {
  const patientIds = new Set();

  claims.forEach((claim) => {
    const billingId = Number(claim?.id || 0);
    if (!billingId) {
      return;
    }

    const row = db.prepare("SELECT patient_id FROM billing WHERE id = ?").get(billingId);
    if (row?.patient_id) {
      patientIds.add(Number(row.patient_id));
    }
  });

  patientIds.forEach((patientId) => {
    publishPatientDataChange(patientId, { reason: "billing" });
  });
}

function parseMissingPolicyFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function claimsQueryFromRequest(req) {
  return {
    status: req.query.status,
    month: req.query.month,
    search: req.query.search,
  };
}

function buildClaimSummaryPayload(claim) {
  return {
    title: "Linkham Coverage Verification Summary",
    visit_date: claim.visit_date,
    patient_name: claim.patient_name,
    patient_identifier: claim.patient_identifier,
    visit_id: claim.id_short,
    policy_number: claim.policy_number,
    doctor_name: claim.doctor_name,
    total_amount: claim.total_amount,
    patient_copay_amount: claim.patient_copay_amount,
    linkham_share_amount: claim.linkham_share_amount,
    claim_status: claim.linkham_claim_status,
    dispute_status: claim.dispute_status,
    dispute_reason: claim.dispute_reason,
    reviewed_at: claim.reviewed_at,
    reviewed_by_name: claim.reviewed_by_name,
    settled_at: claim.settled_at,
    settled_by_name: claim.settled_by_name,
    flagged_at: claim.flagged_at,
    flagged_by_name: claim.flagged_by_name,
    generated_at: new Date().toISOString(),
  };
}

router.get("/dashboard", (_req, res) => {
  res.json(getLinkhamDashboardMetrics());
});

router.get("/reports", (req, res) => {
  res.json(
    getLinkhamAnalyticsReports({
      seenTimeFilter: req.query.seenFilter,
      claimsTimeFilter: req.query.claimsFilter,
    }),
  );
});

router.get("/policies", (req, res) => {
  res.json({
    policies: listLinkhamPolicies({
      search: req.query.search,
      status: req.query.status,
    }),
  });
});

router.get("/policy-lookup", (req, res) => {
  const coverages = lookupLinkhamPolicyCoverage({
    policyNumber: req.query.policy_number,
    nationalId: req.query.national_id,
    actorUserId: req.auth.id,
  });
  res.json({ coverages });
});

router.post("/policies", (req, res) => {
  const result = createLinkhamPolicy(req.body, req.auth.id);
  if (result.error) {
    const status = result.error === "duplicate" ? 409 : 400;
    return res.status(status).json({ error: result.message, code: result.error });
  }

  publishPolicyCoverageChange(result.policy, req.auth.id);
  res.status(201).json({ policy: result.policy });
});

router.post("/policies/import", (req, res) => {
  const result = importLinkhamPolicies(req.body?.rows, req.auth.id);
  if (result.error) {
    return res.status(400).json({
      error: result.message,
      code: result.error,
      errors: result.errors || [],
    });
  }

  publishPolicyCoverageChanges(
    result.changes.map((change) => ({
      policy: change.policy,
      previousPolicy: change.previous_policy,
    })),
    req.auth.id,
  );
  res.json({
    createdCount: result.createdCount,
    updatedCount: result.updatedCount,
    unchangedCount: result.unchangedCount,
  });
});

router.put("/policies/:id", (req, res) => {
  const result = updateLinkhamPolicy(req.params.id, req.body, req.auth.id);
  if (result.error) {
    const status = result.error === "not_found" ? 404 : result.error === "duplicate" ? 409 : 400;
    return res.status(status).json({ error: result.message, code: result.error });
  }

  publishPolicyCoverageChange(result.policy, req.auth.id, result.previous_policy);
  res.json({ policy: result.policy });
});

router.get("/patients", (req, res) => {
  res.json({
    patients: listLinkhamPatients({
      search: req.query.search,
      missingPolicy: parseMissingPolicyFlag(req.query.missingPolicy),
    }),
  });
});

router.get("/patients/:id", (req, res) => {
  const patient = getLinkhamPatientById(req.params.id);

  if (!patient) {
    return res.status(404).json({ error: "Linkham client not found." });
  }

  res.json({ patient });
});

router.get("/claims/statement.csv", (req, res) => {
  const query = claimsQueryFromRequest(req);
  const claims = listLinkhamClaims({
    ...query,
    status: query.status || "all",
  });
  const monthLabel = String(query.month || "all").replace(/[^\d-]/g, "") || "all";
  const csv = buildLinkhamStatementCsv(claims);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="linkham-80pct-statement-${monthLabel}.csv"`,
  );
  res.send(csv);
});

router.get("/claims", (req, res) => {
  const query = claimsQueryFromRequest(req);
  const status = query.status || "pending";
  const claims = listLinkhamClaims({ ...query, status });
  const ledgerClaims = listLinkhamClaims({
    status: "all",
    month: query.month,
    search: query.search,
  });
  const ledger = summarizeLinkhamClaimsLedger(ledgerClaims);

  res.json({
    claims,
    ...ledger,
  });
});

router.patch("/claims/batch-approve-clean", (req, res) => {
  const result = approveLinkhamCleanClaimsBatch(req.auth.id);

  publishLinkhamClaimsChange({
    changedByUserId: req.auth.id,
  });
  publishPatientBillingChangesForClaims(result.approvedClaims || []);

  res.json(result);
});

router.patch("/claims/batch-settle-approved", (req, res) => {
  let result;
  try {
    result = settleLinkhamApprovedClaimsBatch(req.auth.id, {
      month: req.body?.month || req.query.month || "",
      payment_date: req.body?.payment_date,
      remittance_reference: req.body?.remittance_reference,
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  publishLinkhamClaimsChange({
    changedByUserId: req.auth.id,
  });
  publishPatientBillingChangesForClaims(result.settledClaims || []);

  res.json(result);
});

router.get("/claims/:id/summary", (req, res) => {
  const claim = getLinkhamClaimById(req.params.id);

  if (!claim) {
    return res.status(404).json({ error: "Claim not found." });
  }

  res.json({
    claim,
    summary: buildClaimSummaryPayload(claim),
  });
});

router.patch("/claims/:id/approve", (req, res) => {
  const updated = approveLinkhamClaim(req.params.id, req.auth.id);

  if (!updated) {
    return res.status(404).json({ error: "Claim not found or cannot be approved." });
  }

  publishLinkhamClaimsChange({
    claimId: updated.id,
    changedByUserId: req.auth.id,
  });
  publishPatientBillingChangeForClaim(updated);

  res.json(updated);
});

router.patch("/claims/:id/settle", (req, res) => {
  let updated;
  try {
    updated = settleLinkhamClaim(req.params.id, req.auth.id, {
      amount: req.body?.amount,
      payment_date: req.body?.payment_date,
      remittance_reference: req.body?.remittance_reference,
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
  }

  if (!updated) {
    return res.status(404).json({ error: "Claim not found or cannot be marked paid to OCS." });
  }

  publishLinkhamClaimsChange({
    claimId: updated.id,
    changedByUserId: req.auth.id,
  });
  publishPatientBillingChangeForClaim(updated);

  res.json(updated);
});

router.patch("/claims/:id/dispute", (req, res) => {
  const disputeStatus = req.body?.dispute_status;
  const result = setLinkhamClaimDisputeStatus(req.params.id, disputeStatus, {
    reason: req.body?.reason || req.body?.dispute_reason || "",
    userId: req.auth.id,
  });

  if (!result || result.error === "not_found") {
    return res.status(404).json({ error: "Claim not found." });
  }
  if (result.error === "locked") {
    return res.status(409).json({ error: "Approved or paid claims cannot be flagged." });
  }
  if (result.error === "reason_required") {
    return res.status(400).json({ error: "Add a short reason so the clinic can answer." });
  }

  publishLinkhamClaimsChange({
    claimId: result.claim.id,
    changedByUserId: req.auth.id,
  });
  publishPatientBillingChangeForClaim(result.claim);

  res.json(result.claim);
});

module.exports = router;
