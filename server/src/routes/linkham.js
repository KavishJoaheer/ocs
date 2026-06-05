const express = require("express");
const {
  approveLinkhamClaim,
  getLinkhamClaimById,
  getLinkhamDashboardMetrics,
  listLinkhamClaims,
  listLinkhamPatients,
} = require("../lib/linkhamPortal");

const router = express.Router();

router.get("/dashboard", (_req, res) => {
  res.json(getLinkhamDashboardMetrics());
});

router.get("/patients", (_req, res) => {
  res.json({ patients: listLinkhamPatients() });
});

router.get("/claims", (_req, res) => {
  const claims = listLinkhamClaims();
  const totalOutstandingClaims = claims
    .filter((claim) => claim.linkham_claim_status === "pending")
    .reduce((sum, claim) => sum + Number(claim.linkham_share_amount || 0), 0);

  res.json({
    claims,
    totalOutstandingClaims: Number(totalOutstandingClaims.toFixed(2)),
  });
});

router.get("/claims/:id/summary", (req, res) => {
  const claim = getLinkhamClaimById(req.params.id);

  if (!claim) {
    return res.status(404).json({ error: "Claim not found." });
  }

  res.json({
    claim,
    summary: {
      title: "Linkham Coverage Verification Summary",
      visit_date: claim.visit_date,
      patient_name: claim.patient_name,
      patient_identifier: claim.patient_identifier,
      visit_id: claim.id_short,
      doctor_name: claim.doctor_name,
      total_amount: claim.total_amount,
      patient_copay_amount: claim.patient_copay_amount,
      linkham_share_amount: claim.linkham_share_amount,
      claim_status: claim.linkham_claim_status,
      generated_at: new Date().toISOString(),
    },
  });
});

router.patch("/claims/:id/approve", (req, res) => {
  const updated = approveLinkhamClaim(req.params.id);

  if (!updated) {
    return res.status(404).json({ error: "Claim not found." });
  }

  res.json(updated);
});

module.exports = router;
