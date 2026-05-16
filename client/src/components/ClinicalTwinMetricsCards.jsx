import { Link } from "react-router-dom";
import {
  getClinicalTwinMetricCopy,
  getClinicalTwinMetricRoutes,
} from "../lib/clinicalTwinMetrics.js";
import { cx } from "../lib/utils.js";
import MetricNavAnchor from "./MetricNavAnchor.jsx";

function ClinicalTwinMetricCard({
  to,
  label,
  value,
  subtext,
  accent = "teal",
  highlightBorder = false,
}) {
  return (
    <Link
      to={to}
      className={cx(
        "group relative flex cursor-pointer flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:border-teal-100",
        highlightBorder && "border-l-4 border-l-amber-500",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{label}</p>
        <MetricNavAnchor accent={accent} />
      </div>
      <p className="mt-3 text-2xl font-black leading-none text-gray-900 tabular-nums">{value}</p>
      <p className="mt-1.5 text-xs font-medium text-gray-500">{subtext}</p>
    </Link>
  );
}

function ClinicalTwinMetricsCards({
  role,
  longTermReviewCount,
  healthPlansCount,
  className,
}) {
  const routes = getClinicalTwinMetricRoutes(role);
  const copy = getClinicalTwinMetricCopy(role);

  return (
    <div className={cx("grid w-full grid-cols-1 gap-4.5 sm:grid-cols-2", className)}>
      <ClinicalTwinMetricCard
        to={routes.longTermReview}
        label="Long term review"
        value={longTermReviewCount}
        subtext={copy.longTermReview}
        accent="amber"
        highlightBorder
      />
      <ClinicalTwinMetricCard
        to={routes.healthPlans}
        label="Health plans"
        value={healthPlansCount}
        subtext={copy.healthPlans}
        accent="teal"
      />
    </div>
  );
}

export default ClinicalTwinMetricsCards;
