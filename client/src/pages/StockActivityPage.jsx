import { Activity, ChevronDown, Download, Printer, RotateCcw, Search, TrendingUp, Trophy, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { useIsMobile, DENSE_TABLE_BREAKPOINT } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import { formatRupees } from "../lib/format.js";
import { formatSignedQuantity, signedMovementQuantity } from "../lib/inventoryStockDisplay.js";
import { OCS_INVENTORY_EVENT, DOCTOR_BAG_INVENTORY_EVENT, SUPPLY_REQUESTS_EVENT } from "../lib/inventorySync.js";
import { escapePrintHtml } from "../lib/transferReceipt.js";

const BADGE_STYLES = {
  restock: "bg-[#4FB8B3]/15 text-[#1f7f7b]",
  restock_in: "bg-[#4FB8B3]/15 text-[#1f7f7b]",
  restock_out: "bg-[#4FB8B3]/15 text-[#1f7f7b]",
  stock_in: "bg-sky-100 text-sky-700",
  sell: "bg-green-100 text-green-700",
  wastage: "bg-amber-100 text-amber-700",
  stock_out: "bg-orange-100 text-orange-800",
  override: "bg-rose-100 text-rose-700",
  adjustment: "bg-rose-100 text-rose-700",
  correction: "bg-rose-100 text-rose-700",
  reversal: "bg-slate-100 text-slate-700",
};

const ACTION_LABELS = {
  restock_in: "Restock",
  restock_out: "Restock",
  stock_in: "Stock In",
  sell: "Sale",
  wastage: "Wastage",
  stock_out: "Stock Out",
  override: "Override",
  adjustment: "Adjustment",
  correction: "Correction",
  exceptional_correction: "Correction",
  reversal: "Reversal",
  add: "Add",
  edit: "Edit",
  remove: "Remove",
};

function actorDisplayName(row) {
  const name = String(row?.actor_name || "").trim();
  if (name) return name;
  return "Legacy staff record";
}

function formatTimestamp(value) {
  if (!value) return "-";
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${String(value).replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Indian/Mauritius",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function actionLabel(actionType, metaJson) {
  let meta = {};
  try {
    meta = metaJson ? JSON.parse(metaJson) : {};
  } catch {
    meta = {};
  }
  if (meta.emergency_override) return "override";
  return String(actionType || "").toLowerCase();
}

function actionDisplayLabel(actionKey) {
  return ACTION_LABELS[actionKey] || String(actionKey || "Unknown");
}

function buildReceiptPrintHtml(receipt) {
  const rows = (receipt.items || [])
    .map(
      (item) => `
      <tr>
        <td>${escapePrintHtml(item.item_name || "")}</td>
        <td>${escapePrintHtml(item.expiry_date || "-")}</td>
        <td>${escapePrintHtml(item.quantity || 0)}</td>
        <td>${escapePrintHtml(item.unit || "unit")}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html><html><head><title>Stock Transfer Note</title>
  <style>
  body { font-family: Arial, sans-serif; color:#111; padding: 20px; }
  h1 { margin:0 0 8px; font-size: 20px; }
  table { width:100%; border-collapse:collapse; margin-top:16px; }
  th,td { border:1px solid #333; padding:6px 8px; font-size:12px; text-align:left; }
  </style></head><body>
  <h1>Stock Transfer Note</h1>
  <p><strong>Transaction ID:</strong> ${escapePrintHtml(receipt.transaction_id || "-")}</p>
  <p><strong>Issued By:</strong> ${escapePrintHtml(receipt.issued_by_name || "-")}</p>
  <p><strong>Received By:</strong> ${escapePrintHtml(receipt.received_by_name || "-")}</p>
  <p><strong>Date & Time:</strong> ${escapePrintHtml(formatTimestamp(receipt.created_at))}</p>
  <table><thead><tr><th>Item Name</th><th>Expiry</th><th>Qty</th><th>Unit</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}

function StockActivityPage() {
  const { user } = useAuth();
  const isCompact = useIsMobile(DENSE_TABLE_BREAKPOINT);
  const refreshKey = useLiveRefreshKey();
  const [inventoryTick, setInventoryTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [actors, setActors] = useState([]);
  const [actions, setActions] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [analytics, setAnalytics] = useState({
    total_transactions: 0,
    total_units_moved: 0,
    total_value_cost_rs: 0,
    gross_margin_pct: null,
    wastage_value_rs: 0,
    wastage_pct: 0,
    top_performer: null,
  });
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [userId, setUserId] = useState("");
  const [selectedActions, setSelectedActions] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [requestHistory, setRequestHistory] = useState([]);
  const [receiptIds, setReceiptIds] = useState([]);
  const actionMenuRef = useRef(null);
  const lastFetchQueryRef = useRef(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", "50");
    if (search) params.set("search", search);
    if (userId) params.set("userId", userId);
    if (selectedActions.length) params.set("actions", selectedActions.join(","));
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params.toString();
  }, [page, search, userId, selectedActions, dateFrom, dateTo]);

  useEffect(() => {
    function handleInventoryLive() {
      setInventoryTick((value) => value + 1);
    }
    const events = [OCS_INVENTORY_EVENT, DOCTOR_BAG_INVENTORY_EVENT, SUPPLY_REQUESTS_EVENT, "online", "focus"];
    events.forEach(event => window.addEventListener(event, handleInventoryLive));
    return () => events.forEach(event => window.removeEventListener(event, handleInventoryLive));
  }, []);

  useEffect(() => {
    let ignore = false;
    async function load() {
      const showSpinner = lastFetchQueryRef.current !== query;
      lastFetchQueryRef.current = query;
      try {
        if (showSpinner) {
          setLoading(true);
        }
        const payload = await api.get(`/inventory/activity-history?${query}`);
        if (ignore) return;
        const nextRows = payload?.rows || [];
        const nextTotalPages = Math.max(1, Number(payload?.totalPages || 1));
        setRows(nextRows);
        setActors(payload?.actors || []);
        setActions(payload?.actions || []);
        setTotalPages(nextTotalPages);
        setTotal(Number(payload?.total || 0));
        if (payload?.analytics) {
          setAnalytics(payload.analytics);
        }
        if (page > nextTotalPages) {
          setPage(nextTotalPages);
        }
      } catch (error) {
        if (!ignore) {
          setRows([]);
          setTotal(0);
          setTotalPages(1);
          toast.error(error.message || "Failed to load stock activity.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [query, page, refreshKey, inventoryTick]);

  useEffect(() => {
    if (user?.role !== "doctor") return undefined;
    let ignore = false;
    async function loadDoctorHistory() {
      try {
        const payload = await api.get("/restock-requests?view=history&limit=50&offset=0");
        if (ignore) return;
        const requests = payload?.requests || [];
        setRequestHistory(requests);
        setReceiptIds(
          [...new Set(requests.map((row) => row.transfer_transaction_id).filter(Boolean))],
        );
      } catch {
        if (!ignore) {
          setRequestHistory([]);
          setReceiptIds([]);
        }
      }
    }
    loadDoctorHistory();
    return () => {
      ignore = true;
    };
  }, [user?.role, refreshKey, inventoryTick]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target)) {
        setActionMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const actionSummary = useMemo(() => {
    if (!selectedActions.length) return "All actions";
    if (selectedActions.length === 1) return actionDisplayLabel(selectedActions[0]);
    return `${selectedActions.length} selected`;
  }, [selectedActions]);

  const filtersActive = Boolean(
    search || userId || selectedActions.length || dateFrom || dateTo,
  );

  function clearAllFilters() {
    setSearch("");
    setSearchDraft("");
    setUserId("");
    setSelectedActions([]);
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const sellFilterActive = selectedActions.includes("sell");
  const wastageRisk = Number(analytics?.wastage_pct || 0) > 5;
  const historyReconciled =
    Number(analytics?.unclassified_movement_count || 0) === 0 &&
    Number(analytics?.estimated_movement_count || 0) === 0;
  const grossMarginValue =
    typeof analytics?.gross_margin_pct === "number"
      ? `${analytics.gross_margin_pct.toFixed(2)}%`
      : "—";

  async function reprintReceipt(transactionId) {
    if (!transactionId) return;
    try {
      const receipt = await api.get(`/inventory/receipts/${encodeURIComponent(transactionId)}`);
      const printWindow = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
      if (!printWindow) {
        toast.error("Unable to open print preview window.");
        return;
      }
      printWindow.document.write(buildReceiptPrintHtml(receipt));
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (error) {
      toast.error(error.message || "Failed to load receipt.");
    }
  }

  async function handleExportCsv() {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (userId) params.set("userId", userId);
      if (selectedActions.length) params.set("actions", selectedActions.join(","));
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const { blob, filename } = await api.getBlob(`/inventory/activity-history/export.csv?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "stock-activity-log.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.message || "CSV export failed.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventory"
        title="Stock history"
        actions={
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[#4FB8B3] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
          >
            <Download className="size-4" />
            Download CSV
          </button>
        }
      />

      {user?.role === "doctor" ? null : (
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <article className="rounded-3xl border border-slate-200 bg-white p-3 md:p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[10px] md:text-xs font-semibold uppercase tracking-wide text-slate-500">Stock activity</p>
            <span className="hidden md:grid size-9 place-items-center rounded-2xl bg-[#4FB8B3]/15 text-[#1f7f7b]">
              <Activity className="size-4" />
            </span>
          </div>
          <p className="mt-3 text-lg md:text-3xl break-words font-bold text-slate-900">{analytics.total_transactions}</p>
          <p className="mt-3 text-sm font-semibold text-slate-700">{analytics.total_units_moved} units moved</p>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-3 md:p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[10px] md:text-xs font-semibold uppercase tracking-wide text-slate-500">Net stock sales</p>
            <span className="hidden md:grid size-9 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
              <Wallet className="size-4" />
            </span>
          </div>
          <p className="mt-3 text-lg md:text-3xl break-words font-bold text-slate-900">
            {historyReconciled ? formatRupees(analytics.net_sales_rs || 0) : "Incomplete"}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {historyReconciled
              ? "Sales less linked reversals, by stock movement date. This is not collected cash."
              : `Known classified value: ${formatRupees(analytics.net_sales_rs || 0)}. Resolve estimated and unclassified records before reconciliation.`}
          </p>
          {sellFilterActive ? (
            <p className="mt-3 text-sm font-semibold text-emerald-700">Gross Margin: {grossMarginValue}</p>
          ) : null}
        </article>

        <article className={`rounded-3xl border p-3 md:p-5 shadow-sm ${wastageRisk ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
          <div className="flex items-center justify-between">
            <p className={`text-[10px] md:text-xs font-semibold uppercase tracking-wide ${wastageRisk ? "text-rose-600" : "text-slate-500"}`}>Recorded wastage</p>
            <span className={`hidden md:grid size-9 place-items-center rounded-2xl ${wastageRisk ? "bg-rose-200 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
              <TrendingUp className="size-4" />
            </span>
          </div>
          <p className="mt-3 text-lg md:text-3xl break-words font-bold text-slate-900">
            {historyReconciled ? formatRupees(analytics.wastage_value_rs || 0) : "Incomplete"}
          </p>
          <p className={`mt-3 text-sm font-semibold ${wastageRisk ? "text-rose-600" : "text-slate-700"}`}>
            Wastage Rate: {Number(analytics.wastage_pct || 0).toFixed(2)}%
          </p>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-3 md:p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[10px] md:text-xs font-semibold uppercase tracking-wide text-slate-500">Most stock updates</p>
            <span className="hidden md:grid size-9 place-items-center rounded-2xl bg-[#4FB8B3]/15 text-[#1f7f7b]">
              <Trophy className="size-4" />
            </span>
          </div>
          {analytics.top_performer ? (
            <>
              <p className="mt-3 text-base md:text-2xl break-words font-bold text-slate-900">{analytics.top_performer.name}</p>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{analytics.top_performer.role}</p>
            </>
          ) : (
            <p className="mt-3 text-base font-semibold text-slate-600">No human activity in this period</p>
          )}
        </article>
      </div>
      )}

      <SectionCard title={`Activity (${total})`}>
        {user?.role !== 'doctor' && !historyReconciled ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
            <p className="font-bold">Historical valuation is not fully reconciled</p>
            <p className="mt-1">
              {analytics.unclassified_movement_count || 0} corrections or unclassified movements and {" "}
              {analytics.estimated_movement_count || 0} estimated valuations are in this selection.
              Sales and wastage totals show only known classified value until these records are resolved.
            </p>
          </div>
        ) : null}
        <div className="mb-4 flex min-w-0 flex-row flex-wrap items-end gap-3">
          {user?.role === "doctor" ? null : (
          <label className="min-w-0 flex-1 space-y-1 sm:min-w-[10rem] sm:max-w-[14rem]">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">User</span>
            <select className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm" value={userId} onChange={(event) => { setUserId(event.target.value); setPage(1); }}>
              <option value="">All users</option>
                {actors.map((actor) => (
                <option key={actor.actor_user_id} value={actor.actor_user_id}>
                  {String(actor.actor_name || "").trim() || "Legacy staff record"} ({actor.actor_role || "staff"})
                </option>
              ))}
            </select>
          </label>
          )}
          <div className="relative min-w-0 flex-1 space-y-1 sm:min-w-[10rem] sm:max-w-[12rem]" ref={actionMenuRef}>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Action Types</span>
            <button
              type="button"
              className="flex h-11 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 text-left text-sm text-slate-700"
              onClick={() => setActionMenuOpen((prev) => !prev)}
            >
              <span className="truncate">{actionSummary}</span>
              <ChevronDown className="size-4 shrink-0 text-slate-400" />
            </button>
            {actionMenuOpen ? (
              <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                <button
                  type="button"
                  className="mb-1 w-full rounded-lg px-2 py-1 text-left text-xs font-semibold text-[#4FB8B3] hover:bg-slate-50"
                  onClick={() => {
                    setSelectedActions([]);
                    setPage(1);
                  }}
                >
                  Clear all
                </button>
                {actions.map((action) => {
                  const checked = selectedActions.includes(action);
                  return (
                    <label key={action} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedActions((prev) => {
                            if (prev.includes(action)) {
                              return prev.filter((value) => value !== action);
                            }
                            return [...prev, action];
                          });
                          setPage(1);
                        }}
                      />
                      <span>{actionDisplayLabel(action)}</span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
          <label className="w-full space-y-1 sm:w-auto sm:min-w-[9.5rem]">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">From</span>
            <input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm" />
          </label>
          <label className="w-full space-y-1 sm:w-auto sm:min-w-[9.5rem]">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">To</span>
            <input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm" />
          </label>
          <label className="min-w-0 flex-1 space-y-1 sm:min-w-[12rem]">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Search item</span>
            <div className="flex h-11 items-center rounded-2xl border border-slate-200 bg-white px-3">
              <Search className="size-4 shrink-0 text-slate-400" />
              <input
                className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setSearch(searchDraft.trim());
                    setPage(1);
                  }
                }}
                placeholder="Cannula G20"
              />
              <button type="button" className="shrink-0 text-xs font-semibold text-[#4FB8B3]" onClick={() => { setSearch(searchDraft.trim()); setPage(1); }}>Apply</button>
            </div>
          </label>
          {filtersActive ? (
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RotateCcw className="size-3.5" />
              Clear all
            </button>
          ) : null}
        </div>

        {loading ? (
          <LoadingState message="Loading stock activity..." />
        ) : rows.length === 0 ? (
          <EmptyState title="No activity recorded" description="Try changing the filters or date range to find stock events." />
        ) : isCompact ? (
          <div className="space-y-3">
            {rows.map((row) => {
              const label = actionLabel(row.action_type, row.meta_json);
              const badgeClass = BADGE_STYLES[label] || BADGE_STYLES.correction || "bg-slate-100 text-slate-700";
              const signedQty = signedMovementQuantity(row);
              const qtyLabel = formatSignedQuantity(signedQty);
              const qtyDirection = signedQty < 0 ? "removed" : signedQty > 0 ? "added" : "unchanged";
              let meta = {};
              try {
                meta = row.meta_json ? JSON.parse(row.meta_json) : {};
              } catch {
                meta = {};
              }
              const transactionId = row.transaction_id || meta.transaction_id || "";
              const isRestockTransfer = ["restock", "restock_in", "restock_out"].includes(label);
              return (
                <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">{formatTimestamp(row.timestamp)}</p>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ${badgeClass}`}>
                      {actionDisplayLabel(label)}
                    </span>
                  </div>
                  <p className="mt-2 break-words font-semibold text-slate-900">{row.item_name || "Unknown item"}</p>
                  <dl className="mt-2 grid grid-cols-1 gap-1 text-xs">
                    <div>
                      Quantity change:{" "}
                      <strong className={`tabular-nums ${signedQty < 0 ? "text-rose-700" : "text-emerald-800"}`}>
                        {qtyLabel}
                      </strong>
                      <span className="sr-only"> ({qtyDirection})</span>
                    </div>
                    <div>Resulting balance: <strong className="tabular-nums">{row.resulting_balance == null ? "—" : row.resulting_balance}</strong></div>
                    <div>Actor: {actorDisplayName(row)} ({row.actor_role || "staff"})</div>
                    <div className="break-words">Source: {row.source_text || "—"}</div>
                    <div className="break-words">Destination: {row.destination_text || "—"}</div>
                    {row.billing_id && ['doctor','admin','accountant'].includes(user?.role) ? <a href={`/billing?billId=${row.billing_id}`} className="min-h-11 inline-flex items-center font-semibold text-teal-700">Open bill #{row.billing_id}</a> : null}
                    {row.billing_status ? <div>Billing: {row.billing_status}</div> : null}
                    <div>Request: {row.request_id ? `#${row.request_id}` : "—"}</div>
                    <div className="break-words">Transfer receipt: {row.receipt_number || transactionId || "—"}</div>
                    <div>Batch/lot: {row.batch_id || (row.legacy_data_unavailable ? "Legacy/unknown lot" : "—")}</div>
                    <div>Expiry: {row.expiry_date || "—"}</div>
                    <div className="break-words">Reason: {row.reason_note || "—"}</div>
                  </dl>
                  {row.legacy_data_unavailable ? (
                    <p className="mt-2 text-xs font-semibold text-amber-800">Legacy/unavailable data</p>
                  ) : null}
                  {transactionId && isRestockTransfer ? (
                    <button
                      type="button"
                      onClick={() => reprintReceipt(transactionId)}
                      className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-teal-800"
                    >
                      Print receipt
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full table-fixed text-sm">
              <colgroup>
                <col style={{ width: "14%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "6%" }} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-600">
                <tr>
                  <th className="px-3 py-3 text-left">Timestamp</th>
                  <th className="px-3 py-3 text-left">Actor</th>
                  <th className="px-3 py-3 text-left">Action Type</th>
                  <th className="px-3 py-3 text-left">Item & Qty</th>
                  <th className="px-3 py-3 text-left">Source / Destination</th>
                  <th className="px-3 py-3 text-left">Batch ID</th>
                  <th className="px-3 py-3 text-left">Resulting balance</th>
                  <th className="px-3 py-3 text-left">Request / receipt</th>
                  <th className="px-3 py-3 text-left">Expiry</th>
                  <th className="px-3 py-3 text-left">Reason</th>
                  <th className="sticky right-0 z-20 bg-slate-50 px-3 py-3 text-right shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.18)]">
                    Tools
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const label = actionLabel(row.action_type, row.meta_json);
                  const badgeClass = BADGE_STYLES[label] || "bg-slate-100 text-slate-700";
                  const signedQty = signedMovementQuantity(row);
                  const qtyLabel = formatSignedQuantity(signedQty);
                  const qtyDirection = signedQty < 0 ? "removed" : signedQty > 0 ? "added" : "unchanged";
                  let meta = {};
                  try {
                    meta = row.meta_json ? JSON.parse(row.meta_json) : {};
                  } catch {
                    meta = {};
                  }
                  const transactionId = row.transaction_id || meta.transaction_id || "";
                  const isRestockTransfer = ["restock", "restock_in", "restock_out"].includes(label);
                  const actionCellText =
                    label === "stock_out" && meta.stock_out_reason
                      ? `${actionDisplayLabel(label)} (${meta.stock_out_reason})`
                      : actionDisplayLabel(label);
                  return (
                    <tr key={row.id} className="border-t border-slate-100 align-top">
                      <td className="truncate px-3 py-3 text-slate-700" title={formatTimestamp(row.timestamp)}>
                        {formatTimestamp(row.timestamp)}
                      </td>
                      <td className="truncate px-3 py-3 text-slate-700" title={`${actorDisplayName(row)} (${row.actor_role || "staff"})`}>
                        {actorDisplayName(row)} <span className="text-slate-400">({row.actor_role || "staff"})</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex max-w-full truncate rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${badgeClass}`} title={actionCellText}>{actionCellText}</span>
                      </td>
                      <td className="truncate px-3 py-3 text-slate-700" title={`${qtyLabel} units · ${row.item_name || "-"}`}>
                        <span className={signedQty < 0 ? "text-rose-700" : "text-emerald-800"}>{qtyLabel}</span>
                        <span className="sr-only"> {qtyDirection}</span>
                        {" "}units · {row.item_name || "-"}
                      </td>
                      <td className="truncate px-3 py-3 text-slate-700" title={`${row.source_text || "-"} → ${row.destination_text || "-"}`}>
                        {row.source_text || "-"} <span className="text-slate-400">→</span> {row.destination_text || "-"}
                      </td>
                      <td className="truncate px-3 py-3 text-xs text-slate-400" title={row.batch_id || "-"}>
                        {row.batch_id || (row.legacy_data_unavailable ? "Legacy/unknown lot" : "-")}
                      </td>
                      <td className="px-3 py-3 text-slate-700 tabular-nums">
                        {row.resulting_balance == null ? "—" : row.resulting_balance}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        {row.request_id ? <div>Request #{row.request_id}</div> : null}
                        {row.receipt_number ? <div>Receipt {row.receipt_number}</div> : null}
                        {row.billing_id && ['doctor','admin','accountant'].includes(user?.role) ? <a href={`/billing?billId=${row.billing_id}`} className="inline-flex min-h-11 items-center text-teal-700">Bill #{row.billing_id}</a> : null}
                        {row.billing_status ? <div>{row.billing_status}</div> : null}
                        {!row.request_id && !row.receipt_number && !row.billing_id && !row.billing_status ? "—" : null}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">{row.expiry_date || "—"}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        {row.reason_note || "—"}
                        {row.legacy_data_unavailable ? (
                          <span className="mt-1 block font-semibold text-amber-800">Legacy/unavailable data</span>
                        ) : null}
                      </td>
                      <td className="sticky right-0 z-10 bg-white px-3 py-3 text-right shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.12)]">
                        {transactionId && isRestockTransfer ? (
                          <div className="flex justify-end gap-1">
                            {meta.request_id ? (
                              <a
                                href={`/supply-requests`}
                                className="inline-grid size-9 place-items-center rounded-xl text-teal-600"
                                title="Open supply request"
                              >
                                <RotateCcw className="size-4" />
                              </a>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => reprintReceipt(transactionId)}
                              className="inline-grid size-9 place-items-center rounded-xl bg-transparent text-teal-600 transition hover:text-teal-800"
                              title="Print receipt"
                              aria-label="Print receipt"
                            >
                              <Printer className="size-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </SectionCard>

      {user?.role === "doctor" ? (
        <SectionCard title="Supply requests and receipts">
          <p className="text-sm text-slate-600">
            Completed {requestHistory.filter((row) => row.status === "completed").length} · Cancelled{" "}
            {requestHistory.filter((row) => row.status === "cancelled").length} · Transfer receipts{" "}
            {receiptIds.length}
          </p>
          <ul className="mt-3 space-y-2">
            {requestHistory.slice(0, 12).map((request) => (
              <li key={request.id} className="rounded-2xl border border-slate-200 px-3 py-2 text-sm">
                <p className="font-semibold text-slate-800">Request #{request.id} · {request.status}</p>
                <p className="text-xs text-slate-500">
                  {request.completed_at || request.cancelled_at || request.created_at}
                  {request.transfer_transaction_id ? ` · Receipt ${request.transfer_transaction_id}` : ""}
                </p>
                {request.transfer_transaction_id ? (
                  <button
                    type="button"
                    className="mt-1 text-xs font-semibold text-teal-700"
                    onClick={() => reprintReceipt(request.transfer_transaction_id)}
                  >
                    Open receipt
                  </button>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    {request.status === "cancelled"
                      ? "Cancelled before transfer — no receipt was created."
                      : "Legacy record — receipt details unavailable."}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}

export default StockActivityPage;
