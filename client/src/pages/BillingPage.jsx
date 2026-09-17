import FinancialReconciliation from "../components/FinancialReconciliation.jsx";
import FinancialDayClose from "../components/FinancialDayClose.jsx";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import {
  AlertTriangle,
  Calendar,
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

dayjs.extend(isoWeek);
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
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { api } from "../lib/api.js";
import {
  formatCurrency,
  formatDate,
  formatPaymentMethod,
  formatRupees,
} from "../lib/format.js";
import { cx, formControlClass, pageContainerClass } from "../lib/utils.js";
import {
  getPeriodRange,
  normalizeReportPeriod,
  periodToBillingPreset,
} from "../lib/reportPeriod.js";

function isVisitFee(line) {
  return !line.inventory_item_id && !['Wastage','Adjustment'].includes(line.type)
    && (line.is_consultation_fee || /^(?:(?:day|night|review)\s+)?consultation(?:\s+(?:fee|charge))?$/i.test(String(line.description || '').trim()));
}

function billReference(bill) {
  return bill?.invoice_number || `Bill #${bill?.id || ""}`;
}

async function shareBillPdf(bill) {
  const { shareOrDownloadBillPdf } = await import("../lib/billPdf.js");
  return shareOrDownloadBillPdf(bill);
}

async function shareCreditNotePdf(creditNote, bill) {
  const { shareOrDownloadCreditNotePdf } = await import("../lib/billPdf.js");
  return shareOrDownloadCreditNotePdf(creditNote, bill);
}

function billingPageTodayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

const ADMIN_BILLING_PRESETS = [
  { id: "yearly", label: "Yearly" },
  { id: "monthly", label: "Monthly" },
  { id: "weekly", label: "Weekly" },
];

const QUICK_WORKFLOW_META = {
  awaiting_operator: {
    label: "Awaiting operator",
    className: "bg-cyan-50 text-cyan-800 ring-cyan-200",
  },
  needs_doctor: {
    label: "Needs doctor",
    className: "bg-rose-50 text-rose-800 ring-rose-200",
  },
  ready_for_payment: {
    label: "Ready for payment",
    className: "bg-violet-50 text-violet-800 ring-violet-200",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  },
};

const FINANCE_PAGE_SIZE = 40;

function getAdminBillingDateRange(preset, anchorDateStr) {
  const anchor = dayjs(anchorDateStr || billingPageTodayInputValue());
  if (!anchor.isValid()) {
    const today = billingPageTodayInputValue();
    return { from: today, to: today };
  }
  switch (preset) {
    case "yearly":
      return {
        from: anchor.startOf("year").format("YYYY-MM-DD"),
        to: anchor.endOf("year").format("YYYY-MM-DD"),
      };
    case "monthly":
      return {
        from: anchor.startOf("month").format("YYYY-MM-DD"),
        to: anchor.endOf("month").format("YYYY-MM-DD"),
      };
    case "weekly":
      return {
        from: anchor.startOf("isoWeek").format("YYYY-MM-DD"),
        to: anchor.endOf("isoWeek").format("YYYY-MM-DD"),
      };
    case "specific":
      return {
        from: anchorDateStr,
        to: anchorDateStr,
      };
    default:
      return {
        from: anchor.startOf("month").format("YYYY-MM-DD"),
        to: anchor.endOf("month").format("YYYY-MM-DD"),
      };
  }
}

function AdminBillingDateRangeFilter({ preset, anchorDate, onPresetChange, onAnchorDateChange }) {
  return (
    <div
      className="inline-flex max-w-full flex-wrap items-center justify-end gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm"
      role="group"
      aria-label="Billing period"
    >
      {ADMIN_BILLING_PRESETS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onPresetChange(opt.id)}
          className={cx(
            "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
            preset === opt.id
              ? "bg-[#2d8f98] text-white shadow-sm"
              : "border border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900",
          )}
        >
          {opt.label}
        </button>
      ))}
      <label
        title="Specific date"
        className={cx(
          "flex cursor-pointer items-center gap-1 rounded-xl border bg-white px-2 py-1 transition",
          preset === "specific"
            ? "border-[#2d8f98] bg-[#ecf8f7] ring-1 ring-[#2d8f98]/30"
            : "border-slate-200 hover:border-slate-300",
        )}
      >
        <Calendar className="size-3.5 shrink-0 text-[#2d8f98]" />
        <span className="sr-only">Specific date</span>
        <input
          type="date"
          max={billingPageTodayInputValue()}
          value={anchorDate}
          onChange={(event) => {
            onAnchorDateChange(event.target.value);
            onPresetChange("specific");
          }}
          className="max-w-[10rem] cursor-pointer border-0 bg-transparent py-0.5 text-xs font-semibold text-slate-800 outline-none"
        />
      </label>
    </div>
  );
}

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

function rankInventoryMatches(rows, needle) {
  const query = String(needle || "").trim().toLowerCase();
  return [...rows].sort((left, right) => {
    const leftName = String(left.item_name || "").toLowerCase();
    const rightName = String(right.item_name || "").toLowerCase();
    const score = (item, name) => {
      const available = Number(item.available_to_promise ?? item.quantity ?? 0) > 0 ? 100 : 0;
      const match = name === query ? 30 : name.startsWith(query) ? 20 : 10;
      return available + match;
    };
    return score(right, rightName) - score(left, leftName) || leftName.localeCompare(rightName);
  });
}

