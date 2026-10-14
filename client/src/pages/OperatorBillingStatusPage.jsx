import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, DollarSign, FileText, ReceiptText, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import PatientWorkspaceHeader from "../components/patient-workspace/PatientWorkspaceHeader.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { getPeriodRange, normalizeReportPeriod } from "../lib/reportPeriod.js";
import "../components/finance-workspace/financeWorkspace.css";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { api } from "../lib/api.js";
import { formatCurrency, formatDate, formatPaymentMethod } from "../lib/format.js";
import { cx } from "../lib/utils.js";

const PAGE_SIZE = 40;

function todayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
}

function invoiceReference(bill) {
  return bill?.invoice_number || `Bill #${bill?.id || ""}`;
}

function outstandingAmount(bill) {
  return Math.max(0, Number(bill?.payment_balance_amount ?? bill?.total_amount ?? 0));
}

function BillingStat({ icon: Icon, label, value, tone = "teal" }) {
  const tones = {
    teal: "bg-teal-50 text-teal-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <div className="finance-stat rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" data-tone={tone}>
      <div className="flex items-center gap-3">
        <span className={cx("finance-stat-icon grid size-10 place-items-center rounded-xl", tones[tone])}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
          <p className="mt-0.5 truncate text-xl font-black text-slate-950">{value}</p>
        </div>
      </div>
    </div>
  );
}

