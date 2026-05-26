import { Link } from "react-router-dom";

function LowStockBanner({ alert, variant = "doctor" }) {
  if (!alert?.triggered) {
    return null;
  }

  const count = Number(alert.total_items || 0);
  const isDoctor = variant === "doctor";

  return (
    <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4" role="alert">
      <p className="text-xs font-bold uppercase tracking-wider text-rose-700">Low stock alert</p>
      <p className="mt-1 text-sm font-semibold text-rose-900">
        {isDoctor
          ? `${count} item${count === 1 ? "" : "s"} at or below par level in your kit.`
          : `${count} OCS stock item${count === 1 ? "" : "s"} at or below par level.`}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-rose-700">
        {isDoctor
          ? "Restock now to bring each item back to full par. Enable push in the menu for background alerts."
          : "Review warehouse inventory and restock items. Enable push in the menu for background alerts."}
      </p>
      <Link
        to={isDoctor ? "/inventory?context=my&restock=alert" : "/inventory"}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white transition active:bg-[#3aa6a1]"
      >
        {isDoctor ? "Restock now" : "Review inventory"}
      </Link>
    </div>
  );
}

export default LowStockBanner;