function InventoryItemDescriptionField({
  value,
  onChange,
  onPickItem,
  inventoryOptions = [],
  inventoryLoading = false,
  disabled = false,
  placeholder = "Description",
  className,
}) {
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const suggestionsRef = useRef(null);

  const filteredSuggestions = useMemo(() => {
    const needle = String(value || "").trim().toLowerCase();
    if (!needle) {
      return [];
    }

    return rankInventoryMatches(
      inventoryOptions.filter((item) => String(item.item_name || "").toLowerCase().includes(needle)),
      needle,
    )
      .slice(0, 8);
  }, [inventoryOptions, value]);

  function pickItem(item) {
    onPickItem?.(item);
    setSuggestionsOpen(false);
  }

  return (
    <div className="relative min-w-0">
      <input
        required
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
          setSuggestionsOpen(event.target.value.trim().length > 0);
          setHighlightIndex(0);
        }}
        onFocus={() => {
          if (String(value || "").trim()) {
            setSuggestionsOpen(true);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => setSuggestionsOpen(false), 120);
        }}
        onKeyDown={(event) => {
          if (!filteredSuggestions.length) {
            return;
          }

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

          if (event.key === "Enter" && suggestionsOpen) {
            event.preventDefault();
            const picked = filteredSuggestions[highlightIndex];
            if (picked) {
              pickItem(picked);
            }
            return;
          }

          if (event.key === "Escape") {
            setSuggestionsOpen(false);
          }
        }}
        placeholder={inventoryLoading ? "Loading stock…" : placeholder}
        className={className}
      />

      {suggestionsOpen && filteredSuggestions.length ? (
        <div
          ref={suggestionsRef}
          className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-2xl border border-slate-200 bg-white shadow-lg"
        >
          {filteredSuggestions.map((item, index) => {
            const available = Number(item.quantity || 0);
            const isActive = index === highlightIndex;
            return (
              <button
                key={`inventory-suggest-${item.id}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  pickItem(item);
                }}
                className={cx(
                  "w-full px-4 py-2.5 text-left text-sm transition",
                  isActive ? "bg-[#4FB8B3] text-white" : "text-slate-700 hover:bg-slate-50",
                )}
              >
                <p className="font-semibold">
                  {item.item_name}
                  <span className={cx("ml-2 text-xs font-medium", isActive ? "text-white/85" : "text-slate-500")}>
                    {available > 0 ? `${available} in stock` : "Out of stock"}
                  </span>
                </p>
                <p className={cx("text-xs", isActive ? "text-white/85" : "text-slate-500")}>
                  {item.folder_name || "Uncategorized"} · {formatCurrency(item.selling_price || 0)}
                </p>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function BillingStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
      <div className="flex items-center gap-4">
        <div className="rounded-2xl bg-teal-50 p-3 text-teal-700">
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

function BillingItemsEditor({
  items,
  setItems,
  lockInventory = false,
  inventoryOptions = [],
  inventoryLoading = false,
  operatorRestricted = false,
}) {
  function updateItem(index, key, value) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );
  }

  function applyInventorySuggestion(index, stockItem) {
    const sellingPrice = Number(stockItem.selling_price || 0);
    setItems((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              description: stockItem.item_name || "",
              amount: String(sellingPrice),
            }
          : row,
      ),
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const isInventoryLine = Boolean(item.inventory_item_id) && Number(item.quantity || 0) > 0;
        const isFeeLine = isVisitFee(item);
        const lineLocked = (lockInventory && isInventoryLine) || (operatorRestricted && isFeeLine);
        return (
          <div key={index} className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_160px_150px_auto]">
            <InventoryItemDescriptionField
              value={item.description}
              onChange={(nextDescription) => updateItem(index, "description", nextDescription)}
              onPickItem={(stockItem) => applyInventorySuggestion(index, stockItem)}
              inventoryOptions={inventoryOptions}
              inventoryLoading={inventoryLoading}
              disabled={lineLocked}
              placeholder="Search your stock or type custom item"
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
              disabled={lineLocked || operatorRestricted}
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
              title={lineLocked ? "Inventory line is locked" : "Remove line"}
              className="grid size-10 place-items-center self-center rounded-xl border border-transparent bg-transparent text-red-400 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
      {lockInventory && items.some((item) => item.inventory_item_id && Number(item.quantity || 0) > 0) ? (
        <p className="text-xs text-slate-500">Inventory-linked lines cannot be edited after billing finalization to keep stock movements consistent.</p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_150px_auto]">
        <span className="hidden md:block" aria-hidden />
        <div className="flex justify-end md:col-span-3">
          <button
            type="button"
            onClick={() => setItems((current) => [...current, createEmptyLineItem()])}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
          >
            Add line item
          </button>
        </div>
      </div>
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
  paymentReference,
  setPaymentReference,
  total,
}) {
  function handleStatusChange(nextStatus) {
    setStatus(nextStatus);

    if (nextStatus !== "paid") {
      setPaymentMethod("");
      setPaymentDate("");
      setPaymentReference("");
    }
  }

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-5">
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

      <label className="space-y-2">
        <span className="text-sm font-semibold text-slate-700">Transaction reference</span>
        <input
          disabled={status !== "paid"}
          required={status === "paid" && paymentMethod !== "cash"}
          value={paymentReference}
          onChange={(event) => setPaymentReference(event.target.value)}
          placeholder={paymentMethod === "cash" ? "Optional" : "Required for non-cash"}
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

function PaymentConfirmation({ bill, busy, onClose, onConfirm }) {
  const [method, setMethod] = useState('');
  const [date, setDate] = useState(billingPageTodayInputValue());
  const balance = Math.max(0, Number(bill.payment_balance_amount ?? bill.total_amount ?? 0));
  const [amount, setAmount] = useState(balance ? balance.toFixed(2) : "");
  const [externalReference, setExternalReference] = useState("");
  const [operationId] = useState(() => crypto.randomUUID());
  const [confirmed, setConfirmed] = useState(false);
  const amountNumber = Number(amount || 0);
  const valid = amountNumber > 0 && amountNumber <= balance && method && date &&
    (method === "cash" || externalReference.trim().length >= 3) && confirmed;
  return <Modal open onClose={onClose} title={`Record payment · ${billReference(bill)}`} size="md">
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!busy && valid) onConfirm({ amount: amountNumber, payment_method: method, payment_date: date, external_reference: externalReference.trim() || null, operation_id: operationId }); }}>
      <p className="text-sm">{bill.patient_name} · {formatDate(bill.consultation_date)}</p>
      <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Outstanding balance</p><p className="text-2xl font-bold">{formatCurrency(balance)}</p></div>
      <label className="block text-sm font-semibold">Amount received<input required type="number" min="0.01" max={balance} step="0.01" className={BILLING_FIELD} value={amount} onChange={event => {setAmount(event.target.value);setConfirmed(false);}} /></label>
      <label className="block text-sm font-semibold">Payment method<select required className={BILLING_FIELD} value={method} onChange={event => {setMethod(event.target.value);setConfirmed(false);}}>
        <option value="">Select method</option>{PAYMENT_METHOD_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      <label className="block text-sm font-semibold">Payment date<input required type="date" max={billingPageTodayInputValue()} className={BILLING_FIELD} value={date} onChange={event => {setDate(event.target.value);setConfirmed(false);}} /></label>
      <label className="block text-sm font-semibold">Transaction reference {method === "cash" ? <span className="font-normal text-slate-500">(optional)</span> : null}<input required={method !== "cash"} minLength={method === "cash" ? undefined : 3} className={BILLING_FIELD} value={externalReference} onChange={event => {setExternalReference(event.target.value);setConfirmed(false);}} placeholder={method === "cash" ? "Receipt or cash reference" : "Provider transaction reference"} /></label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I confirm receipt of this amount using this method on this date.</label>
      <p className="text-xs text-slate-500">The payment is immutable. A partial amount leaves the remaining balance open.</p>
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" disabled={busy} className="min-h-11 rounded-xl border px-4" onClick={onClose}>Cancel</button>
        <button disabled={busy || !valid} className="min-h-11 rounded-xl bg-ocs-teal px-4 font-semibold text-white disabled:opacity-50">{busy ? 'Recording…' : amountNumber < balance ? 'Record partial payment' : 'Confirm payment'}</button>
      </div>
    </form>
  </Modal>;
}

function RefundConfirmation({ bill, busy, onClose, onConfirm }) {
  const refundable = Math.max(0, Number(bill.refundable_amount ?? (Number(bill.total_amount || 0) - Number(bill.refunded_amount || 0))));
  const [amount, setAmount] = useState(refundable ? refundable.toFixed(2) : "");
  const [method, setMethod] = useState("");
  const [date, setDate] = useState(billingPageTodayInputValue());
  const [reason, setReason] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const amountNumber = Number(amount || 0);
  const valid = amountNumber > 0 && amountNumber <= refundable && method && date && reason.trim().length >= 8 &&
    (method === "cash" || externalReference.trim().length >= 3) && confirmed;

  return (
    <Modal open onClose={onClose} title={`Issue credit note · ${billReference(bill)}`} size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && valid) {
            onConfirm({
              amount: amountNumber,
              refund_method: method,
              refund_date: date,
              reason: reason.trim(),
              external_reference: externalReference.trim() || null,
            });
          }
        }}
      >
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold text-slate-950">{bill.patient_name}</p>
          <p className="mt-1 text-sm text-slate-600">
            Paid {formatCurrency(bill.total_amount)} · Already refunded {formatCurrency(bill.refunded_amount || 0)}
          </p>
          <p className="mt-2 text-sm font-bold text-ocs-teal">Available to refund: {formatCurrency(refundable)}</p>
        </div>
        <label className="block text-sm font-semibold">
          Refund amount
          <input required type="number" min="0.01" max={refundable} step="0.01" className={BILLING_FIELD} value={amount} onChange={(event) => { setAmount(event.target.value); setConfirmed(false); }} />
        </label>
        <label className="block text-sm font-semibold">
          Refund method
          <select required className={BILLING_FIELD} value={method} onChange={(event) => { setMethod(event.target.value); setConfirmed(false); }}>
            <option value="">Select method</option>
            {PAYMENT_METHOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Refund date
          <input required type="date" max={billingPageTodayInputValue()} className={BILLING_FIELD} value={date} onChange={(event) => { setDate(event.target.value); setConfirmed(false); }} />
        </label>
        <label className="block text-sm font-semibold">
          Reason
          <textarea required minLength={8} rows={3} className={cx(BILLING_FIELD, "resize-y")} value={reason} onChange={(event) => { setReason(event.target.value); setConfirmed(false); }} placeholder="Why is this refund being issued?" />
        </label>
        <label className="block text-sm font-semibold">
          External reference {method === "cash" ? <span className="font-normal text-slate-500">(optional)</span> : <span className="text-rose-600">*</span>}
          <input required={method !== "cash"} minLength={method === "cash" ? undefined : 3} className={BILLING_FIELD} value={externalReference} onChange={(event) => { setExternalReference(event.target.value); setConfirmed(false); }} placeholder="Bank, Juice or receipt reference" />
        </label>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>I confirm the money was returned. This creates an immutable credit note and does not restore inventory.</span>
        </label>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" disabled={busy} className="min-h-11 rounded-xl border px-4" onClick={onClose}>Cancel</button>
          <button disabled={busy || !valid} className="min-h-11 rounded-xl bg-rose-700 px-4 font-semibold text-white disabled:opacity-50">{busy ? "Issuing…" : "Issue credit note"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentReversalConfirmation({ payment, busy, onClose, onConfirm }) {
  const [date, setDate] = useState(billingPageTodayInputValue());
  const [reason, setReason] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const needsReference = payment.payment_method !== "cash";
  const valid = date && reason.trim().length >= 8 && (!needsReference || externalReference.trim().length >= 3) && confirmed;
  return (
    <Modal open onClose={onClose} title="Reverse payment transaction" size="md">
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (!busy && valid) onConfirm({
          reversal_date: date,
          reason: reason.trim(),
          external_reference: externalReference.trim() || null,
          operation_id: crypto.randomUUID(),
        });
      }}>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">{formatCurrency(Math.abs(Number(payment.amount || 0)))} · {formatPaymentMethod(payment.payment_method)}</p>
          <p className="mt-1">This keeps the original receipt and posts an immutable compensating reversal.</p>
        </div>
        <label className="block text-sm font-semibold">Reversal date<input required type="date" max={billingPageTodayInputValue()} className={BILLING_FIELD} value={date} onChange={(event) => { setDate(event.target.value); setConfirmed(false); }} /></label>
        <label className="block text-sm font-semibold">Reason<textarea required minLength={8} rows={3} className={cx(BILLING_FIELD, "resize-y")} value={reason} onChange={(event) => { setReason(event.target.value); setConfirmed(false); }} placeholder="Why is this recorded payment incorrect?" /></label>
        <label className="block text-sm font-semibold">Provider reversal reference {needsReference ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-500">(optional)</span>}<input required={needsReference} minLength={needsReference ? 3 : undefined} className={BILLING_FIELD} value={externalReference} onChange={(event) => { setExternalReference(event.target.value); setConfirmed(false); }} placeholder={needsReference ? "Required provider reference" : "Cash correction reference"} /></label>
        <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm this receipt was recorded incorrectly and should be reversed.</span></label>
        <div className="flex justify-end gap-3"><button type="button" disabled={busy} className="min-h-11 rounded-xl border px-4" onClick={onClose}>Cancel</button><button disabled={busy || !valid} className="min-h-11 rounded-xl bg-amber-700 px-4 font-semibold text-white disabled:opacity-50">{busy ? "Reversing…" : "Post reversal"}</button></div>
      </form>
    </Modal>
  );
}

function PaidSupplyCorrectionConfirmation({ submission, busy, onClose, onConfirm }) {
  const [disposition, setDisposition] = useState("");
  const [method, setMethod] = useState("");
  const [date, setDate] = useState(billingPageTodayInputValue());
  const [reason, setReason] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const needsReference = method && method !== "cash";
  const valid = disposition && method && date && reason.trim().length >= 8 && (!needsReference || externalReference.trim().length >= 3) && confirmed;
  return (
    <Modal open onClose={onClose} title="Correct paid supply charge" size="md">
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (!busy && valid) onConfirm({
          disposition,
          refund_method: method,
          refund_date: date,
          reason: reason.trim(),
          external_reference: externalReference.trim() || null,
          operation_id: crypto.randomUUID(),
        });
      }}>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950">
          <p className="font-bold">Credit {formatCurrency(submission.amount_added)} for {submission.item_count} supply unit{submission.item_count === 1 ? "" : "s"}</p>
          <p className="mt-1">A credit note is issued. Stock is restored only when the physical supplies were returned.</p>
        </div>
        <label className="block text-sm font-semibold">What happened to the supplies?<select required className={BILLING_FIELD} value={disposition} onChange={(event) => { setDisposition(event.target.value); setConfirmed(false); }}><option value="">Select outcome</option><option value="returned_to_stock">Returned unopened to stock</option><option value="consumed_or_wasted">Consumed or wasted — do not restore stock</option></select></label>
        <label className="block text-sm font-semibold">Refund method<select required className={BILLING_FIELD} value={method} onChange={(event) => { setMethod(event.target.value); setConfirmed(false); }}><option value="">Select method</option>{PAYMENT_METHOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="block text-sm font-semibold">Refund date<input required type="date" max={billingPageTodayInputValue()} className={BILLING_FIELD} value={date} onChange={(event) => { setDate(event.target.value); setConfirmed(false); }} /></label>
        <label className="block text-sm font-semibold">Correction reason<textarea required minLength={8} rows={3} className={cx(BILLING_FIELD, "resize-y")} value={reason} onChange={(event) => { setReason(event.target.value); setConfirmed(false); }} placeholder="What was billed incorrectly?" /></label>
        <label className="block text-sm font-semibold">Provider refund reference {needsReference ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-500">(optional for cash)</span>}<input required={Boolean(needsReference)} minLength={needsReference ? 3 : undefined} className={BILLING_FIELD} value={externalReference} onChange={(event) => { setExternalReference(event.target.value); setConfirmed(false); }} /></label>
        <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm the refund and the physical stock outcome above.</span></label>
        <div className="flex justify-end gap-3"><button type="button" disabled={busy} className="min-h-11 rounded-xl border px-4" onClick={onClose}>Cancel</button><button disabled={busy || !valid} className="min-h-11 rounded-xl bg-rose-700 px-4 font-semibold text-white disabled:opacity-50">{busy ? "Correcting…" : "Issue correction"}</button></div>
      </form>
    </Modal>
  );
}

function RefundAllocationConfirmation({ refund, submissions, busy, onClose, onConfirm }) {
  const supplySubmissions = (submissions || []).filter((submission) =>
    Number(submission.amount_added || 0) > 0
      && Math.abs(Number(submission.amount_added || 0) - Number(refund.amount || 0)) < 0.005
      && !submission.reversed_at
      && !["corrected", "reversed", "superseded"].includes(submission.workflow_status),
  );
  const [allocationType, setAllocationType] = useState("service_non_stock");
  const [submissionId, setSubmissionId] = useState("");
  const [disposition, setDisposition] = useState("");
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 8
    && (allocationType === "service_non_stock" || (Number(submissionId) > 0 && Boolean(disposition)));
  return (
    <Modal open onClose={onClose} title={`Classify historical credit · ${refund.credit_note_number}`} size="md">
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        if (!busy && valid) onConfirm({
          allocation_type: allocationType,
          submission_id: allocationType === "supply_submission" ? Number(submissionId) : null,
          disposition: allocationType === "supply_submission" ? disposition : null,
          reason: reason.trim(),
          operation_id: crypto.randomUUID(),
        });
      }}>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-bold">{formatCurrency(refund.amount)} credit issued {formatDate(refund.refund_date)}</p>
          <p className="mt-1">Classify the original credit from its supporting record. Supply credits also require the physical stock outcome, so accounting and inventory remain aligned.</p>
        </div>
        <label className="block text-sm font-semibold">Credit applies to
          <select value={allocationType} onChange={(event) => { setAllocationType(event.target.value); setSubmissionId(""); setDisposition(""); }} className={BILLING_FIELD}>
            <option value="service_non_stock">Consultation or service/non-stock charge</option>
            <option value="supply_submission">Medicines or consumables</option>
          </select>
        </label>
        {allocationType === "supply_submission" ? (
          <div className="space-y-4">
            <label className="block text-sm font-semibold">Original supply submission
              <select required value={submissionId} onChange={(event) => setSubmissionId(event.target.value)} className={BILLING_FIELD}>
                <option value="">Select an active submission matching the credit amount</option>
                {supplySubmissions.map((submission) => (
                  <option key={submission.id} value={submission.id}>
                    Submission #{submission.id} · {formatCurrency(submission.amount_added)} · {formatDate(submission.created_at)}
                  </option>
                ))}
              </select>
              {!supplySubmissions.length ? <span className="mt-1 block text-xs text-rose-700">No active supply submission exactly matches this credit. Keep it unresolved and investigate the source documents.</span> : null}
            </label>
            <label className="block text-sm font-semibold">What happened to the supplies?
              <select required value={disposition} onChange={(event) => setDisposition(event.target.value)} className={BILLING_FIELD}>
                <option value="">Select physical outcome</option>
                <option value="returned_to_stock">Returned unopened to stock</option>
                <option value="consumed_or_wasted">Consumed or wasted — do not restore stock</option>
              </select>
            </label>
          </div>
        ) : null}
        <label className="block text-sm font-semibold">Verification note
          <textarea required minLength={8} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className={cx(BILLING_FIELD, "resize-y")} placeholder="State which source record was checked." />
        </label>
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border px-4 font-semibold">Cancel</button>
          <button disabled={busy || !valid} className="min-h-11 rounded-xl bg-amber-700 px-4 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save classification"}</button>
        </div>
      </form>
    </Modal>
  );
}

function QuickActionConfirmation({ action, busy, onClose, onConfirm }) {
  const reversal = action.kind === "reversal";
  const minimum = reversal ? 5 : 3;
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title={reversal ? "Reverse submitted supplies" : "Request doctor clarification"} size="md">
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!busy && reason.trim().length >= minimum) onConfirm(reason.trim()); }}>
        <div className={cx("rounded-2xl border p-4 text-sm", reversal ? "border-rose-200 bg-rose-50 text-rose-950" : "border-amber-200 bg-amber-50 text-amber-950")}>
          <p className="font-bold">{action.submission.patient_name} · {action.submission.visit_number}</p>
          <p className="mt-1">{reversal ? "Eligible stock will be restored and the original submission will remain in the audit trail." : "The invoice leaves the payment queue until the doctor submits a correction."}</p>
        </div>
        <label className="block text-sm font-semibold">{reversal ? "Reason for reversal" : "What should the doctor clarify?"}
          <textarea autoFocus required minLength={minimum} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className={cx(BILLING_FIELD, "resize-y")} />
        </label>
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border px-4 font-semibold">Cancel</button>
          <button disabled={busy || reason.trim().length < minimum} className={cx("min-h-11 rounded-xl px-4 font-semibold text-white disabled:opacity-50", reversal ? "bg-rose-700" : "bg-amber-700")}>{busy ? "Saving…" : reversal ? "Confirm reversal" : "Send clarification"}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditBillingModal({ open, bill, stale = false, onClose, onSubmit, onVoid, onChanged, isSaving }) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [feeConfirmed, setFeeConfirmed] = useState(false);
  const [feeOptions, setFeeOptions] = useState({});
  useEffect(() => { if (open) { setFeeConfirmed(false); api.get('/billing/consultation-fees').then(setFeeOptions).catch(()=>{}); } }, [open,bill?.id]);
  const [correctionReason, setCorrectionReason] = useState("");
  const [history, setHistory] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [payments, setPayments] = useState([]);
  const [quickSubmissions, setQuickSubmissions] = useState([]);
  const [supplyCorrections, setSupplyCorrections] = useState([]);
  const [reversalPayment, setReversalPayment] = useState(null);
  const [correctionSubmission, setCorrectionSubmission] = useState(null);
  const [allocationRefund, setAllocationRefund] = useState(null);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const readOnly = Boolean(!canWriteBill(user, bill) || bill?.voided_at || bill?.consultation_voided_at || ((bill?.status === "paid" || bill?.legacy_fee_review_required) && user?.role !== "admin"));
  const operatorEditing = user?.role === "operator" && !readOnly;
  const [status, setStatus] = useState("unpaid");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [items, setItems] = useState([createEmptyLineItem()]);
  const [inventoryOptions, setInventoryOptions] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const billId = bill?.id ?? null;
  const [syncedDeps, setSyncedDeps] = useState({ open, billId });

  if (syncedDeps.open !== open || syncedDeps.billId !== billId) {
    setSyncedDeps({ open, billId });
    if (open && bill) {
      setCorrectionReason("");
      setStatus(bill.status);
      setPaymentMethod(bill.payment_method || "");
      setPaymentDate(bill.payment_date || "");
      setPaymentReference("");
      setItems(
        bill.items.length
          ? bill.items.map((item) => ({
              description: item.description,
              amount: String(item.amount),
              type: item.type || "Sale",
              quantity: Number(item.quantity || 0) || 0,
              inventory_item_id: item.inventory_item_id ? Number(item.inventory_item_id) : null,
              emergency_override: Boolean(item.emergency_override),
              is_consultation_fee: Boolean(item.is_consultation_fee),
              is_service_charge: Boolean(item.is_service_charge || (!item.inventory_item_id && !isVisitFee(item))),
              dispensing_movement_ids: item.dispensing_movement_ids || [],
              wastage_reason: item.wastage_reason || "",
              batch_id: item.batch_id || null,
            }))
          : [createEmptyLineItem()],
      );
    }
  }

  useEffect(() => {
    if (!open || !bill?.consultation_id) {
      setInventoryOptions([]);
      return undefined;
    }

    let ignore = false;

    async function loadInventory() {
      setInventoryLoading(true);
      try {
        const rows = await api.get(
          `/billing/inventory-options/by-consultation/${bill.consultation_id}`,
        );
        if (!ignore) {
          setInventoryOptions(Array.isArray(rows) ? rows : []);
        }
      } catch {
        if (!ignore) {
          setInventoryOptions([]);
        }
      } finally {
        if (!ignore) {
          setInventoryLoading(false);
        }
      }
    }

    void loadInventory();

    return () => {
      ignore = true;
    };
  }, [open, bill?.consultation_id]);

  useEffect(() => {
    if (!open || !billId) return;
    let ignore = false;
    api.get(`/billing/${billId}`).then(detail => { if (!ignore) { setHistory(detail.history || []); setCreditNotes(detail.refunds || []); setPayments(detail.payments || []); setQuickSubmissions(detail.quick_submissions || []); setSupplyCorrections(detail.supply_corrections || []); } })
      .catch(() => { if (!ignore) { setHistory([]); setCreditNotes([]); setPayments([]); setQuickSubmissions([]); setSupplyCorrections([]); } });
    return () => { ignore = true; };
  }, [open, billId]);

  async function refreshFinancialDetail() {
    const detail = await api.get(`/billing/${billId}`);
    setHistory(detail.history || []);
    setCreditNotes(detail.refunds || []);
    setPayments(detail.payments || []);
    setQuickSubmissions(detail.quick_submissions || []);
    setSupplyCorrections(detail.supply_corrections || []);
    onChanged?.(detail);
    return detail;
  }

  async function reversePayment(payload) {
    setCorrectionBusy(true);
    try {
      await api.post(`/billing/${billId}/payments/${reversalPayment.payment_transaction_id}/reverse`, payload);
      setReversalPayment(null);
      await refreshFinancialDetail();
      toast.success("Payment reversal posted. The original receipt remains in the ledger.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCorrectionBusy(false);
    }
  }

  async function correctPaidSupplies(payload) {
    setCorrectionBusy(true);
    try {
      const result = await api.post(`/billing/quick/submissions/${correctionSubmission.id}/paid-correction`, payload);
      setCorrectionSubmission(null);
      await refreshFinancialDetail();
      toast.success(`${result.credit_note.credit_note_number} issued${result.stock_restored ? " and stock restored" : "; stock left unchanged"}.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCorrectionBusy(false);
    }
  }

  async function reconcileRefundAllocation(payload) {
    setCorrectionBusy(true);
    try {
      await api.post(`/billing/refunds/${allocationRefund.id}/allocation`, payload);
      setAllocationRefund(null);
      await refreshFinancialDetail();
      toast.success("Historical credit note classified and added to the audit trail.");
    } catch (error) {
      toast.error(error.message || "The credit note could not be classified.");
    } finally {
      setCorrectionBusy(false);
    }
  }

  const total = useMemo(
    () =>
      items.reduce((sum, item) => {
        const itemType = String(item.type || "Sale");
        if (itemType === "Wastage" || itemType === "Adjustment") return sum;
        return sum + Number(item.amount || 0);
      }, 0),
    [items],
  );
  const reversedPaymentIds = new Set(
    payments.filter((payment) => payment.entry_type === "reversal").map((payment) => Number(payment.payment_transaction_id)),
  );
  const correctedSubmissionIds = new Set(supplyCorrections.map((correction) => Number(correction.submission_id)));
  const correctableSupplySubmissions = quickSubmissions.filter((submission) =>
    Number(submission.amount_added || 0) > 0
      && submission.workflow_status === "completed"
      && !submission.reversed_at
      && !correctedSubmissionIds.has(Number(submission.id)),
  );
  const canPostFinancialCorrection = ["admin", "accountant"].includes(user?.role);

  function handleSubmit(event) {
    event.preventDefault();

    if (status === "paid" && !paymentMethod) {
      toast.error("Select how the payment was made.");
      return;
    }

    if (readOnly) return;
    onSubmit({
      expected_version: bill.row_version,
      confirm_consultation_fee: feeConfirmed,
      correction_reason: correctionReason,
      items: items.map((item) => ({
        description: item.description,
        amount: Number(item.amount || 0),
        unit_price: Number(item.amount || 0) / Math.max(1, Number(item.quantity || 1)),
        type: item.type || "Sale",
        quantity: Number(item.quantity || 0) || 0,
        inventory_item_id: item.inventory_item_id || null,
        emergency_override: Boolean(item.emergency_override),
        is_consultation_fee: Boolean(item.is_consultation_fee),
        is_service_charge: Boolean(item.is_service_charge),
        dispensing_movement_ids: item.dispensing_movement_ids || [],
        wastage_reason: item.wastage_reason || undefined,
        batch_id: item.batch_id || undefined,
      })),
      status,
      payment_method: status === "paid" ? paymentMethod : null,
      payment_date: status === "paid" ? paymentDate || null : null,
      payment_reference: status === "paid" ? paymentReference.trim() || null : null,
    });
  }

  if (!bill) {
    return null;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${readOnly ? "View" : "Edit"} ${billReference(bill)}`}
      description={
        readOnly
          ? "View the recorded bill and its change history."
          : isMobile
          ? undefined
          : "Update line items, payment status, payment method, and payment date for this billing entry."
      }
      size="xl"
    >
      <form className="min-w-0 w-full max-w-full space-y-5" onSubmit={handleSubmit}>
        {stale ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            This bill was updated elsewhere. Your unsaved edits are still here. Review before
            saving, or close and reopen to load the latest version.
          </div>
        ) : null}
        <div className="rounded-[26px] border border-sky-100 bg-sky-50/70 p-4">
          <p className="text-lg font-semibold text-slate-950">{bill.patient_name}</p>
          <p className="mt-1 text-sm text-slate-600">
            {bill.doctor_name} - {formatDate(bill.consultation_date)}
          </p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {billReference(bill)}
            {bill.source_reference ? ` · Source ${bill.source_reference}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Issued by {bill.issued_by_name || "System"} ({bill.issued_by_role || "system"})
            {bill.partner_category_snapshot ? ` · ${bill.partner_category_snapshot}` : ""}
          </p>
        </div>

        {bill.patient_archived_at && <p className="text-sm text-slate-600">Archived patient · financial record retained</p>}
        {payments.length ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-emerald-950">Payment transactions</p>
              <p className="text-sm font-bold text-emerald-950">Received {formatCurrency(bill.payment_received_amount || 0)} · Balance {formatCurrency(bill.payment_balance_amount || 0)}</p>
            </div>
            <div className="mt-2 space-y-2">
              {payments.map((payment) => {
                const reversal = payment.entry_type === "reversal";
                const alreadyReversed = reversal || reversedPaymentIds.has(Number(payment.payment_transaction_id));
                return (
                  <div key={payment.id} className={cx("flex flex-wrap items-start justify-between gap-3 border-t pt-2 text-sm", reversal ? "border-rose-200 text-rose-950" : "border-emerald-200 text-emerald-950")}>
                    <div><span className="font-bold">{reversal ? "Reversal · " : ""}{formatDate(payment.payment_date)} · {formatPaymentMethod(payment.payment_method)}</span><p className={cx("text-xs", reversal ? "text-rose-800" : "text-emerald-800")}>{payment.reason || payment.external_reference || "Cash / migrated record"} · {payment.recorded_by_name || "Legacy staff record"}</p></div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{formatCurrency(payment.amount)}</span>
                      {!alreadyReversed && ["admin", "accountant", "operator"].includes(user?.role) ? <button type="button" onClick={() => setReversalPayment(payment)} className="min-h-9 rounded-xl border border-amber-300 bg-white px-3 text-xs font-bold text-amber-800">Reverse</button> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {creditNotes.length ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm font-bold text-rose-950">Credit notes</p>
            <div className="mt-2 space-y-2">
              {creditNotes.map((note) => (
                <div key={note.id} className="flex flex-wrap items-start justify-between gap-2 text-sm text-rose-950">
                  <div><span className="font-bold">{note.credit_note_number}</span> · {formatDate(note.refund_date)}<p className="text-xs text-rose-800">{note.reason} · {formatPaymentMethod(note.refund_method)}{note.disposition === "returned_to_stock" ? " · Stock restored" : note.disposition === "consumed_or_wasted" ? " · Reclassified as consumed/wasted" : " · Financial credit only"}</p></div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">−{formatCurrency(note.amount)}</span>
                    {!note.allocation_type && canPostFinancialCorrection ? <button type="button" className="min-h-9 rounded-xl border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900" onClick={() => setAllocationRefund(note)}>Classify</button> : null}
                    <button type="button" className="min-h-9 rounded-xl border border-rose-300 bg-white px-3 text-xs font-bold" onClick={() => shareCreditNotePdf(note, bill).catch((error) => toast.error(error.message || "Could not create credit note PDF."))}>PDF</button>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-rose-200 pt-2 text-xs font-semibold text-rose-900">Inventory treatment is shown separately for each credit note and is backed by its linked correction record.</p>
          </div>
        ) : null}
        {bill.status === "paid" && (correctableSupplySubmissions.length || supplyCorrections.length) ? (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950">
            <p className="font-bold">Paid supply corrections</p>
            {supplyCorrections.map((correction) => <p key={correction.id} className="mt-2 border-t border-violet-200 pt-2">{correction.credit_note_number} · {formatCurrency(correction.amount)} · {correction.disposition === "returned_to_stock" ? "Stock restored" : "Consumed / wasted"}<span className="block text-xs text-violet-800">{correction.reason}</span></p>)}
            {canPostFinancialCorrection && correctableSupplySubmissions.map((submission) => <button key={submission.id} type="button" onClick={() => setCorrectionSubmission(submission)} className="mt-3 min-h-11 w-full rounded-xl border border-violet-300 bg-white px-4 font-bold text-violet-900">Correct {formatCurrency(submission.amount_added)} of paid supplies</button>)}
          </div>
        ) : null}
        {bill.payment_block && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p>{bill.payment_block.reason}</p>
          <div className="flex flex-wrap gap-3">{[...new Set([...(bill.payment_block.bill_ids || []), bill.payment_block.existing_bill_id].filter(id => id && id !== bill.id))].map(id => <a key={id} href={`/billing?billId=${id}`} className="inline-flex min-h-11 items-center font-semibold underline">Open bill #{id}</a>)}</div>
        </div>}
        {user?.role==='admin' && bill.status==='unpaid' && !bill.voided_at && !bill.items.some(i=>i.inventory_item_id) && <div className="space-y-2 rounded-2xl border border-slate-200 p-3">
          <label className="block text-sm">Reason for voiding a duplicate bill<input aria-label="Void bill reason" className={BILLING_FIELD} value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)} /></label>
          <button type="button" disabled={isSaving || correctionReason.trim().length<8} onClick={()=>onVoid?.(bill,correctionReason)} className="min-h-11 rounded-xl border px-3 text-sm disabled:opacity-50">Void this unpaid bill; keep the visit</button>
        </div>}
        {readOnly && <p className="rounded-2xl bg-slate-50 p-3 text-sm">{bill.voided_at || bill.consultation_voided_at ? "Voided bill — retained for audit only." : bill.legacy_fee_review_required ? "This historical fee requires an admin review." : "Payment recorded. An admin can make a documented correction."}</p>}
        <fieldset disabled={readOnly} className="min-w-0 space-y-5">
        {items.some(i => isVisitFee(i)) && <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
          <label className="block text-sm font-semibold">Consultation type
            <select aria-label="Review consultation type" className={BILLING_FIELD} value={Object.hasOwn(feeOptions, items.find(i=>isVisitFee(i))?.description || '') ? items.find(i=>isVisitFee(i)).description : ''}
              onChange={event => { const type=event.target.value; setItems(current=>current.map(i=>isVisitFee(i) ? {...i,description:type,amount:Number(feeOptions[type]),is_consultation_fee:true} : i)); setFeeConfirmed(false); }}>
              <option value="" disabled>Select consultation type</option>
              {Object.keys(feeOptions).map(type=><option key={type}>{type}</option>)}
            </select>
          </label>
          {Boolean(bill.fee_review_required) && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={feeConfirmed} onChange={e=>setFeeConfirmed(e.target.checked)} />I confirm the consultation type and fee for this visit.</label>}
        </div>}
        <BillingItemsEditor
          items={items}
          setItems={setItems}
          lockInventory
          inventoryOptions={inventoryOptions}
          inventoryLoading={inventoryLoading}
          operatorRestricted={operatorEditing}
        />

        {operatorEditing ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
            This invoice remains unpaid while you correct its transcription. Use Record payment from the billing list after saving.
          </div>
        ) : (
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
          <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Invoice total</p><p className="mt-1 text-xl font-black">{formatCurrency(total)}</p></div>
          <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Received</p><p className="mt-1 text-xl font-black">{formatCurrency(bill.payment_received_amount || 0)}</p></div>
          <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Balance</p><p className="mt-1 text-xl font-black">{formatCurrency(bill.payment_balance_amount ?? total)}</p></div>
          <p className="text-xs text-slate-500 sm:col-span-3">Save invoice corrections here. Add money received through Record payment so every receipt remains an immutable transaction.</p>
        </div>
        )}

        {Boolean(bill.legacy_fee_review_required) && <p className="rounded-xl bg-amber-50 p-3 text-sm">Historical fee: an admin must verify the agreed charge against the original record. Keep the existing amount if it was agreed, or correct it with a documented reason. Payment stays blocked until this review is confirmed.</p>}
        {(operatorEditing || bill.status === "paid" || Boolean(bill.legacy_fee_review_required)) && !readOnly && <label className="block text-sm font-medium">Reason and source reference for review / correction
          <textarea required minLength={8} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} className="mt-2 block w-full rounded-xl border border-slate-200 p-3" placeholder="Explain what is being corrected and why" />
        </label>}
        </fieldset>
        {history.length > 0 && <details className="rounded-2xl border border-slate-200 p-4">
          <summary className="cursor-pointer font-semibold">Billing history ({history.length})</summary>
          <ol className="mt-3 space-y-3">{history.map(entry => {
            const before = entry.before_json ? JSON.parse(entry.before_json) : null;
            const after = JSON.parse(entry.after_json);
            return <li key={entry.id} className="border-t border-slate-100 pt-3 text-sm">
              <p>{entry.event_type.replaceAll("_", " ")} · {entry.actor_name || "System / legacy"} · {new Date(`${entry.created_at.replace(" ", "T")}Z`).toLocaleString("en-GB", {timeZone:"Indian/Mauritius"})}</p>
              {before && <p className="text-slate-600">Before: {before.status} · Rs {before.total_amount} · {before.payment_method || "—"} · {before.payment_date || "—"}</p>}
              <p>After: {after.status} · Rs {after.total_amount} · {after.payment_method || "—"} · {after.payment_date || "—"}</p>
              {entry.reason && <p className="text-slate-600">{entry.reason}</p>}
            </li>;
          })}</ol>
        </details>}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={isSaving || readOnly || (operatorEditing && correctionReason.trim().length < 8)}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Update bill"}
          </button>
        </div>
      </form>
      {reversalPayment ? <PaymentReversalConfirmation payment={reversalPayment} busy={correctionBusy} onClose={() => { if (!correctionBusy) setReversalPayment(null); }} onConfirm={reversePayment} /> : null}
      {correctionSubmission ? <PaidSupplyCorrectionConfirmation submission={correctionSubmission} busy={correctionBusy} onClose={() => { if (!correctionBusy) setCorrectionSubmission(null); }} onConfirm={correctPaidSupplies} /> : null}
      {allocationRefund ? <RefundAllocationConfirmation refund={allocationRefund} submissions={quickSubmissions} busy={correctionBusy} onClose={() => { if (!correctionBusy) setAllocationRefund(null); }} onConfirm={reconcileRefundAllocation} /> : null}
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

function WastageTraceabilityFields({ item, onChange, inventoryOptions }) {
  if (item.type !== "Wastage") return null;
  const stockItem = inventoryOptions.find((row) => Number(row.id) === Number(item.inventory_item_id));
  const batches = Array.isArray(item.batches) && item.batches.length
    ? item.batches
    : Array.isArray(stockItem?.batches) ? stockItem.batches : [];
  return (
    <div className="mx-3 mb-3 grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 md:mx-4 md:grid-cols-2">
      <label className="space-y-1">
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-amber-900">Affected batch / lot</span>
        <select
          required
          value={item.batch_id || ""}
          onChange={(event) => onChange({ batch_id: event.target.value ? Number(event.target.value) : "" })}
          className={cx(BILLING_FIELD, "bg-white")}
        >
          <option value="">Select the batch actually wasted</option>
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              Lot #{batch.id} · {batch.is_non_expiring ? "No expiry" : batch.expiry_date || "Expiry missing"} · {batch.available} available
            </option>
          ))}
        </select>
        {!batches.length ? <p className="text-xs font-semibold text-rose-700">No eligible batch is available for this item.</p> : null}
      </label>
      <label className="space-y-1">
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-amber-900">Reason for wastage</span>
        <textarea
          required
          minLength={8}
          rows={2}
          value={item.wastage_reason || ""}
          onChange={(event) => onChange({ wastage_reason: event.target.value })}
          className={cx(BILLING_FIELD, "resize-y bg-white")}
          placeholder="e.g. Vial broke during treatment setup"
        />
      </label>
      <p className="text-xs text-amber-900 md:col-span-2">Wastage reduces the selected batch and records its cost as a loss. It is never charged to the patient.</p>
    </div>
  );
}

function DescriptionList({
  includeFee = true,
  consultationType,
  consultationPrice,
  items,
  onRemoveLine,
  onUpdateManual,
  onAddManual,
  compactMobile = false,
  onUpdateInventoryLine = null,
  inventoryOptions = [],
  allowManualItems = true,
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
        {includeFee && <><div className="hidden items-center px-4 py-3 text-sm md:grid md:grid-cols-[2fr_70px_120px_110px_120px_44px] md:items-start md:gap-3">
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

        </>}
        {hasInventoryRows ? (
          items.map((item, index) => {
            const qty = Number(item.quantity || 0);
            const unitPrice =
              Number(item.unit_price) ||
              (qty > 0 ? Number(item.amount || 0) / qty : Number(item.amount || 0));
            const subtotal = item.type === "Wastage" ? 0 : Number(item.amount || 0);
            const available = Number(item.available || 0);
            const needsOverride = qty > available;
            const canEditInventoryQty = Boolean(compactMobile && onUpdateInventoryLine && !item.is_manual && !item.dispensing_movement_ids?.length);

            if (item.is_manual) {
              return (
                <div key={`manual-${index}`}>
                  <div className={`${gridCols} hidden px-4 py-3 text-sm md:grid`}>
                    <input
                      value={item.description}
                      onChange={(event) => onUpdateManual(index, { description: event.target.value })}
                      placeholder="Service or non-stock charge"
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
                    <span className="self-center text-xs font-semibold text-slate-500">Non-stock</span>
                    <p className="text-right font-semibold text-slate-900">
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
                        placeholder="Service or non-stock charge"
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
                        <span className="text-sm font-semibold text-slate-500">Non-stock charge</span>
                        <p className="text-sm font-bold text-slate-900">
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
                          {item.dispensing_movement_ids?.length ? "Already dispensed · Original quantity and price" : `${item.folder_name || "Inventory"} · Stock ${available}`}
                        </p>
                        {available <= 0 ? (
                          <p className="mt-1 text-xs font-bold text-rose-600">Out of stock</p>
                        ) : needsOverride ? (
                          <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                            <AlertTriangle className="size-3.5" />
                            Quantity exceeds available stock
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
                <WastageTraceabilityFields
                  item={item}
                  inventoryOptions={inventoryOptions}
                  onChange={(patch) => onUpdateInventoryLine?.(index, patch)}
                />
              </div>
            );
          })
        ) : (
          <div className="px-4 py-5 text-center text-sm text-slate-400 md:py-4">
            <span className="hidden md:inline">No line items yet.</span>
            <span className="md:hidden">Select stock or add a service/non-stock charge.</span>
          </div>
        )}
      </div>

      {allowManualItems ? (
      <div className="flex justify-end border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 md:py-2">
        <button
          type="button"
          onClick={onAddManual}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-[#4FB8B3]/40 bg-white px-4 py-3 text-sm font-semibold text-[#1f7f7b] transition hover:bg-[#4FB8B3]/10 md:min-h-0 md:px-3 md:py-2 md:text-xs"
        >
          <Plus className="size-4 md:size-3.5" />
          Add service / non-stock charge
        </button>
      </div>
      ) : null}
    </div>
  );
}

// Retained temporarily for historical invoice inspection tests; deployed finance routes never render it.
function CreateBillingModal({
  open,
  onClose,
  onSubmit,
  isSaving,
  patients,
  consultations,
  preselectedPatientId,
  preselectedConsultationId,
  preselectedDoctorId,
  onOpenExisting,
}) {
  const { user: authUser } = useAuth();
  const operatorIssueOnly = authUser?.role === "operator";
  const [sourceReference, setSourceReference] = useState("");
  const [billingDoctorId, setBillingDoctorId] = useState("");
  const [patientId, setPatientId] = useState("");
  const [consultationId, setConsultationId] = useState("");
  const [status, setStatus] = useState("unpaid");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
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
  const [consultationSearchQuery, setConsultationSearchQuery] = useState("");
  const [inventoryOverlayOpen, setInventoryOverlayOpen] = useState(false);
  const [inventoryOverlayQuery, setInventoryOverlayQuery] = useState("");
  const [inventoryCategory, setInventoryCategory] = useState("All");
  const [consultationFees, setConsultationFees] = useState({});
  const [consultationPriceEditable, setConsultationPriceEditable] = useState(false);
  const [visitBilling, setVisitBilling] = useState(null);
  const [visitBillingLoading, setVisitBillingLoading] = useState(false);
  const [step, setStep] = useState(1);
  const includeFee = Boolean(visitBilling && !visitBilling.bills.some(b=>b.items.some(i=>isVisitFee(i))));
  useEffect(() => {
    if (!open || !consultationId) { setVisitBilling(null); return; }
    let ignore=false; setVisitBilling(null); setVisitBillingLoading(true); setItems([]);
    api.get(`/billing/visit/${consultationId}`).then(data=>{if(!ignore)setVisitBilling(data);})
      .catch(e=>{if(!ignore)toast.error(e.message);}).finally(()=>{if(!ignore)setVisitBillingLoading(false);});
    return ()=>{ignore=true;};
  },[open,consultationId]);


  useEffect(() => {
    if (!open) {
      return;
    }

    setPatientId(preselectedPatientId || "");
    setConsultationId(preselectedConsultationId ? String(preselectedConsultationId) : "");
    setBillingDoctorId(
      operatorIssueOnly
        ? String(
          preselectedDoctorId ||
          consultations.find((row) => Number(row.id) === Number(preselectedConsultationId || 0))?.doctor_id ||
          "",
        )
        : "",
    );
    setStatus("unpaid");
    setPaymentMethod("");
    setPaymentDate("");
    setPaymentReference("");
    setSourceReference("");
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
    setConsultationSearchQuery("");
    setInventoryOverlayOpen(false);
    setInventoryOverlayQuery("");
    setInventoryCategory("All");
    setConsultationPriceEditable(false);
    setConsultationFees({});
    setStep(1);
  }, [open, preselectedPatientId, preselectedConsultationId, preselectedDoctorId, operatorIssueOnly, consultations]);

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

  const operatorDoctorOptions = useMemo(() => {
    const rows = new Map();
    consultations.forEach((consultation) => {
      const id = Number(consultation.doctor_id || 0);
      if (id > 0 && !rows.has(id)) rows.set(id, {
        id,
        full_name: String(consultation.doctor_name || `Doctor #${id}`),
      });
    });
    return [...rows.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [consultations]);

  const availableConsultations = useMemo(() => {
    if (!operatorIssueOnly) return consultations;
    if (!billingDoctorId) return [];
    return consultations.filter(
      (consultation) => Number(consultation.doctor_id) === Number(billingDoctorId),
    );
  }, [billingDoctorId, consultations, operatorIssueOnly]);

  const availablePatients = useMemo(() => {
    if (!operatorIssueOnly && authUser?.role !== "doctor") return patients;
    const patientIds = new Set(availableConsultations.map((row) => Number(row.patient_id)));
    return patients.filter((patient) => patientIds.has(Number(patient.id)));
  }, [authUser?.role, availableConsultations, operatorIssueOnly, patients]);

  const patientConsultations = useMemo(
    () =>
      availableConsultations.filter(
        (consultation) => Number(consultation.patient_id) === Number(patientId || 0),
      ),
    [availableConsultations, patientId],
  );

  const filteredPatientConsultations = useMemo(() => {
    const needle = consultationSearchQuery.trim().toLowerCase().replace(/^#/, "");
    if (!needle) return patientConsultations;
    return patientConsultations.filter((consultation) => {
      const visitNumber = `v-${String(consultation.id).padStart(6, "0")}`;
      return visitNumber.includes(needle) || String(consultation.consultation_date || "").includes(needle) ||
        String(consultation.doctor_name || "").toLowerCase().includes(needle);
    });
  }, [consultationSearchQuery, patientConsultations]);

  useEffect(() => {
    if (!open || !patientId || (operatorIssueOnly && !billingDoctorId)) {
      return;
    }

    if (!patientConsultations.length) {
      setConsultationId("");
      return;
    }

    if (!patientConsultations.some((consultation) => consultation.id === Number(consultationId))) {
      setConsultationId("");
    }
  }, [billingDoctorId, consultationId, open, operatorIssueOnly, patientConsultations, patientId]);

  const selectedConsultation =
    patientConsultations.find((consultation) => consultation.id === Number(consultationId)) || null;

  const filteredSuggestions = useMemo(() => {
    const needle = String(itemQuery || "").trim().toLowerCase();
    if (!needle) return [];
    return rankInventoryMatches(
      inventoryOptions.filter((item) => String(item.item_name || "").toLowerCase().includes(needle)),
      needle,
    ).slice(0, 10);
  }, [inventoryOptions, itemQuery]);

  const filteredPatientsForPicker = useMemo(() => {
    const needle = String(patientSearchQuery || "").trim().toLowerCase();
    if (!needle) return availablePatients;
    return availablePatients.filter((patient) => {
      const name = String(patient.full_name || "").toLowerCase();
      const id = String(patient.patient_identifier || patient.patient_id_number || "").toLowerCase();
      return name.includes(needle) || id.includes(needle);
    });
  }, [availablePatients, patientSearchQuery]);

  const doctorHasNoAssignedPatients = authUser?.role === "doctor" && availablePatients.length === 0;
  const patientLocked = Boolean(
    preselectedPatientId && (!operatorIssueOnly || preselectedConsultationId),
  );

  useEffect(() => {
    if (!open || !patientId || patientLocked) return;
    if (!availablePatients.some((p) => String(p.id) === String(patientId))) {
      setPatientId("");
    }
  }, [availablePatients, open, patientId, patientLocked]);

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
    if (!needle) return rankInventoryMatches(rows, "");
    return rankInventoryMatches(rows.filter((item) => {
      const name = String(item.item_name || "").toLowerCase();
      const folder = String(item.folder_name || "").toLowerCase();
      return name.includes(needle) || folder.includes(needle);
    }), needle);
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

  const consultationPriceNumber = includeFee ? Number(consultationPrice || 0) : 0;
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
      toast.error("No patients have a billable consultation in your doctor workspace.");
      return;
    }

    if (operatorIssueOnly && !billingDoctorId) {
      toast.error("Select the doctor whose consultation this invoice belongs to.");
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

    if (operatorIssueOnly && sourceReference.trim().length < 3) {
      toast.error("Enter the paper invoice number or photo reference.");
      return;
    }

    if (items.some((item) => item.inventory_item_id && Number(item.quantity || 0) > Number(item.available || 0))) {
      toast.error("Reduce the quantity to available stock before issuing this invoice.");
      return;
    }

    if (status === "paid" && !paymentMethod) {
      toast.error("Select how the payment was made.");
      return;
    }
    if (status === "paid" && paymentMethod !== "cash" && paymentReference.trim().length < 3) {
      toast.error("Enter the provider transaction reference for this non-cash payment.");
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
      toast.error("Service and non-stock charges need a description.");
      return;
    }

    const invalidWastage = items.find(
      (item) => item.type === "Wastage" &&
        (!Number(item.batch_id) || String(item.wastage_reason || "").trim().length < 8),
    );
    if (invalidWastage) {
      toast.error("Select the affected batch and enter a meaningful wastage reason.");
      return;
    }

    if (!visitBilling || visitBillingLoading) { toast.error("Wait for the visit billing records to load."); return; }
    const combinedItems = [
      ...(includeFee ? [{
        description: consultationType,
        amount: consultationPriceNumber,
        type: "Sale",
        quantity: 1,
        is_consultation_fee: true,
      }] : []),
      ...items,
    ];

    onSubmit({
      patient_id: Number(patientId),
      consultation_id: Number(consultationId),
      doctor_id: operatorIssueOnly ? Number(billingDoctorId) : undefined,
      items: combinedItems.map((item) => ({
        description: item.description,
        amount: Number(item.amount || 0),
        type: item.type || "Sale",
        quantity: Number(item.quantity || 0),
        inventory_item_id: item.inventory_item_id ? Number(item.inventory_item_id) : null,
        emergency_override: Boolean(item.emergency_override),
        is_consultation_fee: Boolean(item.is_consultation_fee),
        is_service_charge: Boolean(item.is_service_charge || item.is_manual),
        dispensing_movement_ids: item.dispensing_movement_ids || [],
        wastage_reason: item.wastage_reason || undefined,
        batch_id: item.batch_id || undefined,
      })),
      status,
      payment_method: status === "paid" ? paymentMethod : null,
      payment_date: status === "paid" ? paymentDate || null : null,
      payment_reference: status === "paid" ? paymentReference.trim() || null : null,
      source_reference: operatorIssueOnly ? sourceReference.trim() : null,
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
    if (qty > available) {
      toast.error(`Only ${available} unit${available === 1 ? "" : "s"} available.`);
      return;
    }
    if (operatorIssueOnly && type !== "Sale") {
      toast.error("Operators can add catalogue sales only.");
      return;
    }
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
        emergency_override: false,
        batches: selected.batches || [],
        batch_id: type === "Wastage" ? "" : null,
        wastage_reason: type === "Wastage" ? "" : undefined,
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
    if (available < 1) {
      toast.error("This item has no available stock.");
      return;
    }
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
        emergency_override: false,
        batches: selected.batches || [],
      },
    ]);
    setInventoryOverlayOpen(false);
    setInventoryOverlayQuery("");
  }

  function updateInventoryLine(index, patch) {
    setItems((current) =>
      current.map((row, idx) => {
        if (idx !== index || row.is_manual || row.dispensing_movement_ids?.length) return row;
        const available = Number(row.available || 0);
        const requestedQty = Math.max(1, Math.floor(Number(patch.quantity !== undefined ? patch.quantity : row.quantity || 1)));
        const qty = Math.min(Math.max(1, available), requestedQty);
        const unitPrice = Number(row.unit_price || 0);
        const itemType = String(patch.type ?? row.type ?? "Sale");
        const amount =
          itemType === "Wastage" ? Number(row.unit_price || 0) * qty : itemType === "Adjustment" ? 0 : unitPrice * qty;
        return {
          ...row,
          ...patch,
          quantity: qty,
          amount,
          emergency_override: false,
        };
      }),
    );
  }

  function removeLine(index) {
    setItems((current) => current.filter((_, idx) => idx !== index));
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
        is_service_charge: true,
        folder_name: "Custom",
      },
    ]);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={operatorIssueOnly ? "Issue invoice" : isMobile ? "New invoice" : "Add billing entry"}
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
              ? "flex-1 space-y-4 overflow-x-hidden overflow-y-auto pb-28"
              : "contents",
          )}
        >
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1.5">
          {["Visit", "Charges", "Review"].map((label, index) => {
            const value = index + 1;
            return (
              <button
                key={label}
                type="button"
                disabled={value > step}
                onClick={() => value < step && setStep(value)}
                className={cx(
                  "min-h-10 rounded-xl px-2 text-xs font-bold transition md:text-sm",
                  step === value ? "bg-white text-[#17666a] ring-1 ring-slate-200" : "text-slate-500",
                  value > step && "cursor-default opacity-60",
                )}
              >
                {value}. {label}
              </button>
            );
          })}
        </div>
        {step === 1 ? <div className="space-y-3">
        <div className={cx(
          "hidden min-w-0 gap-3 md:grid",
          operatorIssueOnly ? "md:grid-cols-3" : "md:grid-cols-2",
        )}>
          {operatorIssueOnly ? (
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Consultation doctor</span>
              <select
                required
                value={billingDoctorId}
                onChange={(event) => {
                  setBillingDoctorId(event.target.value);
                  setPatientId("");
                  setConsultationId("");
                  setItems([]);
                }}
                className={BILLING_FIELD}
              >
                <option value="">Select doctor</option>
                {operatorDoctorOptions.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">The invoice is recorded against this doctor’s visit and stock.</p>
            </label>
          ) : null}
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Patient</span>
            {doctorHasNoAssignedPatients ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
                No patients with a consultation completed by you are available for billing.
              </div>
            ) : (
              <button
                type="button"
                disabled={patientLocked || (operatorIssueOnly && !billingDoctorId)}
                onClick={() => {
                  setPatientSearchQuery("");
                  setPatientPickerOpen(true);
                }}
                className={cx(
                  BILLING_FIELD,
                  "flex items-center justify-between gap-3 text-left",
                  patientLocked && "cursor-not-allowed bg-slate-100",
                )}
              >
                <span className={patientId ? "text-slate-900" : "text-slate-400"}>
                  {patientId
                    ? selectedPatientLabel
                    : operatorIssueOnly && !billingDoctorId
                      ? "Select doctor first"
                      : "Search by patient name or OCS number"}
                </span>
                <Search className="size-4 shrink-0 text-slate-400" />
              </button>
            )}
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Consultation</span>
            <input
              value={consultationSearchQuery}
              onChange={(event) => setConsultationSearchQuery(event.target.value)}
              disabled={!patientId}
              placeholder="Search visit number, date or doctor"
              className={cx(BILLING_FIELD, "mb-2 disabled:bg-slate-100")}
            />
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
              {filteredPatientConsultations.map((consultation) => (
                <option key={consultation.id} value={consultation.id}>
                  V-{String(consultation.id).padStart(6, "0")} · {formatDate(consultation.consultation_date)} · {consultation.doctor_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="min-w-0 space-y-3 md:hidden">
          {operatorIssueOnly ? (
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Consultation doctor</span>
              <select
                required
                value={billingDoctorId}
                onChange={(event) => {
                  setBillingDoctorId(event.target.value);
                  setPatientId("");
                  setConsultationId("");
                  setItems([]);
                }}
                className={cx(BILLING_FIELD, "min-h-12")}
              >
                <option value="">Select doctor</option>
                {operatorDoctorOptions.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <div>
            <span className="text-sm font-semibold text-slate-700">Patient</span>
            {doctorHasNoAssignedPatients ? (
              <div className="mt-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
                No patients with a consultation completed by you are available for billing.
              </div>
            ) : patientLocked ? (
              <div
                className={cx(
                  BILLING_FIELD,
                  "mt-2 flex min-h-12 cursor-not-allowed items-center bg-slate-100 px-4 text-sm font-semibold text-slate-800",
                )}
                aria-readonly="true"
              >
                {selectedPatientLabel || "Loading patient…"}
              </div>
            ) : (
              <button
                type="button"
                disabled={operatorIssueOnly && !billingDoctorId}
                onClick={() => {
                  setPatientSearchQuery("");
                  setPatientPickerOpen(true);
                }}
                className={cx(
                  BILLING_FIELD,
                  "mt-2 flex min-h-12 items-center justify-between gap-2 text-left text-sm font-semibold text-slate-800 focus:border-[#4FB8B3]",
                  operatorIssueOnly && !billingDoctorId && "cursor-not-allowed bg-slate-100",
                )}
              >
                <span className={patientId ? "text-slate-900" : "text-slate-400"}>
                  {patientId
                    ? selectedPatientLabel
                    : operatorIssueOnly && !billingDoctorId
                      ? "Select doctor first"
                      : "Search and select patient"}
                </span>
                <Search className="size-5 shrink-0 text-slate-400" />
              </button>
            )}
          </div>
          <label className="block min-w-0 space-y-2">
            <span className="text-sm font-semibold text-slate-700">Consultation</span>
            <input
              value={consultationSearchQuery}
              onChange={(event) => setConsultationSearchQuery(event.target.value)}
              disabled={!patientId}
              placeholder="Search visit number, date or doctor"
              className={cx(BILLING_FIELD, "min-h-12 disabled:bg-slate-100")}
            />
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
              {filteredPatientConsultations.map((consultation) => (
                <option key={consultation.id} value={consultation.id}>
                  V-{String(consultation.id).padStart(6, "0")} · {formatDate(consultation.consultation_date)} · {consultation.doctor_name}
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

        {visitBillingLoading ? <p role="status">Checking the visit's existing bills…</p> : null}
        {visitBilling?.bills.length>0 && <div className="rounded-2xl bg-slate-50 p-3 space-y-2">
          <p className="text-sm font-semibold">This visit already has a bill. Review it to confirm the fee or record payment.</p>
          {visitBilling.bills.map(existing=><button key={existing.id} type="button" className="block min-h-11 w-full rounded-xl border px-3 text-left text-sm" onClick={()=>onOpenExisting(existing)}>Open bill #{existing.id} · {formatCurrency(existing.total_amount)} · {existing.status}</button>)}
          <p className="text-xs text-slate-600">{includeFee ? "No consultation charge is recorded yet. Confirm the fee below before saving." : "A new bill here covers additional items only; the consultation fee is not charged again."}</p>
        </div>}
        {!!visitBilling?.pending_sales.length && <div className="rounded-2xl border p-3 space-y-2">
          <p className="text-sm font-semibold">Already dispensed — add to this bill without using stock again</p>
          {visitBilling.pending_sales.map(m=><label key={m.id} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={items.some(i=>i.dispensing_movement_ids?.includes(m.id))} onChange={e=>setItems(current=>e.target.checked ? [...current,{description:m.item_name,type:'Sale',quantity:m.quantity,amount:m.quantity*m.unit_price,unit_price:m.unit_price,inventory_item_id:m.item_id,dispensing_movement_ids:[m.id],available:m.quantity}] : current.filter(i=>!i.dispensing_movement_ids?.includes(m.id)))} />
            #{m.id} · {m.item_name} × {m.quantity} · {formatCurrency(m.quantity*m.unit_price)}{m.matches_visit ? '' : ' · Confirm this belongs to this visit'}
          </label>)}
        </div>}
        {includeFee && <>
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
        </>}
        </div> : null}

        {step === 2 ? <div className="space-y-3">
        <div className="hidden rounded-[24px] border border-slate-200 bg-slate-50/60 p-3 md:block">
          <div className="flex flex-row flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 basis-[min(100%,220px)]">
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
              className="h-10 w-[5.25rem] shrink-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-700"
            />
            <input
              readOnly
              value={formatCurrency(getSellingPriceFromDoctorStock(inventorySelection?.id))}
              className="h-10 w-[7.75rem] shrink-0 rounded-2xl border border-slate-200 bg-slate-100 px-3 py-2 text-right text-sm font-semibold text-slate-700"
            />
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => addInventoryLine("Sale")}
                disabled={!canAddItemLine}
                title={addLineDisabledReason || "Add to bill"}
                className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-2xl bg-[#4FB8B3] px-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4 shrink-0" />
                Add to Bill
              </button>
              {!operatorIssueOnly ? (
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
              ) : null}
            </div>
          </div>
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
          includeFee={includeFee}
          consultationType={consultationType}
          consultationPrice={consultationPriceNumber}
          items={items}
          onRemoveLine={removeLine}
          onUpdateManual={updateManualLine}
          onAddManual={addManualLine}
          compactMobile={isMobile}
          onUpdateInventoryLine={updateInventoryLine}
          inventoryOptions={inventoryOptions}
          allowManualItems
        />
        </div> : null}

        {step === 3 ? <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-slate-950">{selectedPatientLabel}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                {selectedConsultation ? `V-${String(selectedConsultation.id).padStart(6, "0")} · ${formatDate(selectedConsultation.consultation_date)}` : "Visit not selected"}
              </p>
              {selectedConsultation ? (
                <p className="mt-1 text-xs font-bold text-[#17666a]">
                  Consultation doctor: {selectedConsultation.doctor_name}
                </p>
              ) : null}
            </div>
            <p className="text-lg font-black text-[#17666a]">{formatCurrency(total)}</p>
          </div>
          <div className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm text-slate-600">
            {includeFee ? <p>{consultationType} · {formatCurrency(consultationPriceNumber)}</p> : null}
            <p>{items.length} additional line{items.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        {operatorIssueOnly ? (
          <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
            <label className="block font-semibold">
              Paper invoice reference
              <input
                required
                minLength={3}
                value={sourceReference}
                onChange={(event) => setSourceReference(event.target.value)}
                className={cx(BILLING_FIELD, "mt-2 bg-white")}
                placeholder="e.g. OCS pad #0142 or photo reference"
              />
            </label>
            <div>
              <p className="font-bold">Issued as unpaid</p>
              <p className="mt-1">Save the doctor’s written details first, then use Record payment to confirm the method and date during follow-up.</p>
            </div>
          </div>
        ) : (
        <BillingStatusFields
          status={status}
          setStatus={setStatus}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          paymentDate={paymentDate}
          setPaymentDate={setPaymentDate}
          paymentReference={paymentReference}
          setPaymentReference={setPaymentReference}
          total={total}
        />
        )}
        </div> : null}
        </div>

        {isMobile ? (
          <div
            className="shrink-0 border-t border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(242,251,250,0.98))] px-1 pt-3"
            style={{ paddingBottom: "max(1.5rem, var(--sab))" }}
          >
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => step === 1 ? onClose() : setStep((current) => current - 1)}
                className="min-h-12 flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600"
              >
                {step === 1 ? "Cancel" : "Back"}
              </button>
              <button
                type={step === 3 ? "submit" : "button"}
                onClick={step === 3 ? undefined : () => {
                  if (step === 1 && (!patientId || !consultationId)) {
                    toast.error("Select a patient and consultation first.");
                    return;
                  }
                  setStep((current) => Math.min(3, current + 1));
                }}
                disabled={isSaving || doctorHasNoAssignedPatients || (step === 1 && (!patientId || !consultationId))}
                className="min-h-12 flex-1 rounded-2xl bg-[#4FB8B3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isSaving ? "Saving…" : step === 1 ? "Continue to charges" : step === 2 ? "Review bill" : operatorIssueOnly ? "Issue invoice" : "Save invoice"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => step === 1 ? onClose() : setStep((current) => current - 1)}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              {step === 1 ? "Cancel" : "Back"}
            </button>
            <button
              type={step === 3 ? "submit" : "button"}
              onClick={step === 3 ? undefined : () => {
                if (step === 1 && (!patientId || !consultationId)) {
                  toast.error("Select a patient and consultation first.");
                  return;
                }
                setStep((current) => Math.min(3, current + 1));
              }}
              disabled={isSaving || doctorHasNoAssignedPatients || (step === 1 && (!patientId || !consultationId))}
              className="rounded-2xl bg-[#4FB8B3] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
            >
              {isSaving ? "Saving…" : step === 1 ? "Continue to charges" : step === 2 ? "Review bill" : operatorIssueOnly ? "Issue invoice" : "Create bill"}
            </button>
          </div>
        )}
      </form>
      {open && typeof document !== "undefined"
        ? createPortal(
            <>
              {patientPickerOpen ? (
                <div
                  className="fixed inset-0 z-[var(--z-sheet)] flex flex-col bg-white"
                  style={{
                    paddingTop: "max(0px, env(safe-area-inset-top, 0px))",
                    paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))",
                  }}
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
                      <p className="px-4 py-10 text-center text-sm font-semibold text-rose-900">No patients with a consultation completed by you are available for billing.</p>
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
                  className="fixed inset-0 z-[var(--z-sheet)] flex flex-col bg-white"
                  style={{
                    paddingTop: "max(0px, env(safe-area-inset-top, 0px))",
                    paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))",
                  }}
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

function canWriteBill(user, bill) {
  if (user?.role === "admin" || user?.role === "operator") {
    return true;
  }
  if (user?.role !== "doctor") {
    return false;
  }
  return Number(bill?.doctor_id) === Number(user?.doctor_id);
}

function canRecordPayment(user, bill) {
  if (user?.role === "admin" || user?.role === "operator" || user?.role === "accountant") {
    return true;
  }
  return user?.role === "doctor" && Number(bill?.doctor_id) === Number(user?.doctor_id);
}

function BillingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const patientIdFilter = searchParams.get("patientId") || "";
  const dateBasis = searchParams.get("dateBasis") === "payment" ? "payment" : "visit";
  const reportDoctorId = searchParams.get("doctorId") || "";
  const [statusFilter, setStatusFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [bills, setBills] = useState([]);
  const [billPage, setBillPage] = useState(0);
  const [billTotal, setBillTotal] = useState(0);
  const [patientSummary, setPatientSummary] = useState([]);
  const [summaryPage, setSummaryPage] = useState(0);
  const [summaryTotal, setSummaryTotal] = useState(0);
  const [summaryTotals, setSummaryTotals] = useState({ total_billed: 0, paid_amount: 0, unpaid_amount: 0 });
  const [quickReviewQueue, setQuickReviewQueue] = useState([]);
  const [unbilledReport, setUnbilledReport] = useState({ count: 0, visits: [], date_from: "", date_to: "" });
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [paymentBill, setPaymentBill] = useState(null);
  const [refundBill, setRefundBill] = useState(null);
  const [quickActionDialog, setQuickActionDialog] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const canMarkPaid =
    user?.role === "admin" || user?.role === "doctor" || user?.role === "operator" || user?.role === "accountant";
  const canIssueCreditNotes = user?.role === "admin" || user?.role === "accountant";
  const isMobile = useIsMobile();
  const [mobileBillTab, setMobileBillTab] = useState(() =>
    searchParams.get("status") === "paid" ? "paid" : "pending",
  );
  const [adminBillingPreset, setAdminBillingPreset] = useState(() =>
    periodToBillingPreset(searchParams.get("period") || "monthly"),
  );
  const [adminBillingAnchorDate, setAdminBillingAnchorDate] = useState(
    () => searchParams.get("date") || billingPageTodayInputValue(),
  );

  const adminBillingDateRange = useMemo(() => {
    if (user?.role !== "admin") {
      return null;
    }
    return getAdminBillingDateRange(adminBillingPreset, adminBillingAnchorDate);
  }, [user?.role, adminBillingPreset, adminBillingAnchorDate]);

  const linkedDateRange = useMemo(() => {
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    if (dateFrom && dateTo) return { from: dateFrom, to: dateTo };
    const period = searchParams.get("period");
    const date = searchParams.get("date");
    if (period && date) return getPeriodRange(normalizeReportPeriod(period), date);
    return null;
  }, [searchParams]);

  function handleAdminBillingPresetChange(next) {
    setAdminBillingPreset(next);
    if (next !== "specific") {
      setAdminBillingAnchorDate(billingPageTodayInputValue());
    }
  }

  async function loadData() {
    try {
      const filterQuery = new URLSearchParams({
        dateBasis,
        paginated: "1",
        limit: String(FINANCE_PAGE_SIZE),
        offset: String(billPage * FINANCE_PAGE_SIZE),
      });
      if (searchText.trim()) filterQuery.set("search", searchText.trim());
      if (reportDoctorId) filterQuery.set("doctorId", reportDoctorId);

      if (statusFilter && (!isMobile || statusFilter === "voided")) {
        filterQuery.set("status", statusFilter);
      }

      if (patientIdFilter) {
        filterQuery.set("patientId", patientIdFilter);
      }

      if (user?.role === "admin" && adminBillingDateRange) {
        filterQuery.set("dateFrom", adminBillingDateRange.from);
        filterQuery.set("dateTo", adminBillingDateRange.to);
      } else if (linkedDateRange) {
        filterQuery.set("dateFrom", linkedDateRange.from);
        filterQuery.set("dateTo", linkedDateRange.to);
      }

      const queryString = filterQuery.toString();
      const summaryQuery = new URLSearchParams({
        dateBasis,
        paginated: "1",
        limit: String(FINANCE_PAGE_SIZE),
        offset: String(summaryPage * FINANCE_PAGE_SIZE),
      });
      if (searchText.trim()) summaryQuery.set("search", searchText.trim());
      if (reportDoctorId) summaryQuery.set("doctorId", reportDoctorId);
      if (user?.role === "admin" && adminBillingDateRange) {
        summaryQuery.set("dateFrom", adminBillingDateRange.from);
        summaryQuery.set("dateTo", adminBillingDateRange.to);
      } else if (linkedDateRange) {
        summaryQuery.set("dateFrom", linkedDateRange.from);
        summaryQuery.set("dateTo", linkedDateRange.to);
      }
      const summaryQueryString = summaryQuery.toString();

      const [billingData, summaryData, quickQueueData, unbilledData] = await Promise.all([
        api.get(`/billing${queryString ? `?${queryString}` : ""}`),
        api.get(`/billing/patient-summary${summaryQueryString ? `?${summaryQueryString}` : ""}`),
        ["admin", "operator"].includes(user?.role)
          ? api.get("/billing/quick/operator-queue?status=actionable&limit=100&offset=0")
          : Promise.resolve({ submissions: [] }),
        ["admin", "operator"].includes(user?.role)
          ? api.get("/billing/quick/unbilled-report")
          : Promise.resolve({ count: 0, visits: [], date_from: "", date_to: "" }),
      ]);

      const billingRows = Array.isArray(billingData) ? billingData : (billingData?.bills || []);
      const summaryRows = Array.isArray(summaryData) ? summaryData : (summaryData?.patients || []);
      setBills(billingRows);
      setBillTotal(Array.isArray(billingData) ? billingRows.length : Number(billingData?.total || 0));
      setPatientSummary(summaryRows);
      setSummaryTotal(Array.isArray(summaryData) ? summaryRows.length : Number(summaryData?.total || 0));
      setSummaryTotals(Array.isArray(summaryData)
        ? summaryRows.reduce((acc, row) => ({
            total_billed: acc.total_billed + Number(row.total_billed || 0),
            paid_amount: acc.paid_amount + Number(row.paid_amount || 0),
            unpaid_amount: acc.unpaid_amount + Number(row.unpaid_amount || 0),
          }), { total_billed: 0, paid_amount: 0, unpaid_amount: 0 })
        : (summaryData?.totals || { total_billed: 0, paid_amount: 0, unpaid_amount: 0 }));
      setQuickReviewQueue(
        Array.isArray(quickQueueData?.submissions) ? quickQueueData.submissions : [],
      );
      setUnbilledReport({
        count: Number(unbilledData?.count || 0),
        visits: Array.isArray(unbilledData?.visits) ? unbilledData.visits : [],
        date_from: unbilledData?.date_from || "",
        date_to: unbilledData?.date_to || "",
      });
      setEditor((current) => {
        if (!current?.bill) return current;
        const rows = billingRows;
        const fresh = rows.find((row) => Number(row.id) === Number(current.bill.id));
        if (!fresh) return current;
        const changedElsewhere =
          Number(fresh.row_version) !== Number(current.bill.row_version) ||
          String(fresh.updated_at || "") !== String(current.bill.updated_at || "") ||
          String(fresh.status || "") !== String(current.bill.status || "");
        return changedElsewhere ? { ...current, stale: true } : current;
      });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initialStatus = searchParams.get("status") || "";
    if (initialStatus) {
      setStatusFilter(initialStatus);
    }
    if (initialStatus === "paid") {
      setMobileBillTab("paid");
    } else if (initialStatus === "voided") {
      setMobileBillTab("voided");
    } else if (initialStatus === "unpaid") {
      setMobileBillTab("pending");
    }
  }, [searchParams]);

  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    loadData();
  }, [statusFilter, patientIdFilter, isMobile, user?.role, adminBillingPreset, adminBillingAnchorDate, linkedDateRange, dateBasis, reportDoctorId, refreshKey, billPage, summaryPage, searchText]);

  useEffect(() => {
    setBillPage(0);
    setSummaryPage(0);
  }, [statusFilter, patientIdFilter, adminBillingPreset, adminBillingAnchorDate, linkedDateRange, dateBasis, reportDoctorId, searchText]);

  useEffect(() => {
    const billId = Number(searchParams.get("billId") || 0);
    if (!Number.isInteger(billId) || billId <= 0) return undefined;

    const match = bills.find((row) => Number(row.id) === billId);
    if (match) {
      setEditor({ bill: match });
      const next = new URLSearchParams(searchParams);
      next.delete("billId");
      setSearchParams(next, { replace: true });
      return undefined;
    }

    if (loading) return undefined;

    let ignore = false;
    api
      .get(`/billing/${billId}`)
      .then((bill) => {
        if (!ignore && bill) setEditor({ bill });
      })
      .catch(() => {})
      .finally(() => {
        if (ignore) return;
        const next = new URLSearchParams(searchParams);
        if (!next.get("billId")) return;
        next.delete("billId");
        setSearchParams(next, { replace: true });
      });

    return () => {
      ignore = true;
    };
  }, [bills, loading, searchParams, setSearchParams]);

  /** The summary endpoint applies one basis consistently: visit-basis invoice totals, or payment-basis transaction activity and the current outstanding snapshot for those invoices. */
  const billingDashboardTotals = useMemo(() => ({
    totalBilled: Number(summaryTotals.total_billed || 0),
    collected: Number(summaryTotals.paid_amount || 0),
    outstanding: Number(summaryTotals.unpaid_amount || 0),
  }), [summaryTotals]);

  const filteredBills = bills.filter((bill) => {
    if (!searchText.trim()) return true;
    const query = searchText.trim().toLowerCase().replace(/^#/, "");
    const idStr = String(bill.id ?? "");
    return (
      bill.patient_name?.toLowerCase().includes(query) ||
      bill.patient_identifier?.toLowerCase().includes(query) ||
      bill.invoice_number?.toLowerCase().includes(query) ||
      bill.source_reference?.toLowerCase().includes(query) ||
      idStr.includes(query) ||
      idStr === searchText.trim()
    );
  });

  const billsForDisplay = useMemo(() => {
    if (!isMobile) return filteredBills;
    return filteredBills.filter((bill) =>
      mobileBillTab === "voided" ? Boolean(bill.voided_at || bill.consultation_voided_at) :
        !bill.voided_at && !bill.consultation_voided_at && (mobileBillTab === "pending" ? bill.status === "unpaid" : bill.status === "paid"),
    );
  }, [filteredBills, isMobile, mobileBillTab]);

  const pendingPayments = patientSummary.filter((patient) => Number(patient.unpaid_amount || 0) > 0);
  const pendingQuickReviews = quickReviewQueue.filter(
    (submission) => submission.workflow_status !== "completed",
  );

  async function openQuickReview(submission) {
    const loaded = bills.find((bill) => Number(bill.id) === Number(submission.bill_id));
    if (loaded) {
      setEditor({ bill: loaded });
      return;
    }
    try {
      const bill = await api.get(`/billing/${submission.bill_id}`);
      setEditor({ bill });
    } catch (error) {
      toast.error(error.message || "This bill could not be opened.");
    }
  }

  async function updateQuickWorkflow(submission, status, noteInput = "") {
    const note = String(noteInput || "").trim();
    if (status === "needs_doctor" && note.length < 3) {
      toast.error("Add a short clarification note for the doctor.");
      return;
    }

    setIsSaving(true);
    try {
      await api.patch(`/billing/quick/operator-queue/${submission.consultation_id}/status`, {
        submission_id: submission.submission_id,
        expected_workflow_status: submission.workflow_status,
        status,
        note,
      });
      await loadData();
      setQuickActionDialog(null);
      toast.success(
        status === "needs_doctor"
          ? "Sent back to the doctor for clarification."
          : status === "ready_for_payment"
            ? "Bill marked ready for payment."
            : "Submission returned to the operator queue.",
      );
    } catch (error) {
      toast.error(error.message || "The billing workflow could not be updated.");
    } finally {
      setIsSaving(false);
    }
  }

  async function reverseQuickSubmission(submission, reasonInput) {
    const reason = String(reasonInput || "").trim();
    if (reason.length < 5) {
      toast.error("Enter a clear reason for the reversal.");
      return;
    }
    setIsSaving(true);
    try {
      await api.post(`/billing/quick/submissions/${submission.submission_id}/reverse`, {
        operation_id: crypto.randomUUID(),
        reason,
      });
      await loadData();
      setQuickActionDialog(null);
      toast.success("Supplies reversed with stock and billing audit records.");
    } catch (error) {
      toast.error(error.message || "The submitted supplies could not be reversed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleShareBillPdf(bill) {
    try {
      await shareBillPdf(bill);
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

  function handleQuickMarkPaid(bill) {
    if (bill.fee_review_required || bill.payment_block) {
      if (!canWriteBill(user, bill)) {
        toast.error("A doctor or operator must resolve this invoice before payment can be recorded.");
        return;
      }
      setEditor({bill});
      return;
    }
    setPaymentBill(bill);
  }

  async function recordPayment(bill, payload) {
    if (!canRecordPayment(user, bill)) {
      toast.error("You do not have permission to record payment for this invoice.");
      return;
    }
    setIsSaving(true);

    try {
      await api.patch(`/billing/${bill.id}/pay`, {
        ...payload,
        expected_version: bill.row_version,
      });
      toast.success(Number(payload.amount) < Number(bill.payment_balance_amount ?? bill.total_amount) ? "Partial payment recorded." : "Payment recorded.");
      setPaymentBill(null);
      await loadData();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function recordRefund(bill, payload) {
    setIsSaving(true);
    try {
      const hashBytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ bill_id: bill.id, ...payload })),
      );
      const fingerprint = Array.from(new Uint8Array(hashBytes), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      const key = `ocs-refund-operation:${user.id}:${fingerprint}`;
      const operationId = sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, operationId);
      const result = await api.post(`/billing/${bill.id}/refunds`, {
        ...payload,
        operation_id: operationId,
      });
      sessionStorage.removeItem(key);
      toast.success(`${result.credit_note.credit_note_number} issued. Inventory was not changed.`);
      setRefundBill(null);
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

  function clearPeriodFilter() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("period");
    nextParams.delete("date");
    nextParams.delete("dateFrom");
    nextParams.delete("dateTo");
    setSearchParams(nextParams);
  }

  if (loading) {
    return <LoadingState label="Loading billing" />;
  }

  return (
    <div
      className={cx(
        pageContainerClass,
        "space-y-6",
        isMobile && "mx-auto max-w-md",
      )}
    >
      <PageHeader
        eyebrow={user?.role === "operator" ? "Work queue" : user?.role === "accountant" ? "Finance" : "Revenue"}
        title={user?.role === "operator" ? "Billing work queue" : user?.role === "accountant" ? "Billing & reconciliation" : user?.role === "admin" ? "Billing oversight" : "Billing"}
        actions={
          <>
            {user?.role === "admin" ? (
              <AdminBillingDateRangeFilter
                anchorDate={adminBillingAnchorDate}
                preset={adminBillingPreset}
                onAnchorDateChange={setAdminBillingAnchorDate}
                onPresetChange={handleAdminBillingPresetChange}
              />
            ) : null}
          </>
        }
      />

      {user?.role !== "doctor" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <BillingStat
            icon={DollarSign}
            label={dateBasis === "payment" ? "Invoices with activity" : "Total billed"}
            value={formatRupees(billingDashboardTotals.totalBilled)}
          />
          <BillingStat
            icon={CreditCard}
            label={dateBasis === "payment" ? "Net collected in period" : "Collected"}
            value={formatRupees(billingDashboardTotals.collected)}
          />
          <BillingStat
            icon={ReceiptText}
            label={dateBasis === "payment" ? "Outstanding on those invoices" : "Outstanding"}
            value={formatRupees(billingDashboardTotals.outstanding)}
          />
        </div>
      ) : null}

      {["admin", "operator"].includes(user?.role) ? (
        <SectionCard
          title={`Visits missing final billing (${unbilledReport.count})`}
          className={unbilledReport.count ? "border-amber-200 bg-amber-50/70" : "border-emerald-200 bg-emerald-50/60"}
        >
          {unbilledReport.count ? (
            <div>
              <p className="mb-4 text-sm font-semibold text-slate-600">
                Completed visits from {formatDate(unbilledReport.date_from)} to {formatDate(unbilledReport.date_to)} with no doctor submission, payment, supply charge, or documented billing edit.
              </p>
              <div className="grid gap-3 lg:grid-cols-2">
                {unbilledReport.visits.map((visit) => (
                  <article key={visit.consultation_id} className="rounded-[22px] border border-amber-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-slate-950">{visit.patient_name}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-500">
                          {visit.patient_identifier} · {visit.visit_number}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-amber-800">
                          {visit.doctor_name} · {formatDate(visit.visit_date)} {visit.visit_time || ""}
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900">Action needed</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                      <span className="font-semibold text-slate-500">Current bill total</span>
                      <span className="font-bold text-slate-900">{formatRupees(visit.bill_total)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (visit.bill_id) openQuickReview(visit);
                        else toast.error("This visit must be billed by its doctor or an operator from Quick Billing.");
                      }}
                      className="mt-3 min-h-11 w-full rounded-2xl bg-amber-500 px-4 text-sm font-bold text-amber-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {visit.bill_id ? "Open billing review" : "Awaiting doctor or operator"}
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm font-semibold text-emerald-800">No completed visit is missing final billing in the last 14 completed days.</p>
          )}
        </SectionCard>
      ) : null}

      {["admin", "operator"].includes(user?.role) && pendingQuickReviews.length ? (
        <SectionCard
          title={`Doctor billing review queue (${pendingQuickReviews.length})`}
          className="border-[#9fdad4] bg-[#effaf8]"
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {pendingQuickReviews.map((submission) => {
              const workflow = QUICK_WORKFLOW_META[submission.workflow_status] || QUICK_WORKFLOW_META.awaiting_operator;
              return (
              <article
                key={`${submission.consultation_id}-${submission.bill_id}`}
                className="rounded-[24px] border border-[#bce3df] bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-slate-950">{submission.patient_name}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      {submission.patient_identifier} · {submission.visit_number}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#226f73]">
                      {submission.doctor_name} · {formatDate(submission.visit_date)} {submission.visit_time || ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-sm font-bold ring-1 ring-inset ${workflow.className}`}>
                    {workflow.label}
                  </span>
                </div>
                {submission.workflow_note ? (
                  <p className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
                    Clarification: {submission.workflow_note}
                  </p>
                ) : null}
                <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-50 p-3 text-center">
                  <div>
                    <p className="text-sm font-semibold text-slate-400">Supplies</p>
                    <p className="mt-1 font-bold text-slate-900">{submission.supply_item_count || "None"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-400">Supply value</p>
                    <p className="mt-1 font-bold text-slate-900">{formatRupees(submission.supply_amount)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-400">Bill total</p>
                    <p className="mt-1 font-bold text-slate-900">{formatRupees(submission.bill_total)}</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => openQuickReview(submission)}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#17666a] px-4 text-sm font-bold text-white transition hover:bg-[#12575a] active:scale-[0.99]"
                  >
                    <ReceiptText className="size-4" />
                    Open bill
                  </button>
                  {submission.workflow_status === "ready_for_payment" ? (
                    <button
                      type="button"
                      onClick={() => updateQuickWorkflow(submission, "awaiting_operator")}
                      className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                    >
                      Return to review
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => updateQuickWorkflow(submission, "ready_for_payment")}
                      className="min-h-12 rounded-2xl bg-violet-600 px-4 text-sm font-bold text-white transition hover:bg-violet-700"
                    >
                      Ready for payment
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setQuickActionDialog({ kind: "clarification", submission })}
                    className="min-h-11 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-bold text-rose-800 transition hover:bg-rose-100"
                  >
                    Ask doctor to clarify
                  </button>
                  <button
                    type="button"
                    disabled={!submission.supply_item_count}
                    onClick={() => setQuickActionDialog({ kind: "reversal", submission })}
                    className="min-h-11 rounded-2xl border border-slate-300 bg-slate-50 px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Reverse supplies
                  </button>
                </div>
              </article>
              );
            })}
          </div>
        </SectionCard>
      ) : null}

      {user?.role !== "admin" && linkedDateRange ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Period filter from Revenue Report</p>
            <p className="mt-1 text-sm text-slate-600">
              Showing bills by {dateBasis === "payment" ? "payment date (unpaid by visit date)" : "visit date"} from {formatDate(linkedDateRange.from)} to {formatDate(linkedDateRange.to)}.
            </p>
          </div>
          <button
            type="button"
            onClick={clearPeriodFilter}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white"
          >
            Show all dates
          </button>
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

      {user?.role !== "operator" ? <FinancialReconciliation refreshToken={bills} /> : null}
      {["admin", "accountant"].includes(user?.role) ? <FinancialDayClose refreshToken={bills} /> : null}

      <div
        className={cx(
          "grid gap-6",
          !isMobile && "xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start",
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
                placeholder="Filter by patient or invoice ID…"
                className="min-h-12 w-full min-w-0 flex-1 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 outline-none transition focus:border-ocs-teal focus:bg-white"
              />
            ) : null
          }
        >
          {!isMobile ? (
            <div className="mb-4 flex flex-row items-center gap-4">
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search patient or invoice ID…"
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
              <option value="voided">Voided</option>
              </select>
            </div>
          ) : null}
          {isMobile ? (
            <div className="mb-4 flex rounded-2xl border border-slate-200 bg-slate-100 p-1 md:hidden">
              <button
                type="button"
                onClick={() => { setMobileBillTab("pending"); setStatusFilter(""); }}
                className={cx(
                  "min-h-12 flex-1 rounded-xl py-2.5 text-sm font-bold transition",
                  mobileBillTab === "pending"
                    ? "bg-white text-ocs-teal shadow-sm"
                    : "text-slate-500",
                )}
              >
                Pending
              </button>
              <button
                type="button"
                onClick={() => { setMobileBillTab("paid"); setStatusFilter(""); }}
                className={cx(
                  "min-h-12 flex-1 rounded-xl py-2.5 text-sm font-bold transition",
                  mobileBillTab === "paid"
                    ? "bg-white text-ocs-teal shadow-sm"
                    : "text-slate-500",
                )}
              >
                Paid
              </button>
              <button type="button" onClick={() => { setMobileBillTab("voided"); setStatusFilter("voided"); }} className={cx("min-h-12 flex-1 rounded-xl py-2.5 text-sm font-bold", mobileBillTab === "voided" ? "bg-white text-ocs-teal" : "text-slate-500")}>Voided</button>
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
                        <th className="px-5 py-3">Payment method</th>
                        <th className="px-5 py-3">Payment date</th>
                        <th className="sticky right-0 z-[1] bg-slate-50 px-5 py-3 text-right shadow-[-2px_0_0_rgba(226,232,240,0.9)]">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {billsForDisplay.map((bill) => (
                        <tr key={bill.id} className="group border-t border-slate-200/70 hover:bg-slate-50/70">
                          <td className="sticky left-0 z-[1] bg-white px-5 py-3 align-middle shadow-[2px_0_0_rgba(241,245,249,0.95)] group-hover:bg-slate-50/70">
                            <p className="truncate font-semibold text-slate-950">{bill.patient_name}</p>
                            <p className="mt-1 truncate text-sm text-slate-500">{bill.doctor_name}</p>
                          </td>
                          <td className="max-w-[220px] px-5 py-3 text-sm text-slate-600">
                            <p className="truncate">{formatDate(bill.consultation_date)}</p>
                            <p className="mt-1 text-slate-500">
                              {billReference(bill)} - {bill.items.length} line item
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
                            {Number(bill.refunded_amount || 0) > 0 ? (
                              <span className="mt-1 block text-xs font-semibold text-rose-700">
                                Refunded {formatCurrency(bill.refunded_amount)} · Net {formatCurrency(bill.net_paid_amount || 0)}
                              </span>
                            ) : null}
                            {bill.payment_state === "partial" ? <span className="mt-1 block text-xs font-semibold text-amber-700">Received {formatCurrency(bill.payment_received_amount)} · Balance {formatCurrency(bill.payment_balance_amount)}</span> : null}
                          </td>
                          <td className="px-5 py-3">
                            <StatusBadge value={bill.voided_at || bill.consultation_voided_at ? "voided" : bill.payment_state || bill.status} />
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-600">
                            {formatPaymentMethod(bill.payment_method)}
                          </td>
                          <td className="px-5 py-3 text-sm text-slate-600">
                            {bill.payment_date ? formatDate(bill.payment_date) : "Not paid yet"}
                            {bill.updated_by_name ? (
                              <span className="mt-0.5 block text-xs text-slate-400">
                                Edited by {bill.updated_by_name}
                                {bill.updated_at ? ` · ${formatDate(bill.updated_at)}` : ""}
                              </span>
                            ) : null}
                          </td>
                          <td className="sticky right-0 z-[1] bg-white px-5 py-3 shadow-[-2px_0_0_rgba(241,245,249,0.95)] group-hover:bg-slate-50/70">
                            <div className="flex flex-row flex-wrap items-center justify-end gap-2">
                              {!bill.voided_at && !bill.consultation_voided_at && bill.status === "unpaid" && canMarkPaid && canRecordPayment(user, bill) ? (
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={() => handleQuickMarkPaid(bill)}
                                  className="inline-flex items-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-60"
                                >
                                  {bill.fee_review_required ? "Review consultation fee" : bill.payment_block ? "Review visit" : "Record payment"}
                                </button>
                              ) : null}
                              {!bill.voided_at && !bill.consultation_voided_at && bill.status === "paid" && canIssueCreditNotes && Number(bill.total_amount || 0) > Number(bill.refunded_amount || 0) ? (
                                <button
                                  type="button"
                                  disabled={isSaving}
                                  onClick={() => setRefundBill(bill)}
                                  className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 disabled:opacity-60"
                                >
                                  Refund
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => handleShareBillPdf(bill)}
                                className="inline-flex items-center gap-1.5 rounded-2xl border border-[#4FB8B3]/35 bg-[#4FB8B3]/10 px-3 py-1.5 text-sm font-semibold text-[#1f7f7b] transition hover:bg-[#4FB8B3]/20"
                              >
                                <Eye className="size-4 shrink-0" />
                                View
                              </button>
                              {bill && (
                              <button
                                type="button"
                                onClick={() => setEditor({ bill })}
                                aria-label="Bill details and history"
                                className="grid size-9 shrink-0 place-items-center rounded-2xl border border-slate-200 text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                              >
                                <SquarePen className="size-4" />
                              </button>
                              )}
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
                    className="rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-lg font-bold text-ocs-slate">{bill.patient_name}</p>
                        <p className="mt-1 text-xs font-medium text-slate-500">{billReference(bill)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleShareBillPdf(bill)}
                        className="grid size-12 shrink-0 place-items-center rounded-2xl border-2 border-ocs-teal/40 bg-ocs-teal/10 text-ocs-teal transition active:scale-95"
                        aria-label="View or share invoice"
                      >
                        <Share2 className="size-5" />
                      </button>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xl font-bold text-slate-700">{formatCurrency(bill.total_amount)}</p>
                        {Number(bill.refunded_amount || 0) > 0 ? <p className="mt-1 text-xs font-bold text-rose-700">Refunded {formatCurrency(bill.refunded_amount)} · Net {formatCurrency(bill.net_paid_amount || 0)}</p> : null}
                      </div>
                      <StatusBadge value={bill.voided_at || bill.consultation_voided_at ? "voided" : bill.payment_state || bill.status} />
                    </div>
                    <div className="mt-4 flex flex-col gap-2">
                      {!bill.voided_at && !bill.consultation_voided_at && bill.status === "unpaid" && canMarkPaid && canRecordPayment(user, bill) ? (
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleQuickMarkPaid(bill)}
                          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-60"
                        >
                          <CreditCard className="size-4" />
                          {bill.fee_review_required ? "Review consultation fee" : bill.payment_block ? "Review visit" : "Record payment"}
                        </button>
                      ) : null}
                      {!bill.voided_at && !bill.consultation_voided_at && bill.status === "paid" && canIssueCreditNotes && Number(bill.total_amount || 0) > Number(bill.refunded_amount || 0) ? (
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => setRefundBill(bill)}
                          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-800 disabled:opacity-60"
                        >
                          Refund / credit note
                        </button>
                      ) : null}
                      {bill && (
                      <button
                        type="button"
                        onClick={() => setEditor({ bill })}
                        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-800"
                      >
                        <SquarePen className="size-4" />
                        Bill details and history
                      </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {billTotal > FINANCE_PAGE_SIZE ? (
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm font-semibold text-slate-600">
                  <span>{billPage * FINANCE_PAGE_SIZE + 1}–{Math.min(billTotal, (billPage + 1) * FINANCE_PAGE_SIZE)} of {billTotal} bills</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={billPage === 0} onClick={() => setBillPage((page) => Math.max(0, page - 1))} className="min-h-10 rounded-xl border border-slate-200 px-3 disabled:opacity-40">Previous</button>
                    <button type="button" disabled={(billPage + 1) * FINANCE_PAGE_SIZE >= billTotal} onClick={() => setBillPage((page) => page + 1)} className="min-h-10 rounded-xl border border-slate-200 px-3 disabled:opacity-40">Next</button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState
              title="No bills found"
              description="Bills are created from consultations, and authorised staff can issue additional billing entries when needed."
            />
          )}
        </SectionCard>

        <SectionCard
          className="min-w-0 w-full"
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
              {summaryTotal > FINANCE_PAGE_SIZE ? (
                <div className="flex items-center justify-between gap-2 border-t border-rose-100 pt-3 text-xs font-semibold text-slate-600">
                  <span>Page {summaryPage + 1} · {summaryTotal} patients</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={summaryPage === 0} onClick={() => setSummaryPage((page) => Math.max(0, page - 1))} className="min-h-9 rounded-xl border border-slate-200 bg-white px-3 disabled:opacity-40">Previous</button>
                    <button type="button" disabled={(summaryPage + 1) * FINANCE_PAGE_SIZE >= summaryTotal} onClick={() => setSummaryPage((page) => page + 1)} className="min-h-9 rounded-xl border border-slate-200 bg-white px-3 disabled:opacity-40">Next</button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title="No pending payments"
              description="All tracked bills are currently paid for the selected filters."
            />
          )}
        </SectionCard>
      </div>

      {paymentBill && <PaymentConfirmation key={paymentBill.id} bill={paymentBill} busy={isSaving}
        onClose={() => { if (!isSaving) setPaymentBill(null); }}
        onConfirm={(payload) => recordPayment(paymentBill, payload)} />}
      {refundBill && <RefundConfirmation key={refundBill.id} bill={refundBill} busy={isSaving}
        onClose={() => { if (!isSaving) setRefundBill(null); }}
        onConfirm={(payload) => recordRefund(refundBill, payload)} />}
      {quickActionDialog ? <QuickActionConfirmation action={quickActionDialog} busy={isSaving} onClose={() => !isSaving && setQuickActionDialog(null)} onConfirm={(reason) => quickActionDialog.kind === "reversal" ? reverseQuickSubmission(quickActionDialog.submission, reason) : updateQuickWorkflow(quickActionDialog.submission, "needs_doctor", reason)} /> : null}
      <EditBillingModal
        open={Boolean(editor)}
        bill={editor?.bill}
        stale={Boolean(editor?.stale)}
        onClose={() => setEditor(null)}
        onSubmit={handleSave}
        onVoid={async (bill, reason) => { setIsSaving(true); try { await api.post(`/billing/${bill.id}/void`,{reason,expected_version:bill.row_version}); setEditor(null); await loadData(); toast.success("Duplicate bill voided; visit retained."); } catch(e){toast.error(e.message);} finally {setIsSaving(false);} }}
        onChanged={(detail) => { setEditor({ bill: detail }); void loadData(); }}
        isSaving={isSaving}
      />

    </div>
  );
}

export default BillingPage;
