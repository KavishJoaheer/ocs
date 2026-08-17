import { Link } from "react-router-dom";

function LowStockBanner({ alert, variant = "doctor", compact = false }) {
  if (!alert?.triggered) {
    return null;
  }

  const count = Number(alert.total_items || 0);
  const isDoctor = variant === "doctor";
  const to = isDoctor ? "/inventory?context=my&restock=alert" : "/inventory";

  if (compact) {
    return (
      <Link
        to={to}
        className="flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm transition hover:shadow-md"
        role="alert"
      >
        <span className="text-sm font-semibold text-slate-800">
          {count} below min
        </span>
        <span className="shrink-0 text-xs font-semibold text-ocs-teal">Review inventory</span>
      </Link>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-slate-100 border-l-4 border-l-ocs-yellow bg-white p-4 shadow-sm lg:border-ocs-yellow/30 lg:border-l lg:bg-ocs-yellow/10 lg:shadow-none" role="alert">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 lg:text-ocs-yellow-dark">Low stock alert</p>
      <p className="mt-1 text-sm font-semibold text-slate-700 lg:text-ocs-yellow-dark">
        {isDoctor
          ? `${count} item${count === 1 ? "" : "s"} at or below par level in your kit.`
          : `${count} OCS stock item${count === 1 ? "" : "s"} at or below par level.`}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ocs-grey lg:text-ocs-yellow-dark">
        {isDoctor
          ? "Restock now to bring each item back to full par. Enable push in the menu for background alerts."
          : "Review warehouse inventory and restock items. Enable push in the menu for background alerts."}
      </p>
      <Link
        to={to}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-ocs-teal px-4 py-2 text-sm font-semibold text-white transition active:bg-ocs-teal/90 lg:hover:bg-ocs-teal/90"
      >
        {isDoctor ? "Restock now" : "Review inventory"}
      </Link>
    </div>
  );
}

export default LowStockBanner;
