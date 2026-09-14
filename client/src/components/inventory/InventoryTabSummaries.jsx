import { formatRupees } from "../../lib/format.js";
import { cx } from "../../lib/utils.js";

function Card({ title, value, tone = "teal", hint, onClick, active = false }) {
  const valueToneClass = tone === "amber" ? "text-amber-700" : tone === "rose" ? "text-rose-700" : "text-slate-950";
  const className = cx(
    "min-h-11 rounded-2xl border bg-white p-3 text-left md:rounded-3xl md:p-4",
    active ? "border-ocs-teal/50 ring-2 ring-ocs-teal/20" : "border-slate-200/80",
    onClick && "cursor-pointer text-left transition hover:border-ocs-teal/40 hover:bg-slate-50",
  );
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      <p className={`mt-1.5 break-words text-lg font-semibold leading-tight [overflow-wrap:anywhere] tabular-nums md:text-xl ${valueToneClass}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

function stockValueDisplay(stock, warehouseValue) {
  const known = Number(stock.stock_value ?? stock.warehouse_value ?? warehouseValue ?? 0);
  const unpriced = Number(stock.unpriced_count || 0);
  const complete = stock.valuation_complete !== false && unpriced === 0;
  if (!complete) {
    return {
      value: "Incomplete",
      hint: `${unpriced.toLocaleString()} unpriced product${unpriced === 1 ? "" : "s"}${known > 0 ? ` · known ${formatRupees(known)}` : ""}`,
    };
  }
  return { value: formatRupees(known), hint: undefined };
}

function StockAttentionButton({ label, compactLabel, accessibleLabel, value, tone = "slate", active = false, onClick }) {
  const toneClass =
    tone === "rose"
      ? active
        ? "border-rose-600 bg-rose-600 text-white"
        : "border-rose-200 bg-rose-50 text-rose-800"
      : tone === "amber"
        ? active
          ? "border-amber-600 bg-amber-600 text-white"
          : "border-amber-200 bg-amber-50 text-amber-900"
        : active
          ? "border-ocs-teal bg-ocs-teal text-white"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <button
      type="button"
      aria-label={`${accessibleLabel || label}: ${value}`}
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-11 min-w-0 flex-col items-center justify-center rounded-xl border px-1.5 py-1 text-center text-[10px] font-semibold leading-tight transition hover:border-ocs-teal/50 sm:flex-row sm:justify-between sm:px-3 sm:text-left sm:text-xs ${toneClass}`}
    >
      <span className="min-w-0 truncate sm:hidden">{compactLabel || label}</span>
      <span className="hidden min-w-0 truncate sm:inline">{label}</span>
      <strong className="shrink-0 text-sm leading-none tabular-nums">{value}</strong>
    </button>
  );
}

