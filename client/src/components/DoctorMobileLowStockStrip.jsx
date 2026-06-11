import { Link } from "react-router-dom";

export default function DoctorMobileLowStockStrip({ lowStockCount }) {
  if (!lowStockCount || lowStockCount === 0) {
    return null;
  }

  return (
    <Link
      to="/inventory?context=my"
      className="animate-fade-in mb-4 flex w-full items-center gap-3 rounded-2xl border border-slate-100 border-l-4 border-l-ocs-yellow bg-white p-3.5 shadow-sm transition active:scale-[0.99]"
    >
      <div className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ocs-yellow opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ocs-yellow shadow-[0_0_8px_rgba(247,186,36,0.5)]" />
      </div>

      <div className="flex w-full items-center justify-between gap-3">
        <span className="text-xs font-bold tracking-wide text-slate-700">
          {lowStockCount} items are currently low in your bag.
        </span>
        <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
          Action Needed
        </span>
      </div>
    </Link>
  );
}
