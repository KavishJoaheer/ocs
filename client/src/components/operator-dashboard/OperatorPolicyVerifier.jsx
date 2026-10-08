import { useState } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { api } from "../../lib/api.js";
import { cx } from "../../lib/utils.js";

function getCoveragePresentation(coverage) {
  const status = String(coverage?.coverage_status || "").toLowerCase();

  if (status === "green") {
    return {
      Icon: CheckCircle2,
      label: "GREEN — Eligible for OCS services",
      tone: "border-emerald-300 bg-emerald-50 text-emerald-900",
    };
  }

  if (status === "red") {
    return {
      Icon: ShieldAlert,
      label: "RED — Dispatch blocked",
      tone: "border-rose-300 bg-rose-50 text-rose-900",
    };
  }

  const labels = {
    identity_mismatch: "Policy and Mauritius ID do not match",
    invalid_identity: "Enter a valid 14-character Mauritius ID",
    national_id_required: "Mauritius ID is required",
    policy_required: "Policy number is required",
    not_found: "Policy not found in the Linkham register",
  };

  return {
    Icon: ShieldAlert,
    label: labels[status] || "Policy could not be verified",
    tone: "border-amber-300 bg-amber-50 text-amber-950",
  };
}

export default function OperatorPolicyVerifier({ className = "" }) {
  const [policyNumber, setPolicyNumber] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [state, setState] = useState("idle");
  const [coverage, setCoverage] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const canVerify = Boolean(policyNumber.trim() && nationalId.trim());

  function updateField(setter, value) {
    setter(value);
    if (state !== "idle") {
      setState("idle");
      setCoverage(null);
      setErrorMessage("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canVerify || state === "checking") return;

    setState("checking");
    setCoverage(null);
    setErrorMessage("");

    try {
      const params = new URLSearchParams({
        policy_number: policyNumber.trim(),
        national_id: nationalId.trim(),
      });
      const data = await api.get(`/patients/insurance/coverage?${params.toString()}`);
      setCoverage(data?.coverage || null);
      setState("complete");
    } catch (error) {
      setErrorMessage(error.message || "Policy verification is temporarily unavailable.");
      setState("error");
    }
  }

  const presentation = state === "complete" ? getCoveragePresentation(coverage) : null;
  const ResultIcon = presentation?.Icon;

  return (
    <section
      className={cx(
        "rounded-[20px] border border-[#203f42]/10 bg-white px-4 py-4 shadow-[0_10px_30px_rgba(32,63,66,0.07)] sm:px-5",
        className,
      )}
      aria-labelledby="operator-policy-verifier-heading"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#2bccc4]/10 text-[#1a7f7a]">
          <ShieldCheck className="size-5" strokeWidth={2.2} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2
            id="operator-policy-verifier-heading"
            className="font-display text-base font-semibold text-[#203f42]"
          >
            Quick policy verification
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-[#5f7476]">
            Check the live Linkham flag before dispatching a doctor.
          </p>
        </div>
      </div>

      <form className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_auto]" onSubmit={handleSubmit}>
        <label className="min-w-0">
          <span className="sr-only">Policy number</span>
          <input
            type="text"
            value={policyNumber}
            onChange={(event) => updateField(setPolicyNumber, event.target.value)}
            placeholder="Policy number"
            autoComplete="off"
            autoCapitalize="characters"
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-[#2bccc4] focus:bg-white focus:ring-2 focus:ring-[#2bccc4]/15"
          />
        </label>
        <label className="min-w-0">
          <span className="sr-only">Mauritius ID number</span>
          <input
            type="text"
            value={nationalId}
            onChange={(event) => updateField(setNationalId, event.target.value)}
            placeholder="Mauritius ID number"
            maxLength={14}
            autoComplete="off"
            autoCapitalize="characters"
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-semibold uppercase text-slate-800 outline-none transition focus:border-[#2bccc4] focus:bg-white focus:ring-2 focus:ring-[#2bccc4]/15"
          />
        </label>
        <button
          type="submit"
          disabled={!canVerify || state === "checking"}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1a7f7a] px-5 text-sm font-bold text-white transition hover:bg-[#146b67] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {state === "checking" ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-4" strokeWidth={2.3} aria-hidden="true" />
          )}
          {state === "checking" ? "Checking…" : "Verify"}
        </button>
      </form>

      {presentation ? (
        <div
          className={cx("mt-3 rounded-xl border-2 px-3.5 py-3", presentation.tone)}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm font-black">
            <ResultIcon className="size-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span>{presentation.label}</span>
          </div>
          {coverage?.matched ? (
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
              <span>Policy holder: {coverage.holder_name || "Not recorded"}</span>
              <span>Policy: {coverage.policy_number}</span>
              <span>ID: {coverage.national_id}</span>
            </div>
          ) : null}
          {coverage?.status_reason ? (
            <p className="mt-1.5 text-xs font-bold">Reason: {coverage.status_reason}</p>
          ) : null}
        </div>
      ) : state === "error" ? (
        <div
          className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm font-semibold text-amber-950"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}
    </section>
  );
}