function PaymentModal({ bill, busy, onClose, onConfirm }) {
  const balance = outstandingAmount(bill);
  const [amount, setAmount] = useState(balance ? balance.toFixed(2) : "");
  const [method, setMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayInputValue);
  const [reference, setReference] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [operationId] = useState(() => crypto.randomUUID());
  const amountNumber = Number(amount || 0);
  const valid = amountNumber > 0 && amountNumber <= balance && method && paymentDate &&
    (method === "cash" || reference.trim().length >= 3) && confirmed;

  return (
    <Modal open onClose={onClose} title={`Record payment · ${invoiceReference(bill)}`} size="md" className="payment-follow-up-modal">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && valid) {
            onConfirm({
              amount: amountNumber,
              payment_method: method,
              payment_date: paymentDate,
              external_reference: reference.trim() || null,
              operation_id: operationId,
              expected_version: bill.row_version,
            });
          }
        }}
      >
        <div className="payment-balance-summary rounded-2xl bg-slate-50 p-4">
          <p className="font-black text-slate-950">{bill.patient_name}</p>
          <p className="mt-1 text-sm font-semibold text-slate-500">{bill.doctor_name} · {formatDate(bill.consultation_date)}</p>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Outstanding</p>
          <p className="mt-1 text-2xl font-black text-slate-950">{formatCurrency(balance)}</p>
        </div>
        <label className="block text-sm font-bold text-slate-700">
          Amount received
          <input required type="number" min="0.01" max={balance} step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-[#2aa7a0]" />
        </label>
        <label className="block text-sm font-bold text-slate-700">
          Payment method
          <select required value={method} onChange={(event) => { setMethod(event.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 outline-none focus:border-[#2aa7a0]">
            <option value="">Select method</option>
            <option value="cash">Cash</option>
            <option value="juice">Juice</option>
            <option value="card">Card</option>
            <option value="ib">IB / bank</option>
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-bold text-slate-700">
            Payment date
            <input required type="date" max={todayInputValue()} value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); setConfirmed(false); }} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-[#2aa7a0]" />
          </label>
          <label className="block text-sm font-bold text-slate-700">
            Transaction reference
            <input required={method !== "cash"} minLength={method === "cash" ? undefined : 3} value={reference} onChange={(event) => { setReference(event.target.value); setConfirmed(false); }} placeholder={method === "cash" ? "Optional for cash" : "Provider reference"} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-[#2aa7a0]" />
          </label>
        </div>
        <label className="flex min-h-11 items-start gap-3 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-950">
          <input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>I confirm that this amount was received using the method and date entered above.</span>
        </label>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 px-4 font-bold text-slate-700">Cancel</button>
          <button disabled={busy || !valid} className="min-h-11 rounded-xl bg-[#17666a] px-5 font-black text-white disabled:opacity-50">
            {busy ? "Recording…" : amountNumber < balance ? "Record partial payment" : "Confirm payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function OperatorBillingStatusPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const doctorReadOnly = user.role === "doctor";
  const initialRange = searchParams.has("period") && searchParams.get("preset") !== "all" ? getPeriodRange(normalizeReportPeriod(searchParams.get("period")), searchParams.get("date")) : { from: "", to: "" };
  const [doctorOptions, setDoctorOptions] = useState([]);
  const [doctorFilter, setDoctorFilter] = useState(searchParams.get("doctorId") || "");
  const [dateFrom, setDateFrom] = useState(searchParams.get("dateFrom") || initialRange.from);
  const [dateTo, setDateTo] = useState(searchParams.get("dateTo") || initialRange.to);
  const [datePreset, setDatePreset] = useState(searchParams.get("preset") || (searchParams.has("period") ? "custom" : "all"));
  const [ageBucket, setAgeBucket] = useState(searchParams.get("ageBucket") || "");
  const [loadError, setLoadError] = useState("");
  const dateBasis = searchParams.get("dateBasis") === "payment" ? "payment" : "visit";
  const dateRangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  useEffect(() => {
    if (isMobile || doctorReadOnly) return undefined;
    let ignore = false;
    api.get("/doctors?includeInactive=1").then(rows => { if (!ignore) setDoctorOptions(rows); }).catch(() => {});
    return () => { ignore = true; };
  }, [doctorReadOnly, isMobile]);
  const requestedBillId = Number(searchParams.get("billId") || 0);
  const requestedBillOpenedRef = useRef(false);
  const refreshKey = useLiveRefreshKey();
  const [activeView, setActiveView] = useState(searchParams.get("status") === "paid" ? "paid" : searchParams.get("view") === "invoices" && !searchParams.has("status") ? "all" : "pending");
  const [searchText, setSearchText] = useState(
    searchParams.get("q") || (Number.isInteger(requestedBillId) && requestedBillId > 0 ? String(requestedBillId) : ""),
  );
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);
  const [billTotal, setBillTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [totals, setTotals] = useState({ total_billed: 0, paid_amount: 0, unpaid_amount: 0 });
  const [paymentBill, setPaymentBill] = useState(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (isMobile) return;
    const next = new URLSearchParams(searchParams);
    const values = { q: searchText, doctorId: doctorFilter, dateFrom, dateTo, preset: datePreset,
      ageBucket, status: activeView === "pending" ? "unpaid" : activeView === "paid" ? "paid" : "" };
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (doctorReadOnly) next.set("view", "invoices");
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [isMobile, searchText, doctorFilter, dateFrom, dateTo, datePreset, ageBucket, activeView, doctorReadOnly, searchParams, setSearchParams]);

  const openPayment = useCallback(async (bill) => {
    if (doctorReadOnly) return;
    try {
      setPaymentBill(await api.get(`/billing/${bill.id}`));
    } catch (error) {
      toast.error(error.message || "The invoice could not be opened.");
    }
  }, [doctorReadOnly]);


  useEffect(() => {
    let ignore = false;
    const timeout = window.setTimeout(async () => {
      if (dateRangeInvalid) { setLoading(false); return; }
      setLoading(true); setLoadError("");
      try {
        const query = new URLSearchParams({ paginated: "1", limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
        if (activeView === "pending") query.set("status", "unpaid");
        if (activeView === "paid") query.set("status", "paid");
        if (searchText.trim()) query.set("search", searchText.trim());
        const summaryQuery = new URLSearchParams({ paginated: "1", limit: "1", offset: "0" });
        for (const [key, value] of Object.entries({ doctorId: doctorFilter, dateFrom, dateTo, dateBasis })) {
          if (value) { query.set(key, value); summaryQuery.set(key, value); }
        }
        if (ageBucket && activeView === "pending") query.set("ageBucket", ageBucket);
        if (searchParams.get("patientId")) query.set("patientId", searchParams.get("patientId"));
        const [billingData, summaryData] = await Promise.all([
          api.get(`/billing?${query.toString()}`),
          api.get(`/billing/patient-summary?${summaryQuery.toString()}`),
        ]);
        if (ignore) return;
        const rows = Array.isArray(billingData) ? billingData : (billingData?.bills || []);
        setBills(rows);
        setBillTotal(Array.isArray(billingData) ? rows.length : Number(billingData?.total || 0));
        setTotals(Array.isArray(summaryData)
          ? summaryData.reduce((result, patient) => ({
              total_billed: result.total_billed + Number(patient.total_billed || 0),
              paid_amount: result.paid_amount + Number(patient.paid_amount || 0),
              unpaid_amount: result.unpaid_amount + Number(patient.unpaid_amount || 0),
            }), { total_billed: 0, paid_amount: 0, unpaid_amount: 0 })
          : (summaryData?.totals || { total_billed: 0, paid_amount: 0, unpaid_amount: 0 }));
      } catch (error) {
        if (!ignore) setLoadError(error.message || "Payment follow-up could not be loaded.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }, 250);
    return () => { ignore = true; window.clearTimeout(timeout); };
  }, [activeView, page, refreshKey, reloadToken, searchText, doctorFilter, dateFrom, dateTo, dateBasis, dateRangeInvalid, ageBucket, searchParams]);

  useEffect(() => { setPage(0); }, [activeView, searchText, doctorFilter, dateFrom, dateTo, ageBucket]);

  useEffect(() => {
    if (doctorReadOnly || requestedBillOpenedRef.current || loading || !Number.isInteger(requestedBillId) || requestedBillId <= 0) return;
    const bill = bills.find((row) => Number(row.id) === requestedBillId);
    if (!bill) return;
    requestedBillOpenedRef.current = true;
    if (bill.status === "unpaid" && !bill.payment_block && !bill.fee_review_required) void openPayment(bill);
  }, [bills, loading, requestedBillId, doctorReadOnly, openPayment]);

  const viewTitle = useMemo(() => {
    if (activeView === "pending") return doctorReadOnly ? "Outstanding invoices" : "Payments to follow up";
    if (activeView === "paid") return "Paid invoices";
    return "All issued invoices";
  }, [activeView, doctorReadOnly]);


  async function recordPayment(payload) {
    if (doctorReadOnly || !paymentBill || paymentBusy) return;
    setPaymentBusy(true);
    try {
      await api.patch(`/billing/${paymentBill.id}/pay`, payload);
      toast.success(Number(payload.amount) < outstandingAmount(paymentBill) ? "Partial payment recorded. The balance remains open." : "Payment recorded in the transaction ledger.");
      setPaymentBill(null);
      setReloadToken((value) => value + 1);
    } catch (error) {
      toast.error(error.message || "Payment could not be recorded.");
    } finally {
      setPaymentBusy(false);
    }
  }

  async function openInvoicePdf(bill) {
    try {
      const detail = bill.items ? bill : await api.get(`/billing/${bill.id}`);
      const { shareOrDownloadBillPdf } = await import("../lib/billPdf.js");
      await shareOrDownloadBillPdf(detail);
    } catch (error) {
      toast.error(error.message || "The invoice PDF could not be created.");
    }
  }

  return (
    <div className="desktop-finance payment-follow-up mx-auto w-full max-w-7xl space-y-5">
      {!isMobile ? <PatientWorkspaceHeader inlineActions title={doctorReadOnly ? "Issued invoices" : "Payment follow-up"}
        subtitle={doctorReadOnly ? "Invoices for your consultations." : "Find issued invoices and collect outstanding balances."}
        role={user.role} onRefresh={() => setReloadToken(value => value + 1)} refreshing={loading} refreshLabel="Refresh invoices"
        actions={<Link to="/billing" className="finance-control finance-control-primary">Raise an invoice</Link>} /> : (
      <PageHeader eyebrow="Operator workspace" title="Payment follow-up" description="Collect outstanding payments and find every issued invoice without mixing this work with new billing." actions={<Link to="/billing" className="inline-flex min-h-11 items-center rounded-xl bg-[#17666a] px-4 text-sm font-black text-white">Raise an invoice</Link>} />
      )}

      {!loadError && !dateRangeInvalid && <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <BillingStat icon={DollarSign} label="Total issued" value={formatCurrency(totals.total_billed)} />
        <BillingStat icon={CreditCard} label="Collected" value={formatCurrency(totals.paid_amount)} tone="emerald" />
        <BillingStat icon={ReceiptText} label="Still due" value={formatCurrency(totals.unpaid_amount)} tone="amber" />
      </div>
      {!isMobile && <p className="finance-summary-note">Totals for {doctorReadOnly || doctorFilter ? "the selected doctor" : "all doctors"} · {dateBasis === "payment" ? "payment" : "visit"} dates.</p>}
      </div>}

      <section className="rounded-[26px] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="finance-tabs flex overflow-x-auto rounded-xl bg-slate-100 p-1">
            {[["pending", "Pending payments"], ["paid", "Paid invoices"], ["all", "All issued"]].map(([value, label]) => (
              <button key={value} type="button" aria-pressed={activeView === value} onClick={() => setActiveView(value)} className={cx("min-h-11 whitespace-nowrap rounded-lg px-4 text-sm font-black transition", activeView === value ? "bg-white text-[#17666a] shadow-sm" : "text-slate-500 hover:text-slate-800")}>{label}</button>
            ))}
          </div>
          <label className="relative block w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input aria-label="Search invoices" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Patient, OCS, invoice or doctor" className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 font-semibold outline-none focus:border-[#2aa7a0] focus:bg-white" />
          </label>
        </div>

        {!isMobile && <div className="finance-filter-row">
          {!doctorReadOnly && <label>Doctor<select aria-label="Invoice doctor" value={doctorFilter} onChange={event => setDoctorFilter(event.target.value)}><option value="">All doctors</option>
            {doctorOptions.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.full_name}{doctor.is_active ? "" : " (inactive)"}</option>)}</select></label>}
          <label>Date range<select aria-label="Invoice date range" value={datePreset} onChange={event => {
            const preset = event.target.value; setDatePreset(preset);
            if (preset === "all") { setDateFrom(""); setDateTo(""); }
            else if (preset !== "custom") { setDateTo(todayInputValue()); setDateFrom(dayjs(todayInputValue()).subtract(preset === "today" ? 0 : preset === "week" ? 6 : 29, "day").format("YYYY-MM-DD")); }
          }}><option value="all">All dates</option><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="custom">Custom dates</option></select></label>
          <label>{dateBasis === "payment" ? "Payment" : "Visit"} from<input type="date" aria-label="Invoice date from" value={dateFrom} max={dateTo || undefined} onChange={event => { setDatePreset("custom"); setDateFrom(event.target.value); }} /></label>
          <label>{dateBasis === "payment" ? "Payment" : "Visit"} to<input type="date" aria-label="Invoice date to" value={dateTo} min={dateFrom || undefined} onChange={event => { setDatePreset("custom"); setDateTo(event.target.value); }} /></label>
          {activeView === "pending" && <label>Visit age<select aria-label="Outstanding visit age" value={ageBucket} onChange={event => setAgeBucket(event.target.value)}><option value="">Any age</option><option value="today">Today</option><option value="days_1_7">1–7 days</option><option value="days_8_30">8–30 days</option><option value="over_30">Over 30 days</option></select></label>}
        </div>}
        <div className="mt-5">
          <h2 className="text-xl font-black text-slate-950">{viewTitle}</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">{billTotal} matching invoice{billTotal === 1 ? "" : "s"}</p>
        </div>

        {dateRangeInvalid || loadError ? <div role="alert" className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">{dateRangeInvalid ? "Choose an end date on or after the start date." : loadError}
          {!dateRangeInvalid && <button type="button" className="ml-3 underline" onClick={() => setReloadToken(value => value + 1)}>Retry</button>}</div> : loading ? (
          <div className="py-12"><LoadingState label="Loading invoices" /></div>
        ) : bills.length ? (
          <>
            <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 md:block">
              <div className="overflow-x-auto">
                <table className="payment-table min-w-[860px] w-full text-left">
                  <colgroup><col style={{width:"20%"}} /><col style={{width:"18%"}} /><col style={{width:"15%"}} /><col style={{width:"14%"}} /><col style={{width:"13%"}} /><col style={{width:"20%"}} /></colgroup>
                  <thead className="bg-slate-50 text-xs font-bold uppercase tracking-[0.14em] text-slate-500"><tr><th className="px-4 py-3">Patient</th><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Doctor</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
                  <tbody>
                    {bills.map((bill) => (
                      <tr key={bill.id} className="border-t border-slate-100">
                        <td className="px-4 py-4"><p className="font-black text-slate-950">{bill.patient_name}</p><p className="mt-1 text-xs font-semibold text-slate-500">{bill.patient_identifier || "No OCS number"}</p></td>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-600"><p>{invoiceReference(bill)}</p><p className="mt-1 text-xs text-slate-400">{formatDate(bill.consultation_date)}</p>{bill.status === "unpaid" && <span className="payment-age">{Math.max(0, dayjs(todayInputValue()).diff(dayjs(String(bill.consultation_date).slice(0, 10)), "day"))} days since visit</span>}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-slate-600">{bill.doctor_name}</td>
                        <td className="px-4 py-4"><p className="font-black text-slate-950">{formatCurrency(bill.total_amount)}</p>{bill.status === "unpaid" ? <p className="mt-1 text-xs font-bold text-amber-700">Due {formatCurrency(outstandingAmount(bill))}</p> : null}</td>
                        <td className="px-4 py-4"><StatusBadge value={bill.payment_state || bill.status} />{bill.payment_date ? <p className="mt-1 text-xs text-slate-500">{formatPaymentMethod(bill.payment_method)} · {formatDate(bill.payment_date)}</p> : null}</td>
                        <td className="px-4 py-4"><div className="payment-row-actions flex justify-end gap-2"><Link to={`/billing?billId=${bill.id}`} className="finance-control min-h-10 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700">View invoice</Link>{!doctorReadOnly && bill.status === "unpaid" ? <button type="button" disabled={bill.payment_block || bill.fee_review_required} onClick={() => openPayment(bill)} className="min-h-10 rounded-xl bg-[#17666a] px-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">{bill.payment_block || bill.fee_review_required ? "Needs billing review" : "Record payment"}</button> : null}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 space-y-3 md:hidden">
              {bills.map((bill) => (
                <article key={bill.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-black text-slate-950">{bill.patient_name}</p><p className="mt-1 text-xs font-semibold text-slate-500">{invoiceReference(bill)} · {bill.doctor_name}</p></div><StatusBadge value={bill.payment_state || bill.status} /></div>
                  <div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-xl font-black text-slate-950">{formatCurrency(bill.total_amount)}</p>{bill.status === "unpaid" ? <p className="mt-1 text-xs font-bold text-amber-700">Due {formatCurrency(outstandingAmount(bill))}</p> : null}</div><p className="text-xs font-semibold text-slate-500">{formatDate(bill.consultation_date)}</p></div>
                  <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => openInvoicePdf(bill)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">View invoice</button>{bill.status === "unpaid" ? <button type="button" disabled={bill.payment_block || bill.fee_review_required} onClick={() => openPayment(bill)} className="min-h-11 rounded-xl bg-[#17666a] px-3 text-sm font-black text-white disabled:bg-slate-300">Record payment</button> : <Link to={`/patients/${bill.patient_id}`} className="flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">Open patient</Link>}</div>
                </article>
              ))}
            </div>

            {billTotal > PAGE_SIZE ? <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm font-bold text-slate-600"><span>{page * PAGE_SIZE + 1}–{Math.min(billTotal, (page + 1) * PAGE_SIZE)} of {billTotal}</span><div className="flex gap-2"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="min-h-10 rounded-xl border border-slate-200 px-3 disabled:opacity-40">Previous</button><button type="button" disabled={(page + 1) * PAGE_SIZE >= billTotal} onClick={() => setPage((value) => value + 1)} className="min-h-10 rounded-xl border border-slate-200 px-3 disabled:opacity-40">Next</button></div></div> : null}
          </>
        ) : (
          <div className="mt-4"><EmptyState icon={FileText} title={activeView === "pending" ? "No pending payments" : "No invoices found"} description={activeView === "pending" ? "All issued invoices are currently settled." : "Try another patient, invoice number, or doctor."} /></div>
        )}
      </section>

      {!doctorReadOnly && paymentBill ? <PaymentModal key={paymentBill.id} bill={paymentBill} busy={paymentBusy} onClose={() => !paymentBusy && setPaymentBill(null)} onConfirm={recordPayment} /> : null}
    </div>
  );
}
