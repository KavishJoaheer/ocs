import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import LoadingState from "./LoadingState.jsx";
import { api } from "../lib/api.js";
import { formatRupees } from "../lib/format.js";
import {
  formatInventoryPeriodLabel,
  getInventoryDateRange,
  INVENTORY_PERIOD_PRESETS,
  inventoryTodayInputValue,
} from "../lib/inventoryPeriod.js";
import { cx } from "../lib/utils.js";

function CompareRemainingCell({ value }) {
  const amount = Number(value || 0);

  if (amount < 0) {
    return (
      <span className="rounded bg-red-50 px-2 py-0.5 font-bold text-red-600">
        {formatRupees(amount)}
      </span>
    );
  }

  return <span className="text-slate-800">{formatRupees(amount)}</span>;
}

function InventoryPeriodFilter({ preset, anchorDate, onPresetChange, onAnchorDateChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm"
        role="group"
        aria-label="Time period"
      >
        {INVENTORY_PERIOD_PRESETS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onPresetChange(option.id)}
            className={cx(
              "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
              preset === option.id
                ? "bg-[#4FB8B3] text-white"
                : "text-slate-700 hover:bg-slate-50",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={anchorDate}
        onChange={(event) => onAnchorDateChange(event.target.value)}
        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
        aria-label="Period anchor date"
      />
    </div>
  );
}

function AdminInventoryReconciliationPanel() {
  const [preset, setPreset] = useState("monthly");
  const [anchorDate, setAnchorDate] = useState(inventoryTodayInputValue());
  const [compareRows, setCompareRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const periodRange = useMemo(
    () => getInventoryDateRange(preset, anchorDate),
    [preset, anchorDate],
  );

  const periodLabel = formatInventoryPeriodLabel(preset, periodRange.from, periodRange.to);

  useEffect(() => {
    let ignore = false;

    async function loadCompareRows() {
      setLoading(true);

      try {
        const query = new URLSearchParams({
          dateFrom: periodRange.from,
          dateTo: periodRange.to,
        });
        const payload = await api.get(`/inventory?${query.toString()}`);
        if (!ignore) {
          setCompareRows(payload?.compare_rows || []);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
          setCompareRows([]);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadCompareRows();

    return () => {
      ignore = true;
    };
  }, [periodRange.from, periodRange.to]);

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold tracking-tight text-slate-950">
            Inventory stock reconciliation
          </h3>
          <p className="mt-1 text-xs font-medium text-gray-400">{periodLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InventoryPeriodFilter
            preset={preset}
            anchorDate={anchorDate}
            onPresetChange={setPreset}
            onAnchorDateChange={setAnchorDate}
          />
          <Link
            to="/inventory"
            className="text-xs font-semibold text-teal-700 transition hover:text-teal-800"
          >
            Open inventory ➔
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4 md:p-5">
        {loading ? (
          <LoadingState label="Loading reconciliation matrix" />
        ) : compareRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No reconciliation data for this period.</p>
        ) : (
          <div className="h-full overflow-x-auto overflow-y-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 text-left">Doctor</th>
                  <th className="px-3 py-2.5 text-right">Total Restocked</th>
                  <th className="px-3 py-2.5 text-right">Sales</th>
                  <th className="px-3 py-2.5 text-right">Wasted</th>
                  <th className="px-3 py-2.5 text-right">Expired</th>
                  <th className="px-3 py-2.5 text-right">Remaining Stock</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr key={row.doctor_id} className="border-t border-slate-200/70 text-xs">
                    <td className="px-3 py-2.5 font-medium text-slate-900">{row.doctor_name}</td>
                    <td className="px-3 py-2.5 text-right text-slate-800">{formatRupees(row.total_restocked)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-800">{formatRupees(row.consumed_sales)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-800">{formatRupees(row.consumed_wasted)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-800">{formatRupees(row.consumed_expired)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <CompareRemainingCell value={row.remaining_in_bag} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminInventoryReconciliationPanel;
