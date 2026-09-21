import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus } from "lucide-react";
import toast from "react-hot-toast";

import EmptyState from "./EmptyState.jsx";
import LoadingState from "./LoadingState.jsx";
import SectionCard from "./SectionCard.jsx";
import { api } from "../lib/api.js";
import { formatDate, formatPaymentMethod, formatRupees } from "../lib/format.js";
import { formControlClass } from "../lib/utils.js";

const CATEGORIES = [
  ["salary", "Salaries"], ["doctor_commission", "Doctor commission"],
  ["transport_benefit", "Transport benefits"], ["fuel", "Fuel"], ["rent", "Rent"],
  ["utilities", "Utilities"], ["bank_card_fee", "Bank/card fees"], ["marketing", "Marketing"],
  ["professional_fee", "Professional fees"], ["wastage", "Wastage"],
  ["equipment", "Equipment"], ["miscellaneous", "Miscellaneous"],
];
const METHODS = ["cash", "juice", "card", "ib", "bank_transfer", "cheque"];
function localDateInput(value = new Date()) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

const EMPTY_PAYMENT = { amount: "", payment_date: localDateInput(), payment_method: "cash", external_reference: "" };

function operationId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
}

function statusClass(status) {
  if (status === "approved") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (status === "rejected") return "bg-rose-50 text-rose-800 ring-rose-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

function StatusPill({ status }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-black capitalize ring-1 ring-inset ${statusClass(status)}`}>{status}</span>;
}

function BasisNote({ basis }) {
  return <p className="text-sm font-semibold text-slate-500">
    {basis === "cash"
      ? "Cash basis uses actual payment and refund dates. Supplier payments are included in the cash result."
      : "Accrual basis uses invoice and expense dates to show operational performance."}
  </p>;
}

function SummaryTile({ label, value, tone = "default" }) {
  return <div className={`rounded-2xl border p-4 ${tone === "warning" ? "border-amber-200 bg-amber-50" : tone === "good" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
    <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
    <p className="mt-2 text-xl font-black text-slate-950">{formatRupees(value || 0)}</p>
  </div>;
}

function DecisionControls({ onDecision, disabled }) {
  const [note, setNote] = useState("");
  return <div className="grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-[1fr_auto_auto]">
    <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Approval or rejection note" className={formControlClass} />
    <button type="button" disabled={disabled || note.trim().length < 5} onClick={() => onDecision("approved", note)} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Approve</button>
    <button type="button" disabled={disabled || note.trim().length < 5} onClick={() => onDecision("rejected", note)} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Reject</button>
  </div>;
}

function PaymentControls({ outstanding, onPay, disabled }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_PAYMENT, amount: String(outstanding || "") }));
  return <div className="grid gap-2 rounded-2xl bg-slate-50 p-3 md:grid-cols-5">
    <input type="number" min="0.01" step="0.01" max={outstanding} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="Amount" className={formControlClass} />
    <input type="date" value={form.payment_date} onChange={(event) => setForm({ ...form, payment_date: event.target.value })} className={formControlClass} />
    <select value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })} className={formControlClass}>{METHODS.map((method) => <option key={method} value={method}>{formatPaymentMethod(method)}</option>)}</select>
    <input value={form.external_reference} onChange={(event) => setForm({ ...form, external_reference: event.target.value })} placeholder={form.payment_method === "cash" ? "Reference (optional)" : "Provider reference"} className={formControlClass} />
    <button type="button" disabled={disabled || !Number(form.amount)} onClick={() => onPay(form)} className="rounded-xl bg-[#17666a] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Record payment</button>
  </div>;
}

function PaymentReversal({ payment, disabled, onReverse }) {
  const [date, setDate] = useState(localDateInput());
  const [reason, setReason] = useState("");
  if (payment.reversal_id) return <span className="text-rose-700">Reversed {formatDate(payment.reversal_date)} · {payment.reversal_reason}</span>;
  return <details><summary className="cursor-pointer font-bold text-rose-700">Reverse</summary><div className="mt-2 grid gap-2 sm:grid-cols-[9rem_1fr_auto]"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={formControlClass} /><input value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} placeholder="Reason for immutable reversal" className={formControlClass} /><button type="button" disabled={disabled || reason.trim().length < 10} onClick={() => onReverse(payment, { reversal_date: date, reason })} className="rounded-xl bg-rose-700 px-3 py-2 font-bold text-white disabled:opacity-40">Confirm reversal</button></div></details>;
}

