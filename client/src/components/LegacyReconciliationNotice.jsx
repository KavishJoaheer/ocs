import { isLegacyReconciliationRequired, legacyReconciliationGaps } from "../lib/supplyRequests.js";

export default function LegacyReconciliationNotice({ request, compact = false }) {
  if (!isLegacyReconciliationRequired(request)) return null;
  const gaps = legacyReconciliationGaps(request);
  return (
    <div
      className={compact
        ? "mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
        : "rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"}
      role="status"
    >
      <p className="font-bold">Legacy – reconciliation required</p>
      <p className={compact ? "mt-1" : "mt-1.5"}>
        Collection and completion are blocked until an operator reconciles this request. Records are not invented automatically.
      </p>
      {gaps.length ? (
        <ul className={`list-disc pl-4 ${compact ? "mt-1" : "mt-2"}`}>
          {gaps.map((gap) => (
            <li key={gap}>{gap} unavailable</li>
          ))}
        </ul>
      ) : (
        <p className={compact ? "mt-1" : "mt-2"}>Fulfilment, reservation, picked-batch or timeline records are unavailable.</p>
      )}
    </div>
  );
}
