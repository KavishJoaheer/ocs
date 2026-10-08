import { CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
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
  const coverage = patient?.linkham_coverage || null;

  if (!isLinkhamInsuranceProvider(insuranceProvider)) {
    return null;
  }

  const status = String(coverage?.coverage_status || "").toLowerCase();
  const isGreen = coverage?.allowed === true && status === "green";
  const isRed = status === "red";
  const Icon = isGreen ? CircleCheck : isRed ? CircleAlert : CircleHelp;
  const missingPolicy = !policyNumber;
  const label = isGreen
    ? "GREEN · Eligible"
    : isRed
      ? "RED · Dispatch blocked"
      : missingPolicy
        ? "No policy · Dispatch blocked"
        : "Verification required";
  const tone = isGreen
    ? "border-emerald-300 bg-emerald-100 text-emerald-900 ring-emerald-100"
    : isRed
      ? "border-rose-300 bg-rose-100 text-rose-900 ring-rose-100"
      : "border-amber-300 bg-amber-100 text-amber-950 ring-amber-100";
  const details = [
    policyNumber ? `Linkham policy ${policyNumber}` : "Linkham policy number missing",
    coverage?.status_reason,
    coverage?.updated_at ? `Updated ${coverage.updated_at}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div
      className={`animate-fade-in inline-flex items-center gap-2 rounded-xl border-2 px-3.5 py-2 text-xs font-black shadow-sm ring-4 ${tone} ${className}`.trim()}
      title={details}
      role="status"
      aria-label={details || label}
    >
      <Icon className="size-4.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
      <span>{label}</span>
      {policyNumber ? <span className="border-l border-current/20 pl-2 font-mono font-black opacity-80">{policyNumber}</span> : null}
    </div>
  );
}
