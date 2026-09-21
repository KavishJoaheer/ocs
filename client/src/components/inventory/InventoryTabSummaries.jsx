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

function formatActivityDate(value) {
  if (!value) return "No completed activity yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No completed activity yet";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function CadenceSummary({ message, firstLabel, firstValue, secondLabel, secondValue }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white px-3 py-2.5 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0">{message}</p>
      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 tabular-nums">
        <span>{firstLabel}: <strong className="text-slate-900">{firstValue}</strong></span>
        <span>{secondLabel}: <strong className="text-slate-900">{secondValue}</strong></span>
      </div>
    </div>
  );
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
      className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-left text-xs font-semibold leading-tight transition hover:border-ocs-teal/50 sm:px-3 ${toneClass}`}
    >
      <span className="min-w-0 sm:hidden">{compactLabel || label}</span>
      <span className="hidden min-w-0 sm:inline">{label}</span>
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
  onOpenReconciliation,
}) {
  if (tab === "shipments") {
    const data = summaries?.shipments || {};
    return (
      <div className="space-y-2">
        <CadenceSummary
          message="Receive stock whenever a supplier delivery arrives—usually 2–3 times per month, with no fixed dates."
          firstLabel="Received this month"
          firstValue={data.received_this_month || 0}
          secondLabel="Last received"
          secondValue={formatActivityDate(data.last_received_at)}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <Card title="Incoming shipments" value={data.incoming_shipments || 0} onClick={onOpenIncoming} />
          <Card title="Pending lines" value={data.pending_lines || 0} />
          <Card title="Invalid / excluded" value={data.invalid_excluded_lines || 0} tone="amber" />
          <Card title="Pending shipment value" value={formatRupees(data.pending_shipment_value || 0)} />
        </div>
      </div>
    );
  }
  if (tab === "count") {
    const data = summaries?.count || {};
    return (
      <div className="space-y-2">
        <CadenceSummary
          message="Start a stock count whenever needed—usually 2–3 times per week, with no fixed days."
          firstLabel="Completed in 7 days"
          firstValue={data.completed_last_7_days || 0}
          secondLabel="Last completed"
          secondValue={formatActivityDate(data.last_completed_at)}
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <Card title="Active counts" value={data.active_sessions || 0} />
          <Card
            title="Awaiting approval"
            value={data.awaiting_approval || 0}
            tone="amber"
            onClick={() => onOpenApproval?.("submitted")}
          />
          <Card
            title="Approved to apply"
            value={data.awaiting_application || 0}
            onClick={() => onOpenApproval?.("approved")}
          />
          <Card title="Open count variance" value={formatRupees(data.total_open_variance || 0)} hint="Only counted lines. Zero does not confirm uncounted stock." />
        </div>
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
  const out = stock.out_of_stock ?? chaseCounts?.out ?? 0;
  const near = stock.near_expiry ?? chaseCounts?.near ?? 0;
  const missing = stock.missing_expiry ?? chaseCounts?.missing ?? 0;
  const expired = stock.expired ?? chaseCounts?.expired ?? 0;
  const reconciliation = Number(stock.reconciliation_required ?? chaseCounts?.reconciliation ?? 0);
  const isBag = stock.location_kind === "bag";
  const chaseColumns = reconciliation > 0 ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-2 sm:p-3 md:p-4">
      <div className="flex flex-col gap-3">
        <div className="hidden min-w-0 sm:block">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {stock.value_title || (isBag ? "Bag value" : "Stock value")}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-950 sm:text-base">{valueDisplay.value}</p>
          {valueDisplay.hint ? <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-slate-400">{valueDisplay.hint}</p> : null}
        </div>
        <div className={`grid w-full min-w-0 gap-1.5 sm:gap-2 ${chaseColumns}`}>
          <StockAttentionButton label="Low stock" compactLabel="Low" value={low} tone="rose" active={filters?.low} onClick={() => onFilter?.("low")} />
          <StockAttentionButton label="Out of stock" compactLabel="Out" value={out} tone="rose" active={filters?.out} onClick={() => onFilter?.("out")} />
          <StockAttentionButton label="Needs expiry" compactLabel="Expiry" accessibleLabel="Needs expiry" value={missing} tone="amber" active={filters?.missing} onClick={() => onFilter?.("missing")} />
          <StockAttentionButton label="Near expiry" compactLabel="Near" value={near} tone="amber" active={filters?.near} onClick={() => onFilter?.("near")} />
          <StockAttentionButton label="Expired" compactLabel="Expired" value={expired} tone="rose" active={filters?.expired} onClick={() => onFilter?.("expired")} />
          {reconciliation > 0 ? (
            <StockAttentionButton
              label="Reconciliation"
              compactLabel="Reconcile"
              accessibleLabel="Reconciliation required"
              value={reconciliation}
              tone="amber"
              onClick={onOpenReconciliation}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
