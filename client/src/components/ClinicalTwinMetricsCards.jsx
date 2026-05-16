import { HeartPulse, Stethoscope } from "lucide-react";
import { Link } from "react-router-dom";
import {
  getClinicalTwinMetricCopy,
  getClinicalTwinMetricRoutes,
} from "../lib/clinicalTwinMetrics.js";
import { cx } from "../lib/utils.js";

const cardClassName =
  "flex items-center justify-between rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:border-teal-100";

function ClinicalTwinMetricCard({ to, label, value, subtext, icon: Icon, iconFrameClassName, iconClassName }) {
  return (
    <Link to={to} className={cardClassName}>
      <div className="min-w-0 pr-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-400">{label}</p>
        <p className="my-1.5 text-2xl font-black leading-none text-gray-900 tabular-nums">{value}</p>
        <p className="text-xs font-medium text-gray-500">{subtext}</p>
      </div>
      <div
        className={cx(
          "flex size-10 shrink-0 items-center justify-center rounded-xl p-2.5",
          iconFrameClassName,
        )}
      >
        <Icon className={cx("size-5", iconClassName)} strokeWidth={2.25} />
      </div>
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
        icon={Stethoscope}
        iconFrameClassName="bg-amber-50 text-amber-600"
        iconClassName="text-amber-600"
      />
      <ClinicalTwinMetricCard
        to={routes.healthPlans}
        label="Health plans"
        value={healthPlansCount}
        subtext={copy.healthPlans}
        icon={HeartPulse}
        iconFrameClassName="bg-teal-50 text-teal-600"
        iconClassName="text-teal-600"
      />
    </div>
  );
}

export default ClinicalTwinMetricsCards;
