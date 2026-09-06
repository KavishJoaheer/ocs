import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import { formatRupees } from "../../lib/format.js";

const FIELD =
  "w-full min-h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-[#2d8f98] focus:bg-white";

export default function ExceptionalCorrectionModal({ open, item, isSaving, onClose, onSubmit }) {
  const [mode, setMode] = useState("next");
  const [nextQuantity, setNextQuantity] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState("form");
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
    }
  }

  const current = Number(item?.quantity || 0);
  const parsedNext = mode === "next" ? Number(nextQuantity) : current + Number(delta || 0);
  const change = parsedNext - current;
  const validQty = Number.isInteger(parsedNext) && parsedNext >= 0;
  const reasonOk = String(reason).trim().length >= 10;
  const formValid = validQty && reasonOk;

  const summary = useMemo(
    () => [
      ["Item", item?.item_name || "—"],
      ["Before", String(current)],
      ["Change", `${change > 0 ? "+" : ""}${change}`],
      ["After", String(parsedNext)],
      ["Reason", reason.trim() || "—"],
      ["Note", note.trim() || "—"],
    ],
    [item?.item_name, current, change, parsedNext, reason, note],
  );

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
          if (step !== "confirm") {
            setStep("confirm");
            return;
          }
          onSubmit({
            next_quantity: parsedNext,
            reason: reason.trim(),
            note: note.trim(),
            confirm: true,
          });
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pr-1">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Current on-hand: <strong>{current}</strong>. FEFO batches and movements will be updated together.
          </div>
          {step === "confirm" ? (
            <dl className="space-y-2 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm">
              {summary.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="max-w-[60%] break-words text-right font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
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
          )}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 py-4 sm:flex-row sm:justify-end">
          {step === "confirm" ? (
            <button type="button" onClick={() => setStep("form")} className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">
              Back
            </button>
          ) : (
            <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSaving || !formValid}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isSaving ? "Applying…" : step === "confirm" ? "Apply correction" : "Review correction"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
