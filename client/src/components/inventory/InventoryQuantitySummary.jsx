import { ATP_HELP_TEXT, inventoryQuantityBreakdown, itemHasExpiredStock } from "../../lib/inventoryStockDisplay.js";
import { cx } from "../../lib/utils.js";

export default function InventoryQuantitySummary({
  item,
  compact = false,
  showMinimum = true,
  showReserved = !compact,
  firstAtp = false,
}) {
  const { onHand, reserved, expired, atp, minimum } = inventoryQuantityBreakdown(item);
  const expiredStock = itemHasExpiredStock(item) || expired > 0;
  const unavailable = atp <= 0 || expiredStock;

  if (compact) {
    return (
      <div className="flex flex-col gap-0.5 text-[11px] leading-snug text-slate-500">
        <span>
          On hand <strong className="tabular-nums text-slate-900">{onHand}</strong>
        </span>
        <span title={firstAtp ? ATP_HELP_TEXT : undefined}>
          ATP <strong className={cx("tabular-nums", unavailable ? "text-rose-700" : "text-slate-900")}>{atp}</strong>
          {firstAtp ? <span className="sr-only">. {ATP_HELP_TEXT}</span> : null}
        </span>
        {showMinimum ? (
          <span>
            Minimum <strong className="tabular-nums text-slate-900">{minimum}</strong>
          </span>
        ) : null}
        {expired > 0 ? (
          <span className="text-rose-700">
            Expired <strong className="tabular-nums">{expired}</strong>
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
        On hand: <strong className="tabular-nums text-slate-900">{onHand}</strong>
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
      <span title={ATP_HELP_TEXT}>
        ATP: <strong className={cx("tabular-nums", unavailable ? "text-rose-700" : "text-slate-900")}>{atp}</strong>
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
