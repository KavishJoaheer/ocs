"use strict";

const { db } = require("../db");
const { parseMauritianID } = require("./nicParser");

function normalizePolicyNumber(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeNationalId(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeCoverageStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "green" || normalized === "red" ? normalized : "";
}

function validatePolicyInput(input = {}) {
  const policyNumber = normalizePolicyNumber(input.policy_number);
  const nationalId = normalizeNationalId(input.national_id);
  const coverageStatus = normalizeCoverageStatus(input.coverage_status);

  if (!policyNumber) return "Policy number is required.";
  if (!nationalId) return "Mauritius ID number is required.";
  if (!parseMauritianID(nationalId)) {
    return "Enter a valid 14-character Mauritius ID number.";
  }
  if (!coverageStatus) return "Coverage status must be green or red.";
  if (coverageStatus === "red" && String(input.status_reason || "").trim().length < 3) {
    return "A reason is required when a policy is red-flagged.";
  }
  return null;
}

function resolveHolderName(row) {
  return String(row?.holder_name || row?.patient_name || "").trim();
}

function formatPolicy(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    policy_number: row.policy_number,
    national_id: row.national_id,
    holder_name: resolveHolderName(row),
    coverage_status: row.coverage_status,
    status_reason: String(row.status_reason || "").trim(),
    created_at: row.created_at,
    updated_at: row.updated_at,
    updated_by_name: String(row.updated_by_name || "").trim(),
    policy_version: Number(row.row_version || 1),
  };
}

const POLICY_SELECT = `
  SELECT
    lp.*,
    updater.full_name AS updated_by_name,
    (
      SELECT p.full_name
      FROM patients p
      WHERE p.deleted_at IS NULL
        AND upper(trim(p.patient_id_number)) = upper(trim(lp.national_id))
      ORDER BY p.created_at DESC
      LIMIT 1
    ) AS patient_name
  FROM linkham_policies lp
  LEFT JOIN users updater ON updater.id = lp.updated_by_user_id
`;

function getLinkhamPolicyById(policyId) {
  return formatPolicy(
    db.prepare(`${POLICY_SELECT} WHERE lp.id = ?`).get(Number(policyId || 0)),
  );
}

