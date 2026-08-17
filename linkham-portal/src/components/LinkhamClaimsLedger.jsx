import { useState } from "react";
import toast from "react-hot-toast";
import { formatDate, formatRupees } from "../lib/format.js";
import { cx } from "../lib/utils.js";

const STATUS_TABS = [
  { id: "pending", label: "Pending" },
  { id: "flagged", label: "Flagged" },
  { id: "approved", label: "Approved" },
  { id: "settled", label: "Paid to OCS" },
];

function tabCount(id, ledger) {
  if (id === "pending") return ledger.pendingCount ?? ledger.cleanPendingCount ?? 0;
  if (id === "flagged") return ledger.flaggedPendingCount ?? 0;
  if (id === "approved") return ledger.approvedCount ?? 0;
  if (id === "settled") return ledger.settledCount ?? 0;
  return 0;
}

export default function LinkhamClaimsLedger({
  claims = [],
  statusFilter = "pending",
  month = "",
  search = "",
  pendingCount = 0,
  cleanPendingCount = 0,
  flaggedPendingCount = 0,
  approvedCount = 0,
  settledCount = 0,
  clearableBatchTotal = 0,
  approvedShareTotal = 0,
  onStatusFilter,
  onMonthChange,
  onSearchChange,
  onApproveClaim,
  onSettleClaim,
  onViewSummary,
  onToggleDispute,
  onApproveCleanBatch,
  onSettleApprovedBatch,
  onExportCsv,
  onExportPdf,
  approvingClaimId = null,
  settlingClaimId = null,
  flaggingClaimId = null,
  batchApproving = false,
  batchSettling = false,
}) {
  const [flagClaim, setFlagClaim] = useState(null);
  const [flagReason, setFlagReason] = useState("");

  const ledger = {
    pendingCount,
    cleanPendingCount,
    flaggedPendingCount,
    approvedCount,
    settledCount,
  };

  async function submitFlag() {
    if (!flagClaim) return;
    if (!flagReason.trim()) {
      toast.error("Add a short reason so the clinic can answer.");
      return;
    }
    try {
      await onToggleDispute?.(flagClaim, {
        dispute_status: "Flagged_Review",
        reason: flagReason.trim(),
      });
      setFlagClaim(null);
      setFlagReason("");
    } catch (error) {
      toast.error(error.message || "Could not flag the claim.");
    }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-4 border-b border-gray-100 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-sm font-extrabold text-gray-800">Linkham 80% corporate claims</h3>
          <p className="mt-0.5 text-xs text-gray-400">
            Flag with a reason without blocking a clean batch. Mark approved claims paid once the transfer to OCS has gone out.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onExportCsv}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700"
          >
            Download CSV
          </button>
          <button
            type="button"
            onClick={onExportPdf}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700"
          >
            Download PDF
          </button>
          {statusFilter === "pending" ? (
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
              className="rounded-xl bg-[#065a60] px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {batchApproving ? "Clearing..." : `Clear clean batch · ${formatRupees(clearableBatchTotal)}`}
            </button>
          ) : null}
          {statusFilter === "approved" ? (
            <button
              type="button"
              disabled={batchSettling || approvedCount === 0}
              onClick={async () => {
                try {
                  await onSettleApprovedBatch?.();
                } catch (error) {
                  toast.error(error.message || "Could not mark approved claims paid.");
                }
              }}
              className="rounded-xl bg-[#065a60] px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {batchSettling ? "Saving..." : `Mark approved paid to OCS · ${formatRupees(approvedShareTotal)}`}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onStatusFilter?.(tab.id)}
              className={cx(
                "rounded-lg px-3 py-1.5 text-xs font-bold",
                statusFilter === tab.id
                  ? "bg-[#065a60] text-white"
                  : "bg-gray-50 text-gray-600 hover:bg-gray-100",
              )}
            >
              {tab.label} · {tabCount(tab.id, ledger)}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap gap-2 lg:justify-end">
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder="Search patient or policy"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
          />
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange?.(event.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
          />
          {month ? (
            <button
              type="button"
              onClick={() => onMonthChange?.("")}
              className="text-xs font-bold text-gray-500"
            >
              All months
            </button>
          ) : null}
        </div>
      </div>

      {claims.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100/70 text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                <th className="pb-3">Visit date</th>
                <th className="pb-3">Patient</th>
                <th className="pb-3">Policy</th>
                <th className="pb-3">Copay 20%</th>
                <th className="pb-3">Linkham 80%</th>
                <th className="pb-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => {
                const isApproved = claim.linkham_claim_status === "approved";
                const isSettled = claim.linkham_claim_status === "settled";
                const isFlagged = claim.dispute_status === "Flagged_Review";

                return (
                  <tr
                    key={claim.id}
                    className={cx(
                      "group border-b border-gray-100/70 last:border-0",
                      isFlagged ? "border-l-4 border-l-amber-400 bg-amber-50/40" : "hover:bg-slate-50/50",
                    )}
                  >
                    <td className="py-4 text-xs font-semibold text-gray-500">
                      {formatDate(claim.visit_date)}
                    </td>
                    <td className="py-4 text-xs font-extrabold text-gray-800">
                      {claim.patient_name}
                      <span className="mt-0.5 block font-mono text-[10px] font-bold text-gray-400">
                        {claim.id_short}
                      </span>
                    </td>
                    <td className="py-4 text-xs font-semibold text-gray-600">
                      {claim.policy_number || (
                        <span className="font-bold text-amber-700">Missing</span>
                      )}
                    </td>
                    <td className="py-4 text-xs font-semibold text-gray-600">
                      {formatRupees(claim.patient_copay_amount)}
                      {claim.copay_paid ? (
                        <span className="ml-1 text-[10px] font-normal text-gray-400">(collected)</span>
                      ) : (
                        <span className="ml-1 text-[10px] font-normal text-amber-700">(unpaid)</span>
                      )}
                    </td>
                    <td className="py-4 text-xs font-black text-gray-900">
                      {formatRupees(claim.linkham_share_amount)}
                    </td>
                    <td className="py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onViewSummary?.(claim)}
                          className="rounded-lg bg-[#065a60]/5 px-3 py-1.5 text-xs font-bold text-[#065a60]"
                        >
                          Summary
                        </button>

                        {!isApproved && !isSettled ? (
                          <button
                            type="button"
                            disabled={flaggingClaimId === claim.id}
                            onClick={async () => {
                              if (isFlagged) {
                                try {
                                  await onToggleDispute?.(claim, { dispute_status: "Clean" });
                                } catch (error) {
                                  toast.error(error.message || "Could not remove the flag.");
                                }
                                return;
                              }
                              setFlagClaim(claim);
                              setFlagReason("");
                            }}
                            className={cx(
                              "rounded-lg border px-3 py-1.5 text-xs font-bold",
                              isFlagged
                                ? "border-amber-200/60 bg-amber-50 text-amber-700"
                                : "border-gray-200/40 bg-gray-50 text-gray-500",
                            )}
                          >
                            {flaggingClaimId === claim.id
                              ? "Saving..."
                              : isFlagged
                                ? "Remove flag"
                                : "Flag"}
                          </button>
                        ) : null}

                        {isSettled ? (
                          <span className="rounded-lg border border-emerald-200/60 bg-emerald-50/80 px-3 py-1.5 text-xs font-extrabold text-emerald-700">
                            Paid to OCS
                          </span>
                        ) : isApproved ? (
                          <button
                            type="button"
                            disabled={settlingClaimId === claim.id}
                            onClick={async () => {
                              try {
                                await onSettleClaim?.(claim);
                              } catch (error) {
                                toast.error(error.message || "Could not mark paid to OCS.");
                              }
                            }}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-extrabold text-[#065a60]"
                          >
                            {settlingClaimId === claim.id ? "Saving..." : "Mark paid to OCS"}
                          </button>
                        ) : isFlagged ? (
                          <span className="rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-700">
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
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-extrabold text-[#3e5c76]"
                          >
                            {approvingClaimId === claim.id ? "Saving..." : "Approve"}
                          </button>
                        )}
                      </div>
                      {isFlagged && claim.dispute_reason ? (
                        <p className="mt-2 text-left text-[10px] font-medium text-amber-800">
                          {claim.dispute_reason}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No claims in this filter.</p>
      )}

      {flagClaim ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(34,72,91,0.35)] p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <h4 className="text-sm font-extrabold text-gray-900">Flag claim for clarification</h4>
            <p className="mt-1 text-xs text-gray-500">
              {flagClaim.patient_name} · {formatRupees(flagClaim.linkham_share_amount)}. The clinic sees this reason on the bill.
            </p>
            <textarea
              value={flagReason}
              onChange={(event) => setFlagReason(event.target.value)}
              rows={4}
              maxLength={500}
              placeholder="What needs checking?"
              className="mt-3 w-full rounded-xl border border-gray-200 p-3 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFlagClaim(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitFlag()}
                className="rounded-xl bg-[#065a60] px-4 py-2 text-xs font-bold text-white"
              >
                Send flag
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
