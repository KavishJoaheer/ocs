"use strict";

const { db } = require("../db");
const { isLinkhamInsuranceProvider } = require("./insuranceProvider");
const { verifyLinkhamPolicyCoverage } = require("./linkhamPolicyRegistry");

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function getPatientLinkhamCoverage(patientId, { actorUserId = null, audit = false } = {}) {
  const patient = db.prepare(`
    SELECT id, insurance_provider, insurance_policy_number, patient_id_number
    FROM patients
    WHERE id = ? AND deleted_at IS NULL
  `).get(Number(patientId || 0));

  if (!patient) {
    return { error: "patient_not_found", allowed: false, coverage_status: "patient_not_found" };
  }

  if (!isLinkhamInsuranceProvider(patient.insurance_provider)) {
    return {
      provider: String(patient.insurance_provider || "Self-pay").trim() || "Self-pay",
      is_linkham: false,
      allowed: true,
      coverage_status: "not_applicable",
      checked_at: new Date().toISOString(),
    };
  }

  return {
    ...verifyLinkhamPolicyCoverage({
      policyNumber: patient.insurance_policy_number,
      nationalId: patient.patient_id_number,
      actorUserId,
      audit,
    }),
    provider: "Linkham",
    is_linkham: true,
    checked_at: new Date().toISOString(),
  };
}

function linkhamCoverageError(coverage) {
  const messages = {
    policy_required: "This Linkham patient does not have a policy number.",
    national_id_required: "This Linkham patient does not have a Mauritius ID number.",
    invalid_identity: "The patient's Mauritius ID number is invalid.",
    not_found: "This policy is not registered in the Linkham insurance portal.",
    identity_mismatch: "The policy number does not match the patient's Mauritius ID number.",
    red: coverage?.status_reason || "This policy is red-flagged and is not eligible for OCS services.",
  };
  return messages[coverage?.coverage_status] || "Linkham coverage could not be verified.";
}

function requirePatientLinkhamCoverage(patientId, { actorUserId = null, audit = true } = {}) {
  const coverage = getPatientLinkhamCoverage(patientId, { actorUserId, audit });
  if (coverage.is_linkham && !coverage.allowed) {
    throw Object.assign(new Error(linkhamCoverageError(coverage)), {
      status: 409,
      extra: { code: "INSURANCE_DISPATCH_NOT_ALLOWED", coverage },
    });
  }
  return coverage;
}

function snapshotVisitCoverage(visitRequestId, coverage, actorUserId = null) {
  if (!coverage?.is_linkham) return;
  db.prepare(`
    UPDATE visit_requests
    SET coverage_status_snapshot = ?,
        coverage_policy_number_snapshot = ?,
        coverage_national_id_snapshot = ?,
        coverage_holder_name_snapshot = ?,
        coverage_reason_snapshot = ?,
        coverage_verified_at = CURRENT_TIMESTAMP,
        coverage_policy_updated_at = ?,
        coverage_policy_version = ?,
        coverage_verified_by_user_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    coverage.coverage_status,
    String(coverage.policy_number || ""),
    String(coverage.national_id || ""),
    String(coverage.holder_name || ""),
    String(coverage.status_reason || ""),
    coverage.updated_at || null,
    coverage.policy_version || null,
    actorUserId ? Number(actorUserId) : null,
    Number(visitRequestId),
  );
}

function snapshotBillingLinkhamCoverage(billingId, actorUserId = null) {
  const context = db.prepare(`
    SELECT
      b.id,
      b.total_amount,
      b.finalized_at,
      b.linkham_coverage_status_snapshot,
      p.id AS patient_id,
      p.insurance_provider,
      p.insurance_policy_number,
      p.patient_id_number,
      c.appointment_id,
      v.coverage_status_snapshot AS visit_coverage_status,
      v.coverage_policy_number_snapshot AS visit_policy_number,
      v.coverage_national_id_snapshot AS visit_national_id,
      v.coverage_holder_name_snapshot AS visit_holder_name,
      v.coverage_reason_snapshot AS visit_coverage_reason,
      v.coverage_verified_at AS visit_verified_at,
      v.coverage_policy_updated_at AS visit_policy_updated_at,
      v.coverage_policy_version AS visit_policy_version
    FROM billing b
    JOIN patients p ON p.id = b.patient_id
    JOIN consultations c ON c.id = b.consultation_id
    LEFT JOIN visit_requests v ON v.appointment_id = c.appointment_id
    WHERE b.id = ? AND b.voided_at IS NULL
    ORDER BY v.id DESC
    LIMIT 1
  `).get(Number(billingId || 0));

  if (!context || !context.finalized_at || !isLinkhamInsuranceProvider(context.insurance_provider)) {
    return { eligible: false, coverage: null };
  }

  let coverage;
  if (context.visit_coverage_status === "green") {
    coverage = {
      provider: "Linkham",
      is_linkham: true,
      matched: true,
      allowed: true,
      coverage_status: "green",
      policy_number: context.visit_policy_number,
      national_id: context.visit_national_id,
      holder_name: context.visit_holder_name,
      status_reason: context.visit_coverage_reason,
      checked_at: context.visit_verified_at,
      updated_at: context.visit_policy_updated_at,
      policy_version: context.visit_policy_version,
    };
  } else {
    coverage = getPatientLinkhamCoverage(context.patient_id, { actorUserId, audit: true });
  }

  const patientShare = roundMoney(Number(context.total_amount || 0) * 0.2);
  const linkhamShare = roundMoney(Number(context.total_amount || 0) - patientShare);
  db.prepare(`
    UPDATE billing
    SET linkham_policy_number_snapshot = ?,
        linkham_national_id_snapshot = ?,
        linkham_holder_name_snapshot = ?,
        linkham_coverage_status_snapshot = ?,
        linkham_coverage_reason_snapshot = ?,
        linkham_coverage_verified_at = ?,
        linkham_policy_updated_at_snapshot = ?,
        linkham_policy_version_snapshot = ?,
        linkham_patient_share_amount = ?,
        linkham_share_amount = ?,
        linkham_claim_status = CASE WHEN ? = 'green' THEN COALESCE(linkham_claim_status, 'pending') ELSE linkham_claim_status END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    String(coverage.policy_number || context.insurance_policy_number || ""),
    String(coverage.national_id || context.patient_id_number || ""),
    String(coverage.holder_name || ""),
    coverage.coverage_status || null,
    String(coverage.status_reason || ""),
    coverage.checked_at || new Date().toISOString(),
    coverage.updated_at || null,
    coverage.policy_version || null,
    patientShare,
    linkhamShare,
    coverage.coverage_status || null,
    Number(context.id),
  );

  return { eligible: coverage.coverage_status === "green", coverage, patientShare, linkhamShare };
}

module.exports = {
  getPatientLinkhamCoverage,
  linkhamCoverageError,
  requirePatientLinkhamCoverage,
  snapshotBillingLinkhamCoverage,
  snapshotVisitCoverage,
};
