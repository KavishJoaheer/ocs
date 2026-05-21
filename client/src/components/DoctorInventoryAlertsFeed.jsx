import { Link } from "react-router-dom";
import { cx } from "../lib/utils.js";

const alertSurface = {
  rose: {
    row: "bg-rose-50/40 border-rose-100/40",
    dot: "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.4)]",
  },
  amber: {
    row: "bg-amber-50/40 border-amber-100/40",
    dot: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.4)]",
  },
};

function InventoryAlertRow({ alert }) {
  const surface = alertSurface[alert.tone] || alertSurface.rose;

  return (
    <div
      className={cx(
        "flex items-start gap-3 rounded-xl border p-2.5",
        surface.row,
      )}
    >
      <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", surface.dot)} aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-bold text-gray-800">{alert.title}</span>
        <span className="text-[11px] font-medium text-gray-500">{alert.detail}</span>
      </div>
    </div>
  );
}

export default function DoctorInventoryAlertsFeed({
  className,
  loading = false,
  notifications = [],
  alertCount = 0,
}) {
  return (
    <Link
      to="/inventory?context=my"
      className={cx(
        "mb-4 flex min-h-[160px] w-full flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition active:scale-[0.99]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-gray-50 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-extrabold tracking-wide text-gray-800">Inventory Alerts</span>
          {alertCount > 0 ? (
            <span className="rounded-full border border-rose-100/50 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600">
              {alertCount} New
            </span>
          ) : (
            <span className="rounded-full border border-emerald-100/80 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
              Clear
            </span>
          )}
        </div>
        <span className="text-[11px] font-semibold text-gray-400">Real-time</span>
      </div>

      <div className="flex max-h-[180px] flex-col gap-3 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-xs font-medium text-gray-400">Loading bag inventory…</p>
        ) : notifications.length ? (
          notifications.map((alert) => <InventoryAlertRow key={alert.id} alert={alert} />)
        ) : (
          <p className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 text-xs font-medium text-gray-500">
            Your field kit is fully stocked. Alerts appear when quantity hits par level or stock nears expiry.
          </p>
        )}
      </div>
    </Link>
  );
}