export default function InventoryTabSummaries({
  tab,
  summaries,
  chaseCounts,
  warehouseValue,
  filters,
  onFilter,
  onOpenIncoming,
  onOpenApproval,
  onOpenUnpriced,
}) {
  if (tab === "shipments") {
    const data = summaries?.shipments || {};
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Card title="Incoming shipments" value={data.incoming_shipments || 0} onClick={onOpenIncoming} />
        <Card title="Pending lines" value={data.pending_lines || 0} />
        <Card title="Invalid / excluded" value={data.invalid_excluded_lines || 0} tone="amber" />
        <Card title="Pending shipment value" value={formatRupees(data.pending_shipment_value || 0)} />
      </div>
    );
  }
  if (tab === "count") {
    const data = summaries?.count || {};
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Card title="Active sessions" value={data.active_sessions || 0} />
        <Card
          title="Awaiting approval"
          value={data.awaiting_approval || 0}
          tone="amber"
          onClick={() => onOpenApproval?.("submitted")}
        />
        <Card
          title="Approved awaiting application"
          value={data.awaiting_application || 0}
          onClick={() => onOpenApproval?.("approved")}
        />
        <Card title="Recorded open variance" value={formatRupees(data.total_open_variance || 0)} hint="Only counted lines. Zero does not confirm uncounted stock." />
      </div>
    );
  }
  if (tab === "bags") {
    const data = summaries?.bags || {};
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Card title="Doctor bags" value={data.doctor_bags || 0} />
        <Card
          title="Total bag value"
          value={data.valuation_complete === false ? "Incomplete" : formatRupees(data.total_bag_value || 0)}
          hint={
            data.valuation_complete === false
              ? `${Number(data.unpriced_catalogue_items || 0).toLocaleString()} product${Number(data.unpriced_catalogue_items || 0) === 1 ? "" : "s"} lack pricing`
              : undefined
          }
        />
        <Card
          title="Unpriced products"
          value={data.unpriced_catalogue_items ?? data.unpriced_items ?? 0}
          tone="amber"
          hint={
            Number(data.unpriced_bag_item_instances || 0) > 0
              ? `${Number(data.unpriced_bag_item_instances).toLocaleString()} bag-item record${Number(data.unpriced_bag_item_instances) === 1 ? "" : "s"} across ${Number(data.affected_doctor_bags || 0)} bag${Number(data.affected_doctor_bags || 0) === 1 ? "" : "s"}`
              : "Open catalogue pricing"
          }
          onClick={onOpenUnpriced}
        />
        <Card title="Period movements / exceptions" value={`${data.period_movements || 0} / ${data.period_exceptions || 0}`} />
      </div>
    );
  }

  const stock = summaries?.stock || {};
  const valueDisplay = stockValueDisplay(stock, warehouseValue);
  const low = stock.low_stock ?? chaseCounts?.low ?? 0;
  const near = stock.near_expiry ?? chaseCounts?.near ?? 0;
  const missing = stock.missing_expiry ?? chaseCounts?.missing ?? 0;
  const expired = stock.expired ?? chaseCounts?.expired ?? 0;
  const reconciliation = stock.reconciliation_required ?? chaseCounts?.reconciliation ?? 0;
  const isBag = stock.location_kind === "bag";

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-2 sm:p-3 md:p-4">
      <div className="flex items-stretch gap-2 sm:flex-col sm:gap-3 xl:flex-row xl:items-center">
        <div className="hidden min-w-0 shrink-0 sm:flex sm:w-auto sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 xl:w-64 xl:flex-col xl:items-start xl:gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {stock.value_title || (isBag ? "Bag value" : "Stock value")}
          </p>
          <div className="min-w-0 sm:text-right xl:text-left">
            <p className="truncate text-sm font-semibold text-slate-950 sm:text-base md:text-lg">{valueDisplay.value}</p>
            {valueDisplay.hint ? <p className="hidden truncate text-[11px] text-slate-400 sm:block">{valueDisplay.hint}</p> : null}
          </div>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-4 gap-1.5 sm:gap-2">
          <StockAttentionButton label="Low stock" compactLabel="Low" value={low} tone="rose" active={filters?.low} onClick={() => onFilter?.("low")} />
          <StockAttentionButton label="Near expiry" compactLabel="Near" value={near} tone="amber" active={filters?.near} onClick={() => onFilter?.("near")} />
          <StockAttentionButton label="Missing expiry" compactLabel="Miss." value={missing} active={filters?.missing} onClick={() => onFilter?.("missing")} />
          <StockAttentionButton label="Expired" compactLabel="Exp." value={expired} tone="rose" active={filters?.expired} onClick={() => onFilter?.("expired")} />
        </div>
      </div>
      {isBag && reconciliation > 0 ? (
        <button
          type="button"
          onClick={() => onFilter?.("reconciliation")}
          className="mt-2 min-h-11 w-full rounded-xl border border-amber-200 bg-amber-50 px-3 text-left text-xs font-semibold text-amber-900"
        >
          {stock.reconciliation_title || "Bag reconciliation warnings"}: {reconciliation}
        </button>
      ) : null}
    </div>
  );
}
