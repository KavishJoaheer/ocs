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
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : isRed
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-amber-200 bg-amber-50 text-amber-800";
  const details = [
    policyNumber ? `Linkham policy ${policyNumber}` : "Linkham policy number missing",
    coverage?.status_reason,
    coverage?.updated_at ? `Updated ${coverage.updated_at}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div
      className={`animate-fade-in inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-extrabold ${tone} ${className}`.trim()}
      title={details}
      role="status"
      aria-label={details || label}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
      {policyNumber ? <span className="font-mono font-bold opacity-75">{policyNumber}</span> : null}
    </div>
  );
}
