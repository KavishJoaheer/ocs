import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import LinkhamClaimSummarySheet from "../../components/LinkhamClaimSummarySheet.jsx";
import LinkhamClaimsLedger from "../../components/LinkhamClaimsLedger.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import Modal from "../../components/Modal.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { api } from "../../lib/api.js";
import { LINKHAM_CLAIMS_EVENT, LINKHAM_PATIENTS_EVENT } from "../../lib/inventorySync.js";
import { downloadLinkhamStatementPdf } from "../../lib/linkhamExports.js";
import { formatRupees } from "../../lib/format.js";

const STATUS_VALUES = new Set(["pending", "flagged", "approved", "settled"]);

function mauritiusToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Indian/Mauritius",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export default function LinkhamClaimsClearancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = STATUS_VALUES.has(searchParams.get("status"))
    ? searchParams.get("status")
    : "pending";
  const month = searchParams.get("month") || "";
  const search = searchParams.get("search") || "";
  const openClaimId = searchParams.get("open");

  const [claims, setClaims] = useState([]);
  const [ledger, setLedger] = useState({});
  const [loading, setLoading] = useState(true);
  const [approvingClaimId, setApprovingClaimId] = useState(null);
  const [settlingClaimId, setSettlingClaimId] = useState(null);
  const [flaggingClaimId, setFlaggingClaimId] = useState(null);
  const [batchApproving, setBatchApproving] = useState(false);
  const [batchSettling, setBatchSettling] = useState(false);
  const selectedClaimId = openClaimId || null;
  const [settlementTarget, setSettlementTarget] = useState(null);
  const [settlementForm, setSettlementForm] = useState({
    payment_date: mauritiusToday(),
    remittance_reference: "",
  });

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
    setSettlementTarget({ type: "claim", claim });
    setSettlementForm({ payment_date: mauritiusToday(), remittance_reference: "" });
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
    setSettlementTarget({ type: "batch" });
    setSettlementForm({ payment_date: mauritiusToday(), remittance_reference: "" });
  }

  async function submitSettlement(event) {
    event.preventDefault();
    const reference = settlementForm.remittance_reference.trim();
    if (reference.length < 3) {
      toast.error("Enter the Linkham bank transfer or remittance reference.");
      return;
    }
    const isBatch = settlementTarget?.type === "batch";
    if (isBatch) setBatchSettling(true);
    else setSettlingClaimId(settlementTarget?.claim?.id || null);
    try {
      if (isBatch) {
        const result = await api.patch("/linkham/claims/batch-settle-approved", {
          month,
          ...settlementForm,
          remittance_reference: reference,
        });
        toast.success(`Recorded Linkham payment for ${result?.settledCount || 0} claims.`);
      } else {
        const claim = settlementTarget?.claim;
        await api.patch(`/linkham/claims/${claim.id}/settle`, {
          amount: claim.linkham_share_amount,
          ...settlementForm,
          remittance_reference: reference,
        });
        toast.success(`Recorded Linkham payment for ${claim.patient_name}.`);
      }
      setSettlementTarget(null);
      await reloadClaims();
    } catch (error) {
      toast.error(error.message || "Could not record the Linkham payment.");
    } finally {
      setSettlingClaimId(null);
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
        onViewSummary={(claim) => {
          updateParams({ open: claim.id });
        }}
      />

      <LinkhamClaimSummarySheet
        open={Boolean(selectedClaimId)}
        claimId={selectedClaimId}
        onClose={() => {
          updateParams({ open: null });
        }}
      />

      <Modal
        open={Boolean(settlementTarget)}
        onClose={() => {
          if (!settlingClaimId && !batchSettling) setSettlementTarget(null);
        }}
        title="Record Linkham payment to OCS"
        description={settlementTarget?.type === "batch"
          ? `Approved claims in this filter · ${formatRupees(ledger.approvedShareTotal || 0)}`
          : settlementTarget?.claim
            ? `${settlementTarget.claim.patient_name} · ${formatRupees(settlementTarget.claim.linkham_share_amount)}`
            : ""}
        size="md"
      >
        <form className="space-y-4" onSubmit={submitSettlement}>
          <label className="block text-sm font-bold text-gray-700">
            Payment date
            <input
              required
              type="date"
              max={mauritiusToday()}
              value={settlementForm.payment_date}
              onChange={(event) => setSettlementForm((current) => ({ ...current, payment_date: event.target.value }))}
              className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-bold text-gray-700">
            Bank transfer or remittance reference
            <input
              required
              minLength={3}
              maxLength={120}
              value={settlementForm.remittance_reference}
              onChange={(event) => setSettlementForm((current) => ({ ...current, remittance_reference: event.target.value }))}
              placeholder="Example: LKH-OCT-2026-001"
              className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2"
            />
          </label>
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900">
            This records an immutable insurer payment against the OCS invoice balance and keeps the reference on the month-end statement.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSettlementTarget(null)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600">Cancel</button>
            <button disabled={Boolean(settlingClaimId) || batchSettling} className="rounded-xl bg-[#065a60] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {settlingClaimId || batchSettling ? "Recording…" : "Confirm payment"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
