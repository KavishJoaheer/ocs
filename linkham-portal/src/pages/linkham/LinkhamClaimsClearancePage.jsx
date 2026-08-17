import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import LinkhamClaimSummarySheet from "../../components/LinkhamClaimSummarySheet.jsx";
import LinkhamClaimsLedger from "../../components/LinkhamClaimsLedger.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { api } from "../../lib/api.js";
import { LINKHAM_CLAIMS_EVENT, LINKHAM_PATIENTS_EVENT } from "../../lib/inventorySync.js";
import { downloadLinkhamStatementPdf } from "../../lib/linkhamExports.js";

const STATUS_VALUES = new Set(["pending", "flagged", "approved", "settled"]);

export default function LinkhamClaimsClearancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = STATUS_VALUES.has(searchParams.get("status"))
    ? searchParams.get("status")
    : "pending";
  const month = searchParams.get("month") || "";
  const search = searchParams.get("search") || "";

  const [claims, setClaims] = useState([]);
  const [ledger, setLedger] = useState({});
  const [loading, setLoading] = useState(true);
  const [approvingClaimId, setApprovingClaimId] = useState(null);
  const [settlingClaimId, setSettlingClaimId] = useState(null);
  const [flaggingClaimId, setFlaggingClaimId] = useState(null);
  const [batchApproving, setBatchApproving] = useState(false);
  const [batchSettling, setBatchSettling] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState(null);

  function updateParams(next) {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value == null || value === "") {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    });
    setSearchParams(params);
  }

  const applyClaimsPayload = useCallback((data) => {
    setClaims(Array.isArray(data?.claims) ? data.claims : []);
    setLedger({
      clearableBatchTotal: Number(data?.clearableBatchTotal || 0),
      approvedShareTotal: Number(data?.approvedShareTotal || 0),
      pendingCount: Number(data?.pendingCount || data?.cleanPendingCount || 0),
      cleanPendingCount: Number(data?.cleanPendingCount || 0),
      flaggedPendingCount: Number(data?.flaggedPendingCount || 0),
      approvedCount: Number(data?.approvedCount || 0),
      settledCount: Number(data?.settledCount || 0),
    });
  }, []);

  const reloadClaims = useCallback(
    async ({ showSpinner = false } = {}) => {
      if (showSpinner) {
        setLoading(true);
      }
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (month) params.set("month", month);
      const data = await api.get(`/linkham/claims?${params.toString()}`);
      applyClaimsPayload(data);
      if (showSpinner) {
        setLoading(false);
      }
    },
    [applyClaimsPayload, statusFilter, month],
  );

  useEffect(() => {
    void reloadClaims({ showSpinner: true });
  }, [reloadClaims]);

  useEffect(() => {
    const handleRefresh = () => {
      void reloadClaims();
    };
    window.addEventListener(LINKHAM_CLAIMS_EVENT, handleRefresh);
    window.addEventListener(LINKHAM_PATIENTS_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(LINKHAM_CLAIMS_EVENT, handleRefresh);
      window.removeEventListener(LINKHAM_PATIENTS_EVENT, handleRefresh);
    };
  }, [reloadClaims]);

  const visibleClaims = useMemo(() => {
    const needle = search.trim().replace(/^#/, "").toLowerCase();
    if (!needle) return claims;
    return claims.filter((claim) =>
      [claim.patient_name, claim.patient_identifier, claim.policy_number]
        .map((value) => String(value || "").toLowerCase())
        .some((value) => value.includes(needle)),
    );
  }, [claims, search]);

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

  async function handleSettleClaim(claim) {
    setSettlingClaimId(claim.id);
    try {
      await api.patch(`/linkham/claims/${claim.id}/settle`, {});
      toast.success(`Marked paid to OCS for ${claim.patient_name}.`);
      await reloadClaims();
    } finally {
      setSettlingClaimId(null);
    }
  }

  async function handleToggleDispute(claim, payload) {
    setFlaggingClaimId(claim.id);
    try {
      await api.patch(`/linkham/claims/${claim.id}/dispute`, payload);
      toast.success(
        payload.dispute_status === "Flagged_Review"
          ? "Claim flagged for the clinic."
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

  async function handleSettleApprovedBatch() {
    setBatchSettling(true);
    try {
      const result = await api.patch("/linkham/claims/batch-settle-approved", { month });
      toast.success(`Marked ${result?.settledCount || 0} claims paid to OCS.`);
      await reloadClaims();
    } finally {
      setBatchSettling(false);
    }
  }

  async function handleExportCsv() {
    const params = new URLSearchParams();
    params.set("status", statusFilter);
      if (month) params.set("month", month);
    const { blob, filename } = await api.getBlob(`/linkham/claims/statement.csv?${params.toString()}`);
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename || "linkham-statement.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
  }

  if (loading) {
    return <LoadingState label="Loading claims clearance ledger" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Linkham insurer portal"
        title="Claims clearance"
        description="Pending, flagged, approved, and paid-to-OCS. Export the current filter as CSV or PDF."
      />

      <LinkhamClaimsLedger
        claims={visibleClaims}
        statusFilter={statusFilter}
        month={month}
        search={search}
        {...ledger}
        approvingClaimId={approvingClaimId}
        settlingClaimId={settlingClaimId}
        flaggingClaimId={flaggingClaimId}
        batchApproving={batchApproving}
        batchSettling={batchSettling}
        onStatusFilter={(value) => updateParams({ status: value })}
        onMonthChange={(value) => updateParams({ month: value })}
        onSearchChange={(value) => updateParams({ search: value })}
        onApproveClaim={handleApproveClaim}
        onSettleClaim={handleSettleClaim}
        onToggleDispute={handleToggleDispute}
        onApproveCleanBatch={handleApproveCleanBatch}
        onSettleApprovedBatch={handleSettleApprovedBatch}
        onExportCsv={() => void handleExportCsv()}
        onExportPdf={() =>
          void downloadLinkhamStatementPdf(claims, { month, status: statusFilter })
        }
        onViewSummary={(claim) => setSelectedClaimId(claim.id)}
      />

      <LinkhamClaimSummarySheet
        open={Boolean(selectedClaimId)}
        claimId={selectedClaimId}
        onClose={() => setSelectedClaimId(null)}
      />
    </div>
  );
}
