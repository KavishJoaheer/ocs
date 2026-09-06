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
        <Card title="Total open variance" value={formatRupees(data.total_open_variance || 0)} />
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
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      <Card title="Warehouse value" value={formatRupees(stock.warehouse_value ?? warehouseValue ?? 0)} />
      <Card
        title="Low stock"
        value={stock.low_stock ?? chaseCounts?.low ?? 0}
        tone="rose"
        hint="Click to filter"
        active={filters?.low}
        onClick={() => onFilter?.("low")}
      />
      <Card
        title="Near expiry"
        value={stock.near_expiry ?? chaseCounts?.near ?? 0}
        tone="amber"
        hint="Within 90 days"
        active={filters?.near}
        onClick={() => onFilter?.("near")}
      />
      <Card
        title="Missing expiry"
        value={stock.missing_expiry ?? chaseCounts?.missing ?? 0}
        hint="Click to filter"
        active={filters?.missing}
        onClick={() => onFilter?.("missing")}
      />
    </div>
  );
}
