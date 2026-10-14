const alerts = [
  { key: "low", label: "Low stock", color: "rose" },
  { key: "out", label: "Out of stock", color: "rose" },
  { key: "missing", label: "Needs expiry", color: "amber" },
  { key: "near", label: "Near expiry", color: "amber" },
  { key: "expired", label: "Expired", color: "rose" },
];
export default function InventoryStockHealth({ scope, counts, filters, onFilter, loading }) {
  return <section aria-label={`${scope} stock health`} className="rounded-[26px] border border-[#d5e4e1] bg-white px-4 py-3">
    <div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-[#173f4a]">{scope} stock health</h2><span role="status" className="text-xs text-[#5b7379]">{loading ? "Updating stock…" : "Choose an alert to filter"}</span></div>
    <div className="flex flex-wrap gap-2">{alerts.map(({ key, label, color }) => <button key={key} type="button" disabled={loading} aria-label={`${label}: ${loading ? "loading" : counts[key]}`} aria-pressed={Boolean(filters[key])} onClick={() => onFilter(key)} className={`inventory-health-filter inline-flex min-h-11 items-center gap-3 rounded-full border px-3 text-sm font-semibold disabled:opacity-50 ${counts[key] > 0 ? color === "rose" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900" : "border-[#d5e4e1] bg-[#f6faf8] text-[#376168]"}`}><span>{label}</span><strong className="rounded-full bg-white/70 px-2 py-0.5 text-xs tabular-nums text-[#376168]">{loading ? "…" : counts[key]}</strong></button>)}</div>
  </section>;
}