function listLinkhamPolicies({ search = "", status = "all" } = {}) {
  const term = String(search || "").trim().toLowerCase();
  const normalizedStatus = normalizeCoverageStatus(status);
  const filters = [];
  const params = {};

  if (term) {
    params.search = `%${term}%`;
    filters.push(`(
      lower(lp.policy_number) LIKE @search
      OR lower(lp.national_id) LIKE @search
      OR lower(lp.holder_name) LIKE @search
      OR EXISTS (
        SELECT 1 FROM patients p
        WHERE p.deleted_at IS NULL
          AND upper(trim(p.patient_id_number)) = upper(trim(lp.national_id))
          AND lower(p.full_name) LIKE @search
      )
    )`);
  }
  if (normalizedStatus) {
    params.status = normalizedStatus;
    filters.push("lp.coverage_status = @status");
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  return db
    .prepare(`${POLICY_SELECT} ${where} ORDER BY lp.updated_at DESC, lp.id DESC`)
    .all(params)
    .map(formatPolicy);
}

function recordPolicyAudit({ policyId = null, action, outcome = "", policyNumber = "", nationalId = "", actorUserId = null }) {
  db.prepare(`
    INSERT INTO linkham_policy_audit_log (
      policy_id, action, outcome, policy_number, national_id, actor_user_id
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    policyId ? Number(policyId) : null,
    action,
    String(outcome || ""),
    normalizePolicyNumber(policyNumber),
    normalizeNationalId(nationalId),
    actorUserId ? Number(actorUserId) : null,
  );
}

function createLinkhamPolicy(input, actorUserId) {
  const validationError = validatePolicyInput(input);
  if (validationError) return { error: "validation", message: validationError };

  const policyNumber = normalizePolicyNumber(input.policy_number);
  const nationalId = normalizeNationalId(input.national_id);
  const holderName = String(input.holder_name || "").trim();
  const coverageStatus = normalizeCoverageStatus(input.coverage_status);
  const statusReason = String(input.status_reason || "").trim();

  if (db.prepare("SELECT id FROM linkham_policies WHERE policy_number = ? COLLATE NOCASE").get(policyNumber)) {
    return { error: "duplicate", message: "This policy number is already registered." };
  }

  const create = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO linkham_policies (
        policy_number, national_id, holder_name, coverage_status, status_reason,
        created_by_user_id, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      policyNumber,
      nationalId,
      holderName,
      coverageStatus,
      statusReason,
      Number(actorUserId),
      Number(actorUserId),
    );
    const policyId = Number(result.lastInsertRowid);
    recordPolicyAudit({
      policyId,
      action: "created",
      outcome: coverageStatus,
      policyNumber,
      nationalId,
      actorUserId,
    });
    return getLinkhamPolicyById(policyId);
  });

  return { policy: create() };
}

function updateLinkhamPolicy(policyId, input, actorUserId) {
  const existing = getLinkhamPolicyById(policyId);
  if (!existing) return { error: "not_found", message: "Policy not found." };

  const nextInput = {
    policy_number: input.policy_number ?? existing.policy_number,
    national_id: input.national_id ?? existing.national_id,
    holder_name: input.holder_name ?? existing.holder_name,
    coverage_status: input.coverage_status ?? existing.coverage_status,
    status_reason: input.status_reason ?? existing.status_reason,
  };
  const validationError = validatePolicyInput(nextInput);
  if (validationError) return { error: "validation", message: validationError };

  const policyNumber = normalizePolicyNumber(nextInput.policy_number);
  const nationalId = normalizeNationalId(nextInput.national_id);
  const holderName = String(nextInput.holder_name || "").trim();
  const coverageStatus = normalizeCoverageStatus(nextInput.coverage_status);
  const statusReason = String(nextInput.status_reason || "").trim();
  const duplicate = db
    .prepare("SELECT id FROM linkham_policies WHERE policy_number = ? COLLATE NOCASE AND id <> ?")
    .get(policyNumber, Number(policyId));
  if (duplicate) {
    return { error: "duplicate", message: "This policy number is already registered." };
  }

  const update = db.transaction(() => {
    db.prepare(`
      UPDATE linkham_policies
      SET policy_number = ?, national_id = ?, holder_name = ?, coverage_status = ?,
          status_reason = ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP,
          row_version = row_version + 1
      WHERE id = ?
    `).run(
      policyNumber,
      nationalId,
      holderName,
      coverageStatus,
      statusReason,
      Number(actorUserId),
      Number(policyId),
    );
    recordPolicyAudit({
      policyId,
      action: "updated",
      outcome: coverageStatus,
      policyNumber,
      nationalId,
      actorUserId,
    });
    return getLinkhamPolicyById(policyId);
  });

  return { policy: update(), previous_policy: existing };
}

function verifyLinkhamPolicyCoverage({ policyNumber, nationalId, actorUserId = null, audit = true } = {}) {
  const normalizedPolicyNumber = normalizePolicyNumber(policyNumber);
  const normalizedNationalId = normalizeNationalId(nationalId);
  let policy = null;
  let outcome = "not_found";

  if (!normalizedPolicyNumber) {
    outcome = "policy_required";
  } else if (!normalizedNationalId) {
    outcome = "national_id_required";
  } else if (!parseMauritianID(normalizedNationalId)) {
    outcome = "invalid_identity";
  } else {
    policy = db
      .prepare(`${POLICY_SELECT} WHERE lp.policy_number = ? COLLATE NOCASE`)
      .get(normalizedPolicyNumber);
    if (!policy) {
      outcome = "not_found";
    } else if (normalizeNationalId(policy.national_id) !== normalizedNationalId) {
      outcome = "identity_mismatch";
    } else {
      outcome = policy.coverage_status;
    }
  }

  if (audit) {
    recordPolicyAudit({
      policyId: policy?.id || null,
      action: "verified",
      outcome,
      policyNumber: normalizedPolicyNumber,
      nationalId: normalizedNationalId,
      actorUserId,
    });
  }

  if (!policy || !["green", "red"].includes(outcome)) {
    return {
      matched: false,
      allowed: false,
      coverage_status: outcome,
      policy_number: normalizedPolicyNumber,
    };
  }

  const formatted = formatPolicy(policy);
  return {
    matched: true,
    allowed: outcome === "green",
    coverage_status: outcome,
    policy_number: formatted.policy_number,
    national_id: formatted.national_id,
    holder_name: formatted.holder_name,
    status_reason: formatted.status_reason,
    updated_at: formatted.updated_at,
    policy_version: formatted.policy_version,
  };
}

function lookupLinkhamPolicyCoverage({ policyNumber, nationalId, actorUserId = null } = {}) {
  const normalizedPolicyNumber = normalizePolicyNumber(policyNumber);
  const normalizedNationalId = normalizeNationalId(nationalId);

  if (normalizedPolicyNumber && normalizedNationalId) {
    return [
      verifyLinkhamPolicyCoverage({
        policyNumber: normalizedPolicyNumber,
        nationalId: normalizedNationalId,
        actorUserId,
      }),
    ];
  }

  if (!normalizedPolicyNumber && !normalizedNationalId) {
    recordPolicyAudit({
      action: "verified",
      outcome: "identifier_required",
      actorUserId,
    });
    return [{ matched: false, allowed: false, coverage_status: "identifier_required" }];
  }

  if (normalizedNationalId && !parseMauritianID(normalizedNationalId)) {
    recordPolicyAudit({
      action: "verified",
      outcome: "invalid_identity",
      nationalId: normalizedNationalId,
      actorUserId,
    });
    return [{
      matched: false,
      allowed: false,
      coverage_status: "invalid_identity",
      national_id: normalizedNationalId,
    }];
  }

  const policies = normalizedPolicyNumber
    ? db
        .prepare(`${POLICY_SELECT} WHERE lp.policy_number = ? COLLATE NOCASE`)
        .all(normalizedPolicyNumber)
    : db
        .prepare(`${POLICY_SELECT} WHERE lp.national_id = ? COLLATE NOCASE ORDER BY lp.updated_at DESC, lp.id DESC`)
        .all(normalizedNationalId);

  if (!policies.length) {
    recordPolicyAudit({
      action: "verified",
      outcome: "not_found",
      policyNumber: normalizedPolicyNumber,
      nationalId: normalizedNationalId,
      actorUserId,
    });
    return [{
      matched: false,
      allowed: false,
      coverage_status: "not_found",
      policy_number: normalizedPolicyNumber,
      national_id: normalizedNationalId,
    }];
  }

  return policies.map((row) => {
    const policy = formatPolicy(row);
    recordPolicyAudit({
      policyId: policy.id,
      action: "verified",
      outcome: policy.coverage_status,
      policyNumber: normalizedPolicyNumber,
      nationalId: normalizedNationalId,
      actorUserId,
    });
    return {
      matched: true,
      allowed: policy.coverage_status === "green",
      coverage_status: policy.coverage_status,
      policy_number: policy.policy_number,
      national_id: policy.national_id,
      holder_name: policy.holder_name,
      status_reason: policy.status_reason,
      updated_at: policy.updated_at,
      policy_version: policy.policy_version,
    };
  });
}

module.exports = {
  createLinkhamPolicy,
  getLinkhamPolicyById,
  listLinkhamPolicies,
  lookupLinkhamPolicyCoverage,
  normalizeCoverageStatus,
  normalizeNationalId,
  normalizePolicyNumber,
  updateLinkhamPolicy,
  validatePolicyInput,
  verifyLinkhamPolicyCoverage,
};
