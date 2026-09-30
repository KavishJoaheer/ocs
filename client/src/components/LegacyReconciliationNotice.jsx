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
      <p className="font-bold">Stock information needs review</p>
      <p className={compact ? "mt-1" : "mt-1.5"}>
        Some information needed to move this stock is missing. An operator must review it before collection.
      </p>
      {gaps.length ? (
        <ul className={`list-disc pl-4 ${compact ? "mt-1" : "mt-2"}`}>
          {gaps.map((gap) => (
            <li key={gap}>{gap} unavailable</li>
          ))}
        </ul>
      ) : (
        <p className={compact ? "mt-1" : "mt-2"}>The item, reserved quantity, or batch details are unavailable.</p>
      )}
    </div>
  );
}
