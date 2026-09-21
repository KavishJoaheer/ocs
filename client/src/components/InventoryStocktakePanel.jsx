import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, ChevronLeft, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile, DENSE_TABLE_BREAKPOINT } from "../hooks/useIsMobile.js";
import { cx } from "../lib/utils.js";
import { canCountStocktake, canReviewStocktake, withOperationalOverride } from "../lib/inventoryAccess.js";
import { setUnsavedWork } from "../lib/unsavedWork.js";
import EmergencyOverrideDialog from "./EmergencyOverrideDialog.jsx";

function isBlankCount(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function formatCountDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatSignedCount(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

function formatCountValue(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "—";
}

function formatSavedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function lineMovements(line) {
  return Array.isArray(line?.movements_since) ? line.movements_since : [];
}

function isCountMismatch(line) {
  return Number(line?.variance || 0) !== 0;
}

function isSurplusCount(line) {
  return Number(line?.variance || 0) > 0;
}

function surplusLotReady(line) {
  const expiryOk = Boolean(line?.surplus_is_non_expiring) || Boolean(String(line?.surplus_expiry_date || "").trim());
  const supplierOk = String(line?.surplus_supplier_name || "").trim().length >= 2;
  const deliveredOk = Boolean(String(line?.surplus_received_date || "").trim());
  return expiryOk && supplierOk && deliveredOk;
}

function SurplusLotFields({ line, disabled, onChange }) {
  const extra = Number(line.variance || 0);
  const nonExpiring = Boolean(line.surplus_is_non_expiring);
  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-white px-3 py-3">
      <p className="font-semibold text-slate-900">{line.item_name}</p>
      <p className="text-xs text-slate-600">
        Extra {extra} {extra === 1 ? "becomes" : "become"} a new lot. Record the supplier and delivery date for that new supply. The old lot stays as it is.
      </p>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={nonExpiring}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              surplus_is_non_expiring: event.target.checked,
              surplus_expiry_date: event.target.checked ? "" : line.surplus_expiry_date,
            })
          }
        />
        Does not expire
      </label>
      <label className="space-y-1 text-xs font-semibold text-slate-600">
        New lot expiry
        <input
          type="date"
          disabled={disabled || nonExpiring}
          value={String(line.surplus_expiry_date || "").slice(0, 10)}
          onChange={(event) => onChange({ surplus_expiry_date: event.target.value, surplus_is_non_expiring: false })}
          className="min-h-11 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal text-slate-800"
        />
      </label>
      <label className="space-y-1 text-xs font-semibold text-slate-600">
        Supplier
        <input
          type="text"
          disabled={disabled}
          value={line.surplus_supplier_name || ""}
          onChange={(event) => onChange({ surplus_supplier_name: event.target.value })}
          placeholder="Who delivered this stock?"
          className="min-h-11 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal text-slate-800"
        />
      </label>
      <label className="space-y-1 text-xs font-semibold text-slate-600">
        Date of delivery
        <input
          type="date"
          disabled={disabled}
          value={String(line.surplus_received_date || "").slice(0, 10)}
          onChange={(event) => onChange({ surplus_received_date: event.target.value })}
          className="min-h-11 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal text-slate-800"
        />
      </label>
      <label className="space-y-1 text-xs font-semibold text-slate-600">
        Unit cost (optional — leave blank to copy last known)
        <input
          type="number"
          min="0"
          step="0.01"
          disabled={disabled}
          value={line.surplus_unit_cost ?? ""}
          onChange={(event) => onChange({ surplus_unit_cost: event.target.value })}
          className="min-h-11 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal text-slate-800"
        />
      </label>
    </div>
  );
}

function hasUnexplainedMovement(line) {
  return Number(line?.unexplained_movement_quantity || 0) !== 0;
}

