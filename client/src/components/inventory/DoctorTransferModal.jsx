import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import { api } from "../../lib/api.js";
import { formatRupees } from "../../lib/format.js";
import {
  formatAllocationExpiry,
  isPositiveWholeNumber,
  requiresOperationalOverride,
} from "../../lib/inventoryAccess.js";
import AllocationPreviewList from "./AllocationPreviewList.jsx";
import OperationalOverrideFields from "./OperationalOverrideFields.jsx";

const FIELD =
  "w-full min-h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-[#2d8f98] focus:bg-white";

export default function DoctorTransferModal({
  open,
  doctors = [],
  item,
  user,
  presetDoctorId = null,
  presetDoctorName = "",
  isSaving,
  onClose,
  onSubmit,
}) {
  const [doctorId, setDoctorId] = useState("");
  const [doctorQuery, setDoctorQuery] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [overrideReason, setOverrideReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [step, setStep] = useState("form");
  const doctorLocked = Boolean(presetDoctorId);
  const [syncedDeps, setSyncedDeps] = useState({
    open,
    presetDoctorId,
    presetDoctorName,
    itemId: item?.id,
  });

  if (
    syncedDeps.open !== open
    || syncedDeps.presetDoctorId !== presetDoctorId
    || syncedDeps.presetDoctorName !== presetDoctorName
    || syncedDeps.itemId !== item?.id
  ) {
    setSyncedDeps({ open, presetDoctorId, presetDoctorName, itemId: item?.id });
    if (open) {
      setDoctorId(presetDoctorId ? String(presetDoctorId) : "");
      setDoctorQuery(presetDoctorName || "");
      setQuantity("1");
      setOverrideReason("");
      setPreview(null);
      setPreviewError("");
      setStep("form");
    }
  }

  const selectedDoctor = useMemo(
    () => doctors.find((doctor) => String(doctor.id) === String(doctorId)) || null,
    [doctors, doctorId],
  );

  const doctorOptions = useMemo(() => {
    const q = doctorQuery.trim().toLowerCase();
    const sorted = doctors.slice().sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
    if (!q) return sorted;
    return sorted.filter((doctor) => String(doctor.full_name || "").toLowerCase().includes(q));
  }, [doctors, doctorQuery]);

  function selectDoctor(doctor) {
    setDoctorId(String(doctor.id));
    setDoctorQuery(doctor.full_name || "");
  }

  const qty = Number(quantity);
  const quantityError = !isPositiveWholeNumber(qty) ? "Quantity must be a positive whole number." : "";
  const doctorError = !doctorId ? "Select a destination doctor." : "";
  const overrideError =
    requiresOperationalOverride(user) && String(overrideReason || "").trim().length < 10
      ? "Enter an operational override reason of at least 10 characters."
      : "";

  useEffect(() => {
    if (!open || !item?.id || !isPositiveWholeNumber(qty)) {
      return undefined;
    }
    let ignore = false;
    async function loadPreview() {
      try {
        const params = new URLSearchParams({
          quantity: String(qty),
          mode: "transfer",
        });
        if (doctorId) params.set("doctor_id", String(doctorId));
        const payload = await api.get(`/inventory/items/${item.id}/allocation-preview?${params.toString()}`);
        if (!ignore) {
          setPreview(payload?.preview || null);
          setPreviewError("");
        }
      } catch (error) {
        if (!ignore) {
          setPreview(null);
          setPreviewError(error.message || "Could not preview transfer allocation.");
        }
      }
    }
    loadPreview();
    return () => {
      ignore = true;
    };
  }, [open, item?.id, qty, doctorId]);

  const available = Number(preview?.available_to_transfer ?? 0);
  const exceeds = isPositiveWholeNumber(qty) && preview && qty > available;
  const formValid = !quantityError && !doctorError && !overrideError && !exceeds;
  const destinationName = selectedDoctor?.full_name || presetDoctorName || "Selected doctor";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Transfer to doctor bag${item ? ` — ${item.item_name}` : ""}`}
      description="Transfer reserved-aware warehouse stock into a doctor bag. Confirmation stays disabled until a doctor is selected."
      size="md"
      innerScroll={false}
    >
      <form
        className="flex min-h-0 w-full flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (!formValid) {
            toast.error(doctorError || quantityError || overrideError || "Quantity exceeds available-to-transfer stock.");
            return;
          }
          if (step !== "confirm") {
            setStep("confirm");
            return;
          }
          onSubmit({
            ocs_item_id: item?.id,
            doctor_id: Number(doctorId),
            quantity: qty,
            override_reason: overrideReason,
            confirm: true,
          });
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pr-1">
          {step === "confirm" ? (
            <dl className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <Row label="Source" value="OCS warehouse" />
              <Row label="Destination doctor" value={destinationName} />
              <Row label="Item" value={item?.item_name || "—"} />
              <Row label="Quantity" value={String(qty)} />
              <Row
                label="Batch / expiry allocation"
                value={
                  (preview?.allocations || [])
                    .map((row) => `#${row.batch_id} ${formatAllocationExpiry(row)} × ${row.quantity}`)
                    .join("; ") || "—"
                }
              />
              <Row label="Resulting warehouse quantity" value={String(preview?.resulting_quantity ?? "—")} />
              <Row
                label="Resulting doctor-bag quantity"
                value={preview?.destination_resulting == null ? "—" : String(preview.destination_resulting)}
              />
            </dl>
          ) : (
            <>
              {doctorLocked ? (
                <div className="rounded-2xl border-2 border-[#2d8f98] bg-[#ecf8f7] px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2d8f98]">Selected doctor</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{presetDoctorName || "Selected doctor"}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Doctor (search)</span>
                    <input
                      value={doctorQuery}
                      onChange={(event) => setDoctorQuery(event.target.value)}
                      placeholder="Search doctor by name…"
                      className={FIELD}
                    />
                  </label>
                  {selectedDoctor ? (
                    <p className="rounded-2xl border-2 border-[#2d8f98] bg-[#ecf8f7] px-4 py-2 text-sm font-semibold text-slate-900">
                      Selected: {selectedDoctor.full_name}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">No doctor selected yet.</p>
                  )}
                  <div className="max-h-44 overflow-auto rounded-2xl border border-slate-200 bg-white">
                    {doctorOptions.length ? (
                      doctorOptions.map((doctor) => (
                        <button
                          key={doctor.id}
                          type="button"
                          onClick={() => selectDoctor(doctor)}
                          className={`flex min-h-11 w-full items-center px-4 text-left text-sm hover:bg-slate-50 ${
                            String(doctor.id) === String(doctorId) ? "bg-[rgba(79,184,179,0.12)] font-semibold" : ""
                          }`}
                        >
                          {doctor.full_name}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-slate-500">No matches</div>
                    )}
                  </div>
                </div>
              )}

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Quantity</span>
                <input
                  required
                  min="1"
                  step="1"
                  type="number"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className={FIELD}
                />
                {quantityError ? <p className="text-xs text-rose-600">{quantityError}</p> : null}
              </label>

              {preview ? (
                <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                  <p>Warehouse on-hand: <strong>{preview.current_quantity}</strong></p>
                  <p>Active reservations: <strong>{preview.reserved_quantity}</strong></p>
                  <p>Available to transfer: <strong>{preview.available_to_transfer}</strong></p>
                  {preview.destination_on_hand != null ? (
                    <p>Doctor bag on-hand: <strong>{preview.destination_on_hand}</strong></p>
                  ) : null}
                  {Number(preview.estimated_value || 0) > 0 ? (
                    <p>Estimated value: <strong>{formatRupees(preview.estimated_value)}</strong></p>
                  ) : null}
                </div>
              ) : null}
              {exceeds ? (
                <p className="text-xs text-rose-600">Cannot transfer more than available-to-transfer stock ({available}).</p>
              ) : null}
              {previewError ? <p className="text-xs text-rose-600">{previewError}</p> : <AllocationPreviewList preview={preview} />}
              <OperationalOverrideFields user={user} reason={overrideReason} onChange={setOverrideReason} />
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
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[#4FB8B3] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isSaving ? "Transferring…" : step === "confirm" ? "Transfer to doctor bag" : "Review transfer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="max-w-[62%] break-words text-right font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
