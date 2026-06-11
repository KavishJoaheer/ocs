import { Link } from "react-router-dom";

function LowStockBanner({ alert, variant = "doctor" }) {
  if (!alert?.triggered) {
    return null;
  }

  const count = Number(alert.total_items || 0);
  const isDoctor = variant === "doctor";

  return (
    <div className="mb-4 rounded-2xl border border-ocs-yellow/30 bg-ocs-yellow/10 p-4 lg:border-ocs-yellow/30 lg:bg-ocs-yellow/10" role="alert">
      <p className="text-xs font-bold uppercase tracking-wider text-ocs-yellow-dark">Low stock alert</p>
      <p className="mt-1 text-sm font-semibold text-ocs-yellow-dark">
        {isDoctor
          ? `${count} item${count === 1 ? "" : "s"} at or below par level in your kit.`
          : `${count} OCS stock item${count === 1 ? "" : "s"} at or below par level.`}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ocs-yellow-dark">
        {isDoctor
          ? "Restock now to bring each item back to full par. Enable push in the menu for background alerts."
          : "Review warehouse inventory and restock items. Enable push in the menu for background alerts."}
      </p>
      <Link
        to={isDoctor ? "/inventory?context=my&restock=alert" : "/inventory"}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-ocs-teal px-4 py-2 text-sm font-semibold text-white transition active:bg-ocs-teal/90 lg:hover:bg-ocs-teal/90"
      >
        {isDoctor ? "Restock now" : "Review inventory"}
      </Link>
    </div>
  );
}

export default LowStockBanner;
