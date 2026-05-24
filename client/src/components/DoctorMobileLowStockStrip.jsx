import { Link } from "react-router-dom";

export default function DoctorMobileLowStockStrip({ lowStockCount }) {
  if (!lowStockCount || lowStockCount === 0) {
    return null;
  }

  return (
    <Link
      to="/inventory?context=my"
      className="animate-fade-in mb-4 flex w-full items-center gap-3 rounded-2xl border border-rose-100/80 bg-rose-50/70 p-3.5 shadow-sm transition active:scale-[0.99]"
    >
      <div className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
      </div>

      <div className="flex w-full items-center justify-between gap-3">
        <span className="text-xs font-bold tracking-wide text-gray-800">
          {lowStockCount} items are currently low in your bag.
        </span>
        <span className="shrink-0 rounded-lg bg-rose-100/60 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-rose-600">
          Action Needed
        </span>
      </div>
    </Link>
  );
}
