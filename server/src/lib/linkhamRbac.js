const LINKHAM_INSURANCE_PROVIDER = "linkham";

function isLinkhamAdminRole(role) {
  return String(role || "") === "linkham_admin";
}

function isLinkhamInsuredPatient(patient) {
  return String(patient?.insurance_provider || "").trim().toLowerCase() === LINKHAM_INSURANCE_PROVIDER;
}

/** SQL fragment appended to patient queries for Linkham Admin read scope. */
function getLinkhamPatientFilterSql(role, alias = "p") {
  if (!isLinkhamAdminRole(role)) {
    return "";
  }

  return `AND lower(trim(${alias}.insurance_provider)) = '${LINKHAM_INSURANCE_PROVIDER}'`;
}

function ensureLinkhamPatientAccess(patient, auth) {
  if (!isLinkhamAdminRole(auth?.role)) {
    return true;
  }

  return isLinkhamInsuredPatient(patient);
}

module.exports = {
  LINKHAM_INSURANCE_PROVIDER,
  ensureLinkhamPatientAccess,
  getLinkhamPatientFilterSql,
  isLinkhamAdminRole,
  isLinkhamInsuredPatient,
};
