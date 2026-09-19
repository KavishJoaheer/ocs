import { ATP_HELP_TEXT, inventoryQuantityBreakdown, itemHasExpiredStock, itemHasQuarantinedStock } from "../../lib/inventoryStockDisplay.js";
import { cx } from "../../lib/utils.js";

export default function InventoryQuantitySummary({
  item,
  compact = false,
  showMinimum = true,
  showReserved = !compact,
  firstAtp = false,
  atpLabel = "Usable",
  onHandLabel = "On hand",
}) {
  const { onHand, reserved, expired, quarantined, atp, minimum } = inventoryQuantityBreakdown(item);
  const expiredStock = itemHasExpiredStock(item) || expired > 0;
  const quarantinedStock = itemHasQuarantinedStock(item) || quarantined > 0;
  const unavailable = atp <= 0 || expiredStock || quarantinedStock;
  const usableLine = (
    <span title={firstAtp ? ATP_HELP_TEXT : undefined}>
      {atpLabel}{" "}
      <strong className={cx("tabular-nums", unavailable ? "text-rose-700" : "text-slate-900")}>{atp}</strong>
      {firstAtp ? <span className="sr-only">. {ATP_HELP_TEXT}</span> : null}
    </span>
  );
  const onHandLine = (
    <span>
      {onHandLabel} <strong className="tabular-nums text-slate-900">{onHand}</strong>
    </span>
  );

  if (compact) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-snug text-slate-500">
        {firstAtp ? usableLine : onHandLine}
        <span aria-hidden="true">·</span>
        {firstAtp ? onHandLine : usableLine}
        {showMinimum ? (
          <span>
            Min <strong className="tabular-nums text-slate-900">{minimum}</strong>
          </span>
        ) : null}
        {expired > 0 ? (
          <span className="text-rose-700">
            Expired <strong className="tabular-nums">{expired}</strong>
          </span>
        ) : null}
        {quarantined > 0 ? (
          <span className="text-rose-700">
            Quarantined <strong className="tabular-nums">{quarantined}</strong>
          </span>
        ) : null}
        {showReserved && reserved > 0 ? (
          <span>
            Reserved <strong className="tabular-nums text-slate-900">{reserved}</strong>
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <p
      className="text-xs leading-snug text-slate-600 [overflow-wrap:anywhere]"
      title={ATP_HELP_TEXT}
    >
      <span>
        {onHandLabel}: <strong className="tabular-nums text-slate-900">{onHand}</strong>
      </span>
      <span aria-hidden="true"> · </span>
      <span>
        Reserved: <strong className="tabular-nums text-slate-900">{reserved}</strong>
      </span>
      <span aria-hidden="true"> · </span>
      <span className={expired > 0 ? "text-rose-700" : undefined}>
        Expired: <strong className="tabular-nums">{expired}</strong>
      </span>
      <span aria-hidden="true"> · </span>
      <span className={quarantined > 0 ? "text-rose-700" : undefined}>
        Quarantined: <strong className="tabular-nums">{quarantined}</strong>
      </span>
      <span aria-hidden="true"> · </span>
      <span title={ATP_HELP_TEXT}>
        {atpLabel}: <strong className={cx("tabular-nums", unavailable ? "text-rose-700" : "text-slate-900")}>{atp}</strong>
        {firstAtp ? <span className="sr-only">. {ATP_HELP_TEXT}</span> : null}
      </span>
      {showMinimum ? (
        <>
          <span aria-hidden="true"> · </span>
          <span>
            Minimum: <strong className="tabular-nums text-slate-900">{minimum}</strong>
          </span>
        </>
      ) : null}
    </p>
  );
}
