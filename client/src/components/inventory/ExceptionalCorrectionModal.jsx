import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import { api } from "../../lib/api.js";
import { formatRupees } from "../../lib/format.js";
import { setUnsavedWork } from "../../lib/unsavedWork.js";

const FIELD =
  "w-full min-h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-[#2d8f98] focus:bg-white";

export default function ExceptionalCorrectionModal({ open, item, isSaving, onClose, onSubmit }) {
  const [mode, setMode] = useState("next");
  const [nextQuantity, setNextQuantity] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState("form");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [affectConfirmed, setAffectConfirmed] = useState(false);
  const [syncedDeps, setSyncedDeps] = useState({ open, itemId: item?.id });

  if (syncedDeps.open !== open || syncedDeps.itemId !== item?.id) {
    setSyncedDeps({ open, itemId: item?.id });
    if (open) {
      setMode("next");
      setNextQuantity(String(item?.quantity ?? 0));
      setDelta("0");
      setReason("");
      setNote("");
      setStep("form");
      setPreview(null);
      setAffectConfirmed(false);
    }
  }

  const current = Number(item?.quantity || 0);
  const parsedNext = mode === "next" ? Number(nextQuantity) : current + Number(delta || 0);
  const change = parsedNext - current;
  const validQty = Number.isInteger(parsedNext) && parsedNext >= 0;
  const reasonOk = String(reason).trim().length >= 10;
  const formValid = validQty && reasonOk;
  const dirty = open && (String(reason).trim() !== "" || String(note).trim() !== "" || change !== 0);

  useEffect(() => {
    setUnsavedWork("correction", Boolean(dirty));
    return () => setUnsavedWork("correction", false);
  }, [dirty]);

  const blocking = preview?.blocking_requests || [];
  const impacted = (preview?.impacted_requests || []).filter((row) => Number(row.reduced_quantity || 0) > 0 || row.blocking);
  const highRisk = Boolean(preview?.requires_affect_reservations);

  const summary = useMemo(
    () => [
      ["Item", item?.item_name || "—"],
      ["Before", String(preview?.previous ?? current)],
      ["Change", `${change > 0 ? "+" : ""}${preview?.change ?? change}`],
      ["After", String(preview?.next ?? parsedNext)],
      ["Available to promise", String(preview?.available_to_promise ?? "—")],
      ["Reserved", String(preview?.reserved_quantity ?? "—")],
      ["Reason", reason.trim() || "—"],
      ["Note", note.trim() || "—"],
    ],
    [item?.item_name, current, change, parsedNext, preview, reason, note],
  );

  async function requestPreview() {
    if (!item?.id || !formValid) {
      toast.error("Enter a valid quantity of zero or more and a reason of at least 10 characters.");
      return;
    }
    setPreviewing(true);
    try {
      const payload = await api.post(`/inventory/items/${item.id}/exceptional-correction/preview`, {
        next_quantity: parsedNext,
      });
      const nextPreview = payload.preview;
      setPreview(nextPreview);
      setAffectConfirmed(false);
      if ((nextPreview?.blocking_requests || []).length && nextPreview.change < 0) {
        setStep("blocked");
        return;
      }
      if (nextPreview?.requires_affect_reservations) {
        setStep("reservation-confirm");
        return;
      }
      setStep("confirm");
    } catch (error) {
      toast.error(error.message || "Could not preview this correction.");
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Exceptional inventory correction${item ? ` — ${item.item_name}` : ""}`}
      description="Admin-only audited correction. This is not routine receiving or write-off."
      size="sm"
      innerScroll={false}
    >
      <form
        className="flex min-h-0 w-full flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!formValid) {
            toast.error("Enter a valid quantity of zero or more and a reason of at least 10 characters.");
            return;
          }
          if (step === "form") {
            void requestPreview();
            return;
          }
          if (step === "blocked") return;
          if (step === "reservation-confirm" && !affectConfirmed) {
            toast.error("Confirm that accepted unpicked reservations will be reduced.");
            return;
          }
          onSubmit({
            next_quantity: parsedNext,
            reason: reason.trim(),
            note: note.trim(),
            confirm: true,
            affect_reservations: highRisk === true,
            expected_row_version: preview?.row_version,
            expected_quantity: preview?.quantity,
          });
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pr-1">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Current on-hand: <strong>{current}</strong>. FEFO batches and movements will be updated together.
          </div>
          {step === "blocked" ? (
            <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
              <p className="font-semibold">This correction is blocked.</p>
              <p>
                Reserved stock is already picked or Supply Ready. Resolve these requests first, then correct warehouse
                quantity.
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {blocking.map((row) => (
                  <li key={row.request_id}>
                    Request #{row.request_id} · Dr. {row.doctor_name} · {row.status} · reserved {row.reserved_quantity} ·
                    picked {row.picked_quantity}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {step === "reservation-confirm" || step === "confirm" ? (
            <>
              <dl className="space-y-2 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm">
                {summary.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="max-w-[60%] break-words text-right font-semibold text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
              {impacted.length ? (
                <div className="space-y-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm">
                  <p className="font-semibold text-slate-800">Impacted supply requests</p>
                  <ul className="space-y-2">
                    {impacted.map((row) => (
                      <li key={row.request_id} className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="font-semibold">
                          Request #{row.request_id} · Dr. {row.doctor_name}
                        </p>
                        <p className="text-xs text-slate-600">
                          Status {row.status} · reserved {row.reserved_quantity} · picked {row.picked_quantity} · shortage
                          after {row.resulting_shortage}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {step === "reservation-confirm" ? (
                <label className="flex min-h-11 items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={affectConfirmed}
                    onChange={(event) => setAffectConfirmed(event.target.checked)}
                  />
                  <span>
                    High risk: this will reduce reservations on accepted but unpicked requests and notify the affected
                    doctors and operators. I confirm the reservations should be reduced.
                  </span>
                </label>
              ) : null}
            </>
          ) : step === "form" ? (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-slate-700">Correction method</legend>
                <label className="flex min-h-11 items-center gap-3">
                  <input type="radio" name="mode" checked={mode === "next"} onChange={() => setMode("next")} />
                  <span>Set corrected quantity</span>
                </label>
                <label className="flex min-h-11 items-center gap-3">
                  <input type="radio" name="mode" checked={mode === "delta"} onChange={() => setMode("delta")} />
                  <span>Enter adjustment delta</span>
                </label>
              </fieldset>
              {mode === "next" ? (
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Corrected quantity</span>
                  <input
                    required
                    min="0"
                    step="1"
                    type="number"
                    value={nextQuantity}
                    onChange={(event) => setNextQuantity(event.target.value)}
                    className={FIELD}
                  />
                </label>
              ) : (
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Adjustment delta</span>
                  <input
                    required
                    step="1"
                    type="number"
                    value={delta}
                    onChange={(event) => setDelta(event.target.value)}
                    className={FIELD}
                  />
                </label>
              )}
              <p className="text-sm text-slate-600">
                Before {current} · change {change > 0 ? "+" : ""}{change} · after {Number.isFinite(parsedNext) ? parsedNext : "—"}
                {Number(item?.cost_price || 0) > 0 && Number.isFinite(change)
                  ? ` · value ${formatRupees(Math.abs(change) * Number(item.cost_price || 0))}`
                  : ""}
              </p>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Reason (required)</span>
                <textarea required minLength={10} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className={FIELD} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Supporting note (optional)</span>
                <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} className={FIELD} />
              </label>
            </>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 py-4 sm:flex-row sm:justify-end">
          {step === "form" ? (
            <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setPreview(null);
                setAffectConfirmed(false);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"
            >
              Back
            </button>
          )}
          {step !== "blocked" ? (
            <button
              type="submit"
              disabled={isSaving || previewing || !formValid || (step === "reservation-confirm" && !affectConfirmed)}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isSaving || previewing
                ? "Working…"
                : step === "reservation-confirm"
                  ? "Reduce reservations and apply"
                  : step === "confirm"
                    ? "Apply correction"
                    : "Review correction"}
            </button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
