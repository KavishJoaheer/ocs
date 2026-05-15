import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CreditCard,
  DollarSign,
  Eye,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Share2,
  SquarePen,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import { shareOrDownloadBillPdf } from "../lib/billPdf.js";
import {
  formatCurrency,
  formatDate,
  formatPaymentMethod,
} from "../lib/format.js";
import { cx, formControlClass, pageContainerClass } from "../lib/utils.js";

const BILLING_FIELD = cx(
  formControlClass,
  "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white",
);

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "juice", label: "Juice" },
  { value: "card", label: "Card" },
  { value: "ib", label: "IB" },
];
const CONSULTATION_TYPE_OPTIONS = [
  "Day Consultation",
  "Night Consultation",
  "Review Consultation",
];

function resolveConsultationFee(feeMap, typeName) {
  if (!feeMap || !typeName) return "";
  const value = feeMap[typeName];
  if (value == null || Number.isNaN(Number(value))) return "";
  return String(Number(value));
}

function createEmptyLineItem() {
  return { description: "", amount: "0", type: "Sale" };
}

function BillingStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
      <div className="flex items-center gap-4">
        <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
        </div>
      </div>
    </div>
  );
}

function BillingItemsEditor({ items, setItems, lockInventory = false }) {
  function updateItem(index, key, value) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const isInventoryLine = Boolean(item.inventory_item_id) && Number(item.quantity || 0) > 0;
        const lineLocked = lockInventory && isInventoryLine;
        return (
          <div key={index} className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_160px_150px_auto]">
            <input
              required
              value={item.description}
              onChange={(event) => updateItem(index, "description", event.target.value)}
              placeholder="Description"
              disabled={lineLocked}
              className={cx(BILLING_FIELD, "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500")}
            />
            <input
              required
              min="0"
              step="0.01"
              type="number"
              value={item.amount}
              onChange={(event) => updateItem(index, "amount", event.target.value)}
              placeholder="Amount"
              disabled={lineLocked}
              className={cx(BILLING_FIELD, "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500")}
            />
            <select
              value={item.type || "Sale"}
              onChange={(event) => updateItem(index, "type", event.target.value)}
              disabled={lineLocked}
              className={cx(BILLING_FIELD, "px-3 text-sm font-semibold text-slate-600 disabled:cursor-not-allowed disabled:bg-slate-100")}
            >
              <option value="Sale">Sale</option>
              <option value="Wastage">Wastage</option>
              <option value="Adjustment">Adjustment</option>
            </select>
            <button
              type="button"
              disabled={lineLocked}
              onClick={() =>
                setItems((current) =>
                  current.length > 1
                    ? current.filter((_, itemIndex) => itemIndex !== index)
                    : current,
                )
              }
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {lineLocked ? "Locked" : "Remove"}
            </button>
          </div>
        );
      })}
      {lockInventory && items.some((item) => item.inventory_item_id && Number(item.quantity || 0) > 0) ? (
        <p className="text-xs text-slate-500">Inventory-linked lines cannot be edited after billing finalization to keep stock movements consistent.</p>
      ) : null}

      <button
        type="button"
        onClick={() => setItems((current) => [...current, createEmptyLineItem()])}
        className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
      >
        Add line item
      </button>
    </div>
  );
}

function BillingStatusFields({
  status,
  setStatus,
  paymentMethod,
  setPaymentMethod,
  paymentDate,
  setPaymentDate,
  total,
}) {
  function handleStatusChange(nextStatus) {
    setStatus(nextStatus);

    if (nextStatus !== "paid") {
      setPaymentMethod("");
      setPaymentDate("");
    }
  }

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-4">
      <label className="min-w-0 space-y-2">
        <span className="text-sm font-semibold text-slate-700">Status</span>
        <select
          value={status}
          onChange={(event) => handleStatusChange(event.target.value)}
          className={BILLING_FIELD}
        >
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
        </select>
      </label>

      <label className="min-w-0 space-y-2">
        <span className="text-sm font-semibold text-slate-700">Pay by</span>
        <select
          disabled={status !== "paid"}
          value={paymentMethod}
          onChange={(event) => setPaymentMethod(event.target.value)}
          className={cx(BILLING_FIELD, "disabled:cursor-not-allowed disabled:bg-slate-100")}
        >
          <option value="">Select method</option>
          {PAYMENT_METHOD_OPTIONS.map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-2">
        <span className="text-sm font-semibold text-slate-700">Payment date</span>
        <input
          type="date"
          disabled={status !== "paid"}
          value={paymentDate}
          onChange={(event) => setPaymentDate(event.target.value)}
          className={cx(BILLING_FIELD, "disabled:cursor-not-allowed disabled:bg-slate-100")}
        />
      </label>

      <div className="min-w-0 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          Total
        </p>
        <p className="mt-2 text-2xl font-bold text-slate-950">{formatCurrency(total)}</p>
      </div>
    </div>
  );
}

