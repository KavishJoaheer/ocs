import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useLiveRefreshKey } from '../hooks/useLiveRefreshKey.js';
import { api } from '../lib/api.js';

const money = value => new Intl.NumberFormat('en-MU',{style:'currency',currency:'MUR'}).format(Number(value || 0));
const countStatusLabel = {
  draft: "Not started",
  in_progress: "In progress",
  recount_required: "Recount required",
  submitted: "Awaiting approval",
  approved: "Approved",
};
export default function FinancialReconciliation({ report = null, refreshToken = null }) {
  const {user}=useAuth();
  const refreshKey=useLiveRefreshKey();
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  const [cancellingId,setCancellingId]=useState(null);
  const [hiddenCountIds,setHiddenCountIds]=useState([]);
  useEffect(()=>{
    if (report) return;
    let ignore=false;
    api.get('/billing/reconciliation').then(result=>{if(!ignore){setData(result);setError('');}}).catch(()=>{if(!ignore)setError('Financial review could not refresh. Reload before relying on the review count.');});
    return ()=>{ignore=true;};
  },[report,refreshKey,refreshToken,user?.id]);
  const result=report || data;
  if (!result && !error) return null;
  const stockNeedsAttention = Boolean(result?.stock_readiness && (
    result.stock_readiness.unpriced_products ||
    result.stock_readiness.zero_sale_price_products ||
    result.stock_readiness.expiry_unverified_products ||
    result.stock_readiness.unfinished_counts ||
    result.stock_readiness.deliveries_without_invoice_count
  ));
  return <details open={Boolean(error || result?.issue_count || stockNeedsAttention)} className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">
    <summary className="min-h-11 cursor-pointer text-sm font-semibold">Financial review {result ? `· ${result.issue_count} record${result.issue_count===1?'':'s'} to review` : ''}</summary>
    {error && <p role="alert" className="mt-2 text-sm text-amber-800">{error}</p>}
    {result && <div className="mt-3 space-y-4">
      <p className="text-sm">{result.scope}</p>
      {result.as_of && <p className="text-xs text-slate-500">Updated {new Date(result.as_of).toLocaleString('en-GB',{timeZone:'Indian/Mauritius'})} (Mauritius)</p>}
      {result.issues.length ? <ul className="divide-y divide-slate-100">{result.issues.map((issue,index)=><li key={`${issue.type}-${issue.movement_id || issue.bill_ids.join('-')}-${index}`} className="py-3 text-sm">
        <p className="font-semibold">{issue.label}</p>
        <p>Amount linked: {money(issue.amount)}</p>
        <div className="flex flex-wrap gap-3">{issue.bill_ids.map(id=><a key={id} className="inline-flex min-h-11 items-center font-semibold text-teal-700" href={`/billing?billId=${id}`}>Review bill #{id}</a>)}
          {issue.patient_id && <a className="inline-flex min-h-11 items-center font-semibold text-teal-700" href={`/billing?patientId=${issue.patient_id}&create=1`}>Match dispensing to a bill</a>}
        </div>
      </li>)}</ul> : <p className="text-sm">No exceptions detected by these checks. This does not replace a bank reconciliation or physical stock count.</p>}
      {Boolean(result.legacy_estimate_count) && <p className="text-sm">{result.legacy_estimate_count} older stock movements use estimated historical prices. Verify source records before treating these valuations as exact.</p>}
      {result.stock_readiness && user?.role!=='doctor' && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
        <p className="font-semibold">Stock verification · all stock locations</p>
        <p>{result.stock_readiness.unpriced_products} missing cost price · {result.stock_readiness.zero_sale_price_products} missing sale price · {result.stock_readiness.expiry_unverified_products} products with unverified expiry · {Math.max(0, Number(result.stock_readiness.unfinished_counts || 0) - hiddenCountIds.length)} unfinished stock counts</p>
        {Array.isArray(result.stock_readiness.unfinished_count_sessions) && result.stock_readiness.unfinished_count_sessions.length ? (
          <ul className="mt-2 space-y-2">
            {result.stock_readiness.unfinished_count_sessions.filter((session) => !hiddenCountIds.includes(session.id)).map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>Count #{session.id} · {countStatusLabel[session.status] || session.status} · {session.counted_count} of {session.item_count} · {session.location}{session.counter_name ? ` · ${session.counter_name}` : ""}</span>
                <a className="inline-flex min-h-11 items-center font-semibold text-teal-800" href={`/inventory?tab=count&session=${session.id}`}>Open count</a>
                {user?.role === "admin" && session.counted_count === 0 && ["draft", "in_progress"].includes(session.status) ? (
                  <button
                    type="button"
                    disabled={cancellingId === session.id}
                    onClick={() => {
                      setCancellingId(session.id);
                      api.post(`/inventory/stocktake/sessions/${session.id}/cancel`, {})
                        .then(() => {
                          setHiddenCountIds((current) => current.concat(session.id));
                          if (!report) return api.get("/billing/reconciliation");
                          return null;
                        })
                        .then((next) => { if (next) { setData(next); setError(""); } })
                        .catch(() => setError("This empty count could not be cancelled. Open it from inventory."))
                        .finally(() => setCancellingId(null));
                    }}
                    className="inline-flex min-h-11 items-center font-semibold text-amber-950 underline disabled:opacity-50"
                  >
                    {cancellingId === session.id ? "Cancelling…" : "Cancel this empty count"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {Number(result.stock_readiness.unfinished_counts || 0) > (result.stock_readiness.unfinished_count_sessions || []).length ? (
          <p className="mt-1 text-xs">Showing the latest {(result.stock_readiness.unfinished_count_sessions || []).length} unfinished counts.</p>
        ) : null}
        {Number(result.stock_readiness.deliveries_without_invoice_count || 0) > 0 ? (
          <div className="mt-3">
            <p>{result.stock_readiness.deliveries_without_invoice_count} Receive Delivery record{result.stock_readiness.deliveries_without_invoice_count === 1 ? "" : "s"} still need an approved supplier invoice.</p>
            <div className="mt-1 flex flex-col">
              {(result.stock_readiness.deliveries_without_invoice || []).map((delivery) => (
                <a key={delivery.id} className="inline-flex min-h-11 items-center font-semibold text-teal-800" href={`/billing?section=suppliers&shipment=${delivery.id}`}>
                  {delivery.invoice_status === "submitted"
                    ? "Approve invoice for"
                    : delivery.invoice_status === "rejected"
                      ? "Replace rejected invoice for"
                      : "Record invoice for"} Receive Delivery #{delivery.id}{delivery.supplier ? ` · ${delivery.supplier}` : ""}{delivery.delivery_note ? ` · ${delivery.delivery_note}` : ""}
                </a>
              ))}
            </div>
          </div>
        ) : null}
        {user?.role === 'admin' ? <a href="/inventory" className="inline-flex min-h-11 items-center font-semibold text-teal-800">Open inventory: pricing, expiry filters and stock counts →</a> : <p className="mt-2 font-semibold text-amber-900">Ask an inventory administrator to resolve these from supplier records and physical stock.</p>}
        <p className="text-xs">Resolve these from supplier records and physical counts. A recorded zero is not evidence that unknown stock values or losses are zero.</p>
      </div>}
      {result.stock && user?.role!=='doctor' && <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div><p>Net stock sales</p><strong>{money(result.stock.net_sales_rs)}</strong></div>
        <div><p>Cost of stock sold</p><strong>{money(result.stock.sales_cost_rs)}</strong></div>
        <div><p>Stock wastage</p><strong>{money(result.stock.wastage_value_rs)}</strong></div>
        {Number(result.stock.supplier_cost_variance_rs || 0) !== 0 ? (
          <div>
            <p>Supplier price adjustments</p>
            <strong>{money(result.stock.supplier_cost_variance_rs)}</strong>
          </div>
        ) : null}
        {(Number(result.stock.stocktake_shortage_rs || 0) !== 0 || Number(result.stock.stocktake_surplus_rs || 0) !== 0) ? (
          <div className="sm:col-span-3 rounded-xl bg-slate-50 p-3">
            <p>Stock count differences</p>
            <strong>{money(result.stock.stocktake_net_rs)}</strong>
            <p className="mt-1 text-xs">Extra stock {money(result.stock.stocktake_surplus_rs)} · Short stock {money(result.stock.stocktake_shortage_rs)}. A count difference is separate from sales and wastage. The value uses the lot cost recorded on that count or delivery.</p>
          </div>
        ) : null}
        <p className="sm:col-span-3 text-xs">Stock values follow movement dates, include linked reversals, and include billed and unbilled dispensing. They are separate from collected cash. Sales and wastage leave out stock-count differences.</p>
        {result.stock.unclassified_movement_count > 0 && <p className="sm:col-span-3 rounded-xl bg-amber-50 p-3">{result.stock.unclassified_movement_count} movements are corrections or have no sales / wastage classification. Recorded sales and wastage exclude those unknown purposes. <a href="/stock-history" className="font-semibold underline">Review stock history and source records</a>.</p>}
      </div>}
      <p className="text-xs text-slate-500">{result.accounting_note}</p>
    </div>}
  </details>;
}
