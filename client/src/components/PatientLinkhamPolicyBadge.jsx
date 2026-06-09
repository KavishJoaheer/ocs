import {
  isLinkhamInsuranceProvider,
  resolveInsuranceProviderFromTags,
} from "../lib/insuranceProvider.js";

function resolvePatientInsuranceProvider(patient) {
  return (
    patient?.insurance_provider ||
    resolveInsuranceProviderFromTags(patient?.location_tags || [])
  );
}

export default function PatientLinkhamPolicyBadge({ patient, className = "" }) {
  const insuranceProvider = resolvePatientInsuranceProvider(patient);
  const policyNumber = String(patient?.insurance_policy_number || "").trim();

  if (!isLinkhamInsuranceProvider(insuranceProvider) || !policyNumber) {
    return null;
  }

  return (
    <div
      className={`animate-fade-in flex items-center gap-1.5 rounded-lg border border-amber-200/80 bg-amber-50 px-2.5 py-0.5 font-mono text-[11px] font-extrabold text-amber-800 shadow-sm ${className}`.trim()}
    >
      <span aria-hidden="true">🛡️</span>
      <span>Linkham Policy: {policyNumber}</span>
    </div>
  );
}