function EditBillingModal({ open, bill, onClose, onSubmit, isSaving }) {
  const isMobile = useIsMobile();
  const [status, setStatus] = useState("unpaid");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [items, setItems] = useState([createEmptyLineItem()]);

  useEffect(() => {
    if (!open || !bill) {
      return;
    }

    setStatus(bill.status);
    setPaymentMethod(bill.payment_method || "");
    setPaymentDate(bill.payment_date || "");
    setItems(
      bill.items.length
        ? bill.items.map((item) => ({
            description: item.description,
            amount: String(item.amount),
            type: item.type || "Sale",
            quantity: Number(item.quantity || 0) || 0,
            inventory_item_id: item.inventory_item_id ? Number(item.inventory_item_id) : null,
            emergency_override: Boolean(item.emergency_override),
          }))
        : [createEmptyLineItem()],
    );
  }, [open, bill]);

  const total = useMemo(
    () =>
      items.reduce((sum, item) => {
        const itemType = String(item.type || "Sale");
        if (itemType === "Wastage" || itemType === "Adjustment") return sum;
        return sum + Number(item.amount || 0);
      }, 0),
    [items],
  );

  function handleSubmit(event) {
    event.preventDefault();

    if (status === "paid" && !paymentMethod) {
      toast.error("Select how the payment was made.");
      return;
    }

    onSubmit({
      items: items.map((item) => ({
        description: item.description,
        amount: Number(item.amount || 0),
        type: item.type || "Sale",
        quantity: Number(item.quantity || 0) || 0,
        inventory_item_id: item.inventory_item_id || null,
        emergency_override: Boolean(item.emergency_override),
      })),
      status,
      payment_method: status === "paid" ? paymentMethod : null,
      payment_date: status === "paid" ? paymentDate || null : null,
    });
  }

  if (!bill) {
    return null;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit bill #${bill.id}`}
      description={
        isMobile
          ? undefined
          : "Update line items, payment status, payment method, and payment date for this billing entry."
      }
      size="xl"
    >
      <form className="min-w-0 w-full max-w-full space-y-5" onSubmit={handleSubmit}>
        <div className="rounded-[26px] border border-sky-100 bg-sky-50/70 p-4">
          <p className="text-lg font-semibold text-slate-950">{bill.patient_name}</p>
          <p className="mt-1 text-sm text-slate-600">
            {bill.doctor_name} - {formatDate(bill.consultation_date)}
          </p>
        </div>

        <BillingItemsEditor items={items} setItems={setItems} lockInventory />

        <BillingStatusFields
          status={status}
          setStatus={setStatus}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          paymentDate={paymentDate}
          setPaymentDate={setPaymentDate}
          total={total}
        />

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Update bill"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TypeBadge({ type }) {
  const palette =
    type === "Wastage"
      ? "bg-amber-100 text-amber-700"
      : type === "Adjustment"
        ? "bg-rose-100 text-rose-700"
        : "bg-[#4FB8B3]/15 text-[#1f7f7b]";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${palette}`}>
      {type}
    </span>
  );
}

function DescriptionList({
  consultationType,
  consultationPrice,
  items,
  onRemoveLine,
  onToggleOverride,
  onUpdateManual,
  onAddManual,
  compactMobile = false,
  onUpdateInventoryLine = null,
}) {
  const consultationSubtotal = Math.max(0, Number(consultationPrice || 0));
  const hasInventoryRows = items.length > 0;
  const gridCols = "grid grid-cols-[2fr_70px_120px_110px_120px_44px] items-start gap-3";

  return (
    <div className="min-w-0 w-full max-w-full overflow-x-hidden rounded-[24px] border border-slate-200 bg-white">
      <div
        className={`${gridCols} hidden border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:grid`}
      >
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit Price</span>
        <span>Type</span>
        <span className="text-right">Subtotal</span>
        <span></span>
      </div>

      <div className="divide-y divide-slate-100">
        <div className="hidden items-center px-4 py-3 text-sm md:grid md:grid-cols-[2fr_70px_120px_110px_120px_44px] md:items-start md:gap-3">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-xl bg-[#4FB8B3]/15 text-[#1f7f7b]">
              <Stethoscope className="size-3.5" />
            </span>
            <div>
              <p className="font-semibold text-slate-900">{consultationType}</p>
              <p className="text-xs text-slate-500">Consultation charge</p>
            </div>
          </div>
          <p className="text-right text-slate-700">1</p>
          <p className="text-right text-slate-700">{formatCurrency(consultationSubtotal)}</p>
          <TypeBadge type="Sale" />
          <p className="text-right font-semibold text-slate-900">{formatCurrency(consultationSubtotal)}</p>
          <span className="text-right text-xs text-slate-300">—</span>
        </div>
        {compactMobile ? (
          <div className="border-b border-slate-100 px-3 py-2 md:hidden">
            <div className="flex min-h-10 items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-1.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#4FB8B3]/15 text-[#1f7f7b]">
                <Stethoscope className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight text-slate-900">{consultationType}</p>
                <p className="text-xs text-slate-500">{formatCurrency(consultationSubtotal)}</p>
              </div>
            </div>
          </div>
        ) : null}

        {hasInventoryRows ? (
          items.map((item, index) => {
            const qty = Number(item.quantity || 0);
            const unitPrice =
              Number(item.unit_price) ||
              (qty > 0 ? Number(item.amount || 0) / qty : Number(item.amount || 0));
            const subtotal = item.type === "Wastage" ? 0 : Number(item.amount || 0);
            const available = Number(item.available || 0);
            const needsOverride = qty > available;
            const canEditInventoryQty = Boolean(compactMobile && onUpdateInventoryLine && !item.is_manual);

            if (item.is_manual) {
              return (
                <div key={`manual-${index}`}>
                  <div className={`${gridCols} hidden px-4 py-3 text-sm md:grid`}>
                    <input
                      value={item.description}
                      onChange={(event) => onUpdateManual(index, { description: event.target.value })}
                      placeholder="Custom item description"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#4FB8B3]"
                    />
                    <input
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={item.quantity}
                      onChange={(event) => onUpdateManual(index, { quantity: event.target.value })}
                      className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-sm text-slate-700 outline-none focus:border-[#4FB8B3]"
                    />
                    <input
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(event) => onUpdateManual(index, { unit_price: event.target.value })}
                      className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 py-2 text-right text-sm text-slate-700 outline-none focus:border-[#4FB8B3]"
                    />
                    <select
                      value={item.type}
                      onChange={(event) => onUpdateManual(index, { type: event.target.value })}
                      className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-600 outline-none focus:border-[#4FB8B3]"
                    >
                      <option value="Sale">Sale</option>
                      <option value="Wastage">Wastage</option>
                    </select>
                    <p className={`text-right font-semibold ${item.type === "Wastage" ? "text-slate-400 line-through" : "text-slate-900"}`}>
                      {formatCurrency(subtotal)}
                    </p>
                    <button
                      type="button"
                      onClick={() => onRemoveLine(index)}
                      className="grid size-9 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:text-rose-600"
                      title="Remove line"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {compactMobile ? (
                    <div className="md:hidden space-y-3 px-4 py-3">
                      <input
                        value={item.description}
                        onChange={(event) => onUpdateManual(index, { description: event.target.value })}
                        placeholder="Description"
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#4FB8B3]"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="text-xs font-semibold text-slate-500">Qty</span>
                          <input
                            inputMode="numeric"
                            min="0"
                            step="1"
                            value={item.quantity}
                            onChange={(event) => onUpdateManual(index, { quantity: event.target.value })}
                            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-right text-sm outline-none focus:border-[#4FB8B3]"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-semibold text-slate-500">Unit (Rs)</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(event) => onUpdateManual(index, { unit_price: event.target.value })}
                            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-right text-sm outline-none focus:border-[#4FB8B3]"
                          />
                        </label>
                      </div>
                      <div className="flex min-h-12 items-center justify-between gap-2">
                        <select
                          value={item.type}
                          onChange={(event) => onUpdateManual(index, { type: event.target.value })}
                          className="min-h-12 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 outline-none focus:border-[#4FB8B3]"
                        >
                          <option value="Sale">Sale</option>
                          <option value="Wastage">Wastage</option>
                        </select>
                        <p className={`text-sm font-bold ${item.type === "Wastage" ? "text-slate-400 line-through" : "text-slate-900"}`}>
                          {formatCurrency(subtotal)}
                        </p>
                        <button
                          type="button"
                          onClick={() => onRemoveLine(index)}
                          className="grid size-12 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-500"
                          title="Remove"
                        >
                          <Trash2 className="size-5" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            }

            return (
              <div key={`line-${index}`}>
                <div className={`${gridCols} hidden px-4 py-3 text-sm md:grid`}>
                  <div>
                    <p className="font-semibold text-slate-900">{item.description}</p>
                    <p className="text-xs text-slate-500">
                      {item.folder_name || "Inventory"} · Available: {available}
                    </p>
                    {needsOverride ? (
                      <label className="mt-1 inline-flex items-center gap-2 text-xs font-semibold text-rose-700">
                        <input
                          type="checkbox"
                          checked={Boolean(item.emergency_override)}
                          onChange={(event) => onToggleOverride(index, event.target.checked)}
                        />
                        <AlertTriangle className="size-3.5" />
                        Emergency override
                      </label>
                    ) : null}
                  </div>
                  <p className="text-right text-slate-700">{qty}</p>
                  <p className="text-right text-slate-700">{formatCurrency(unitPrice)}</p>
                  <TypeBadge type={item.type || "Sale"} />
                  <p className={`text-right font-semibold ${item.type === "Wastage" ? "text-slate-400 line-through" : "text-slate-900"}`}>
                    {formatCurrency(subtotal)}
                  </p>
                  <button
                    type="button"
                    onClick={() => onRemoveLine(index)}
                    className="grid size-9 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:text-rose-600"
                    title="Remove line"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {compactMobile ? (
                  <div className="md:hidden space-y-2 px-4 py-3">
                    <div className="flex min-h-12 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{item.description}</p>
                        <p className="text-xs text-slate-500">
                          {item.folder_name || "Inventory"} · Stock {available}
                        </p>
                        {available <= 0 ? (
                          <p className="mt-1 text-xs font-bold text-rose-600">Out of stock</p>
                        ) : needsOverride ? (
                          <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                            <AlertTriangle className="size-3.5" />
                            Above on-hand stock — billing uses emergency override
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveLine(index)}
                        className="grid size-12 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-500"
                        title="Remove"
                      >
                        <Trash2 className="size-5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1">
                        <span className="text-xs font-semibold text-slate-500">Qty</span>
                        {canEditInventoryQty ? (
                          <input
                            inputMode="numeric"
                            min="1"
                            step="1"
                            value={qty || ""}
                            onChange={(event) =>
                              onUpdateInventoryLine(index, { quantity: event.target.value })
                            }
                            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-right text-sm font-semibold outline-none focus:border-[#4FB8B3]"
                          />
                        ) : (
                          <div className="flex min-h-12 items-center rounded-2xl border border-slate-100 bg-slate-50 px-3 text-right text-sm font-semibold text-slate-800">
                            {qty}
                          </div>
                        )}
                      </label>
                      <div className="space-y-1">
                        <span className="text-xs font-semibold text-slate-500">Unit</span>
                        <div className="flex min-h-12 items-center rounded-2xl border border-slate-100 bg-slate-50 px-3 text-sm font-semibold text-slate-800">
                          {formatCurrency(unitPrice)}
                        </div>
                      </div>
                    </div>
                    <div className="flex min-h-12 items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-2">
                      <TypeBadge type={item.type || "Sale"} />
                      <p className={`text-sm font-bold ${item.type === "Wastage" ? "text-slate-400 line-through" : "text-slate-900"}`}>
                        {formatCurrency(subtotal)}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="px-4 py-5 text-center text-sm text-slate-400 md:py-4">
            <span className="hidden md:inline">No line items yet.</span>
            <span className="md:hidden">Use Select from Inventory or Add manual item.</span>
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 md:py-2">
        <button
          type="button"
          onClick={onAddManual}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[#4FB8B3]/40 bg-white px-4 py-3 text-sm font-semibold text-[#1f7f7b] transition hover:bg-[#4FB8B3]/10 md:min-h-0 md:px-3 md:py-2 md:text-xs"
        >
          <Plus className="size-4 md:size-3.5" />
          Add manual item
        </button>
      </div>
    </div>
  );
}

function CreateBillingModal({
  open,
  onClose,
  onSubmit,
  isSaving,
  patients,
  consultations,
  preselectedPatientId,
}) {
  const { user: authUser } = useAuth();
  const [patientId, setPatientId] = useState("");
  const [consultationId, setConsultationId] = useState("");
  const [status, setStatus] = useState("unpaid");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [consultationType, setConsultationType] = useState("Day Consultation");
  const [consultationPrice, setConsultationPrice] = useState("");
  const [items, setItems] = useState([]);
  const [inventoryOptions, setInventoryOptions] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [itemQuery, setItemQuery] = useState("");
  const [inventorySelection, setInventorySelection] = useState(null);
  const [inventoryQty, setInventoryQty] = useState("1");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const suggestionsRef = useRef(null);
  const isMobile = useIsMobile();
  const [patientPickerOpen, setPatientPickerOpen] = useState(false);
  const [patientSearchQuery, setPatientSearchQuery] = useState("");
  const [inventoryOverlayOpen, setInventoryOverlayOpen] = useState(false);
  const [inventoryOverlayQuery, setInventoryOverlayQuery] = useState("");
  const [inventoryCategory, setInventoryCategory] = useState("All");
  const [consultationFees, setConsultationFees] = useState({});
  const [consultationPriceEditable, setConsultationPriceEditable] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setPatientId(preselectedPatientId || "");
    setConsultationId("");
    setStatus("unpaid");
    setPaymentMethod("");
    setPaymentDate("");
    setConsultationType("Day Consultation");
    setConsultationPrice("");
    setItems([]);
    setInventoryOptions([]);
    setItemQuery("");
    setInventorySelection(null);
    setInventoryQty("1");
    setSuggestionsOpen(false);
    setHighlightIndex(0);
    setPatientPickerOpen(false);
    setPatientSearchQuery("");
    setInventoryOverlayOpen(false);
    setInventoryOverlayQuery("");
    setInventoryCategory("All");
    setConsultationPriceEditable(false);
    setConsultationFees({});
  }, [open, preselectedPatientId]);

  useEffect(() => {
    if (!open) return undefined;
    let ignore = false;
    api
      .get("/billing/consultation-fees")
      .then((fees) => {
        if (!ignore) setConsultationFees(fees || {});
      })
      .catch(() => {
        if (!ignore) setConsultationFees({});
      });
    return () => {
      ignore = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || consultationPriceEditable) return;
    const fee = resolveConsultationFee(consultationFees, consultationType);
    if (fee !== "") setConsultationPrice(fee);
  }, [open, consultationFees, consultationType, consultationPriceEditable]);

  const patientConsultations = useMemo(
    () =>
      consultations.filter(
        (consultation) => Number(consultation.patient_id) === Number(patientId || 0),
      ),
    [consultations, patientId],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!patientConsultations.length) {
      setConsultationId("");
      return;
    }

    if (!patientConsultations.some((consultation) => consultation.id === Number(consultationId))) {
      setConsultationId(String(patientConsultations[0].id));
    }
  }, [consultationId, open, patientConsultations]);

  const selectedConsultation =
    patientConsultations.find((consultation) => consultation.id === Number(consultationId)) || null;

  const filteredSuggestions = useMemo(() => {
    const needle = String(itemQuery || "").trim().toLowerCase();
    if (!needle) return [];
    return inventoryOptions.filter((item) => String(item.item_name || "").toLowerCase().includes(needle));
  }, [inventoryOptions, itemQuery]);

  const filteredPatientsForPicker = useMemo(() => {
    const needle = String(patientSearchQuery || "").trim().toLowerCase();
    if (!needle) return patients;
    return patients.filter((patient) => {
      const name = String(patient.full_name || "").toLowerCase();
      const id = String(patient.patient_identifier || patient.patient_id_number || "").toLowerCase();
      return name.includes(needle) || id.includes(needle);
    });
  }, [patients, patientSearchQuery]);

  const doctorHasNoAssignedPatients = authUser?.role === "doctor" && patients.length === 0;

  useEffect(() => {
    if (!open || !patientId || !patients.length) return;
    if (!patients.some((p) => String(p.id) === String(patientId))) {
      setPatientId("");
    }
  }, [open, patients, patientId]);

  const inventoryCategories = useMemo(() => {
    const folders = new Set();
    inventoryOptions.forEach((item) => {
      folders.add(String(item.folder_name || "").trim() || "Uncategorized");
    });
    return ["All", ...Array.from(folders).sort((a, b) => a.localeCompare(b))];
  }, [inventoryOptions]);

  const filteredInventoryOverlayRows = useMemo(() => {
    let rows = inventoryOptions;
    if (inventoryCategory !== "All") {
      rows = rows.filter(
        (item) => (String(item.folder_name || "").trim() || "Uncategorized") === inventoryCategory,
      );
    }
    const needle = String(inventoryOverlayQuery || "").trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((item) => {
      const name = String(item.item_name || "").toLowerCase();
      const folder = String(item.folder_name || "").toLowerCase();
      return name.includes(needle) || folder.includes(needle);
    });
  }, [inventoryOptions, inventoryOverlayQuery, inventoryCategory]);

  function handleConsultationTypeChange(nextType) {
    setConsultationType(nextType);
    if (!consultationPriceEditable) {
      const fee = resolveConsultationFee(consultationFees, nextType);
      if (fee !== "") setConsultationPrice(fee);
    }
  }

  const selectedPatientLabel = useMemo(() => {
    const row = patients.find((patient) => Number(patient.id) === Number(patientId));
    if (!row) return "";
    return `${row.full_name} — ${row.patient_identifier || row.patient_id_number || ""}`;
  }, [patients, patientId]);

  useEffect(() => {
    if (!open || !consultationId) return;
    let ignore = false;
    async function loadInventory() {
      setInventoryLoading(true);
      try {
        const rows = await api.get(`/billing/inventory-options/by-consultation/${consultationId}`);
        if (!ignore) {
          setInventoryOptions(rows);
        }
      } catch (error) {
        if (!ignore) toast.error(error.message);
      } finally {
        if (!ignore) setInventoryLoading(false);
      }
    }
    loadInventory();
    return () => {
      ignore = true;
    };
  }, [open, consultationId]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [itemQuery, consultationId]);

  function getSellingPriceFromDoctorStock(itemId) {
    const row = inventoryOptions.find((item) => Number(item.id) === Number(itemId));
    return Number(row?.selling_price || 0);
  }

  function handleSelectSuggestion(item) {
    setInventorySelection(item);
    setItemQuery(item.item_name || "");
    setInventoryQty("1");
    setSuggestionsOpen(false);
  }

  const consultationPriceNumber = Number(consultationPrice || 0);
  const total = useMemo(() => {
    const inventoryTotal = items.reduce((sum, item) => {
      const itemType = String(item.type || "Sale");
      if (itemType === "Wastage" || itemType === "Adjustment") return sum;
      return sum + Number(item.amount || 0);
    }, 0);
    return inventoryTotal + Math.max(0, consultationPriceNumber);
  }, [items, consultationPriceNumber]);

  const canAddItemLine = Boolean(patientId && consultationId && inventorySelection);
  const addLineDisabledReason = !patientId
    ? "Select a patient first"
    : !consultationId
      ? "Select a consultation first"
      : !inventorySelection
        ? "Pick an item from the suggestions"
        : "";

  function handleSubmit(event) {
    event.preventDefault();

    if (doctorHasNoAssignedPatients) {
      toast.error("No patients are assigned to your account.");
      return;
    }

    if (!patientId) {
      toast.error("Select a patient.");
      return;
    }

    if (!consultationId) {
      toast.error("Select a consultation.");
      return;
    }

    if (status === "paid" && !paymentMethod) {
      toast.error("Select how the payment was made.");
      return;
    }

    if (consultationPriceNumber < 0) {
      toast.error("Consultation price must be zero or more.");
      return;
    }

    const invalidManual = items.find(
      (item) => item.is_manual && !String(item.description || "").trim(),
    );
    if (invalidManual) {
      toast.error("Manual items need a description.");
      return;
    }

    const combinedItems = [
      {
        description: consultationType,
        amount: consultationPriceNumber,
        type: "Sale",
        quantity: 1,
      },
      ...items,
    ];

    onSubmit({
      patient_id: Number(patientId),
      consultation_id: Number(consultationId),
      items: combinedItems.map((item) => ({
        description: item.description,
        amount: Number(item.amount || 0),
        type: item.type || "Sale",
        quantity: Number(item.quantity || 0),
        inventory_item_id: item.inventory_item_id ? Number(item.inventory_item_id) : null,
        emergency_override: Boolean(item.emergency_override),
      })),
      status,
      payment_method: status === "paid" ? paymentMethod : null,
      payment_date: status === "paid" ? paymentDate || null : null,
    });
  }

  function resetItemSearch() {
    setInventorySelection(null);
    setItemQuery("");
    setInventoryQty("1");
    setSuggestionsOpen(false);
    setHighlightIndex(0);
  }

  function addInventoryLine(type) {
    if (!patientId || !consultationId) {
      toast.error("Select a patient and consultation first.");
      return;
    }
    const selected = inventorySelection
      ? inventoryOptions.find((row) => Number(row.id) === Number(inventorySelection.id))
      : null;
    const qty = Number(inventoryQty || 0);
    if (!selected) {
      toast.error("Select an inventory item first.");
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.error("Quantity must be a whole number greater than 0.");
      return;
    }
    const available = Number(selected.quantity || 0);
    const sellingPrice = getSellingPriceFromDoctorStock(selected.id);
    const unitPrice =
      type === "Wastage" ? Number(selected.cost_price || 0) : sellingPrice;
    setItems((current) => [
      ...current,
      {
        description: selected.item_name,
        amount: unitPrice * qty,
        unit_price: unitPrice,
        type,
        quantity: qty,
        inventory_item_id: selected.id,
        available,
        folder_name: selected.folder_name || "",
        emergency_override: qty > available,
      },
    ]);
    resetItemSearch();
  }

  function appendSaleFromInventoryRow(stockRow) {
    if (!patientId || !consultationId) {
      toast.error("Select a patient and consultation first.");
      return;
    }
    const selected = inventoryOptions.find((row) => Number(row.id) === Number(stockRow.id));
    if (!selected) {
      return;
    }
    const qty = 1;
    const available = Number(selected.quantity || 0);
    const sellingPrice = Number(selected.selling_price || 0);
    setItems((current) => [
      ...current,
      {
        description: selected.item_name,
        amount: sellingPrice * qty,
        unit_price: sellingPrice,
        type: "Sale",
        quantity: qty,
        inventory_item_id: selected.id,
        available,
        folder_name: selected.folder_name || "",
        emergency_override: qty > available,
      },
    ]);
    setInventoryOverlayOpen(false);
    setInventoryOverlayQuery("");
  }

  function updateInventoryLine(index, patch) {
    setItems((current) =>
      current.map((row, idx) => {
        if (idx !== index || row.is_manual) return row;
        const qty = Math.max(1, Math.floor(Number(patch.quantity !== undefined ? patch.quantity : row.quantity || 1)));
        const unitPrice = Number(row.unit_price || 0);
        const itemType = String(row.type || "Sale");
        const amount =
          itemType === "Wastage" ? Number(row.unit_price || 0) * qty : itemType === "Adjustment" ? 0 : unitPrice * qty;
        const available = Number(row.available || 0);
        return {
          ...row,
          quantity: qty,
          amount,
          emergency_override: qty > available,
        };
      }),
    );
  }

  function removeLine(index) {
    setItems((current) => current.filter((_, idx) => idx !== index));
  }

  function setLineEmergencyOverride(index, checked) {
    setItems((current) =>
      current.map((row, idx) =>
        idx === index ? { ...row, emergency_override: Boolean(checked) } : row,
      ),
    );
  }

  function updateManualLine(index, patch) {
    setItems((current) =>
      current.map((row, idx) => {
        if (idx !== index) return row;
        if (!row.is_manual) return row;
        const next = { ...row, ...patch };
        const qty = Math.max(0, Number(next.quantity || 0));
        const unitPrice = Math.max(0, Number(next.unit_price || 0));
        next.quantity = qty;
        next.unit_price = unitPrice;
        next.amount = next.type === "Wastage" ? 0 : qty * unitPrice;
        return next;
      }),
    );
  }

  function addManualLine() {
    if (!patientId || !consultationId) {
      toast.error("Select a patient and consultation first.");
      return;
    }
    setItems((current) => [
      ...current,
      {
        description: "",
        amount: 0,
        unit_price: 0,
        type: "Sale",
        quantity: 1,
        inventory_item_id: null,
        emergency_override: false,
        is_manual: true,
        folder_name: "Custom",
      },
    ]);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isMobile ? "New invoice" : "Add billing entry"}
      size="xl"
      innerScroll={!isMobile}
    >
      <form
        className={cx(
          "min-w-0 w-full max-w-full",
          isMobile ? "flex min-h-0 flex-1 flex-col" : "space-y-3",
        )}
        onSubmit={handleSubmit}
      >
        <div
          className={cx(
            "min-w-0 w-full max-w-full",
            isMobile
              ? "flex-1 space-y-4 overflow-x-hidden overflow-y-auto pb-4"
              : "contents",
          )}
        >
        <div className="hidden min-w-0 gap-3 md:grid md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Patient</span>
            {doctorHasNoAssignedPatients ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
                No patients currently assigned to you.
              </div>
            ) : (
              <select
                required
                value={patientId}
                onChange={(event) => setPatientId(event.target.value)}
                className={BILLING_FIELD}
              >
                <option value="">Select patient</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.full_name} - {patient.patient_identifier || patient.patient_id_number}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Consultation</span>
            <select
              required
              disabled={!patientId || !patientConsultations.length}
              value={consultationId}
              onChange={(event) => setConsultationId(event.target.value)}
              className={cx(BILLING_FIELD, "disabled:cursor-not-allowed disabled:bg-slate-100")}
            >
              <option value="">
                {!patientId
                  ? "Select a patient first"
                  : patientConsultations.length
                    ? "Select consultation"
                    : "No consultations available"}
              </option>
              {patientConsultations.map((consultation) => (
                <option key={consultation.id} value={consultation.id}>
                  {formatDate(consultation.consultation_date)} - {consultation.doctor_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="min-w-0 space-y-3 md:hidden">
          <div>
            <span className="text-sm font-semibold text-slate-700">Patient</span>
            {doctorHasNoAssignedPatients ? (
              <div className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
                No patients currently assigned to you.
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPatientSearchQuery("");
                  setPatientPickerOpen(true);
                }}
                className={cx(
                  BILLING_FIELD,
                  "mt-2 flex min-h-12 items-center justify-between gap-2 text-left text-sm font-semibold text-slate-800 focus:border-[#4FB8B3]",
                )}
              >
                <span className={patientId ? "text-slate-900" : "text-slate-400"}>
                  {patientId ? selectedPatientLabel : "Search and select patient"}
                </span>
                <Search className="size-5 shrink-0 text-slate-400" />
              </button>
            )}
          </div>
          <label className="block min-w-0 space-y-2">
            <span className="text-sm font-semibold text-slate-700">Consultation</span>
            <select
              required
              disabled={!patientId || !patientConsultations.length}
              value={consultationId}
              onChange={(event) => setConsultationId(event.target.value)}
              className={cx(BILLING_FIELD, "min-h-12 disabled:cursor-not-allowed disabled:bg-slate-100")}
            >
              <option value="">
                {!patientId
                  ? "Select a patient first"
                  : patientConsultations.length
                    ? "Select consultation"
                    : "No consultations available"}
              </option>
              {patientConsultations.map((consultation) => (
                <option key={consultation.id} value={consultation.id}>
                  {formatDate(consultation.consultation_date)} - {consultation.doctor_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedConsultation ? (
          <div className="rounded-[26px] border border-sky-100 bg-sky-50/70 p-3 md:hidden">
            <p className="text-lg font-semibold text-slate-950">
              {selectedConsultation.patient_name}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {selectedConsultation.doctor_name} - {formatDate(selectedConsultation.consultation_date)}
            </p>
          </div>
        ) : null}

        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          <label className="min-w-0 space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">Consultation Type</span>
            <select
              value={consultationType}
              onChange={(event) => handleConsultationTypeChange(event.target.value)}
              className={cx(BILLING_FIELD, "min-h-12 md:min-h-0")}
            >
              {CONSULTATION_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 space-y-1.5">
            <span className="text-sm font-semibold text-slate-700">Consultation Price (Rs)</span>
            <div className="relative min-w-0">
              <input
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                readOnly={!consultationPriceEditable}
                value={consultationPrice}
                onChange={(event) => setConsultationPrice(event.target.value)}
                placeholder="0.00"
                className={cx(
                  BILLING_FIELD,
                  "min-h-12 pr-12 md:min-h-0",
                  !consultationPriceEditable && "cursor-default bg-slate-100/90",
                )}
              />
              <button
                type="button"
                aria-label={consultationPriceEditable ? "Lock consultation price" : "Edit consultation price"}
                onClick={() => setConsultationPriceEditable((current) => !current)}
                className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-xl border border-slate-200/80 bg-white text-slate-600 transition hover:border-[#4FB8B3]/40 hover:text-[#1f7f7b]"
              >
                <Pencil className="size-4" />
              </button>
            </div>
          </label>
        </div>

        <div className="hidden rounded-[24px] border border-slate-200 bg-slate-50/60 p-3 md:block">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_88px_120px_auto] md:items-center">
            <div className="relative">
              <input
                value={itemQuery}
                onChange={(event) => {
                  const value = event.target.value;
                  setItemQuery(value);
                  setSuggestionsOpen(value.trim().length > 0);
                }}
                onBlur={() => {
                  window.setTimeout(() => setSuggestionsOpen(false), 120);
                }}
                onKeyDown={(event) => {
                  if (!filteredSuggestions.length) return;
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSuggestionsOpen(true);
                    setHighlightIndex((prev) => {
                      const next = Math.min(filteredSuggestions.length - 1, prev + 1);
                      suggestionsRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
                      return next;
                    });
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSuggestionsOpen(true);
                    setHighlightIndex((prev) => {
                      const next = Math.max(0, prev - 1);
                      suggestionsRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
                      return next;
                    });
                    return;
                  }
                  if (event.key === "Enter") {
                    if (!suggestionsOpen) return;
                    event.preventDefault();
                    const picked = filteredSuggestions[highlightIndex];
                    if (picked) handleSelectSuggestion(picked);
                    return;
                  }
                  if (event.key === "Escape") {
                    setSuggestionsOpen(false);
                  }
                }}
                placeholder={inventoryLoading ? "Loading stock…" : "Search inventory"}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#4FB8B3]"
              />
              {suggestionsOpen && filteredSuggestions.length ? (
                <div
                  ref={suggestionsRef}
                  className="absolute z-20 mt-1 max-h-[168px] w-full overflow-auto rounded-2xl border border-slate-200 bg-white shadow"
                >
                  {filteredSuggestions.map((item, index) => {
                    const available = Number(item.quantity || 0);
                    const isOut = available <= 0;
                    const isActive = index === highlightIndex;
                    return (
                      <button
                        key={`suggest-${item.id}`}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleSelectSuggestion(item);
                        }}
                        className={`w-full px-4 py-2 text-left text-sm ${
                          isActive ? "bg-[#4FB8B3] text-white" : isOut ? "text-slate-400" : "text-slate-700"
                        }`}
                      >
                        <p className="font-semibold">
                          {item.item_name} ({available > 0 ? `${available} left` : "0 available"})
                        </p>
                        <p className={`text-xs ${isActive ? "text-white/85" : "text-slate-500"}`}>
                          {item.folder_name || "Uncategorized"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <input
              min="1"
              step="1"
              type="number"
              inputMode="numeric"
              value={inventoryQty}
              onChange={(event) => setInventoryQty(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700"
            />
            <input
              readOnly
              value={formatCurrency(getSellingPriceFromDoctorStock(inventorySelection?.id))}
              className="rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-700"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => addInventoryLine("Sale")}
                disabled={!canAddItemLine}
                title={addLineDisabledReason || "Add to bill"}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-2xl bg-[#4FB8B3] px-3 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4" />
                + Add to Bill
              </button>
              <button
                type="button"
                onClick={() => addInventoryLine("Wastage")}
                disabled={!canAddItemLine}
                title={addLineDisabledReason || "Mark as wastage (no charge)"}
                aria-label="Mark as wastage"
                className="grid size-10 shrink-0 place-items-center rounded-2xl border border-amber-200/80 bg-amber-50 text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
          {addLineDisabledReason ? (
            <p className="mt-2 text-xs font-semibold text-amber-700">{addLineDisabledReason}.</p>
          ) : null}
        </div>

        <div className="space-y-2 md:hidden">
          <button
            type="button"
            disabled={!consultationId || inventoryLoading}
            onClick={() => {
              setInventoryOverlayQuery("");
              setInventoryCategory("All");
              setInventoryOverlayOpen(true);
            }}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#4FB8B3]/50 bg-[#4FB8B3]/10 px-4 py-3 text-sm font-bold text-[#1f7f7b] transition hover:bg-[#4FB8B3]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Package className="size-5" />
            {inventoryLoading ? "Loading stock…" : "Select from Inventory"}
          </button>
        </div>

        <DescriptionList
          consultationType={consultationType}
          consultationPrice={consultationPriceNumber}
          items={items}
          onRemoveLine={removeLine}
          onToggleOverride={setLineEmergencyOverride}
          onUpdateManual={updateManualLine}
          onAddManual={addManualLine}
          compactMobile={isMobile}
          onUpdateInventoryLine={isMobile ? updateInventoryLine : null}
        />

        <BillingStatusFields
          status={status}
          setStatus={setStatus}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          paymentDate={paymentDate}
          setPaymentDate={setPaymentDate}
          total={total}
        />
        </div>

        {isMobile ? (
          <div
            className="shrink-0 border-t border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(242,251,250,0.98))] px-1 pt-3"
            style={{ paddingBottom: "max(1.5rem, var(--sab))" }}
          >
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="min-h-12 flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || doctorHasNoAssignedPatients}
                className="min-h-12 flex-1 rounded-2xl bg-[#4FB8B3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isSaving ? "Saving…" : "Save invoice"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || doctorHasNoAssignedPatients}
              className="rounded-2xl bg-[#4FB8B3] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
            >
              {isSaving ? "Saving…" : "Create bill"}
            </button>
          </div>
        )}
      </form>
      {isMobile && open && typeof document !== "undefined"
        ? createPortal(
            <>
              {patientPickerOpen ? (
                <div
                  className="fixed inset-0 z-[60] flex flex-col bg-white"
                  style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
                >
                  <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-slate-200 px-2">
                    <button
                      type="button"
                      onClick={() => setPatientPickerOpen(false)}
                      className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600"
                    >
                      Cancel
                    </button>
                    <span className="text-sm font-bold text-slate-900">Select patient</span>
                    <span className="w-16" />
                  </div>
                  <div className="shrink-0 border-b border-slate-100 p-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
                      <input
                        autoFocus
                        value={patientSearchQuery}
                        onChange={(event) => setPatientSearchQuery(event.target.value)}
                        placeholder="Search name or patient ID"
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#4FB8B3]"
                      />
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {doctorHasNoAssignedPatients ? (
                      <p className="px-4 py-10 text-center text-sm font-semibold text-rose-900">No patients currently assigned to you.</p>
                    ) : filteredPatientsForPicker.length === 0 ? (
                      <p className="px-4 py-10 text-center text-sm text-slate-500">No matches.</p>
                    ) : (
                      filteredPatientsForPicker.map((patient) => (
                        <button
                          key={patient.id}
                          type="button"
                          className="flex min-h-[48px] w-full flex-col items-start justify-center border-b border-slate-100 px-4 py-3 text-left active:bg-[#4FB8B3]/10"
                          onClick={() => {
                            setPatientId(String(patient.id));
                            setPatientPickerOpen(false);
                            setPatientSearchQuery("");
                          }}
                        >
                          <span className="font-bold text-slate-950">{patient.full_name}</span>
                          <span className="text-xs font-medium text-slate-500">
                            {patient.patient_identifier || patient.patient_id_number || "—"}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
              {inventoryOverlayOpen ? (
                <div
                  className="fixed inset-0 z-[60] flex flex-col bg-white"
                  style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
                >
                  <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-slate-200 px-2">
                    <button
                      type="button"
                      onClick={() => {
                        setInventoryOverlayOpen(false);
                        setInventoryOverlayQuery("");
                        setInventoryCategory("All");
                      }}
                      className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600"
                    >
                      Close
                    </button>
                    <span className="text-sm font-bold text-slate-900">My stock</span>
                    <span className="w-16" />
                  </div>
                  <div className="shrink-0 space-y-3 border-b border-slate-100 p-3">
                    {inventoryCategories.length > 1 ? (
                      <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                        {inventoryCategories.map((category) => (
                          <button
                            key={category}
                            type="button"
                            onClick={() => setInventoryCategory(category)}
                            className={cx(
                              "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                              inventoryCategory === category
                                ? "bg-[#4FB8B3] text-white"
                                : "bg-slate-100 text-slate-600",
                            )}
                          >
                            {category}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="relative min-w-0">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
                      <input
                        value={inventoryOverlayQuery}
                        onChange={(event) => setInventoryOverlayQuery(event.target.value)}
                        placeholder="Filter stock…"
                        className={cx(BILLING_FIELD, "min-h-12 pl-11")}
                      />
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {inventoryLoading ? (
                      <p className="px-4 py-6 text-center text-sm text-slate-500">Loading stock…</p>
                    ) : inventoryOptions.length === 0 ? (
                      <p className="px-4 py-6 text-center text-sm text-slate-500">
                        No items in My Stock for this visit.
                      </p>
                    ) : filteredInventoryOverlayRows.length === 0 ? (
                      <p className="px-4 py-6 text-center text-sm text-slate-500">
                        No items match this filter.
                      </p>
                    ) : (
                      filteredInventoryOverlayRows.map((item) => {
                        const available = Number(item.quantity || 0);
                        const out = available <= 0;
                        const price = Number(item.selling_price || 0);
                        return (
                          <button
                            key={`inv-row-${item.id}`}
                            type="button"
                            disabled={!consultationId}
                            onClick={() => appendSaleFromInventoryRow(item)}
                            className="flex min-h-[48px] w-full flex-col items-start justify-center gap-0.5 border-b border-slate-100 px-4 py-3 text-left active:bg-[#4FB8B3]/10 disabled:opacity-50"
                          >
                            <div className="flex w-full items-start justify-between gap-2">
                              <span className="font-bold text-slate-950">{item.item_name}</span>
                              <span className="shrink-0 text-sm font-bold text-[#1f7f7b]">{formatCurrency(price)}</span>
                            </div>
                            <div className="flex w-full flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                              <span>{item.folder_name || "Uncategorized"}</span>
                              <span className="text-slate-300">·</span>
                              <span>{available > 0 ? `${available} on hand` : null}</span>
                              {out ? (
                                <span className="font-bold uppercase tracking-wide text-rose-600">Out of stock</span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </>,
            document.body,
          )
        : null}
    </Modal>
  );
}

function BillingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const patientIdFilter = searchParams.get("patientId") || "";
  const [statusFilter, setStatusFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [bills, setBills] = useState([]);
  const [patientSummary, setPatientSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [patientOptions, setPatientOptions] = useState([]);
  const [consultationOptions, setConsultationOptions] = useState([]);
  const canCreateBills = user?.role === "admin" || user?.role === "doctor";
  const isMobile = useIsMobile();
  const [mobileBillTab, setMobileBillTab] = useState(() =>
    searchParams.get("status") === "paid" ? "paid" : "pending",
  );

  async function loadData() {
    try {
      const filterQuery = new URLSearchParams();

      if (statusFilter && !isMobile) {
        filterQuery.set("status", statusFilter);
      }

      if (patientIdFilter) {
        filterQuery.set("patientId", patientIdFilter);
      }

      const queryString = filterQuery.toString();
      const [billingData, summaryData] = await Promise.all([
        api.get(`/billing${queryString ? `?${queryString}` : ""}`),
        api.get("/billing/patient-summary"),
      ]);

      setBills(billingData);
      setPatientSummary(summaryData);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadReferenceData() {
    if (!user) {
      return;
    }
    if (!(user.role === "admin" || user.role === "doctor")) {
      return;
    }

    try {
      const [patients, consultations] = await Promise.all([
        api.get("/patients/options"),
        api.get("/consultations"),
      ]);

      setPatientOptions(patients);
      setConsultationOptions(consultations);
    } catch (error) {
      toast.error(error.message);
    }
  }

  useEffect(() => {
    const initialStatus = searchParams.get("status") || "";
    if (initialStatus && initialStatus !== statusFilter) {
      setStatusFilter(initialStatus);
    }
  }, [searchParams, statusFilter]);

  useEffect(() => {
    loadData();
  }, [statusFilter, patientIdFilter, isMobile]);

  useEffect(() => {
    loadReferenceData();
  }, [user?.id, user?.doctor_id, user?.role]);

  const overallPaid = patientSummary.reduce(
    (sum, patient) => sum + Number(patient.paid_amount || 0),
    0,
  );
  const overallUnpaid = patientSummary.reduce(
    (sum, patient) => sum + Number(patient.unpaid_amount || 0),
    0,
  );
  const overallBilled = patientSummary.reduce(
    (sum, patient) => sum + Number(patient.total_billed || 0),
    0,
  );
  const filteredBills = bills.filter((bill) => {
    if (!searchText.trim()) return true;
    const query = searchText.trim().toLowerCase();
    return (
      bill.patient_name?.toLowerCase().includes(query) ||
      bill.consultation_date?.toLowerCase().includes(query)
    );
  });

  const billsForDisplay = useMemo(() => {
    if (!isMobile) return filteredBills;
    return filteredBills.filter((bill) =>
      mobileBillTab === "pending" ? bill.status === "unpaid" : bill.status === "paid",
    );
  }, [filteredBills, isMobile, mobileBillTab]);

  const pendingPayments = patientSummary.filter((patient) => Number(patient.unpaid_amount || 0) > 0);

  async function handleShareBillPdf(bill) {
    try {
      await shareOrDownloadBillPdf(bill);
    } catch (error) {
      toast.error(error.message || "Could not create PDF.");
    }
  }

  async function handleSave(payload) {
    if (!editor?.bill) {
      return;
    }

    setIsSaving(true);

    try {
      await api.put(`/billing/${editor.bill.id}`, payload);
      toast.success("Bill updated.");
      setEditor(null);
      await loadData();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreate(payload) {
    setIsSaving(true);

    try {
      await api.post("/billing", payload);
      toast.success("Bill created and inventory updated.");
      setCreatorOpen(false);
      await loadData();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  function clearPatientFilter() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("patientId");
    setSearchParams(nextParams);
  }

  if (loading) {
    return <LoadingState label="Loading billing" />;
  }

  return (
    <div className={cx(pageContainerClass, "space-y-6", isMobile && canCreateBills && "pb-28")}>
      <PageHeader
        eyebrow="Revenue"
        title="Billing"
        actions={
          !isMobile && canCreateBills ? (
            <button
              type="button"
              onClick={() => setCreatorOpen(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700"
            >
              <Plus className="size-4" />
              Add bill
            </button>
          ) : null
        }
      />

      {user?.role !== "doctor" ? (
        <div className="hidden gap-4 md:grid md:grid-cols-3">
          <BillingStat icon={DollarSign} label="Total billed" value={formatCurrency(overallBilled)} />
          <BillingStat icon={CreditCard} label="Collected" value={formatCurrency(overallPaid)} />
          <BillingStat icon={ReceiptText} label="Outstanding" value={formatCurrency(overallUnpaid)} />
        </div>
      ) : null}

      {patientIdFilter ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-sky-100 bg-sky-50/80 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Patient billing filter active</p>
            <p className="mt-1 hidden text-sm text-slate-600 sm:block">
              Showing bills only for the selected patient.
            </p>
          </div>
          <button
            type="button"
            onClick={clearPatientFilter}
            className="rounded-2xl border border-sky-200 px-4 py-2.5 text-sm font-semibold text-sky-700 transition hover:border-sky-300 hover:bg-sky-100"
          >
            Clear patient filter
          </button>
        </div>
      ) : null}

      <div
        className={cx(
          "grid gap-6",
          !isMobile && "xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start",
        )}
      >
        <SectionCard
          className="min-w-0"
          title="Bills"
          actions={
            isMobile ? (
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Filter by patient or date…"
                className="min-h-12 w-full min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 outline-none transition focus:border-sky-400 focus:bg-white"
              />
            ) : null
          }
        >
          {!isMobile ? (
            <div className="mb-4 flex flex-row items-center gap-4">
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search patient or date…"
                className="min-w-0 max-w-md flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 outline-none transition focus:border-sky-400 focus:bg-white"
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 outline-none transition focus:border-sky-400 focus:bg-white"
              >
                <option value="">All bills</option>
                <option value="unpaid">Unpaid only</option>
                <option value="paid">Paid only</option>
              </select>
            </div>
          ) : null}
          {isMobile ? (
            <div className="mb-4 flex rounded-2xl border border-slate-200 bg-slate-100 p-1 md:hidden">
              <button
                type="button"
                onClick={() => setMobileBillTab("pending")}
                className={cx(
                  "min-h-12 flex-1 rounded-xl py-2.5 text-sm font-bold transition",
                  mobileBillTab === "pending"
                    ? "bg-white text-[#1f7f7b] shadow-sm"
                    : "text-slate-500",
                )}
              >
                Pending
              </button>
              <button
                type="button"
                onClick={() => setMobileBillTab("paid")}
                className={cx(
                  "min-h-12 flex-1 rounded-xl py-2.5 text-sm font-bold transition",
                  mobileBillTab === "paid"
                    ? "bg-white text-[#1f7f7b] shadow-sm"
                    : "text-slate-500",
                )}
              >
                Paid
              </button>
            </div>
          ) : null}

          {billsForDisplay.length ? (
            <>
              <div className="hidden min-w-0 rounded-[24px] border border-slate-200/80 md:block">
                <div className="overflow-x-auto overscroll-x-contain">
                  <table className="min-w-[920px] w-full bg-white text-left">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                      <tr>
                        <th className="sticky left-0 z-[1] bg-slate-50 px-5 py-3 shadow-[2px_0_0_rgba(226,232,240,0.9)] md:py-3">
                          Patient
                        </th>
                        <th className="px-5 py-3">Consultation</th>
                        <th className="px-5 py-3">Total</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Pay by</th>
                        <th className="px-5 py-3">Payment date</th>
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billsForDisplay.map((bill) => (
                        <tr key={bill.id} className="group border-t border-slate-200/70 hover:bg-slate-50/70">
                          <td className="sticky left-0 z-[1] bg-white px-5 py-3 align-middle shadow-[2px_0_0_rgba(241,245,249,0.95)] group-hover:bg-slate-50/70">
                            <p className="font-semibold text-slate-950">{bill.patient_name}</p>
                            <p className="mt-1 text-sm text-slate-500">{bill.doctor_name}</p>
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-600">
                            <p>{formatDate(bill.consultation_date)}</p>
                            <p className="mt-1 text-slate-500">
                              Bill #{bill.id} - {bill.items.length} line item
                              {bill.items.length === 1 ? "" : "s"}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {bill.items.slice(0, 4).map((item, idx) => (
                                <span
                                  key={`bill-item-${bill.id}-${idx}`}
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                    item.type === "Wastage"
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-[#4FB8B3]/15 text-[#2f8f8b]"
                                  }`}
                                >
                                  {item.type || "Sale"}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-3 font-semibold text-slate-950">
                            {formatCurrency(bill.total_amount)}
                          </td>
                          <td className="px-5 py-3">
                            <StatusBadge value={bill.status} />
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-600">
                            {formatPaymentMethod(bill.payment_method)}
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-600">
                            {bill.payment_date ? formatDate(bill.payment_date) : "Not paid yet"}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex flex-row items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleShareBillPdf(bill)}
                                className="inline-flex items-center gap-1.5 rounded-2xl border border-[#4FB8B3]/35 bg-[#4FB8B3]/10 px-3 py-1.5 text-sm font-semibold text-[#1f7f7b] transition hover:bg-[#4FB8B3]/20"
                              >
                                <Eye className="size-4 shrink-0" />
                                View
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditor({ bill })}
                                aria-label="Edit bill"
                                className="grid size-9 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                              >
                                <SquarePen className="size-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-3 md:hidden">
                {billsForDisplay.map((bill) => (
                  <div
                    key={`card-${bill.id}`}
                    className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_40px_rgba(15,23,42,0.06)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-lg font-bold text-slate-950">{bill.patient_name}</p>
                        <p className="mt-1 text-xs font-medium text-slate-500">Invoice #{bill.id}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleShareBillPdf(bill)}
                        className="grid size-12 shrink-0 place-items-center rounded-2xl border-2 border-[#4FB8B3]/40 bg-[#4FB8B3]/10 text-[#1f7f7b] transition active:scale-95"
                        aria-label="View or share invoice"
                      >
                        <Share2 className="size-5" />
                      </button>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xl font-bold text-[#1f7f7b]">{formatCurrency(bill.total_amount)}</p>
                      <StatusBadge value={bill.status} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditor({ bill })}
                      className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-800"
                    >
                      <SquarePen className="size-4" />
                      Edit invoice
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="No bills found"
              description="Bills are created from consultations, and admin or doctor accounts can add more billing entries here when needed."
            />
          )}
        </SectionCard>

        <SectionCard
          className={cx("w-full max-w-sm xl:justify-self-end", isMobile ? "hidden" : undefined)}
          title="Pending payments from unpaid patients"
        >
          {pendingPayments.length ? (
            <div className="space-y-3">
              {pendingPayments.map((patient) => (
                <div
                  key={patient.patient_id}
                  className="rounded-[24px] border border-rose-200/80 bg-rose-50/70 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{patient.patient_name}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {patient.bill_count} bill{patient.bill_count === 1 ? "" : "s"} total
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-slate-950">
                        {formatCurrency(patient.unpaid_amount)}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-rose-700">
                        Pending / Unpaid
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No pending payments"
              description="All tracked bills are currently paid for the selected filters."
            />
          )}
        </SectionCard>
      </div>

      {canCreateBills && isMobile ? (
        <button
          type="button"
          aria-label="Create new invoice"
          onClick={() => setCreatorOpen(true)}
          className="fixed bottom-24 right-6 z-[45] grid size-14 place-items-center rounded-full bg-[#4FB8B3] text-white shadow-lg shadow-teal-900/25 md:hidden"
        >
          <Plus className="size-7 stroke-[2.5]" />
        </button>
      ) : null}

      <EditBillingModal
        open={Boolean(editor)}
        bill={editor?.bill}
        onClose={() => setEditor(null)}
        onSubmit={handleSave}
        isSaving={isSaving}
      />

      <CreateBillingModal
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        onSubmit={handleCreate}
        isSaving={isSaving}
        patients={patientOptions}
        consultations={consultationOptions}
        preselectedPatientId={patientIdFilter}
      />
    </div>
  );
}

export default BillingPage;
