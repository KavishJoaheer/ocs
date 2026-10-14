import { ClipboardList, Ellipsis, Plus, RefreshCw, Search } from "lucide-react";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import PushNotificationBanner from "../PushNotificationBanner.jsx";
import LegacyReconciliationNotice from "../LegacyReconciliationNotice.jsx";
import { canDoctorCancelRequest, canDoctorEditRequest, canDoctorRequestChanges, describeSupplyRequestItems, formatSupplyRequestCollectionDay, isLegacyReconciliationRequired, supplyRequestStatusLabel, supplyRequestStatusTone } from "../../lib/supplyRequests.js";
import "./supplyWorkspace.css";

export default function DoctorDesktopSupplyRequests({
  tab, onTabChange, requests, history, historyTotal, historyPage, historyPages,
  historyCompletedCount, historyCancelledCount, historyItemCounts, historyFrom, historyTo,
  onHistoryFrom, onHistoryTo, onPrevious, onNext, onExport,
  search, onSearch, loading, error, catalogLoading, refreshing, onRefresh,
  newRequestRef, onCreate, onEdit, onAmend, onCancel, onDetails, updatingId,
}) {
  const historical = tab === "history";
  const needle = search.trim().replace(/^#/, "").toLowerCase();
  const requestNumber = /^#?\d+$/.test(search.trim());
  const rows = historical ? history : requests.filter(request => !needle || (requestNumber ? Number(request.id) === Number(needle) : String(request.id).includes(needle) || (request.items || []).some(item => item.item_name.toLowerCase().includes(needle))));
  return <section className="supply-workspace w-full space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] bg-gradient-to-r from-[#e3f5f0] to-[#fff9ed] px-6 py-5">
      <div><p className="text-xs font-semibold text-[#137b80]">Supply workspace</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#173f4a]">My Supply Requests</h1></div>
      <div className="flex items-center gap-2">
        <button ref={newRequestRef} type="button" disabled={catalogLoading} onClick={onCreate} className="supply-primary inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-white disabled:opacity-50"><Plus className="size-4" aria-hidden="true" />New supply request</button>
        <PushNotificationBanner compact role="doctor" /><AppUpdateBanner compact />
        <button type="button" aria-label="Refresh supply requests" disabled={refreshing} onClick={onRefresh} className="inline-flex size-11 items-center justify-center rounded-full border border-[#d5e4e1] bg-white text-[#376168] disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? "animate-spin" : ""}`} /></button>
      </div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Supply request views" className="flex gap-2">
        {["active", "history"].map(id => <button key={id} type="button" aria-pressed={tab === id} onClick={() => onTabChange(id)} className={`min-h-11 rounded-full border px-4 ${tab === id ? "border-[#137b80] bg-[#137b80] text-white" : "border-[#d5e4e1] bg-white text-[#376168]"}`}>{id === "active" ? `Active (${requests.length})` : "History"}</button>)}
      </nav>
      <label className="relative w-80 max-w-full"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#657c82]" /><input aria-label="Search supply requests" placeholder="Find request number or item" value={search} onChange={event => onSearch(event.target.value)} className="min-h-11 w-full rounded-full border border-[#d5e4e1] bg-white pl-10 pr-3 text-sm text-[#173f4a]" /></label>
    </div>
    {historical ? <div className="flex flex-wrap items-end justify-between gap-3 rounded-[26px] border border-[#d5e4e1] bg-white px-4 py-3">
      <div className="flex items-end gap-3"><label className="text-xs font-semibold text-[#5b7379]">Date from<input type="date" value={historyFrom} onChange={event => onHistoryFrom(event.target.value)} className="mt-1 block min-h-11 rounded-full border border-[#d5e4e1] px-3 text-[#173f4a]" /></label><label className="text-xs font-semibold text-[#5b7379]">Date to<input type="date" value={historyTo} onChange={event => onHistoryTo(event.target.value)} className="mt-1 block min-h-11 rounded-full border border-[#d5e4e1] px-3 text-[#173f4a]" /></label></div>
      <p className="text-sm text-[#376168]"><strong>{historyTotal}</strong> requests · <strong>{historyCompletedCount}</strong> completed · <strong>{historyCancelledCount}</strong> cancelled</p>
      <button type="button" disabled={loading} onClick={onExport} className="min-h-11 rounded-full border border-[#d5e4e1] px-4 text-[#376168] disabled:opacity-50">Export CSV</button>
    </div> : null}
    {loading ? <p role="status" className="rounded-[26px] border border-[#d5e4e1] bg-white px-5 py-8 text-[#5b7379]">Loading {historical ? "history" : "supply requests"}…</p> : error ? <div role="alert" className="rounded-[26px] border border-rose-200 bg-rose-50 p-4 text-rose-800">{error}<button type="button" onClick={onRefresh} className="ml-3 min-h-11 rounded-full border border-rose-200 px-4">Retry</button></div> : rows.length ? <div className="space-y-3">
      {rows.map(request => {
        const busy = updatingId === request.id;
        const amendment = request.pending_amendment;
        const declined = !amendment && request.latest_amendment?.status === "rejected" && request.status === "accepted";
        const shortages = (request.fulfilment?.items || []).filter(item => Number(item.shortage_quantity) > 0);
        return <article key={request.id} aria-label={`Supply request ${request.id}`} className="supply-request-row rounded-[26px] border border-[#d5e4e1] bg-white px-4 py-3">
          <div><h2 className="text-sm font-semibold text-[#173f4a]">Request #{request.id}</h2><p className="mt-1 text-xs text-[#5b7379]">Collect {formatSupplyRequestCollectionDay(request.collection_date)}</p><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${supplyRequestStatusTone(request.status)}`}>{supplyRequestStatusLabel(request.status, "doctor")}</span></div>
          <div className="min-w-0"><p className="supply-items-preview text-sm text-[#376168]" title={describeSupplyRequestItems(request.items)}>{describeSupplyRequestItems((request.items || []).slice(0,3))}{request.items?.length > 3 ? ` · +${request.items.length - 3} more` : ""}</p>{request.note ? <p className="mt-1 truncate text-xs text-[#5b7379]" title={request.note}>{request.note}</p> : null}{request.cancelled_reason ? <p className="mt-1 text-xs text-rose-700">Reason: {request.cancelled_reason}</p> : null}</div>
          <div className="flex items-center justify-end gap-2">
            {!historical && canDoctorEditRequest(request) ? <button type="button" disabled={busy} onClick={() => onEdit(request)} className="supply-primary min-h-11 rounded-full px-4 text-white disabled:opacity-50">Edit request</button> : null}
            {!historical && canDoctorRequestChanges(request) ? <button type="button" disabled={busy} onClick={() => onAmend(request)} className="supply-primary min-h-11 rounded-full px-4 text-white disabled:opacity-50">Request Changes</button> : null}
            <button type="button" onClick={() => onDetails(request.id)} className="min-h-11 rounded-full border border-[#d5e4e1] px-4 text-[#376168]">View details</button>
            {!historical && canDoctorCancelRequest(request) ? <details className="relative"><summary aria-label={`More actions for request ${request.id}`} className="inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-full border border-[#d5e4e1] text-[#376168]"><Ellipsis className="size-4" aria-hidden="true" /></summary><div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-2xl border border-[#d5e4e1] bg-white p-1 shadow-lg"><button type="button" disabled={busy} onClick={event => { event.currentTarget.closest("details").open = false; onCancel(request); }} className="min-h-11 w-full rounded-full px-3 text-left text-rose-700">Cancel request</button></div></details> : null}
          </div>
          {amendment || declined || shortages.length || isLegacyReconciliationRequired(request) ? <div className="col-span-3 space-y-2">
            {amendment ? <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900"><strong>Changes Awaiting Review</strong> · {describeSupplyRequestItems(amendment.items)} · {formatSupplyRequestCollectionDay(amendment.proposed_collection_date)}</p> : null}
            {declined ? <p className="rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-800"><strong>Change request declined</strong> · {request.latest_amendment.review_reason || "Your accepted request is unchanged."}</p> : null}
            {shortages.length ? <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900">Shortage: {shortages.map(item => `${item.item_name} (${item.shortage_quantity})`).join(" · ")}</p> : null}
            {isLegacyReconciliationRequired(request) ? <LegacyReconciliationNotice request={request} compact /> : null}
          </div> : null}
        </article>;
      })}
    </div> : <div className="rounded-[26px] border border-dashed border-[#d5e4e1] bg-white p-8 text-center text-[#5b7379]"><ClipboardList aria-hidden="true" className="mx-auto mb-2 size-7 text-[#137b80]" /><p>{search || historyFrom || historyTo ? "No requests match your filters." : historical ? "No collected or cancelled requests yet." : "No active supply requests."}</p></div>}
    {historical && historyPages > 1 ? <nav aria-label="Supply history pages" className="flex items-center justify-between"><button type="button" disabled={historyPage <= 1} onClick={onPrevious} className="min-h-11 rounded-full border border-[#d5e4e1] bg-white px-4 disabled:opacity-40">Previous</button><span className="text-xs text-[#5b7379]">Page {historyPage} of {historyPages}</span><button type="button" disabled={historyPage >= historyPages} onClick={onNext} className="min-h-11 rounded-full border border-[#d5e4e1] bg-white px-4 disabled:opacity-40">Next</button></nav> : null}
    {historical && historyItemCounts.length ? <details className="rounded-[26px] border border-[#d5e4e1] bg-white px-4 py-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-[#376168]">Most requested items</summary><ul className="mt-2 space-y-2 text-sm text-[#5b7379]">{historyItemCounts.slice(0,8).map(row => <li key={row.item_name} className="flex justify-between gap-4"><span>{row.item_name}</span><span>{row.request_count} requests · qty {row.total_quantity || 0}{row.total_fulfilled != null ? ` / ${row.total_fulfilled} fulfilled` : ""}{row.shortage_quantity ? ` · shortage ${row.shortage_quantity}` : ""}</span></li>)}</ul></details> : null}
  </section>;
}
