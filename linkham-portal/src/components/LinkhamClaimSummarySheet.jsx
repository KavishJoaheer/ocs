import { useEffect, useState } from "react";
import { X } from "lucide-react";
import toast from "react-hot-toast";
import LoadingState from "./LoadingState.jsx";
import { api } from "../lib/api.js";
import { formatDate, formatRupees } from "../lib/format.js";

function MetadataField({ label, value, valueClassName = "", mono = false, span = 1 }) {
  const content =
    value === null || value === undefined || String(value).trim() === ""
      ? "Not recorded"
      : String(value);

  return (
    <div className={span === 2 ? "col-span-2 flex flex-col gap-0.5" : "flex flex-col gap-0.5"}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <span
        className={[
          mono ? "font-mono" : "",
          "text-sm font-semibold text-gray-800",
          valueClassName,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {content}
      </span>
    </div>
  );
}

function formatClaimStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved") return "Approved";
  if (normalized === "settled") return "Settled";
  if (normalized === "pending") return "Pending clearance";
  return status || "Not recorded";
}

function formatDisputeStatus(status) {
  return String(status || "").trim() === "Flagged_Review" ? "Flagged for review" : "Clean";
}

export default function LinkhamClaimSummarySheet({ claimId, open, onClose }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !claimId) {
      setSummary(null);
      return undefined;
    }

    let ignore = false;

    async function loadSummary() {
      setLoading(true);
      try {
        const data = await api.get(`/linkham/claims/${claimId}/summary`);
        if (!ignore) {
          setSummary(data?.summary || null);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message || "Could not load verification summary.");
          onClose?.();
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadSummary();
    return () => {
      ignore = true;
    };
  }, [open, claimId, onClose]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const generatedLabel = summary?.generated_at
    ? new Date(summary.generated_at).toLocaleString()
    : "Not recorded";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close verification summary"
        className="absolute inset-0 bg-[rgba(34,72,91,0.35)] backdrop-blur-[1px]"
        onClick={onClose}
      />

      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-gray-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
              Claims clearance
            </p>
            <h2 className="text-lg font-bold text-gray-900">Verification summary</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <LoadingState label="Loading verification summary" />
          ) : summary ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 rounded-2xl border border-gray-100 bg-gray-50/50 p-4">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                  Coverage verification anchor
                </span>
                <div className="flex w-full items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Patient
                    </span>
                    <span className="mt-0.5 truncate text-sm font-black text-[#14213d]">
                      {summary.patient_name}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col text-right">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Claim status
                    </span>
                    <span className="mt-0.5 ml-auto w-fit rounded-lg bg-[#065a60]/10 px-2.5 py-1 text-[11px] font-extrabold text-[#065a60]">
                      {formatClaimStatus(summary.claim_status)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h4 className="mb-4 text-xs font-extrabold uppercase tracking-wider text-[#065a60]">
                  Visit details
                </h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                  <MetadataField label="OCS Visit ID" value={summary.visit_id} mono />
                  <MetadataField
                    label="Visit date"
                    value={summary.visit_date ? formatDate(summary.visit_date) : "Not set"}
                  />
                  <MetadataField label="Attending doctor" value={summary.doctor_name} span={2} />
                  <MetadataField label="Generated" value={generatedLabel} span={2} />
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h4 className="mb-4 text-xs font-extrabold uppercase tracking-wider text-[#065a60]">
                  80/20 settlement split
                </h4>
                <div className="grid grid-cols-2 gap-4 rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
                  <div className="col-span-2 flex flex-col gap-0.5 border-b border-gray-200/60 pb-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Total visit amount
                    </span>
                    <span className="text-sm font-black text-[#14213d]">
                      {formatRupees(summary.total_amount)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Patient copay (20%)
                    </span>
                    <span className="text-sm font-black text-emerald-600">
                      {formatRupees(summary.patient_copay_amount)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Linkham share (80%)
                    </span>
                    <span className="text-sm font-black text-gray-900">
                      {formatRupees(summary.linkham_share_amount)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <h4 className="mb-4 text-xs font-extrabold uppercase tracking-wider text-[#065a60]">
                  Dispute review
                </h4>
                <MetadataField
                  label="Dispute status"
                  value={formatDisputeStatus(summary.dispute_status)}
                  valueClassName={
                    summary.dispute_status === "Flagged_Review" ? "text-amber-700" : "text-emerald-700"
                  }
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Verification summary unavailable.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