function PaymentHistory({ payments = [], user, disabled, onReverse }) {
  if (!payments.length) return null;
  return <details className="mt-3"><summary className="cursor-pointer text-xs font-bold text-slate-500">Payment history ({payments.length})</summary><div className="mt-2 space-y-2">{payments.map((payment) => <div key={payment.id} className="rounded-xl bg-slate-50 p-3 text-xs font-semibold text-slate-600"><div className="flex flex-wrap justify-between gap-2"><span>{formatDate(payment.payment_date)} · {formatPaymentMethod(payment.payment_method)} · {payment.external_reference || "No reference"}</span><strong className={payment.reversal_id ? "line-through" : ""}>{formatRupees(payment.amount)}</strong></div>{user?.role === "admin" ? <div className="mt-2"><PaymentReversal payment={payment} disabled={disabled} onReverse={onReverse} /></div> : payment.reversal_id ? <p className="mt-2 text-rose-700">Reversed {formatDate(payment.reversal_date)} · {payment.reversal_reason}</p> : null}</div>)}</div></details>;
}

function Overview({ summary, loading, basis }) {
  if (loading && !summary) return <LoadingState label="Loading finance overview" />;
  return <section className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <SummaryTile label={summary?.revenue_label || "Net sales"} value={summary?.revenue_amount} />
      <SummaryTile label="Collected cash" value={summary?.collected_cash_amount} />
      <SummaryTile label="Receivables" value={summary?.receivables_amount} tone={Number(summary?.receivables_amount) > 0 ? "warning" : "default"} />
      <SummaryTile label={summary?.gross_result_label || "Gross profit"} value={summary?.gross_result_amount} />
      <SummaryTile label={basis === "cash" ? "Paid operating expenses" : "Approved expenses"} value={summary?.expense_amount} />
      <SummaryTile label={summary?.net_result_label || "Net profit"} value={summary?.net_profit_amount} tone={Number(summary?.net_profit_amount) >= 0 ? "good" : "warning"} />
    </div>
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${summary?.exception_count ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
      {summary?.exception_count ? <AlertTriangle className="mt-0.5 size-5 text-amber-700" /> : <CheckCircle2 className="mt-0.5 size-5 text-emerald-700" />}
      <div>
        <p className="font-black text-slate-950">{summary?.exception_count ? `${summary.exception_count} finance exception(s) need attention` : "No finance exceptions in this period"}</p>
        {summary?.exception_count ? <p className="mt-1 text-sm font-semibold text-slate-600">Pending expenses {summary.exceptions.pending_expenses} · Pending supplier invoices {summary.exceptions.pending_supplier_invoices} · Missing supply costs {summary.exceptions.missing_cost_sales}</p> : null}
      </div>
    </div>
    <BasisNote basis={basis} />
  </section>;
}

function ExpenseForm({ onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ expense_date: localDateInput(), category: "miscellaneous", payee: "", description: "", amount: "", external_reference: "" });
  const [receipt, setReceipt] = useState(null);
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, value));
      body.append("operation_id", operationId("expense"));
      if (receipt) body.append("receipt", receipt);
      await api.post("/finance/expenses", body);
      toast.success("Expense submitted for approval.");
      onCreated();
    } catch (error) { toast.error(error.message); }
    finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-teal-200 bg-teal-50/40 p-4 md:grid-cols-2 xl:grid-cols-4">
    <label className="grid gap-1 text-xs font-bold text-slate-600">Expense date<input required type="date" value={form.expense_date} onChange={(event) => setForm({ ...form, expense_date: event.target.value })} className={formControlClass} /></label>
    <label className="grid gap-1 text-xs font-bold text-slate-600">Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className={formControlClass}>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="grid gap-1 text-xs font-bold text-slate-600">Supplier / payee<input required value={form.payee} onChange={(event) => setForm({ ...form, payee: event.target.value })} className={formControlClass} /></label>
    <label className="grid gap-1 text-xs font-bold text-slate-600">Amount<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className={formControlClass} /></label>
    <label className="grid gap-1 text-xs font-bold text-slate-600 md:col-span-2">Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={formControlClass} /></label>
    <label className="grid gap-1 text-xs font-bold text-slate-600">Reference<input value={form.external_reference} onChange={(event) => setForm({ ...form, external_reference: event.target.value })} className={formControlClass} /></label>
    <label className="grid gap-1 text-xs font-bold text-slate-600">Receipt / supporting document<input required type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setReceipt(event.target.files?.[0] || null)} className="block w-full text-xs" /></label>
    <div className="flex gap-2 md:col-span-2 xl:col-span-4"><button disabled={saving} className="rounded-xl bg-[#17666a] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Submit expense"}</button><button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold">Cancel</button></div>
  </form>;
}

