import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, ChevronLeft, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile, DENSE_TABLE_BREAKPOINT } from "../hooks/useIsMobile.js";
import { formatRupees } from "../lib/format.js";
import { cx } from "../lib/utils.js";
import { canCountStocktake, canReviewStocktake, withOperationalOverride } from "../lib/inventoryAccess.js";
import { setUnsavedWork } from "../lib/unsavedWork.js";
import EmergencyOverrideDialog from "./EmergencyOverrideDialog.jsx";

function isBlankCount(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function formatSavedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function InventoryStocktakePanel({ folders = [], items = [], onApplied, sessions = [], requestedStatus = "" }) {
  const { user } = useAuth();
  const canCount = canCountStocktake(user);
  const canReview = canReviewStocktake(user);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const isMobile = useIsMobile(DENSE_TABLE_BREAKPOINT);
  const [folderId, setFolderId] = useState("");
  const [active, setActive] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmFull, setConfirmFull] = useState(false);
  const [mobileIndex, setMobileIndex] = useState(0);
  const [reviewUncounted, setReviewUncounted] = useState(false);
  const [finalReview, setFinalReview] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setUnsavedWork(
      "stocktake",
      Boolean(active && ["draft", "in_progress", "recount_required"].includes(active.status)),
    );
    return () => setUnsavedWork("stocktake", false);
  }, [active]);

  const scopedItems = useMemo(
    () => (folderId ? items.filter((item) => String(item.folder_id) === String(folderId)) : items),
    [items, folderId],
  );
  const selectedFolderName = folderId
    ? folders.find((folder) => String(folder.id) === String(folderId))?.name || "Selected folder"
    : "All OCS folders";

  useEffect(() => {
    if (!requestedStatus) return;
    const match = (sessions || []).find((session) => session.status === requestedStatus);
    if (match) void openSession(match.id);
    // Only react to summary-card selection; do not re-open on session polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedStatus]);

  async function createSession() {
    if (!folderId && !confirmFull) {
      setConfirmFull(true);
      return;
    }
    setCreating(true);
    try {
      const payload = await api.post("/inventory/stocktake/sessions", {
        folder_id: folderId ? Number(folderId) : null,
      });
      setActive(payload.session);
      setLastSavedAt(payload.session?.last_saved_at || "");
      setConfirmFull(false);
      setMobileIndex(0);
      setFinalReview(false);
      toast.success("Stocktake session started. System quantities stay hidden until you submit.");
    } catch (error) {
      toast.error(error.message || "Could not start a stocktake session.");
    } finally {
      setCreating(false);
    }
  }

  async function openSession(id) {
    try {
      const payload = await api.get(`/inventory/stocktake/sessions/${id}`);
      setActive(payload.session);
      setLastSavedAt(payload.session?.last_saved_at || "");
      setMobileIndex(0);
      setFinalReview(false);
      setReviewUncounted(false);
    } catch (error) {
      toast.error(error.message || "Could not open this session.");
    }
  }

  function countedLines() {
    return (active?.items || [])
      .map((line) => {
        if (isBlankCount(line.physical_quantity)) return null;
        return {
          id: line.id,
          physical_quantity: line.physical_quantity,
          reason: line.reason || "",
        };
      })
      .filter(Boolean);
  }

  function uncountedLines() {
    return (active?.items || []).filter((line) => isBlankCount(line.physical_quantity));
  }

  function isClosedSession(status) {
    return ["rejected", "cancelled", "applied"].includes(status);
  }

  async function saveProgress({ silent = false } = {}) {
    if (!active) return;
    setSaving(true);
    try {
      const payload = await api.patch(`/inventory/stocktake/sessions/${active.id}`, {
        lines: countedLines(),
      });
      setActive(payload.session);
      setLastSavedAt(payload.session?.last_saved_at || new Date().toISOString());
      if (!silent) toast.success("Counts saved.");
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
      await api.patch(`/inventory/stocktake/sessions/${active.id}`, {
        lines: countedLines(),
      });
      const payload = await api.post(`/inventory/stocktake/sessions/${active.id}/submit`);
      setActive(payload.session);
      toast.success(
        payload.session.status === "applied"
          ? "Zero-variance session closed."
          : "Counts submitted for approval.",
      );
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
      await onApplied?.();
    } catch (error) {
      toast.error(error.message || "Could not review this session.");
    }
  }

  async function applySession() {
    if (!active || applying) return;
    setApplying(true);
    try {
      const payload = await api.post(`/inventory/stocktake/sessions/${active.id}/apply`);
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
      link.download = filename || `stocktake-session-${active.id}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.message || "CSV export failed.");
    }
  }

  function updateLine(id, physical_quantity) {
    setActive((current) => ({
      ...current,
      items: current.items.map((row) => (row.id === id ? { ...row, physical_quantity } : row)),
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
  const visibleRows = reviewUncounted && canEditCounts ? uncountedLines() : rows;
  const mobileRows = reviewUncounted ? uncountedLines() : rows;
  const mobileLine = mobileRows[mobileIndex] || null;

  useEffect(() => {
    if (mobileIndex >= mobileRows.length) setMobileIndex(0);
  }, [mobileRows.length, mobileIndex]);

  return (
    <>
    <SectionCard
      title="Stocktake sessions"
      subtitle="Blind-count a category, submit together, and apply approved variances atomically."
      actions={
        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
          <ClipboardCheck className="size-3.5" />
          Sessions
        </span>
      }
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Folder / category
          <select
            value={folderId}
            onChange={(event) => {
              setFolderId(event.target.value);
              setConfirmFull(false);
            }}
            className="min-h-11 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal normal-case text-slate-800"
          >
            <option value="">All OCS folders</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        {canCount ? (
          <button
            type="button"
            disabled={creating}
            onClick={createSession}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {confirmFull && !folderId ? "Confirm full-catalogue count" : "Start session"}
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
        <p>Items in scope: <strong>{scopedItems.length}</strong></p>
        <p>Counter / assignee: <strong>{user?.full_name || user?.username || "You"}</strong></p>
        {!folderId ? (
          <p className="mt-2 font-semibold text-amber-800">
            All OCS folders will be counted. Confirm before starting a full-catalogue session.
          </p>
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
          Operators start, count and submit stocktake sessions. Administrators review discrepancies and apply approved variances.
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
                #{session.id} · {session.folder_name || "All OCS folders"} · {session.status}
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
            Session #{active.id} · {active.status} · {counted} of {total} ({progress}%)
            {lastSavedAt ? ` · saved ${formatSavedAt(lastSavedAt)}` : ""}
          </p>
          {saving ? <p className="text-xs text-slate-500" aria-live="polite">Saving progress…</p> : null}

          {submitted ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <p>Discrepancy lines: <strong>{active.discrepancy_count ?? 0}</strong></p>
              <p>Open variance qty: <strong>{active.open_variance_qty ?? 0}</strong></p>
              <p>Financial impact: <strong>{formatRupees(active.open_variance_value || 0)}</strong></p>
            </div>
          ) : null}

          {isMobile && !canEditCounts ? (
            <div className="space-y-2 lg:hidden">
              {rows.map((line) => (
                <div key={line.id} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
                  <p className="font-semibold text-slate-900">{line.item_name}</p>
                  <p className="text-xs text-slate-500">
                    Count {line.physical_quantity}
                    {submitted ? ` · System ${line.system_quantity} · Variance ${line.variance}` : ""}
                  </p>
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
                    {submitted ? <th className="px-3 py-2 text-right">System</th> : null}
                    <th className="px-3 py-2 text-right">Count</th>
                    {submitted ? <th className="px-3 py-2 text-right">Variance</th> : null}
                    {recountRequired ? <th className="px-3 py-2 text-left">Conflict</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-2 font-semibold text-slate-800">{line.item_name}</td>
                      {submitted ? (
                        <td className="px-3 py-2 text-right tabular-nums">{line.system_quantity}</td>
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
                        <td className="px-3 py-2 text-right tabular-nums">{line.variance}</td>
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
                  {saving ? "Saving…" : lastSavedAt ? "Save progress" : "Save progress"}
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
                disabled={applying}
                onClick={applySession}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white disabled:opacity-60"
              >
                {applying ? "Applying…" : "Apply adjustments"}
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
        <p className="text-sm text-slate-500">Start a session or open a submitted variance from the list.</p>
      )}
    </SectionCard>
    <EmergencyOverrideDialog
      open={overrideOpen}
      summary="This will start a stocktake session as an administrator. Operators should perform routine counting. The session still requires blind counts, concurrency checks, and approval."
      onClose={() => setOverrideOpen(false)}
      onConfirm={async (reason) => {
        setCreating(true);
        try {
          const payload = await api.post("/inventory/stocktake/sessions", withOperationalOverride(
            user,
            { folder_id: folderId ? Number(folderId) : null },
            reason,
          ));
          setActive(payload.session);
          toast.success("Emergency stocktake session started.");
        } catch (error) {
          toast.error(error.message || "Could not start a stocktake session.");
        } finally {
          setCreating(false);
        }
      }}
    />
    </>
  );
}

export default InventoryStocktakePanel;
