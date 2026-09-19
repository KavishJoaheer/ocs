import { ATP_HELP_TEXT, inventoryQuantityBreakdown, itemHasExpiredStock, itemHasQuarantinedStock } from "../../lib/inventoryStockDisplay.js";
import { cx } from "../../lib/utils.js";

export default function InventoryQuantitySummary({
  item,
  compact = false,
  showMinimum = true,
  firstAtp = false,
}) {
  const { atp, minimum, expired, quarantined } = inventoryQuantityBreakdown(item);
  const expiredStock = itemHasExpiredStock(item) || expired > 0;
  const quarantinedStock = itemHasQuarantinedStock(item) || quarantined > 0;
  const unavailable = atp <= 0 || expiredStock || quarantinedStock;
  const qty = (
    <span title={firstAtp ? ATP_HELP_TEXT : undefined}>
      <strong className={cx("tabular-nums", unavailable ? "text-rose-700" : "text-slate-900")}>{atp}</strong>
      {" available"}
      {firstAtp ? <span className="sr-only">. {ATP_HELP_TEXT}</span> : null}
    </span>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-0.5 text-[11px] leading-snug text-slate-500">
        {qty}
        {showMinimum ? (
          <span>
            Min <strong className="tabular-nums text-slate-900">{minimum}</strong>
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <p className="text-xs leading-snug text-slate-600 [overflow-wrap:anywhere]" title={ATP_HELP_TEXT}>
      {qty}
      {showMinimum ? (
        <>
          <span aria-hidden="true"> · </span>
          <span>
            Min <strong className="tabular-nums text-slate-900">{minimum}</strong>
          </span>
        </>
      ) : null}
    </p>
  );
}
