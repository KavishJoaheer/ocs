import { RefreshCw, Search, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import PushNotificationBanner from "../PushNotificationBanner.jsx";

const alerts = [
  ["low", "Low stock"], ["out", "Out of stock"], ["missing", "Needs expiry"],
  ["near", "Near expiry"], ["expired", "Expired"],
];

export default function MobileDoctorInventory({
  search, setSearch, doctorContext, onDoctorContextChange, stockKind, onStockKindChange,
  folders, selectedView, onSelectedViewChange, folderCounts, itemCount,
  counts, filters, onFilter, refreshing, onRefresh, scopeLoading, children,
}) {
  const services = stockKind === "services";
  useEffect(() => {
    // Clip horizontal overflow without creating an ancestor scroll container;
    // search must stick to the phone viewport as the stock list scrolls.
    const nodes = [document.documentElement, document.body];
    nodes.forEach(node => node.classList.add("doctor-mobile-inventory-page"));
    return () => nodes.forEach(node => node.classList.remove("doctor-mobile-inventory-page"));
  }, []);
  return <section className="doctor-mobile-inventory mx-auto flex w-full min-w-0 max-w-md flex-col gap-3 text-[#173f4a]">
    <header className="rounded-[28px] border border-[#d5e9e3] bg-gradient-to-r from-[#e3f5f0] to-[#fff9ed] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">Inventory</h1>
        <div className="flex items-center gap-1">
          <PushNotificationBanner compact role="doctor" /><AppUpdateBanner compact />
          <button type="button" aria-label="Refresh inventory" disabled={refreshing || scopeLoading} onClick={onRefresh} className="inline-flex size-11 items-center justify-center rounded-full border border-[#d5e4e1] bg-white text-[#376168] disabled:opacity-50"><RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? "animate-spin" : ""}`} /></button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <nav aria-label="Inventory location" className="flex min-w-0 flex-1 gap-1 rounded-full bg-white/70 p-1">
          {[["my", "My bag"], ["ocs", "OCS depot"]].map(([id, label]) => <button key={id} type="button" aria-pressed={doctorContext === id} onClick={() => onDoctorContextChange(id)} className={`min-h-11 min-w-0 flex-1 rounded-full px-2 ${doctorContext === id ? "bg-[#137b80] text-white" : "text-[#376168]"}`}>{label}</button>)}
        </nav>
        {!services ? <Link to="/supply-requests" aria-label="Request supply" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-[#137b80] px-3 font-semibold text-white"><Truck className="size-4" aria-hidden="true" />Request</Link> : null}
      </div>
    </header>

    <div className="doctor-inventory-search sticky top-0 z-20 rounded-full bg-[#f2faf7] py-1">
      <label className="relative block min-w-0">
        <span className="sr-only">Search inventory items</span><Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#657c82]" />
        <input aria-label="Search inventory items" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search items" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" className="h-11 w-full min-w-0 rounded-full border border-[#cde2de] bg-white pl-10 pr-10 text-base outline-none focus:border-[#137b80]" />
        {search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-0 top-0 inline-flex size-11 items-center justify-center rounded-full text-[#376168]">×</button> : null}
      </label>
    </div>
    <div className="flex min-w-0 items-center gap-2">
      <nav aria-label="Inventory item type" className="flex min-w-0 flex-1 gap-1">
        {[["stock", "Physical stock"], ["services", "Services"]].map(([id, label]) => <button key={id} type="button" aria-pressed={stockKind === id} onClick={() => onStockKindChange(id)} className={`min-h-11 min-w-0 flex-1 rounded-full border px-2 leading-tight ${stockKind === id ? "border-[#137b80] bg-[#137b80] text-white" : "border-[#d5e4e1] bg-white text-[#376168]"}`}>{label}</button>)}
      </nav>
      <select aria-label="Inventory category" disabled={scopeLoading} value={selectedView || "all"} onChange={event => onSelectedViewChange(event.target.value)} className="min-h-11 w-28 min-w-0 rounded-full border border-[#d5e4e1] bg-white px-2 text-[#376168]">
        <option value="all">All ({scopeLoading ? "…" : itemCount})</option>
        {folders.map(folder => <option key={folder.id} value={String(folder.id)}>{folder.name} ({scopeLoading ? "…" : folderCounts.get(String(folder.id)) || 0})</option>)}
      </select>
    </div>
    {!services ? <nav aria-label="Stock alerts" className="ocs-h-scroll pb-1">
      {alerts.map(([key, label]) => <button key={key} type="button" disabled={scopeLoading} aria-pressed={Boolean(filters[key])} aria-label={`${label}: ${scopeLoading ? "loading" : counts[key]}`} onClick={() => onFilter(key)} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3 disabled:opacity-50 ${filters[key] ? "border-[#137b80] bg-[#137b80] text-white" : counts[key] > 0 ? key === "near" || key === "missing" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-rose-200 bg-rose-50 text-rose-800" : "border-[#d5e4e1] bg-white text-[#376168]"}`}>{label}<strong className="rounded-full bg-white/75 px-2 py-0.5 text-xs tabular-nums text-[#376168]">{scopeLoading ? "…" : counts[key]}</strong></button>)}
    </nav> : null}
    {services ? <p className="text-xs leading-5 text-[#5b7379]">Service prices for reference. Services do not use bag stock.</p> : null}
    {children}
  </section>;
}
