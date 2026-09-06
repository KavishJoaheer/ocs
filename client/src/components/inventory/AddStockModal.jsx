import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import { formatRupees } from "../../lib/format.js";
import {
  isNonNegativeNumber,
  isPastLocalDate,
  isPositiveWholeNumber,
  requiresOperationalOverride,
  todayLocalDate,
} from "../../lib/inventoryAccess.js";
import OperationalOverrideFields from "./OperationalOverrideFields.jsx";

const FIELD =
  "w-full min-h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-[#2d8f98] focus:bg-white";

export default function AddStockModal({ open, item, user, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [expiryDate, setExpiryDate] = useState("");
  const [nonExpiring, setNonExpiring] = useState(false);
  const [costPrice, setCostPrice] = useState("0.00");
  const [overrideReason, setOverrideReason] = useState("");
  const [step, setStep] = useState("form");
  const [syncedDeps, setSyncedDeps] = useState({ open, item });

  if (syncedDeps.open !== open || syncedDeps.item !== item) {
    setSyncedDeps({ open, item });
    if (open) {
      setQuantity("1");
      setExpiryDate("");
      setNonExpiring(false);
      setCostPrice(String(item?.cost_price ?? 0));
      setOverrideReason("");
      setStep("form");
    }
  }

  const qty = Number(quantity);
  const cost = Number(costPrice);
  const today = todayLocalDate();
  const currentOnHand = Number(item?.quantity || 0);
  const expiryError = !nonExpiring && expiryDate && isPastLocalDate(expiryDate)
    ? "Expiry must be today or a future date. Expired batches cannot become usable stock."
    : !nonExpiring && !expiryDate
      ? "Set a batch expiry date, or mark this batch as non-expiring."
      : "";
  const quantityError = !isPositiveWholeNumber(qty) ? "Quantity must be a positive whole number." : "";
  const costError = !isNonNegativeNumber(cost) ? "Unit cost must be zero or more." : "";
  const overrideError =
    requiresOperationalOverride(user) && String(overrideReason || "").trim().length < 10
      ? "Enter an operational override reason of at least 10 characters."
      : "";
  const formValid = !quantityError && !expiryError && !costError && !overrideError;
  const totalCost = Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : 0;

  const summary = useMemo(
    () => [
      ["Item", item?.item_name || "—"],
      ["Quantity being received", Number.isFinite(qty) ? String(qty) : "—"],
      ["Expiry", nonExpiring ? "Non-expiring" : expiryDate || "—"],
      ["Unit cost", formatRupees(cost || 0)],
      ["Total cost", formatRupees(totalCost)],
      ["Current on-hand", String(currentOnHand)],
      ["Resulting on-hand", String(currentOnHand + (isPositiveWholeNumber(qty) ? qty : 0))],
    ],
    [item?.item_name, qty, nonExpiring, expiryDate, cost, totalCost, currentOnHand],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Receive stock${item ? ` — ${item.item_name}` : ""}`}
      description="Add a warehouse batch. Expiry is blank by default and past dates are rejected."
      size="sm"
      innerScroll={false}
    >
      <form
        className="flex min-h-0 w-full flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!formValid) {
            toast.error(quantityError || expiryError || costError || overrideError);
            return;
          }
          if (step !== "confirm") {
            setStep("confirm");
            return;
          }
          onSubmit({
            quantity: qty,
            expiry_date: nonExpiring ? "" : expiryDate,
            is_non_expiring: nonExpiring,
            cost_price: cost,
            override_reason: overrideReason,
          });
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pr-1">
          {step === "confirm" ? (
            <dl className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              {summary.map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="max-w-[60%] break-words text-right font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Quantity to receive</span>
                <input
                  required
                  min={1}
                  step={1}
                  type="number"
                  inputMode="numeric"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className={FIELD}
                />
                {quantityError ? <p className="text-xs text-rose-600">{quantityError}</p> : null}
              </label>

              <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <input
                  type="checkbox"
                  checked={nonExpiring}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setNonExpiring(next);
                    if (next) setExpiryDate("");
                  }}
                  className="size-5 accent-[#2d8f98]"
                />
                <span className="text-sm font-semibold text-slate-700">This batch does not expire</span>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Batch expiry date</span>
                <input
                  type="date"
                  min={today}
                  disabled={nonExpiring}
                  value={expiryDate}
                  onChange={(event) => setExpiryDate(event.target.value)}
                  className={FIELD}
                />
                {expiryError ? <p className="text-xs text-rose-600">{expiryError}</p> : null}
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Unit cost (Rs)</span>
                <input
                  required
                  min={0}
                  step="0.01"
                  type="number"
                  value={costPrice}
                  onChange={(event) => setCostPrice(event.target.value)}
                  className={FIELD}
                />
                {costError ? <p className="text-xs text-rose-600">{costError}</p> : null}
              </label>

              <OperationalOverrideFields user={user} reason={overrideReason} onChange={setOverrideReason} />
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 py-4 sm:flex-row sm:justify-end">
          {step === "confirm" ? (
            <button
              type="button"
              onClick={() => setStep("form")}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSaving || !formValid}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[#4FB8B3] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isSaving ? "Saving…" : step === "confirm" ? "Receive" : "Review receive"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
