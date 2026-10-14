import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import toast from "react-hot-toast";
import PatientWorkspaceHeader from "../components/patient-workspace/PatientWorkspaceHeader.jsx";
import LoadingState from "../components/LoadingState.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { formatCurrency, formatDate, formatPaymentMethod } from "../lib/format.js";
import "../components/finance-workspace/financeWorkspace.css";

export default function InvoiceDetailPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const billId = Number(params.get("billId"));
  const [bill, setBill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    let ignore = false;
    setLoading(true); setBill(null); setError("");
    if (!Number.isInteger(billId) || billId <= 0) { setError("Choose a valid invoice."); setLoading(false); return undefined; }
    api.get(`/billing/${billId}`).then(result => { if (!ignore) setBill(result); })
      .catch(failure => { if (!ignore) setError(failure.message || "The invoice could not be loaded."); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [billId, refreshToken]);
  useEffect(() => { document.title = "Invoice details · OCS Médecins"; }, []);
  async function downloadInvoice() {
    setDownloading(true);
    try {
      const { buildBillPdf } = await import("../lib/billPdf.js");
      const reference = bill.invoice_number || `OCS-INV-${String(bill.id).padStart(8, "0")}`;
      buildBillPdf(bill).save(`${reference.replace(/[^a-z0-9_-]+/gi, "-")}.pdf`);
    } catch (failure) { toast.error(failure.message || "The invoice PDF could not be created."); }
    finally { setDownloading(false); }
  }
  const canRecordPayment = user.role === "operator" && bill?.finalized_at && bill.status === "unpaid"
    && !bill.voided_at && !bill.consultation_voided_at && !bill.payment_block && !bill.fee_review_required;
  const backToList = user.role === "operator" ? "/operator/pending-payment" : "/billing?view=invoices";
  return <div className="desktop-finance space-y-5">
    <PatientWorkspaceHeader inlineActions title="Invoice details" subtitle={bill ? bill.invoice_number || `Bill #${bill.id}` : "View the selected invoice."}
      role={user.role} onRefresh={() => setRefreshToken(value => value + 1)} refreshing={loading} refreshLabel="Refresh invoice"
      actions={<><button type="button" className="finance-control" onClick={() => window.history.state?.idx > 0 ? navigate(-1) : navigate(backToList)}><ArrowLeft size={16} />Back</button>
        <Link className="finance-control" to={backToList}>Invoice list</Link>
        {bill?.finalized_at && <button type="button" className="finance-control" disabled={downloading} onClick={downloadInvoice}><Download size={16} />{downloading ? "Preparing…" : "Download invoice"}</button>}</>} />
    {loading ? <LoadingState label="Loading invoice" /> : error ? <div role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : bill && <>
      <div className="flex flex-wrap items-center gap-3"><strong className="text-lg">{bill.patient_name}</strong>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-900">{bill.patient_identifier || "No OCS number"}</span>
        <StatusBadge value={bill.voided_at || bill.consultation_voided_at ? "voided" : !bill.finalized_at ? "draft" : bill.payment_state || bill.status} />
        <span className="text-sm text-[#5d767e]">{bill.doctor_name} · Visit {formatDate(bill.consultation_date)}</span>
      </div>
      {bill.payment_block && <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{bill.payment_block.reason || "This invoice needs billing review before payment can be recorded."}</p>}
      <div className="invoice-detail-grid">
        <div className="space-y-5">
          <section className="overflow-hidden border bg-white">
            <h2 className="p-5 text-lg font-bold">Invoice items</h2>
            <table className="invoice-detail-table"><thead><tr><th>Item</th><th>Qty</th><th>Charged</th></tr></thead>
              <tbody>{(bill.items || []).map((item, index) => <tr key={index}><td>{item.description || item.item_name || "Item"}</td>
                <td>{item.quantity || 1}</td><td>{item.type === "Loss" || item.cost_only ? "Not charged" : formatCurrency(item.amount || 0)}</td></tr>)}</tbody>
            </table>
          </section>
          <section className="border bg-white p-5"><h2 className="mb-3 text-lg font-bold">Payment history</h2>
            {bill.payments?.length ? <ul className="space-y-3">{bill.payments.map(payment => <li key={payment.id} className="flex flex-wrap justify-between gap-2 border-b border-[#e5eeea] pb-3 text-sm">
              <div><strong>{formatPaymentMethod(payment.payment_method)}</strong><p className="mt-1 text-xs text-[#5d767e]">{formatDate(payment.payment_date)} · {payment.recorded_by_name || "OCS"}</p>
                {(payment.external_reference || payment.entry_type === "reversal") && <p className="mt-1 text-xs text-[#5d767e]">{payment.entry_type === "reversal" ? "Reversal · " : ""}{payment.external_reference || payment.reason}</p>}</div>
              <strong>{formatCurrency(payment.amount)}</strong>
            </li>)}</ul> : <p className="text-sm text-[#5d767e]">No payments recorded.</p>}
            {bill.refunds?.length > 0 && <div className="mt-4 border-t border-[#e5eeea] pt-4"><h3 className="mb-2 font-semibold">Credit notes</h3>
              {bill.refunds.map(refund => <p key={refund.id} className="mt-2 text-sm">{refund.credit_note_number || "Credit note"} · {formatDate(refund.refund_date)} · {formatCurrency(refund.amount)}</p>)}
            </div>}
          </section>
        </div>
        <section className="invoice-detail-summary border bg-white" aria-label="Invoice amounts">
          <h2 className="font-bold">Invoice summary</h2>
          <div className="invoice-detail-total"><span className="text-xs text-amber-900">Invoice total</span><strong>{formatCurrency(bill.total_amount)}</strong></div>
          <dl className="space-y-3 text-sm"><div className="flex justify-between gap-2"><dt>Payments received</dt><dd className="font-semibold">{formatCurrency(bill.payment_received_amount)}</dd></div>
            {bill.refunded_amount > 0 && <div className="flex justify-between gap-2"><dt>Credit notes</dt><dd>{formatCurrency(bill.refunded_amount)}</dd></div>}
            <div className="flex justify-between gap-2"><dt>Outstanding</dt><dd className="font-bold text-amber-800">{formatCurrency(bill.payment_balance_amount)}</dd></div>
          </dl>
          {canRecordPayment && <Link className="finance-control finance-control-primary mt-5 w-full" to={`/operator/pending-payment?billId=${bill.id}`}>Record payment</Link>}
          {bill.patient_archived_at ? <p className="mt-4 text-sm text-[#5d767e]">Patient archived</p> : <Link className="finance-control mt-3 w-full" to={`/patients/${bill.patient_id}`}>Open patient</Link>}
          <p className="mt-4 text-xs text-[#5d767e]">{bill.finalized_at ? `Issued ${formatDate(bill.finalized_at)}` : "This is a draft bill."}{bill.source_reference ? ` · Reference ${bill.source_reference}` : ""}</p>
        </section>
      </div>
    </>}
  </div>;
}
