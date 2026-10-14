export default function LinkhamMauritiusHeatmap({ clusters = [] }) {
  const rows = clusters.filter(row => Number(row.recent_count) > 0).sort((a, b) => Number(b.recent_count) - Number(a.recent_count));
  return <div className="min-w-0">
    <p className="mb-3 text-sm text-[#526d75]">Recorded visits by mapped district · last 14 days</p>
    {rows.length ? <ul className="divide-y divide-[#e3eeeb]">{rows.map(row => <li key={row.id} className="flex min-h-12 items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0 break-words font-semibold text-[#173f4a]">{row.name}</span><span className="shrink-0 rounded-full bg-[#edf5f2] px-3 py-1 font-bold text-[#137b80]">{Number(row.recent_count)} visits</span></li>)}</ul> : <p className="py-5 text-sm text-[#526d75]">No recent visits with a mapped district.</p>}
  </div>;
}