function Expenses({ rows, user, reload, loading }) {
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  async function decide(row, action, note) {
    setBusyId(row.id);
    try { await api.post(`/finance/expenses/${row.id}/decision`, { action, note, operation_id: operationId(`expense-${action}`) }); toast.success(`Expense ${action}.`); await reload(); }
    catch (error) { toast.error(error.message); } finally { setBusyId(null); }
  }
  async function pay(row, form) {
    setBusyId(row.id);
    try { await api.post(`/finance/expenses/${row.id}/payments`, { ...form, operation_id: operationId("expense-payment") }); toast.success("Expense payment recorded."); await reload(); }
    catch (error) { toast.error(error.message); } finally { setBusyId(null); }
  }
  async function reverse(row, payment, form) {
    setBusyId(row.id);
    try { await api.post(`/finance/expenses/${row.id}/payments/${payment.id}/reversal`, { ...form, operation_id: operationId("expense-payment-reversal") }); toast.success("Expense payment reversed with an audit entry."); await reload(); }
    catch (error) { toast.error(error.message); } finally { setBusyId(null); }
  }
  return <SectionCard title="Expenses" actions={<button type="button" onClick={() => setAdding(true)} className="flex items-center gap-2 rounded-xl bg-[#17666a] px-4 py-2 text-sm font-bold text-white"><Plus className="size-4" /> Add expense</button>}>
    <div className="space-y-3">
      {adding ? <ExpenseForm onCreated={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} /> : null}
      {loading ? <LoadingState label="Loading expenses" /> : rows.length ? rows.map((row) => <article key={row.id} className="rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black text-slate-950">{row.payee}</p><p className="mt-1 text-sm font-semibold text-slate-500">{formatDate(row.expense_date)} · {CATEGORIES.find(([key]) => key === row.category)?.[1] || row.category}</p><p className="mt-1 text-sm text-slate-600">{row.description || "No description"}</p></div><div className="text-right"><p className="text-xl font-black">{formatRupees(row.amount)}</p><StatusPill status={row.approval_status} /></div></div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-slate-500"><span>Paid {formatRupees(row.paid_amount)}</span><span>Outstanding {formatRupees(row.outstanding_amount)}</span><span>Created by {row.created_by_name}</span>{row.receipt_stored_name ? <a href={`/api/finance/expenses/${row.id}/receipt`} target="_blank" rel="noreferrer" className="text-[#17666a]">Open receipt</a> : <span className="text-amber-700">No receipt attached</span>}</div>
        {row.approval_status === "submitted" && user?.role === "admin" ? <div className="mt-3"><DecisionControls disabled={busyId === row.id} onDecision={(action, note) => decide(row, action, note)} /></div> : null}
        {row.approval_status === "approved" && Number(row.outstanding_amount) > 0.004 ? <details className="mt-3"><summary className="cursor-pointer text-sm font-bold text-[#17666a]">Record payment</summary><div className="mt-2"><PaymentControls outstanding={row.outstanding_amount} disabled={busyId === row.id} onPay={(form) => pay(row, form)} /></div></details> : null}
        <PaymentHistory payments={row.payments} user={user} disabled={busyId === row.id} onReverse={(payment, form) => reverse(row, payment, form)} />
        {row.history?.length ? <details className="mt-3"><summary className="cursor-pointer text-xs font-bold text-slate-500">Approval history ({row.history.length})</summary><div className="mt-2 space-y-1 text-xs text-slate-500">{row.history.map((event) => <p key={event.id}>{event.created_at} · {event.action} · {event.actor_name} · {event.note}</p>)}</div></details> : null}
      </article>) : <EmptyState title="No expenses in this period" description="Add operating expenses so net profit is complete." />}
    </div>
  </SectionCard>;
}

function SupplierForm({ catalogue, onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ supplier_name: "", invoice_number: "", invoice_date: localDateInput(), due_date: "", delivery_note: "", shipment_id: "", other_amount: "0" });
  const [document, setDocument] = useState(null);
  const [lines, setLines] = useState([{ inventory_item_id: "", batch_id: "", description: "", quantity: "1", unit_cost: "" }]);
  const options = useMemo(() => catalogue?.items || [], [catalogue]);
  function updateLine(index, patch) { setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)); }
  async function submit(event) {
    event.preventDefault(); setSaving(true);
    try {
      const body = new FormData(); Object.entries(form).forEach(([key, value]) => body.append(key, value));
      body.append("operation_id", operationId("supplier-invoice")); body.append("lines", JSON.stringify(lines)); if (document) body.append("document", document);
      await api.post("/finance/supplier-invoices", body); toast.success("Supplier invoice submitted for approval."); onCreated();
    } catch (error) { toast.error(error.message); } finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="space-y-4 rounded-2xl border border-teal-200 bg-teal-50/40 p-4">
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <label className="grid gap-1 text-xs font-bold">Supplier<input required value={form.supplier_name} onChange={(event) => setForm({ ...form, supplier_name: event.target.value })} className={formControlClass} /></label>
      <label className="grid gap-1 text-xs font-bold">Invoice number<input required value={form.invoice_number} onChange={(event) => setForm({ ...form, invoice_number: event.target.value })} className={formControlClass} /></label>
      <label className="grid gap-1 text-xs font-bold">Invoice date<input required type="date" value={form.invoice_date} onChange={(event) => setForm({ ...form, invoice_date: event.target.value })} className={formControlClass} /></label>
      <label className="grid gap-1 text-xs font-bold">Due date<input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} className={formControlClass} /></label>
      <label className="grid gap-1 text-xs font-bold">Delivery note<input value={form.delivery_note} onChange={(event) => setForm({ ...form, delivery_note: event.target.value })} className={formControlClass} /></label>
      <label className="grid gap-1 text-xs font-bold">Linked Receive Delivery<select value={form.shipment_id} onChange={(event) => setForm({ ...form, shipment_id: event.target.value })} className={formControlClass}><option value="">Not linked</option>{(catalogue?.shipments || []).map((shipment) => <option key={shipment.id} value={shipment.id}>#{shipment.id} · {shipment.supplier || "Supplier"} · {shipment.delivery_note || "No delivery note"}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-bold">Freight / other cost<input type="number" min="0" step="0.01" value={form.other_amount} onChange={(event) => setForm({ ...form, other_amount: event.target.value })} className={formControlClass} /></label>
      <label className="grid gap-1 text-xs font-bold">Invoice document<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setDocument(event.target.files?.[0] || null)} className="block w-full text-xs" /></label>
    </div>
    <div className="space-y-2"><div className="flex items-center justify-between"><p className="font-black">Actual item and batch costs</p><button type="button" onClick={() => setLines([...lines, { inventory_item_id: "", batch_id: "", description: "", quantity: "1", unit_cost: "" }])} className="text-sm font-bold text-[#17666a]">+ Add line</button></div>
      {lines.map((line, index) => <div key={index} className="grid gap-2 rounded-xl bg-white p-3 md:grid-cols-[1.4fr_1.3fr_.6fr_.7fr_auto]">
        <select value={`${line.inventory_item_id || ""}:${line.batch_id || ""}`} onChange={(event) => { const match = options.find((item) => `${item.id}:${item.batch_id || ""}` === event.target.value); updateLine(index, match ? { inventory_item_id: String(match.id), batch_id: String(match.batch_id || ""), description: match.item_name, unit_cost: String(match.unit_cost || match.cost_price || "") } : { inventory_item_id: "", batch_id: "" }); }} className={formControlClass}><option value=":">Service / unlinked item</option>{options.map((item) => <option key={`${item.id}-${item.batch_id || 0}`} value={`${item.id}:${item.batch_id || ""}`}>{item.item_name}{item.batch_id ? ` · batch ${item.batch_id} · ${item.quantity_remaining} remaining` : ""}</option>)}</select>
        <input required value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} placeholder="Description" className={formControlClass} />
        <input required type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} placeholder="Qty" className={formControlClass} />
        <input required type="number" min="0" step="0.01" value={line.unit_cost} onChange={(event) => updateLine(index, { unit_cost: event.target.value })} placeholder="Unit cost" className={formControlClass} />
        <button type="button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, lineIndex) => lineIndex !== index))} className="rounded-xl border px-3 text-rose-700 disabled:opacity-30">Remove</button>
      </div>)}
    </div>
    <div className="flex gap-2"><button disabled={saving} className="rounded-xl bg-[#17666a] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Submit supplier invoice"}</button><button type="button" onClick={onCancel} className="rounded-xl border px-5 py-2.5 text-sm font-bold">Cancel</button></div>
  </form>;
}

