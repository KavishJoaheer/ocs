import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, UserRoundCheck } from "lucide-react";
import { cx } from "../../lib/utils.js";

function IssueButton({ label, value, tone = "amber", actionLabel, onClick }) {
  const active = Number(value || 0) > 0;
  const toneClass = tone === "rose"
    ? "border-rose-200 bg-rose-50 text-rose-900"
    : "border-amber-200 bg-amber-50 text-amber-950";
  return (
    <button
      type="button"
      disabled={!active}
      onClick={onClick}
      className={cx(
        "flex min-h-12 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition",
        active ? `${toneClass} hover:border-ocs-teal/50` : "cursor-default border-slate-100 bg-slate-50 text-slate-400",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-bold">{label}</span>
        {active ? <span className="text-[11px] font-semibold opacity-75">{actionLabel}</span> : <span className="text-[11px]">Clear</span>}
      </span>
      <strong className="shrink-0 text-lg tabular-nums">{Number(value || 0)}</strong>
    </button>
  );
}

function CompletionBar({ value }) {
  const percent = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-label={`${percent}% data complete`}>
      <div className="h-full rounded-full bg-[#2d8f98]" style={{ width: `${percent}%` }} />
    </div>
  );
}

export default function InventoryDataIssuesQueue({
  dataQuality,
  currentLocationKey,
  isAdmin,
  assigningOwner,
  onAssignOwner,
  onResolve,
  onSelectLocation,
}) {
  const [locationsOpen, setLocationsOpen] = useState(false);
  if (!dataQuality) return null;
  const locations = Array.isArray(dataQuality.locations) ? dataQuality.locations : [];
  const current = locations.find((row) => row.location_key === currentLocationKey) || locations[0] || {};
  const issueCount = Number(current.unpriced || 0)
    + Number(current.missing_expiry || 0)
    + Number(current.expired || 0)
    + Number(current.reconciliation_required || 0);
  const owner = dataQuality.owner;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4" aria-labelledby="inventory-data-issues-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {issueCount > 0 ? <AlertTriangle className="size-5 shrink-0 text-amber-700" /> : <CheckCircle2 className="size-5 shrink-0 text-emerald-700" />}
            <h2 id="inventory-data-issues-title" className="truncate text-base font-black text-slate-950">
              Data issues requiring action
            </h2>
          </div>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {current.location_name || "Selected location"} · {Number(current.completion_percent || 0).toFixed(1)}% batch data complete
          </p>
        </div>

        <label className="flex min-w-0 flex-col gap-1 text-xs font-bold text-slate-500 sm:min-w-64">
          <span className="inline-flex items-center gap-1.5"><UserRoundCheck className="size-3.5" /> Today&apos;s exception owner</span>
          <select
            value={owner?.assigned_to_user_id || ""}
            disabled={assigningOwner}
            onChange={(event) => event.target.value && onAssignOwner?.(Number(event.target.value))}
            className={cx(
              "min-h-11 rounded-xl border px-3 text-sm font-bold outline-none focus:border-ocs-teal",
              owner ? "border-slate-200 bg-slate-50 text-slate-800" : "border-amber-300 bg-amber-50 text-amber-950",
            )}
          >
            <option value="">Assign owner…</option>
            {(dataQuality.owner_candidates || []).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.full_name} · {candidate.role}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <IssueButton label="Missing cost" value={current.unpriced} actionLabel={isAdmin ? "Fix next batch" : "Review items"} onClick={() => onResolve?.("unpriced")} />
        <IssueButton label="Missing expiry" value={current.missing_expiry} actionLabel={isAdmin ? "Fix next batch" : "Review items"} onClick={() => onResolve?.("missing")} />
        <IssueButton label="Expired stock" value={current.expired} tone="rose" actionLabel="Review and dispose" onClick={() => onResolve?.("expired")} />
        <IssueButton label="Reconciliation" value={current.reconciliation_required} actionLabel="Open queue" onClick={() => onResolve?.("reconciliation")} />
      </div>

      <button
        type="button"
        aria-expanded={locationsOpen}
        onClick={() => setLocationsOpen((open) => !open)}
        className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 text-left text-xs font-bold text-slate-700"
      >
        <span>All locations · {Number(dataQuality.overall?.completion_percent || 0).toFixed(1)}% complete</span>
        <ChevronDown className={cx("size-4 transition-transform", locationsOpen && "rotate-180")} />
      </button>

      {locationsOpen ? (
        <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {locations.map((location) => (
            <button
              key={location.location_key}
              type="button"
              onClick={() => onSelectLocation?.(location)}
              className={cx(
                "grid w-full gap-2 px-3 py-3 text-left sm:grid-cols-[minmax(10rem,1fr)_minmax(9rem,1fr)_auto] sm:items-center",
                location.location_key === currentLocationKey ? "bg-teal-50" : "hover:bg-slate-50",
              )}
            >
              <span className="min-w-0 truncate text-sm font-bold text-slate-800">{location.location_name}</span>
              <span className="min-w-0">
                <CompletionBar value={location.completion_percent} />
                <span className="mt-1 block text-[11px] text-slate-500">{Number(location.complete_items || 0)} of {Number(location.stocked_items || 0)} stocked products complete</span>
              </span>
              <span className="text-xs font-bold tabular-nums text-slate-600">{Number(location.completion_percent || 0).toFixed(1)}%</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
