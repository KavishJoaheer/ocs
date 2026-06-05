import toast from "react-hot-toast";
import { formatDate, formatRupees } from "../lib/format.js";
import { cx } from "../lib/utils.js";

export default function LinkhamClaimsLedger({
  claims = [],
  clearableBatchTotal = 0,
  cleanPendingCount = 0,
  flaggedPendingCount = 0,
  onApproveClaim,
  onViewSummary,
  onToggleDispute,
  onApproveCleanBatch,
  approvingClaimId = null,
  flaggingClaimId = null,
  batchApproving = false,
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-5">
        <div className="flex flex-col">
          <h3 className="text-sm font-extrabold text-gray-800">Linkham 80% Corporate Claims Ledger</h3>
          <p className="mt-0.5 text-xs text-gray-400">
            Itemized insurance liability billing queue awaiting corporate settlement processing.
          </p>
        </div>

        <div className="flex items-center gap-3.5">
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-600">
              Clean batch: {formatRupees(clearableBatchTotal)}
            </span>
            {flaggedPendingCount > 0 ? (
              <span className="rounded-lg bg-amber-50/80 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-amber-700">
                {flaggedPendingCount} flagged for review
              </span>
            ) : null}
          </div>
          <button
            type="button"
            disabled={batchApproving || cleanPendingCount === 0}
            onClick={async () => {
              try {
                await onApproveCleanBatch?.();
              } catch (error) {
                toast.error(error.message || "Could not clear clean claims batch.");
              }
            }}
            className="rounded-xl bg-[#065a60] px-5 py-2.5 text-xs font-bold text-white shadow-sm shadow-[#065a60]/10 transition-all duration-200 hover:bg-[#054a4f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {batchApproving ? "Clearing..." : "Clear Clean Claims Batch"}
          </button>
        </div>
      </div>

      {claims.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100/70 text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                <th className="pb-3">Visit Date</th>
                <th className="pb-3">Patient Name</th>
                <th className="pb-3">OCS Visit ID</th>
                <th className="pb-3">Patient Copay (20%)</th>
                <th className="pb-3">Linkham Share (80%)</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => {
                const isApproved =
                  claim.linkham_claim_status === "approved" ||
                  claim.linkham_claim_status === "settled";
                const isFlagged = claim.dispute_status === "Flagged_Review";

                return (
                  <tr
                    key={claim.id}
                    className={cx(
                      "group border-b border-gray-100/70 transition-all duration-150 last:border-0",
                      isFlagged
                        ? "border-l-4 border-l-amber-400 bg-amber-50/40"
                        : "hover:bg-slate-50/50",
                    )}
                  >
                    <td className="py-4 text-xs font-semibold text-gray-500">
                      {formatDate(claim.visit_date)}
                    </td>
                    <td className="py-4 text-xs font-extrabold text-gray-800">{claim.patient_name}</td>
                    <td className="py-4 font-mono text-xs font-bold text-gray-400">{claim.id_short}</td>
                    <td className="py-4 text-xs font-semibold text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-emerald-600">✓</span>
                        <span>{formatRupees(claim.patient_copay_amount)}</span>
                        <span className="text-[10px] font-normal text-gray-400">(Paid)</span>
                      </div>
                    </td>
                    <td className="py-4 text-xs font-black text-gray-900">
                      {formatRupees(claim.linkham_share_amount)}
                    </td>
                    <td className="py-4 text-right">
                      <div className="flex items-center justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => onViewSummary?.(claim)}
                          className="rounded-lg bg-[#065a60]/5 px-3 py-1.5 text-xs font-bold text-[#065a60] transition-all hover:bg-[#065a60]/10 hover:text-[#054a4f]"
                        >
                          📄 View Summary
                        </button>

                        {!isApproved ? (
                          <button
                            type="button"
                            disabled={flaggingClaimId === claim.id}
                            onClick={async () => {
                              try {
                                await onToggleDispute?.(claim);
                              } catch (error) {
                                toast.error(error.message || "Could not update clarification flag.");
                              }
                            }}
                            className={cx(
                              "rounded-lg border px-3 py-1.5 text-xs font-bold transition-all",
                              isFlagged
                                ? "border-amber-200/60 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                : "border-gray-200/40 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-800",
                            )}
                          >
                            {flaggingClaimId === claim.id
                              ? "Saving..."
                              : isFlagged
                                ? "Remove Flag"
                                : "Clarify"}
                          </button>
                        ) : null}

                        {isApproved ? (
                          <span className="ml-2 rounded-lg border border-emerald-200/60 bg-emerald-50/80 px-3 py-1.5 text-xs font-extrabold text-emerald-700">
                            Approved
                          </span>
                        ) : isFlagged ? (
                          <span className="ml-2 rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-700 shadow-sm">
                            Flagged
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={approvingClaimId === claim.id}
                            onClick={async () => {
                              try {
                                await onApproveClaim?.(claim);
                              } catch (error) {
                                toast.error(error.message || "Could not approve claim.");
                              }
                            }}
                            className="ml-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-extrabold text-[#3e5c76] shadow-sm transition-all duration-150 hover:border-[#065a60] hover:bg-[#065a60]/5 hover:text-[#065a60] disabled:opacity-60"
                          >
                            {approvingClaimId === claim.id ? "Saving..." : "Approve"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          No paid Linkham visit bills are waiting in the corporate claims ledger.
        </p>
      )}
    </div>
  );
}
