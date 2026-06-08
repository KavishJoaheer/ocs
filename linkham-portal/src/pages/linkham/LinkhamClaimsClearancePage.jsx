import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import LinkhamClaimSummarySheet from "../../components/LinkhamClaimSummarySheet.jsx";
import LinkhamClaimsLedger from "../../components/LinkhamClaimsLedger.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { api } from "../../lib/api.js";
import { LINKHAM_CLAIMS_EVENT } from "../../lib/inventorySync.js";

export default function LinkhamClaimsClearancePage() {
  const [claims, setClaims] = useState([]);
  const [clearableBatchTotal, setClearableBatchTotal] = useState(0);
  const [cleanPendingCount, setCleanPendingCount] = useState(0);
  const [flaggedPendingCount, setFlaggedPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [approvingClaimId, setApprovingClaimId] = useState(null);
  const [flaggingClaimId, setFlaggingClaimId] = useState(null);
  const [batchApproving, setBatchApproving] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState(null);

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

  function handleViewSummary(claim) {
    setSelectedClaimId(claim.id);
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

      <LinkhamClaimSummarySheet
        open={Boolean(selectedClaimId)}
        claimId={selectedClaimId}
        onClose={() => setSelectedClaimId(null)}
      />
    </div>
  );
}
