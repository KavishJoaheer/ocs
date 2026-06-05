import toast from "react-hot-toast";
import { formatDate, formatRupees } from "../lib/format.js";
import { api } from "../lib/api.js";

export default function LinkhamClaimsLedger({
  claims = [],
  totalOutstandingClaims = 0,
  onApproveClaim,
  onViewSummary,
  approvingClaimId = null,
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-gray-800">Linkham 80% Corporate Claims Ledger</h3>
        <span className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-bold text-amber-600">
          Outstanding: {formatRupees(totalOutstandingClaims)}
        </span>
      </div>

      {claims.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-semibold text-gray-600">
            <thead>
              <tr className="border-b border-gray-50 text-[10px] uppercase tracking-wider text-gray-400">
                <th className="pb-3">Visit Date</th>
                <th className="pb-3">Patient Name</th>
                <th className="pb-3">OCS Visit ID</th>
                <th className="pb-3">Patient Copay (20%)</th>
                <th className="pb-3">Linkham Share (80%)</th>
                <th className="pb-3">Verification</th>
                <th className="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => {
                const isApproved =
                  claim.linkham_claim_status === "approved" ||
                  claim.linkham_claim_status === "settled";

                return (
                  <tr
                    key={claim.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                  >
                    <td className="py-3.5 text-gray-700">{formatDate(claim.visit_date)}</td>
                    <td className="py-3.5 font-bold text-gray-800">{claim.patient_name}</td>
                    <td className="py-3.5 font-mono text-gray-400">{claim.id_short}</td>
                    <td className="py-3.5 font-bold text-emerald-600">
                      {formatRupees(claim.patient_copay_amount)} (Paid)
                    </td>
                    <td className="py-3.5 font-black text-gray-800">
                      {formatRupees(claim.linkham_share_amount)}
                    </td>
                    <td className="py-3.5">
                      <button
                        type="button"
                        onClick={() => onViewSummary?.(claim)}
                        className="font-bold text-[#557373] hover:underline"
                      >
                        View Summary
                      </button>
                    </td>
                    <td className="py-3.5 text-right">
                      {isApproved ? (
                        <span className="rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
                          Approved
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
                          className="rounded-xl bg-[#557373] px-3 py-1.5 font-bold text-white hover:bg-[#435c5c] disabled:opacity-60"
                        >
                          {approvingClaimId === claim.id ? "Saving..." : "Approve Claim"}
                        </button>
                      )}
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
