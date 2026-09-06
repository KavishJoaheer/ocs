import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import toast from "react-hot-toast";
import SectionCard from "./SectionCard.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";

function InventoryStocktakePanel({ folders = [], onApplied, sessions = [] }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [folderId, setFolderId] = useState("");
  const [active, setActive] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const liveSessions = sessions.length ? sessions : [];

  async function createSession() {
    setCreating(true);
    try {
      const payload = await api.post("/inventory/stocktake/sessions", {
        folder_id: folderId ? Number(folderId) : null,
      });
      setActive(payload.session);
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
    } catch (error) {
      toast.error(error.message || "Could not open this session.");
    }
  }

  function countedLines() {
    return (active?.items || [])
      .map((line) => {
        const raw = line.physical_quantity;
        if (raw === null || raw === undefined || raw === "") return null;
        return {
          id: line.id,
          physical_quantity: raw,
          reason: line.reason || "",
        };
      })
      .filter(Boolean);
  }

  function uncountedCount() {
    return (active?.items || []).filter((line) => {
      const raw = line.physical_quantity;
      return raw === null || raw === undefined || String(raw).trim() === "";
    }).length;
  }

  function isClosedSession(status) {
    return ["rejected", "cancelled", "applied"].includes(status);
  }

  async function saveProgress() {
    if (!active) return;
    setSaving(true);
    try {
      const payload = await api.patch(`/inventory/stocktake/sessions/${active.id}`, {
        lines: countedLines(),
      });
      setActive(payload.session);
      toast.success("Counts saved.");
    } catch (error) {
      toast.error(error.message || "Could not save counts.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function submitSession() {
    if (!active) return;
    const remaining = uncountedCount();
    if (remaining > 0) {
      toast.error(
        `${remaining} line${remaining === 1 ? "" : "s"} still uncounted. Enter a count, including 0 where the shelf is empty, before submitting.`,
      );
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
      toast.error(error.message || "Could not submit this session.");
    } finally {
      setSaving(false);
    }
  }

  async function review(decision) {
    if (!active) return;
    const reason =
      decision === "rejected"
        ? window.prompt("Reason for rejecting this count (at least 10 characters)")
        : "";
    try {
      const payload = await api.post(`/inventory/stocktake/sessions/${active.id}/review`, {
        decision,
        reason,
      });
      setActive(payload.session);
      await onApplied?.();
    } catch (error) {
      toast.error(error.message || "Could not review this session.");
    }
  }

  async function applySession() {
    if (!active) return;
    try {
      const payload = await api.post(`/inventory/stocktake/sessions/${active.id}/apply`);
      setActive(payload.session);
      toast.success("Approved variances applied.");
      await onApplied?.();
    } catch (error) {
      toast.error(error.message || "Could not apply this session.");
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

  const rows = active?.items || [];
  const submitted = ["submitted", "approved", "rejected", "applied"].includes(active?.status);
  const remainingUncounted = active && !submitted ? uncountedCount() : 0;
  const canEditCounts = active && ["draft", "in_progress"].includes(active.status);

  return (
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
        <select
          value={folderId}
          onChange={(event) => setFolderId(event.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">All OCS folders</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={creating}
          onClick={createSession}
          className="rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
        >
          Start session
        </button>
      </div>

      {liveSessions.length ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {liveSessions.slice(0, 8).map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => openSession(session.id)}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
            >
              #{session.id} {session.status}
            </button>
          ))}
        </div>
      ) : null}

      {active ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Session #{active.id} · {active.status}
          </p>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  {submitted ? <th className="px-3 py-2 text-right">System</th> : null}
                  <th className="px-3 py-2 text-right">Count</th>
                  {submitted ? <th className="px-3 py-2 text-right">Variance</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((line) => (
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
                        onChange={(event) =>
                          setActive((current) => ({
                            ...current,
                            items: current.items.map((row) =>
                              row.id === line.id
                                ? { ...row, physical_quantity: event.target.value }
                                : row,
                            ),
                          }))
                        }
                        className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-right"
                      />
                    </td>
                    {submitted ? (
                      <td className="px-3 py-2 text-right tabular-nums">{line.variance}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
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
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"
                >
                  Save progress
                </button>
                <button
                  type="button"
                  disabled={saving || remainingUncounted > 0 || !canEditCounts}
                  onClick={submitSession}
                  className="rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                >
                  Submit counts
                </button>
              </>
            ) : null}
            {isAdmin && active.status === "submitted" ? (
              <>
                <button
                  type="button"
                  onClick={() => review("approved")}
                  className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => review("rejected")}
                  className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"
                >
                  Reject
                </button>
              </>
            ) : null}
            {isAdmin && active.status === "approved" && !isClosedSession(active.status) ? (
              <button
                type="button"
                onClick={applySession}
                className="rounded-xl bg-[#2d8f98] px-3 py-2 text-xs font-bold text-white"
              >
                Apply adjustments
              </button>
            ) : null}
            <button
              type="button"
              onClick={exportSession}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
            >
              Export
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Start a session or open a submitted variance from the list.</p>
      )}
    </SectionCard>
  );
}

export default InventoryStocktakePanel;
