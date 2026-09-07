import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import { api } from "../../lib/api.js";
import { formatRupees } from "../../lib/format.js";
import {
  isPositiveWholeNumber,
  requiresOperationalOverride,
} from "../../lib/inventoryAccess.js";
import AllocationPreviewList from "./AllocationPreviewList.jsx";
import OperationalOverrideFields from "./OperationalOverrideFields.jsx";

const FIELD =
  "w-full min-h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-[#2d8f98] focus:bg-white";

const NOTE_REQUIRED = new Set(["Damaged", "Discontinued"]);

export default function WriteOffStockModal({
  open,
  item,
  user,
  isDoctorBag = false,
  isSaving,
  onClose,
  onSubmit,
}) {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("Expired");
  const [note, setNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [step, setStep] = useState("form");
  const [syncedDeps, setSyncedDeps] = useState({ open, itemId: item?.id });

  if (syncedDeps.open !== open || syncedDeps.itemId !== item?.id) {
    setSyncedDeps({ open, itemId: item?.id });
    if (open) {
      setQuantity("1");
      setReason("Expired");
      setNote("");
      setOverrideReason("");
      setPreview(null);
      setPreviewError("");
      setStep("form");
    }
  }

  const qty = Number(quantity);
  const quantityError = !isPositiveWholeNumber(qty) ? "Quantity must be a positive whole number." : "";
  const noteError = NOTE_REQUIRED.has(reason) && String(note).trim().length < 3
    ? "Damaged, Discontinued, and other exceptional write-offs require an explanatory note."
    : "";
  const overrideError =
    requiresOperationalOverride(user) && String(overrideReason || "").trim().length < 10
      ? "Enter an operational override reason of at least 10 characters."
      : "";

  useEffect(() => {
    if (!open || !item?.id || !isPositiveWholeNumber(qty) || isDoctorBag) {
      return undefined;
    }
    let ignore = false;
    async function loadPreview() {
      try {
        const payload = await api.get(
          `/inventory/items/${item.id}/allocation-preview?quantity=${qty}&mode=write_off`,
        );
        if (!ignore) {
          setPreview(payload?.preview || null);
          setPreviewError("");
        }
      } catch (error) {
        if (!ignore) {
          setPreview(null);
          setPreviewError(error.message || "Could not preview write-off batches.");
        }
      }
    }
    loadPreview();
    return () => {
      ignore = true;
    };
  }, [open, item?.id, qty, isDoctorBag]);

  const available = Number(preview?.available_to_transfer ?? item?.quantity ?? 0);
  const currentQty = Number(preview?.current_quantity ?? item?.quantity ?? 0);
  const exceeds = isPositiveWholeNumber(qty) && qty > available;
  const formValid = !quantityError && !noteError && !overrideError && !exceeds;
  const resulting = currentQty - (isPositiveWholeNumber(qty) ? qty : 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={requiresOperationalOverride(user) ? `Exceptional write-off${item ? ` — ${item.item_name}` : ""}` : `Write off stock${item ? ` — ${item.item_name}` : ""}`}
      description={
        requiresOperationalOverride(user)
          ? "This is an exceptional administrator write-off. Review location, item, batches, quantity, reservations and the resulting balance before confirming."
          : isDoctorBag
          ? "Write off quantity from the doctor medical bag."
          : "Write off usable warehouse stock using FEFO. Active reservations cannot be written off."
      }
      size="sm"
      innerScroll={false}
    >
      <form
        className="flex min-h-0 w-full flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!formValid) {
            toast.error(quantityError || noteError || overrideError || "Cannot write off more than available stock.");
            return;
          }
          if (step !== "confirm") {
            setStep("confirm");
            return;
          }
          onSubmit({
            quantity: qty,
            reason,
            note: note.trim(),
            confirm: true,
            override_reason: overrideReason,
          });
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pr-1">
          {step === "confirm" ? (
            <dl className="space-y-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-rose-700">Current quantity</dt>
                <dd className="font-semibold text-rose-950">{currentQty}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-rose-700">Write-off quantity</dt>
                <dd className="font-semibold text-rose-950">{qty}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-rose-700">Resulting quantity</dt>
                <dd className="font-semibold text-rose-950">{resulting}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-rose-700">Reservations affected</dt>
                <dd className="font-semibold text-rose-950">{preview?.reserved_quantity ?? 0}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-rose-700">Estimated value</dt>
                <dd className="font-semibold text-rose-950">
                  {preview ? formatRupees(preview.estimated_value || 0) : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-rose-700">Reason</dt>
                <dd className="text-right font-semibold text-rose-950">{reason}</dd>
              </div>
              {note.trim() ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-rose-700">Note</dt>
                  <dd className="max-w-[60%] break-words text-right text-rose-950">{note}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <>
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Quantity to write off</span>
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
                {exceeds ? (
                  <p className="text-xs text-rose-600">
                    Cannot write off more than available-to-transfer stock ({available}).
                  </p>
                ) : null}
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Reason</span>
                <select value={reason} onChange={(event) => setReason(event.target.value)} className={FIELD}>
                  <option value="Expired">Expired</option>
                  <option value="Discontinued">Discontinued</option>
                  <option value="Damaged">Damaged</option>
                  {isDoctorBag ? <option value="Wasted">Wasted</option> : null}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">
                  {NOTE_REQUIRED.has(reason) ? "Explanatory note (required)" : "Note (optional)"}
                </span>
                <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} className={FIELD} />
                {noteError ? <p className="text-xs text-rose-600">{noteError}</p> : null}
              </label>

              {!isDoctorBag ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">FEFO batches affected</p>
                  {previewError ? <p className="text-xs text-rose-600">{previewError}</p> : <AllocationPreviewList preview={preview} />}
                </div>
              ) : null}

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
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isSaving ? "Writing off…" : step === "confirm" ? (requiresOperationalOverride(user) ? "Confirm exceptional write-off" : "Write off stock") : "Review write-off"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