function Suppliers({ rows, catalogue, user, reload, loading }) {
  const [adding, setAdding] = useState(false); const [busyId, setBusyId] = useState(null);
  async function decide(row, action, note) { setBusyId(row.id); try { await api.post(`/finance/supplier-invoices/${row.id}/decision`, { action, note, operation_id: operationId(`supplier-${action}`) }); toast.success(`Supplier invoice ${action}.`); await reload(); } catch (error) { toast.error(error.message); } finally { setBusyId(null); } }
  async function pay(row, form) { setBusyId(row.id); try { await api.post(`/finance/supplier-invoices/${row.id}/payments`, { ...form, operation_id: operationId("supplier-payment") }); toast.success("Supplier payment recorded."); await reload(); } catch (error) { toast.error(error.message); } finally { setBusyId(null); } }
  async function reverse(row, payment, form) { setBusyId(row.id); try { await api.post(`/finance/supplier-invoices/${row.id}/payments/${payment.id}/reversal`, { ...form, operation_id: operationId("supplier-payment-reversal") }); toast.success("Supplier payment reversed with an audit entry."); await reload(); } catch (error) { toast.error(error.message); } finally { setBusyId(null); } }
  return <SectionCard title="Supplier purchasing and payables" actions={<button type="button" onClick={() => setAdding(true)} className="flex items-center gap-2 rounded-xl bg-[#17666a] px-4 py-2 text-sm font-bold text-white"><Plus className="size-4" /> Add supplier invoice</button>}>
    <div className="space-y-3">{adding ? <SupplierForm catalogue={catalogue} onCreated={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} /> : null}
      {loading ? <LoadingState label="Loading supplier invoices" /> : rows.length ? rows.map((row) => <article key={row.id} className="rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{row.supplier_name} · {row.invoice_number}</p><p className="mt-1 text-sm font-semibold text-slate-500">Invoice {formatDate(row.invoice_date)}{row.due_date ? ` · Due ${formatDate(row.due_date)}` : ""}{row.delivery_note ? ` · Delivery ${row.delivery_note}` : ""}</p></div><div className="text-right"><p className="text-xl font-black">{formatRupees(row.total_amount)}</p><StatusPill status={row.approval_status} /></div></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Paid</p><p className="font-black">{formatRupees(row.paid_amount)}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Outstanding</p><p className="font-black">{formatRupees(row.outstanding_amount)}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">Stock lines</p><p className="font-black">{row.lines?.length || 0}</p></div></div>
        {row.document_stored_name ? <a href={`/api/finance/supplier-invoices/${row.id}/document`} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-bold text-[#17666a]">Open supplier document</a> : null}
        <details className="mt-3"><summary className="cursor-pointer text-sm font-bold text-slate-600">Invoice lines and actual costs</summary><div className="mt-2 space-y-1 text-sm">{row.lines?.map((line) => <p key={line.id} className="flex justify-between gap-3"><span>{line.description} × {line.quantity}{line.batch_id ? ` · batch ${line.batch_id}` : ""}</span><strong>{formatRupees(Number(line.quantity) * Number(line.unit_cost))}</strong></p>)}</div></details>
        {row.approval_status === "submitted" && user?.role === "admin" ? <div className="mt-3"><DecisionControls disabled={busyId === row.id} onDecision={(action, note) => decide(row, action, note)} /></div> : null}
        {row.approval_status === "approved" && Number(row.outstanding_amount) > 0.004 ? <details className="mt-3"><summary className="cursor-pointer text-sm font-bold text-[#17666a]">Record supplier payment</summary><div className="mt-2"><PaymentControls outstanding={row.outstanding_amount} disabled={busyId === row.id} onPay={(form) => pay(row, form)} /></div></details> : null}
        <PaymentHistory payments={row.payments} user={user} disabled={busyId === row.id} onReverse={(payment, form) => reverse(row, payment, form)} />
      </article>) : <EmptyState title="No supplier invoices in this period" description="Record purchases to track actual stock cost and supplier balances." />}
    </div>
  </SectionCard>;
}

function Statements({ summary, basis, dateFrom, dateTo }) {
  async function exportStatement() { try { const result = await api.getBlob(`/finance/statement.csv?dateFrom=${dateFrom}&dateTo=${dateTo}&basis=${basis}`); const url = URL.createObjectURL(result.blob); const link = document.createElement("a"); link.href = url; link.download = result.filename || "ocs-financial-statement.csv"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { toast.error(error.message); } }
  async function exportDetailed(format) { try { const query = `dateFrom=${dateFrom}&dateTo=${dateTo}&dateBasis=${basis === "cash" ? "payment" : "visit"}`; if (format === "pdf") { const statement = await api.get(`/billing/finance-statement?${query}`); const { presentFinanceStatementPdf } = await import("../lib/financeStatementPdf.js"); await presentFinanceStatementPdf(statement); return; } const result = await api.getBlob(`/billing/finance-statement.csv?${query}`); const url = URL.createObjectURL(result.blob); const link = document.createElement("a"); link.href = url; link.download = result.filename || "ocs-detailed-finance.csv"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (error) { toast.error(error.message); } }
  const actions = <div className="flex flex-wrap gap-2"><button type="button" onClick={exportStatement} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold">Summary CSV</button><button type="button" onClick={() => exportDetailed("csv")} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold">Detailed ledger CSV</button><button type="button" onClick={() => exportDetailed("pdf")} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold">Detailed ledger PDF</button></div>;
  return <section className="space-y-4"><SectionCard title="Profit and loss statement" actions={actions}>
    <div className="space-y-2 text-sm"><div className="flex justify-between rounded-xl bg-slate-50 p-3"><span>{summary?.revenue_label || "Net sales"}</span><strong>{formatRupees(summary?.revenue_amount)}</strong></div>{basis === "accrual" ? <div className="flex justify-between rounded-xl bg-slate-50 p-3"><span>Cost of supplies sold</span><strong>({formatRupees(summary?.supply_cost_amount)})</strong></div> : null}<div className="flex justify-between rounded-xl bg-teal-50 p-3 text-base"><strong>{summary?.gross_result_label || "Gross profit"}</strong><strong>{formatRupees(summary?.gross_result_amount)}</strong></div><div className="flex justify-between rounded-xl bg-slate-50 p-3"><span>{basis === "cash" ? "Paid operating expenses" : "Approved operating expenses"}</span><strong>({formatRupees(summary?.expense_amount)})</strong></div>{basis === "cash" ? <div className="flex justify-between rounded-xl bg-slate-50 p-3"><span>Supplier payments (included above)</span><strong>{formatRupees(summary?.supplier_payment_amount)}</strong></div> : null}<div className="flex justify-between rounded-xl bg-emerald-50 p-4 text-lg"><strong>{summary?.net_result_label || "Net profit"}</strong><strong>{formatRupees(summary?.net_profit_amount)}</strong></div></div><div className="mt-4"><BasisNote basis={basis} /></div>
  </SectionCard></section>;
}

function MonthlyClose({ user }) {
  const defaultMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7);
  const [month, setMonth] = useState(defaultMonth); const [data, setData] = useState(null); const [notes, setNotes] = useState(""); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { setData(await api.get(`/finance/monthly-close?month=${month}`)); } catch (error) { toast.error(error.message); } finally { setLoading(false); } }, [month]);
  useEffect(() => { load(); }, [load]);
  async function closeMonth() { setLoading(true); try { await api.post("/finance/monthly-close", { month, notes, operation_id: operationId("month-close") }); toast.success("Finance month signed off and locked."); await load(); } catch (error) { toast.error(error.message); if (error.data?.readiness) setData({ readiness: error.data.readiness, closing: null }); } finally { setLoading(false); } }
  return <SectionCard title="Monthly financial close" actions={<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={formControlClass} />}>
    {loading && !data ? <LoadingState label="Checking month close" /> : data?.closing ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-black text-emerald-900">{month} is signed off</p><p className="mt-1 text-sm text-emerald-800">Closed by {data.closing.closed_by_name} on {data.closing.created_at}. This period is locked.</p></div> : <div className="space-y-3"><div className={`rounded-2xl border p-4 ${data?.readiness?.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}><p className="font-black">{data?.readiness?.ready ? "Ready to close" : "Month cannot close yet"}</p>{data?.readiness?.blockers?.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold">{data.readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className="mt-1 text-sm">All required daily closes and finance checks are complete.</p>}</div>{user?.role === "admin" ? <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Month-close responsibility and sign-off note" className={formControlClass} /><button type="button" onClick={closeMonth} disabled={!data?.readiness?.ready || notes.trim().length < 10 || loading} className="rounded-xl bg-[#17666a] px-5 py-2 font-bold text-white disabled:opacity-40">Sign off month</button></div> : <p className="text-sm font-semibold text-slate-500">An administrator completes the final sign-off.</p>}</div>}
  </SectionCard>;
}

export default function FinanceLedgerSections({ section, dateFrom, dateTo, basis, user }) {
  const [summary, setSummary] = useState(null); const [expenses, setExpenses] = useState([]); const [suppliers, setSuppliers] = useState([]); const [catalogue, setCatalogue] = useState({ items: [], shipments: [] }); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) return;
    setLoading(true);
    try {
      const requests = [api.get(`/finance/summary?dateFrom=${dateFrom}&dateTo=${dateTo}&basis=${basis}`)];
      if (section === "expenses") requests.push(api.get(`/finance/expenses?dateFrom=${dateFrom}&dateTo=${dateTo}&basis=${basis}`));
      if (section === "suppliers") requests.push(api.get(`/finance/supplier-invoices?dateFrom=${dateFrom}&dateTo=${dateTo}&basis=${basis}`), api.get("/finance/supplier-catalogue"));
      const result = await Promise.all(requests); setSummary(result[0]);
      if (section === "expenses") setExpenses(result[1]?.expenses || []);
      if (section === "suppliers") { setSuppliers(result[1]?.invoices || []); setCatalogue(result[2] || { items: [], shipments: [] }); }
    } catch (error) { toast.error(error.message); } finally { setLoading(false); }
  }, [basis, dateFrom, dateTo, section]);
  useEffect(() => { if (["overview", "expenses", "suppliers", "statements"].includes(section)) load(); }, [load, section]);
  if (section === "overview") return <Overview summary={summary} loading={loading} basis={basis} />;
  if (section === "expenses") return <Expenses rows={expenses} user={user} reload={load} loading={loading} />;
  if (section === "suppliers") return <Suppliers rows={suppliers} catalogue={catalogue} user={user} reload={load} loading={loading} />;
  if (section === "statements") return <Statements summary={summary} basis={basis} dateFrom={dateFrom} dateTo={dateTo} />;
  if (section === "controls") return <MonthlyClose user={user} />;
  return null;
}
