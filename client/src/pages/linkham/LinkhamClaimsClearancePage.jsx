import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import LinkhamClaimsLedger from "../../components/LinkhamClaimsLedger.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { api } from "../../lib/api.js";
import { formatDate, formatRupees } from "../../lib/format.js";
import { LINKHAM_CLAIMS_EVENT } from "../../lib/inventorySync.js";

function openClaimSummaryWindow(summary) {
  const popup = window.open("", "_blank", "noopener,noreferrer,width=720,height=840");
  if (!popup) {
    toast.error("Allow pop-ups to open the verification summary.");
    return;
  }

  popup.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Linkham Verification Summary</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #1f2937; }
          h1 { font-size: 20px; margin-bottom: 8px; }
          p { margin: 6px 0; font-size: 14px; }
          .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
          .label { color: #6b7280; }
          .value { font-weight: 700; }
        </style>
      </head>
      <body>
        <h1>${summary.title}</h1>
        <p>Generated ${new Date(summary.generated_at).toLocaleString()}</p>
        <div class="row"><span class="label">Patient</span><span class="value">${summary.patient_name}</span></div>
        <div class="row"><span class="label">OCS Visit ID</span><span class="value">${summary.visit_id}</span></div>
        <div class="row"><span class="label">Visit date</span><span class="value">${summary.visit_date || "N/A"}</span></div>
        <div class="row"><span class="label">Attending doctor</span><span class="value">${summary.doctor_name || "N/A"}</span></div>
        <div class="row"><span class="label">Total visit amount</span><span class="value">${formatRupees(summary.total_amount)}</span></div>
        <div class="row"><span class="label">Patient copay (20%)</span><span class="value">${formatRupees(summary.patient_copay_amount)}</span></div>
        <div class="row"><span class="label">Linkham share (80%)</span><span class="value">${formatRupees(summary.linkham_share_amount)}</span></div>
        <div class="row"><span class="label">Claim status</span><span class="value">${summary.claim_status}</span></div>
        <div class="row"><span class="label">Dispute status</span><span class="value">${summary.dispute_status || "Clean"}</span></div>
      </body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
}

export default function LinkhamClaimsClearancePage() {
  const [claims, setClaims] = useState([]);
  const [clearableBatchTotal, setClearableBatchTotal] = useState(0);
  const [cleanPendingCount, setCleanPendingCount] = useState(0);
  const [flaggedPendingCount, setFlaggedPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [approvingClaimId, setApprovingClaimId] = useState(null);
  const [flaggingClaimId, setFlaggingClaimId] = useState(null);
  const [batchApproving, setBatchApproving] = useState(false);

  const applyClaimsPayload = useCallback((data) => {
    setClaims(Array.isArray(data?.claims) ? data.claims : []);
    setClearableBatchTotal(Number(data?.clearableBatchTotal || 0));
    setCleanPendingCount(Number(data?.cleanPendingCount || 0));
    setFlaggedPendingCount(Number(data?.flaggedPendingCount || 0));
  }, []);

  const reloadClaims = useCallback(
    async ({ showSpinner = false } = {}) => {
      if (showSpinner) {
        setLoading(true);
      }
      const data = await api.get("/linkham/claims");
      applyClaimsPayload(data);
      if (showSpinner) {
        setLoading(false);
      }
    },
    [applyClaimsPayload],
  );

  useEffect(() => {
    void reloadClaims({ showSpinner: true });
  }, [reloadClaims]);

  useEffect(() => {
    const handleRefresh = () => {
      void reloadClaims();
    };
    window.addEventListener(LINKHAM_CLAIMS_EVENT, handleRefresh);
    return () => window.removeEventListener(LINKHAM_CLAIMS_EVENT, handleRefresh);
  }, [reloadClaims]);

  async function handleApproveClaim(claim) {
    setApprovingClaimId(claim.id);
    try {
      await api.patch(`/linkham/claims/${claim.id}/approve`, {});
      toast.success(`Claim for ${claim.patient_name} approved.`);
      await reloadClaims();
    } finally {
      setApprovingClaimId(null);
    }
  }

  async function handleToggleDispute(claim) {
    const nextStatus =
      claim.dispute_status === "Flagged_Review" ? "Clean" : "Flagged_Review";
    setFlaggingClaimId(claim.id);
    try {
      await api.patch(`/linkham/claims/${claim.id}/dispute`, {
        dispute_status: nextStatus,
      });
      toast.success(
        nextStatus === "Flagged_Review"
          ? "Claim flagged for clarification."
          : "Clarification flag removed.",
      );
      await reloadClaims();
    } finally {
      setFlaggingClaimId(null);
    }
  }

  async function handleApproveCleanBatch() {
    setBatchApproving(true);
    try {
      const result = await api.patch("/linkham/claims/batch-approve-clean", {});
      toast.success(`Cleared ${result?.approvedCount || 0} clean claims.`);
      await reloadClaims();
    } finally {
      setBatchApproving(false);
    }
  }

  async function handleViewSummary(claim) {
    try {
      const data = await api.get(`/linkham/claims/${claim.id}/summary`);
      openClaimSummaryWindow({
        ...data.summary,
        visit_date: data.summary.visit_date ? formatDate(data.summary.visit_date) : "Not set",
      });
    } catch (error) {
      toast.error(error.message || "Could not open verification summary.");
    }
  }

  if (loading) {
    return <LoadingState label="Loading claims clearance ledger" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Linkham insurer portal"
        title="Claims clearance"
        description="Flag disputed line items without blocking clean claim batch settlement."
      />

      <LinkhamClaimsLedger
        claims={claims}
        clearableBatchTotal={clearableBatchTotal}
        cleanPendingCount={cleanPendingCount}
        flaggedPendingCount={flaggedPendingCount}
        approvingClaimId={approvingClaimId}
        flaggingClaimId={flaggingClaimId}
        batchApproving={batchApproving}
        onApproveClaim={handleApproveClaim}
        onToggleDispute={handleToggleDispute}
        onApproveCleanBatch={handleApproveCleanBatch}
        onViewSummary={handleViewSummary}
      />
    </div>
  );
}
