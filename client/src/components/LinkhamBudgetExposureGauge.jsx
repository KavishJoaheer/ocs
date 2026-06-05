import { formatRupees } from "../lib/format.js";

export default function LinkhamBudgetExposureGauge({ exposure }) {
  const threshold = Number(exposure?.monthlyThreshold || 200000);
  const currentTotal = Number(exposure?.currentMonthClaimsTotal || 0);
  const percent = Math.min(Number(exposure?.exposurePercent || 0), 100);
  const ringRadius = 42;
  const circumference = 2 * Math.PI * ringRadius;
  const dashOffset = circumference - (percent / 100) * circumference;
  const tone =
    percent >= 80 ? "text-amber-600" : percent >= 60 ? "text-[#557373]" : "text-emerald-600";
  const strokeTone = percent >= 80 ? "#d97706" : percent >= 60 ? "#557373" : "#059669";

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
            Corporate Budget Exposure
          </span>
          <p className="mt-2 text-sm font-semibold text-gray-700">
            Monthly 80% claims pool vs liquidity threshold
          </p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-2xl font-black tabular-nums ${tone}`}>
              {formatRupees(currentTotal)}
            </span>
            <span className="text-xs font-medium text-gray-400">
              of {formatRupees(threshold)}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${percent}%`,
                backgroundColor: strokeTone,
              }}
            />
          </div>
          <p className="mt-2 text-[11px] font-medium text-gray-500">
            {percent.toFixed(1)}% utilized · {formatRupees(exposure?.remainingBudget || 0)} remaining
          </p>
        </div>

        <div className="relative flex size-28 shrink-0 items-center justify-center">
          <svg className="-rotate-90" width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">
            <circle cx="56" cy="56" r={ringRadius} fill="none" stroke="#f3f4f6" strokeWidth="10" />
            <circle
              cx="56"
              cy="56"
              r={ringRadius}
              fill="none"
              stroke={strokeTone}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-lg font-black tabular-nums ${tone}`}>{percent.toFixed(0)}%</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Used</span>
          </div>
        </div>
      </div>
    </div>
  );
}