function countStatusLabel(status) {
  return {
    draft: "Not started",
    in_progress: "In progress",
    recount_required: "Recount required",
    submitted: "Awaiting approval",
    approved: "Approved",
    rejected: "Rejected",
    applied: "Completed",
    cancelled: "Cancelled",
  }[status] || status;
}

function InventoryStocktakePanel({ folders = [], items = [], doctors = [], onApplied, sessions = [], requestedStatus = "" }) {
  const { user } = useAuth();
  const canCount = canCountStocktake(user);
  const canReview = canReviewStocktake(user);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const isMobile = useIsMobile(DENSE_TABLE_BREAKPOINT);
  const [scope, setScope] = useState("");
  const [scopePreview, setScopePreview] = useState(null);
  const [active, setActive] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmFullOpen, setConfirmFullOpen] = useState(false);
  const [mobileIndex, setMobileIndex] = useState(0);
  const [reviewUncounted, setReviewUncounted] = useState(false);
  const [reviewMismatchesOnly, setReviewMismatchesOnly] = useState(false);
  const [finalReview, setFinalReview] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [applying, setApplying] = useState(false);
  const [editedIds, setEditedIds] = useState({});

  useEffect(() => {
    setUnsavedWork("stocktake", Object.keys(editedIds).length > 0);
    return () => setUnsavedWork("stocktake", false);
  }, [editedIds]);

  const bagDoctors = useMemo(
    () => (Array.isArray(doctors) ? doctors.filter((doctor) => doctor?.id) : []),
    [doctors],
  );
  const isBagScope = String(scope).startsWith("bag:");
  const bagDoctorId = isBagScope ? Number(String(scope).slice(4)) || null : null;
  const selectedBagDoctor = bagDoctorId
    ? bagDoctors.find((doctor) => Number(doctor.id) === bagDoctorId)
    : null;
  const scopedItems = useMemo(() => {
    if (isBagScope) return [];
    return scope && scope !== "all" ? items.filter((item) => String(item.folder_id) === String(scope)) : items;
  }, [items, scope, isBagScope]);
  const selectedFolderName = !scope
    ? "No location selected"
    : isBagScope
      ? `${String(selectedBagDoctor?.full_name || "Doctor").trim()}'s bag`
      : scope === "all"
        ? "All OCS folders"
        : folders.find((folder) => String(folder.id) === String(scope))?.name || "Selected folder";
  const fullCatalogue = scope === "all" || isBagScope;
  const scopeChosen = Boolean(scope);

  useEffect(() => {
    if (!scopeChosen) {
      setScopePreview(null);
      return undefined;
    }
    let cancelled = false;
    const params = new URLSearchParams();
    if (isBagScope && bagDoctorId) {
      params.set("doctor_id", String(bagDoctorId));
    } else if (!fullCatalogue && scope) {
      params.set("folder_id", String(scope));
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    api
      .get(`/inventory/stocktake/scope${suffix}`)
      .then((payload) => {
        if (!cancelled) setScopePreview(payload);
      })
      .catch(() => {
        if (!cancelled) setScopePreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, fullCatalogue, scopeChosen, isBagScope, bagDoctorId]);

  useEffect(() => {
    if (!requestedStatus) return;
    const match = (sessions || []).find((session) => session.status === requestedStatus);
    if (match) void openSession(match.id);
    // Only react to summary-card selection; do not re-open on session polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedStatus]);

  async function startStocktakeSession({ confirmAll = false } = {}) {
    if (!scopeChosen) return;
    if (fullCatalogue && !confirmAll) {
      setConfirmFullOpen(true);
      return;
    }
    setCreating(true);
    try {
      const payload = await api.post("/inventory/stocktake/sessions", {
        folder_id: isBagScope || fullCatalogue ? null : Number(scope),
        doctor_id: bagDoctorId,
        confirm_all: fullCatalogue || isBagScope,
        expected_item_count: scopePreview?.item_count ?? scopedItems.length,
        scope_token: scopePreview?.scope_token,
      });
      setActive(payload.session);
      setLastSavedAt(payload.session?.last_saved_at || "");
      setConfirmFullOpen(false);
      setMobileIndex(0);
      setFinalReview(false);
      setEditedIds({});
      toast.success("Stock count started. System quantities stay hidden until you submit.");
    } catch (error) {
      toast.error(error.message || "Could not start the stock count.");
    } finally {
      setCreating(false);
    }
  }

  async function createSession() {
    await startStocktakeSession();
  }

  async function openSession(id) {
    try {
      const payload = await api.get(`/inventory/stocktake/sessions/${id}`);
      setActive(payload.session);
      setLastSavedAt(payload.session?.last_saved_at || "");
      setMobileIndex(0);
      setFinalReview(false);
      setReviewUncounted(false);
      setEditedIds({});
    } catch (error) {
      toast.error(error.message || "Could not open this session.");
    }
  }

  function editedLines() {
    return (active?.items || [])
      .filter((line) => editedIds[line.id] && !isBlankCount(line.physical_quantity))
      .map((line) => ({
        id: line.id,
        physical_quantity: line.physical_quantity,
        reason: line.reason || "",
        conflict_detected_at: line.conflict_detected_at || "",
        expected_row_version: line.live_row_version,
        conflict: String(line.conflict_status || "") === "recount_required",
      }));
  }

  function uncountedLines() {
    return (active?.items || []).filter((line) => isBlankCount(line.physical_quantity));
  }

  function isClosedSession(status) {
    return ["rejected", "cancelled", "applied"].includes(status);
  }

  async function persistEditedLines() {
    const pending = editedLines();
    const ordinary = pending.filter((line) => !line.conflict);
    const recount = pending.filter((line) => line.conflict);
    if (!ordinary.length && !recount.length) return active;
    let session = active;
    if (ordinary.length) {
      const payload = await api.patch(`/inventory/stocktake/sessions/${active.id}`, {
        lines: ordinary.map(({ id, physical_quantity, reason }) => ({ id, physical_quantity, reason })),
      });
      session = payload.session;
    }
    if (recount.length) {
      const payload = await api.post(`/inventory/stocktake/sessions/${active.id}/recount`, {
        lines: recount.map((line) => ({
          id: line.id,
          physical_quantity: line.physical_quantity,
          reason: line.reason,
          conflict_detected_at: line.conflict_detected_at,
          expected_row_version: line.expected_row_version,
        })),
      });
      session = payload.session;
    }
    setActive(session);
    setLastSavedAt(session?.last_saved_at || new Date().toISOString());
    setEditedIds({});
    return session;
  }

  async function saveProgress({ silent = false } = {}) {
    if (!active) return;
    const pending = editedLines();
    if (!pending.length) {
      if (!silent) toast.success("No new counts to save.");
      return;
    }
    setSaving(true);
    try {
      await persistEditedLines();
      if (!silent) toast.success(pending.some((line) => line.conflict) ? "Recount saved." : "Counts saved.");
    } catch (error) {
      toast.error(error.message || "Could not save counts.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function submitSession() {
    if (!active) return;
    const remaining = uncountedLines().length;
    if (remaining > 0) {
      toast.error(
        `${remaining} line${remaining === 1 ? "" : "s"} still uncounted. Enter a count, including 0 where the shelf is empty, before submitting.`,
      );
      setReviewUncounted(true);
      return;
    }
    if (isMobile && !finalReview) {
      setFinalReview(true);
      return;
    }
    setSaving(true);
    try {
      if (Object.keys(editedIds).length) {
        await persistEditedLines();
      }
      const payload = await api.post(`/inventory/stocktake/sessions/${active.id}/submit`);
      setActive(payload.session);
      setEditedIds({});
      toast.success("Stock count submitted for approval.");
      await onApplied?.();
    } catch (error) {
      if (error.status === 409 && error.data?.session) {
        setActive(error.data.session);
      }
      toast.error(error.message || "Could not submit this session.");
    } finally {
      setSaving(false);
    }
  }

  async function review(decision) {
    if (!active) return;
    if (decision === "rejected" && String(rejectReason).trim().length < 10) {
      toast.error("A reason of at least 10 characters is required to reject this session.");
      return;
    }
    try {
      const payload = await api.post(`/inventory/stocktake/sessions/${active.id}/review`, {
        decision,
        reason: rejectReason,
      });
      setActive(payload.session);
      setRejectReason("");
      if (decision === "rejected") {
        toast.success("Stock count rejected.");
      } else if (payload.session?.status === "applied") {
        toast.success("This count is now the official stock count.");
      } else {
        toast.success("Approved. Apply differences to update stock.");
      }
      await onApplied?.();
    } catch (error) {
      toast.error(error.message || "Could not review this session.");
    }
  }

  function surplusPayloadLines() {
    return (active?.items || [])
      .filter((line) => isSurplusCount(line))
      .map((line) => ({
        id: line.id,
        surplus_expiry_date: line.surplus_expiry_date || "",
        surplus_is_non_expiring: Boolean(line.surplus_is_non_expiring),
        surplus_unit_cost: line.surplus_unit_cost ?? "",
        surplus_supplier_name: line.surplus_supplier_name || "",
        surplus_received_date: line.surplus_received_date || "",
      }));
  }

  async function saveNewLots() {
    if (!active) return;
    const lines = surplusPayloadLines();
    if (!lines.length) return;
    setSaving(true);
    try {
      const payload = await api.patch(`/inventory/stocktake/sessions/${active.id}/new-lots`, { lines });
      setActive(payload.session);
      toast.success("New lot details saved.");
    } catch (error) {
      toast.error(error.message || "Could not save new lot details.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function applySession() {
    if (!active || applying) return;
    const surplusLines = surplusPayloadLines();
    if (surplusLines.length && surplusLines.some((line) => !surplusLotReady(line))) {
      toast.error("Enter the new lot expiry, supplier, and delivery date before applying.");
      return;
    }
    setApplying(true);
    try {
      const payload = await api.post(`/inventory/stocktake/sessions/${active.id}/apply`, {
        lines: surplusLines,
      });
      setActive(payload.session);
      toast.success(payload.idempotent ? "Adjustments were already applied." : "Approved variances applied.");
      await onApplied?.();
    } catch (error) {
      if (error.status === 409 && error.data?.session) {
        setActive(error.data.session);
      }
      toast.error(error.message || "Could not apply this session.");
    } finally {
      setApplying(false);
    }
  }

  async function exportSession() {
    if (!active) return;
    try {
      const { blob, filename } = await api.getBlob(`/inventory/stocktake/sessions/${active.id}/export.csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || `stock-count-${active.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.message || "CSV export failed.");
    }
  }

  function updateLine(id, physical_quantity) {
    setEditedIds((current) => ({ ...current, [id]: true }));
    setActive((current) => ({
      ...current,
      items: current.items.map((row) => (row.id === id ? { ...row, physical_quantity } : row)),
    }));
  }

  function updateSurplus(id, patch) {
    setActive((current) => ({
      ...current,
      items: current.items.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  }

  const rows = active?.items || [];
  const submitted = ["submitted", "approved", "rejected", "applied"].includes(active?.status);
  const recountRequired = active?.status === "recount_required";
  const remainingUncounted = active && (!submitted || recountRequired) ? uncountedLines().length : 0;
  const canEditCounts = Boolean(canCount && active && ["draft", "in_progress", "recount_required"].includes(active.status));
  const counted = Number(active?.counted_count || rows.filter((row) => !isBlankCount(row.physical_quantity)).length);
  const total = Number(active?.item_count || rows.length);
  const progress = total ? Math.round((counted / total) * 100) : 0;
  const surplusRows = submitted ? rows.filter((line) => isSurplusCount(line)) : [];
  const canEditNewLots = Boolean(
    (canCount || canReview) && active && ["submitted", "approved"].includes(active.status),
  );
  const surplusLotsReady = surplusRows.every((line) => surplusLotReady(line));
  const mismatchRows = rows.filter((line) => isCountMismatch(line) || hasUnexplainedMovement(line));
  const visibleRows = submitted && reviewMismatchesOnly
    ? mismatchRows
    : reviewUncounted && canEditCounts
      ? uncountedLines()
      : rows;
  const mobileRows = reviewUncounted ? uncountedLines() : rows;
  const mobileLine = mobileRows[mobileIndex] || null;

  useEffect(() => {
    if (mobileIndex >= mobileRows.length) setMobileIndex(0);
  }, [mobileRows.length, mobileIndex]);

  return (
    <>
    <SectionCard
      title="Stock Count"
          subtitle="Operators count the shelf or a doctor bag. Admin then compares this count with the last recorded count, including stock that moved in between."
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
          <ClipboardCheck className="size-3.5" />
          Count history
        </span>
      }
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Location
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setConfirmFullOpen(false);
            }}
            className="min-h-11 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case text-slate-800"
          >
            <option value="">Select a location…</option>
            <optgroup label="Warehouse">
              <option value="all">All OCS folders</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </optgroup>
            {bagDoctors.length ? (
              <optgroup label="Doctor bags">
                {bagDoctors.map((doctor) => (
                  <option key={`bag-${doctor.id}`} value={`bag:${doctor.id}`}>
                    {String(doctor.full_name || "Doctor").trim()}'s bag
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        {canCount ? (
          <button
            type="button"
            disabled={creating || !scopeChosen || !scopePreview?.scope_token}
            onClick={createSession}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-600"
          >
            Start Stock Count
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOverrideOpen(true)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-800"
          >
            Emergency operational override
          </button>
        )}
      </div>
      <div className="mb-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <p>Scope: <strong>{selectedFolderName}</strong></p>
        <p>Items in scope: <strong>{scopePreview?.item_count ?? scopedItems.length}</strong></p>
        <p>Counter / assignee: <strong>{user?.full_name || user?.username || "You"}</strong></p>
        {scope === "all" ? (
          <p className="mt-2 font-semibold text-amber-800">
            All OCS folders will be counted ({scopePreview?.item_count ?? scopedItems.length} items). Confirm before starting a full-catalogue session.
          </p>
        ) : isBagScope ? (
          <p className="mt-2 font-semibold text-amber-800">
            {selectedFolderName} will be counted ({scopePreview?.item_count ?? 0} items). Confirm before starting a bag count.
          </p>
        ) : !scopeChosen ? (
          <p className="mt-2 text-slate-500">Choose a warehouse folder, all folders, or a doctor bag before starting.</p>
        ) : null}
      </div>
      {recountRequired ? (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Recount required</p>
          <p className="mt-1 text-xs">
            Stock moved after this count. Recount the conflicted lines, then resubmit. Baseline, live quantity and the
            latest movement time are shown only for those lines.
          </p>
        </div>
      ) : null}
      {!canCount && !active ? (
        <p className="mb-4 text-sm text-slate-600">
          Operators start and submit a stock count. Administrators compare this count with the last recorded count before approving.
        </p>
      ) : null}

      {sessions.length ? (
        <div className="mb-4 space-y-2">
          {sessions.slice(0, 12).map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => openSession(session.id)}
              className={cx(
                "flex min-h-11 w-full flex-col rounded-2xl border px-3 py-2 text-left text-xs sm:flex-row sm:items-center sm:justify-between",
                String(active?.id) === String(session.id) ? "border-[#2d8f98] bg-[#ecf8f7]" : "border-slate-200 text-slate-600",
              )}
            >
              <span className="font-semibold">
                Count #{session.id} · {session.folder_name || "All OCS folders"} · {countStatusLabel(session.status)}
              </span>
              <span>
                {session.assigned_counter_name || session.created_by_name || "Counter"} · {session.progress_percent || 0}% ·{" "}
                {formatSavedAt(session.last_saved_at)}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Count #{active.id} · {countStatusLabel(active.status)} · {counted} of {total} ({progress}%)
            {lastSavedAt ? ` · saved ${formatSavedAt(lastSavedAt)}` : ""}
          </p>
          {saving ? <p className="text-xs text-slate-500" aria-live="polite">Saving progress…</p> : null}

          {submitted ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <p>
                A good count matches expected: last official count plus recorded stock in or out since then.
                A difference means this physical count does not match the system after those movements.
              </p>
              <p className="mt-1">Matches expected: <strong>{Math.max(0, (active.counted_count || 0) - (active.discrepancy_count || 0))}</strong></p>
              <p>Does not match: <strong className={Number(active.discrepancy_count || 0) > 0 ? "text-rose-700" : ""}>{active.discrepancy_count ?? 0}</strong></p>
              <p>Total quantity difference: <strong>{formatSignedCount(active.open_variance_qty)}</strong></p>
              {surplusRows.length ? (
                <p className="mt-2 text-sm text-amber-900">
                  Extra counted stock is a new lot. Prefer receiving the delivery first, then counting. If you counted the new supply here, enter its expiry, supplier, and delivery date below so the old lot stays unchanged.
                </p>
              ) : null}
            </div>
          ) : null}

          {isMobile && !canEditCounts ? (
            <div className="space-y-2 lg:hidden">
              {rows.map((line) => (
                <div key={line.id} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
                  <p className="font-semibold text-slate-900">{line.item_name}</p>
                  <p className="text-xs text-slate-500">
                    This count {formatCountValue(line.physical_quantity)}
                    {submitted
                      ? ` · Last count ${formatCountValue(line.previous_count_quantity)}${
                          line.previous_count_at ? ` (${formatCountDate(line.previous_count_at)})` : ""
                        } · Since then ${formatSignedCount(line.movement_since_quantity)} · Expected ${formatCountValue(line.expected_quantity ?? line.system_quantity)} · Difference ${formatSignedCount(line.variance)}`
                      : ""}
                  </p>
                  {submitted && lineMovements(line).length ? (
                    <ul className="mt-2 space-y-1 text-xs text-slate-600">
                      {lineMovements(line).map((entry) => (
                        <li key={entry.id}>
                          {formatCountDate(entry.created_at)} · {entry.summary}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {submitted && isCountMismatch(line) ? (
                    <p className="mt-2 text-xs font-semibold text-rose-700">This physical count does not match expected.</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {isMobile && canEditCounts ? (
            finalReview ? (
              <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                <p className="font-semibold text-slate-900">Final review</p>
                <p className="text-sm text-slate-600">{counted} of {total} counted. System quantities remain hidden until submission.</p>
                <button
                  type="button"
                  onClick={() => setFinalReview(false)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold"
                >
                  Back to counting
                </button>
              </div>
            ) : mobileLine ? (
              <div className="space-y-4 rounded-2xl border border-slate-200 p-4">
                <p className="sticky top-0 bg-white pb-2 text-base font-bold text-slate-900">{mobileLine.item_name}</p>
                <p className="text-xs text-slate-500">{mobileIndex + 1} of {mobileRows.length}</p>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Physical count</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={mobileLine.physical_quantity ?? ""}
                    onChange={(event) => updateLine(mobileLine.id, event.target.value)}
                    className="w-full min-h-11 rounded-xl border border-slate-200 px-3 text-lg"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => updateLine(mobileLine.id, "0")}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 text-sm font-semibold"
                >
                  Counted as zero
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={mobileIndex <= 0}
                    onClick={() => setMobileIndex((value) => Math.max(0, value - 1))}
                    className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 disabled:opacity-40"
                  >
                    <ChevronLeft className="size-4" /> Previous
                  </button>
                  <button
                    type="button"
                    disabled={mobileIndex >= mobileRows.length - 1}
                    onClick={() => setMobileIndex((value) => Math.min(mobileRows.length - 1, value + 1))}
                    className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-slate-200 disabled:opacity-40"
                  >
                    Next <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No remaining uncounted items.</p>
            )
          ) : isMobile ? null : (
            <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 lg:block">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    {submitted ? <th className="px-3 py-2 text-right">Last count</th> : null}
                    {submitted ? <th className="px-3 py-2 text-right">Since then</th> : null}
                    {submitted ? <th className="px-3 py-2 text-left">What moved</th> : null}
                    {submitted ? <th className="px-3 py-2 text-right">Expected</th> : null}
                    <th className="px-3 py-2 text-right">This count</th>
                    {submitted ? <th className="px-3 py-2 text-right">Difference</th> : null}
                    {recountRequired ? <th className="px-3 py-2 text-left">Conflict</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((line) => (
                    <tr
                      key={line.id}
                      className={isCountMismatch(line) || hasUnexplainedMovement(line) ? "bg-rose-50" : ""}
                    >
                      <td className="px-3 py-2 font-semibold text-slate-800">{line.item_name}</td>
                      {submitted ? (
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCountValue(line.previous_count_quantity)}
                          {line.previous_count_at ? (
                            <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-slate-400">
                              {formatCountDate(line.previous_count_at)}
                            </span>
                          ) : null}
                        </td>
                      ) : null}
                      {submitted ? (
                        <td className="px-3 py-2 text-right tabular-nums">{formatSignedCount(line.movement_since_quantity)}</td>
                      ) : null}
                      {submitted ? (
                        <td className="px-3 py-2 text-left text-xs font-medium text-slate-600">
                          {lineMovements(line).length ? (
                            <ul className="space-y-1">
                              {lineMovements(line).map((entry) => (
                                <li key={entry.id}>
                                  <span className="block text-slate-800">{entry.summary}</span>
                                  <span className="block text-[10px] font-medium text-slate-400">
                                    {formatCountDate(entry.created_at)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            "No recorded stock in or out"
                          )}
                          {hasUnexplainedMovement(line) ? (
                            <p className="mt-1 font-semibold text-rose-700">
                              Unexplained {formatSignedCount(line.unexplained_movement_quantity)} vs last count
                            </p>
                          ) : null}
                        </td>
                      ) : null}
                      {submitted ? (
                        <td className="px-3 py-2 text-right tabular-nums">{formatCountValue(line.expected_quantity ?? line.system_quantity)}</td>
                      ) : null}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          disabled={!canEditCounts}
                          value={line.physical_quantity ?? ""}
                          onChange={(event) => updateLine(line.id, event.target.value)}
                          className="min-h-11 w-24 rounded-lg border border-slate-200 px-2 py-1 text-right"
                        />
                      </td>
                      {submitted ? (
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${isCountMismatch(line) ? "text-rose-700" : "text-slate-800"}`}>
                          {formatSignedCount(line.variance)}
                        </td>
                      ) : null}
                      {recountRequired ? (
                        <td className="px-3 py-2 text-xs text-amber-800">
                          {line.conflict_status === "recount_required"
                            ? `${line.conflict_reason || "Recount this line."} Baseline ${line.expected_quantity ?? "—"} · live ${line.live_quantity ?? line.conflict_live_quantity ?? "—"}`
                            : "No conflict"}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {surplusRows.length ? (
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-950">New lots from extra counted stock</p>
              {surplusRows.map((line) => (
                <SurplusLotFields
                  key={line.id}
                  line={line}
                  disabled={!canEditNewLots}
                  onChange={(patch) => updateSurplus(line.id, patch)}
                />
              ))}
              {canEditNewLots ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveNewLots().catch(() => {})}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-950 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save new lot details"}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {!submitted ? (
              <>
                {remainingUncounted > 0 ? (
                  <p className="w-full text-xs font-semibold text-amber-700">
                    {remainingUncounted} line{remainingUncounted === 1 ? "" : "s"} still uncounted. Blank is not zero.
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={saving || !canEditCounts}
                  onClick={() => void saveProgress().catch(() => {})}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold"
                >
                  {saving ? "Saving…" : recountRequired ? "Save recount" : lastSavedAt ? "Save progress" : "Save progress"}
                </button>
                <button
                  type="button"
                  onClick={() => setReviewUncounted((value) => !value)}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold"
                >
                  {reviewUncounted ? "Show all lines" : "Review uncompleted"}
                </button>
                <button
                  type="button"
                  disabled={saving || remainingUncounted > 0 || !canEditCounts}
                  onClick={submitSession}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  {finalReview ? "Confirm submit counts" : "Submit counts"}
                </button>
              </>
            ) : null}
            {canReview && active.status === "submitted" ? (
              <>
                {mismatchRows.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setReviewMismatchesOnly((value) => !value)}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-800"
                  >
                    {reviewMismatchesOnly ? "Show all lines" : `Show mismatches (${mismatchRows.length})`}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => review("approved")}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white"
                >
                  Approve
                </button>
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs font-semibold text-rose-700">
                  Rejection reason
                  <input
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    className="min-h-11 rounded-xl border border-rose-200 px-3 text-sm font-normal text-slate-800"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => review("rejected")}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-700"
                >
                  Reject
                </button>
              </>
            ) : null}
            {canReview && active.status === "approved" && !isClosedSession(active.status) ? (
              <button
                type="button"
                disabled={applying || (surplusRows.length > 0 && !surplusLotsReady)}
                onClick={applySession}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white disabled:opacity-60"
              >
                {applying ? "Recording…" : Number(active.discrepancy_count || 0) > 0 ? "Apply count differences" : "Record this count"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={exportSession}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600"
            >
              Export
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Start a Stock Count or open an earlier count from the list.</p>
      )}
    </SectionCard>
    <ConfirmDialog
      open={confirmFullOpen}
      onClose={() => setConfirmFullOpen(false)}
      onConfirm={() => startStocktakeSession({ confirmAll: true })}
      title={isBagScope ? "Start a bag stock count?" : "Start a complete Stock Count?"}
      description={
        isBagScope
          ? `This will start a blind stock count for ${scopePreview?.item_count ?? 0} items in ${selectedFolderName}.`
          : `This will start a blind stock count for ${scopePreview?.item_count ?? scopedItems.length} items across all OCS folders.`
      }
      confirmLabel={isBagScope ? "Start bag count" : "Start full-catalogue count"}
      tone="primary"
      busy={creating}
    />
    <EmergencyOverrideDialog
      open={overrideOpen}
      summary="This will start a Stock Count as an administrator. Operators should perform routine counting. The count still requires blind entries, movement checks, and approval."
      onClose={() => setOverrideOpen(false)}
      onConfirm={async (reason) => {
        setCreating(true);
        try {
          const payload = await api.post("/inventory/stocktake/sessions", withOperationalOverride(
            user,
            {
              folder_id: isBagScope || fullCatalogue || !scope ? null : Number(scope),
              doctor_id: bagDoctorId,
              confirm_all: fullCatalogue || isBagScope,
              expected_item_count: scopePreview?.item_count ?? scopedItems.length,
              scope_token: scopePreview?.scope_token,
            },
            reason,
          ));
          setActive(payload.session);
          toast.success("Emergency Stock Count started.");
        } catch (error) {
          toast.error(error.message || "Could not start the stock count.");
        } finally {
          setCreating(false);
        }
      }}
    />
    </>
  );
}

export default InventoryStocktakePanel;
