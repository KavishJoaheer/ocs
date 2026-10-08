import { useState } from "react";
import { CheckCircle2, LoaderCircle, Search, ShieldAlert } from "lucide-react";
import { api } from "../lib/api.js";
import { cx } from "../lib/utils.js";

function resultStyle(status) {
  if (status === "green") {
    return {
      Icon: CheckCircle2,
      label: "Green · eligible",
      className: "border-emerald-200 bg-emerald-50 text-emerald-900",
    };
  }
  if (status === "red") {
    return {
      Icon: ShieldAlert,
      label: "Red · OCS service blocked",
      className: "border-rose-200 bg-rose-50 text-rose-900",
    };
  }
  return {
    Icon: ShieldAlert,
    label: status === "invalid_identity" ? "Invalid Mauritius ID" : "No matching policy found",
    className: "border-amber-200 bg-amber-50 text-amber-950",
  };
}

export default function LinkhamQuickPolicyLookup() {
  const [mode, setMode] = useState("policy");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("idle");
  const [coverages, setCoverages] = useState([]);
  const [error, setError] = useState("");

  function changeMode(nextMode) {
    setMode(nextMode);
    setQuery("");
    setState("idle");
    setCoverages([]);
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (!query.trim() || state === "checking") return;
    setState("checking");
    setCoverages([]);
    setError("");
    try {
      const params = new URLSearchParams({
        [mode === "policy" ? "policy_number" : "national_id"]: query.trim(),
      });
      const data = await api.get(`/linkham/policy-lookup?${params.toString()}`);
      setCoverages(Array.isArray(data?.coverages) ? data.coverages : []);
      setState("complete");
    } catch (lookupError) {
      setError(lookupError.message || "Policy lookup is temporarily unavailable.");
      setState("error");
    }
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-[#0d5c63]/10 bg-[#0d5c63] text-white shadow-[0_18px_45px_rgba(6,90,96,0.16)]">
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)] lg:items-center lg:p-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#9fe1dc]">Live registry</p>
          <h2 className="mt-2 text-xl font-black tracking-tight">Find a policy holder</h2>
          <p className="mt-1 max-w-sm text-xs leading-5 text-white/65">
            Verify the current OCS eligibility flag before changing or discussing coverage.
          </p>
        </div>

        <div>
          <div className="mb-2 flex gap-1 rounded-xl bg-white/8 p-1 sm:w-fit">
            {[["policy", "Policy number"], ["national", "Mauritius ID"]].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => changeMode(id)}
                className={cx(
                  "flex-1 rounded-lg px-3 py-1.5 text-[11px] font-extrabold transition sm:flex-none",
                  mode === id ? "bg-white text-[#0d5c63]" : "text-white/65 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#0d5c63]/45" />
              <span className="sr-only">{mode === "policy" ? "Policy number" : "Mauritius ID"}</span>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setState("idle");
                  setCoverages([]);
                  setError("");
                }}
                maxLength={mode === "national" ? 14 : 80}
                autoComplete="off"
                autoCapitalize="characters"
                placeholder={mode === "policy" ? "Enter policy number" : "Enter 14-character Mauritius ID"}
                className="h-12 w-full rounded-xl border-0 bg-white pl-10 pr-4 text-sm font-bold uppercase text-slate-900 outline-none ring-2 ring-transparent transition focus:ring-[#78d8d1]"
              />
            </label>
            <button
              type="submit"
              disabled={!query.trim() || state === "checking"}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#f2c14d] px-5 text-sm font-black text-[#163b3e] transition hover:bg-[#ffd675] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state === "checking" ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
              {state === "checking" ? "Checking" : "Verify"}
            </button>
          </form>
        </div>
      </div>

      {state === "complete" ? (
        <div className="space-y-2 border-t border-white/10 bg-[#073f44] px-5 py-4 lg:px-6">
          {coverages.map((coverage, index) => {
            const style = resultStyle(coverage.coverage_status);
            const Icon = style.Icon;
            return (
              <div key={`${coverage.policy_number || "result"}-${index}`} className={cx("rounded-xl border px-3.5 py-3 text-xs", style.className)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-black"><Icon className="size-4" /> {style.label}</span>
                  {coverage.matched ? <span className="font-mono font-black">{coverage.policy_number}</span> : null}
                </div>
                {coverage.matched ? <p className="mt-1.5 font-semibold">{coverage.holder_name || "Policy holder not recorded"} · {coverage.national_id}</p> : null}
                {coverage.status_reason ? <p className="mt-1 font-bold">{coverage.status_reason}</p> : null}
              </div>
            );
          })}
        </div>
      ) : state === "error" ? (
        <p className="border-t border-white/10 bg-rose-950/25 px-5 py-3 text-xs font-bold text-rose-100" role="alert">{error}</p>
      ) : null}
    </section>
  );
}
