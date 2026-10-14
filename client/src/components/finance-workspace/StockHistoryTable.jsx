import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Printer } from "lucide-react";
import { formatSignedQuantity, signedMovementQuantity } from "../../lib/inventoryStockDisplay.js";

function recordedTime(value) {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${String(value).replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (!value || !Number.isFinite(date.getTime())) return { date: "Unavailable", time: "" };
  return {
    date: new Intl.DateTimeFormat("en-GB", { timeZone: "Indian/Mauritius", day: "numeric", month: "short", year: "numeric" }).format(date),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: "Indian/Mauritius", hour: "2-digit", minute: "2-digit" }).format(date),
  };
}
export default function StockHistoryTable({ rows, user, actionLabel, actionDisplayLabel, badgeStyles, actorDisplayName, onPrint, onReverse }) {
  const [expanded, setExpanded] = useState(new Set());
  return <div className="overflow-hidden rounded-[22px] border border-[#d5e4e1]">
    <table className="stock-activity-table" aria-label="Stock movements">
      <colgroup><col style={{ width: "13%" }} /><col style={{ width: "23%" }} /><col style={{ width: "15%" }} /><col style={{ width: "20%" }} /><col style={{ width: "14%" }} /><col style={{ width: "15%" }} /></colgroup>
      <thead><tr><th>Recorded</th><th>Item</th><th>Movement</th><th>From / to</th><th>Staff</th><th>Details</th></tr></thead>
      <tbody>{rows.map(row => {
        const label = actionLabel(row.action_type, row.meta_json);
        const quantity = signedMovementQuantity(row);
        let meta = {}; try { meta = JSON.parse(row.meta_json || "{}") || {}; } catch { /* Preserve older incomplete audit records. */ }
        const transactionId = row.transaction_id || meta.transaction_id || "";
        const canPrint = transactionId && ["restock", "restock_in", "restock_out"].includes(label);
        const time = recordedTime(row.timestamp);
        const opened = expanded.has(row.id);
        const detailId = `stock-movement-details-${row.id}`;
        return <Fragment key={row.id}>
          <tr>
            <td className="stock-row-date">{time.date}<small>{time.time} · Mauritius</small></td>
            <td><strong className="text-[#173f4a]">{row.item_name || "Unknown item"}</strong></td>
            <td><span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${badgeStyles[label] || "bg-slate-100 text-slate-700"}`}>{actionDisplayLabel(label)}</span>
              <p className={`font-bold tabular-nums ${quantity < 0 ? "text-rose-700" : "text-emerald-800"}`}>{formatSignedQuantity(quantity)} units<span className="sr-only"> {quantity < 0 ? "removed" : quantity > 0 ? "added" : "unchanged"}</span></p>
            </td>
            <td><p>{row.source_text || "—"}</p><p className="text-[#5d767e]">→ {row.destination_text || "—"}</p></td>
            <td><p>{actorDisplayName(row)}</p><p className="text-xs capitalize text-[#789096]">{row.actor_role || "staff"}</p></td>
            <td><div className="stock-row-tools">
              <button type="button" className="finance-control" aria-expanded={opened} aria-controls={detailId} onClick={() => setExpanded(current => {
                const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next;
              })}>{opened ? "Hide details" : "Details"}<ChevronDown size={14} aria-hidden="true" /></button>
              {canPrint && <button type="button" className="finance-control" onClick={() => onPrint(transactionId)} aria-label="Print receipt"><Printer size={14} aria-hidden="true" /></button>}
              {user.role === "admin" && row.write_off_reversible && <button type="button" className="finance-control text-rose-700" onClick={() => onReverse(row)}>Reverse</button>}
              {row.write_off_reversed && <span className="text-xs text-[#5d767e]">Reversed</span>}
            </div></td>
          </tr>
          {opened && <tr id={detailId} className="stock-movement-details"><td colSpan={6}>
            <dl>
              <div><dt>Batch / lot</dt><dd>{row.batch_id || (row.legacy_data_unavailable ? "Legacy / unknown lot" : "—")}</dd></div>
              <div><dt>Expiry</dt><dd>{row.expiry_date || "—"}</dd></div>
              <div><dt>Resulting balance</dt><dd>{row.resulting_balance ?? "—"}</dd></div>
              <div><dt>Supply request</dt><dd>{row.request_id ? `#${row.request_id}` : "—"}
                {row.request_id && ["admin", "operator"].includes(user.role) && <Link className="mt-1 block text-teal-700 underline" to={`/supply-requests?requestId=${row.request_id}`}>Open supply request</Link>}</dd></div>
              <div><dt>Receipt / transaction</dt><dd>{row.receipt_number || transactionId || "—"}</dd></div>
              <div><dt>Billing</dt><dd>{row.billing_status || "—"}
                {row.billing_id && ["doctor", "admin", "accountant"].includes(user.role) && <Link className="mt-1 block text-teal-700 underline" to={`/billing?billId=${row.billing_id}`}>Bill #{row.billing_id}</Link>}</dd></div>
              <div className="stock-detail-note"><dt>Reason</dt><dd>{meta.stock_out_reason ? `${meta.stock_out_reason} · ` : ""}{row.reason_note || row.movement_note || "—"}</dd></div>
              {row.legacy_data_unavailable && <div className="stock-detail-note text-amber-800">Legacy / unavailable data</div>}
            </dl>
          </td></tr>}
        </Fragment>;
      })}</tbody>
    </table>
  </div>;
}
