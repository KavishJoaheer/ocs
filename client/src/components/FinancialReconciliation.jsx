import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useLiveRefreshKey } from '../hooks/useLiveRefreshKey.js';
import { api } from '../lib/api.js';

const money = value => new Intl.NumberFormat('en-MU',{style:'currency',currency:'MUR'}).format(Number(value || 0));
export default function FinancialReconciliation({ report = null, refreshToken = null }) {
  const {user}=useAuth();
  const refreshKey=useLiveRefreshKey();
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    if (report) return;
    let ignore=false;
    api.get('/billing/reconciliation').then(result=>{if(!ignore){setData(result);setError('');}}).catch(()=>{if(!ignore)setError('Financial review could not refresh. Reload before relying on the review count.');});
    return ()=>{ignore=true;};
  },[report,refreshKey,refreshToken,user?.id]);
  const result=report || data;
  if (!result && !error) return null;
  return <details className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-700">
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
        <p>{result.stock_readiness.unpriced_products} unpriced products · {result.stock_readiness.expiry_unverified_products} products with unverified expiry · {result.stock_readiness.unfinished_counts} unfinished stock counts</p>
        <a href="/inventory" className="inline-flex min-h-11 items-center font-semibold text-teal-800">Open inventory: pricing, expiry filters and stock counts →</a>
        <p className="text-xs">Resolve these from supplier records and physical counts. A recorded zero is not evidence that unknown stock values or losses are zero.</p>
      </div>}
      {result.stock && user?.role!=='doctor' && <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div><p>Net stock sales</p><strong>{money(result.stock.net_sales_rs)}</strong></div>
        <div><p>Cost of stock sold</p><strong>{money(result.stock.sales_cost_rs)}</strong></div>
        <div><p>Stock wastage</p><strong>{money(result.stock.wastage_value_rs)}</strong></div>
        <p className="sm:col-span-3 text-xs">Stock values follow movement dates, include linked reversals, and include billed and unbilled dispensing. They are separate from collected cash.</p>
        {result.stock.unclassified_movement_count > 0 && <p className="sm:col-span-3 rounded-xl bg-amber-50 p-3">{result.stock.unclassified_movement_count} movements are corrections or have no sales / wastage classification. Recorded sales and wastage exclude those unknown purposes. <a href="/stock-history" className="font-semibold underline">Review stock history and source records</a>.</p>}
      </div>}
      <p className="text-xs text-slate-500">{result.accounting_note}</p>
    </div>}
  </details>;
}
