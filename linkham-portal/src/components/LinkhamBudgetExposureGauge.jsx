import { formatRupees } from "../lib/format.js";

export default function LinkhamBudgetExposureGauge({ exposure }) {
  const threshold = Number(exposure?.monthlyThreshold || 200000);
  const currentTotal = Number(exposure?.currentMonthClaimsTotal || 0);
  const percent = Math.min(Number(exposure?.exposurePercent || 0), 100);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
            Corporate Budget Exposure
          </span>
          <p className="mt-2 text-sm font-semibold text-gray-600">
            Monthly 80% claims pool vs liquidity threshold
          </p>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black tabular-nums text-[#14213d]">
              {formatRupees(currentTotal)}
            </span>
            <span className="text-xs font-medium text-gray-400">
              of {formatRupees(threshold)}
            </span>
          </div>
          <span className="text-sm font-black tabular-nums text-[#14213d]">
            {percent.toFixed(1)}% utilized
          </span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-[#065a60] transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>

        <p className="text-[11px] font-medium text-gray-500">
          {formatRupees(exposure?.remainingBudget || 0)} remaining in monthly coverage pool
        </p>
      </div>
    </div>
  );
}
