const express = require("express");
const { db } = require("../db");
const { publishLinkhamClaimsChange, publishPatientDataChange } = require("../lib/inventoryRealtime");
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

const router = express.Router();

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
  const result = settleLinkhamApprovedClaimsBatch(req.auth.id, {
    month: req.body?.month || req.query.month || "",
  });

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
  const updated = settleLinkhamClaim(req.params.id, req.auth.id);

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
