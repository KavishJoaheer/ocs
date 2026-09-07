import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Ellipsis,
  Minus,
  MinusCircle,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import toast from "react-hot-toast";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import InventoryStagingQueue from "../components/InventoryStagingQueue.jsx";
import InventoryCsvImport from "../components/InventoryCsvImport.jsx";
import InventoryStocktakePanel from "../components/InventoryStocktakePanel.jsx";
import OperatorSupplyRequestsPanel from "../components/OperatorSupplyRequestsPanel.jsx";
import OperatorWorkQueuesPanel from "../components/OperatorWorkQueuesPanel.jsx";
import AddStockModal from "../components/inventory/AddStockModal.jsx";
import DoctorTransferModal from "../components/inventory/DoctorTransferModal.jsx";
import ExceptionalCorrectionModal from "../components/inventory/ExceptionalCorrectionModal.jsx";
import InventoryTabSummaries from "../components/inventory/InventoryTabSummaries.jsx";
import ItemEditorModal from "../components/inventory/ItemEditorModal.jsx";
import TransferReceiptModal from "../components/inventory/TransferReceiptModal.jsx";
import WriteOffStockModal from "../components/inventory/WriteOffStockModal.jsx";
import {
  canApplyExceptionalCorrection,
  canArchiveCatalogueItem,
  canReceiveWarehouseStock,
  canTransferToDoctorBag,
  canWriteOffWarehouseStock,
  isAdminUser,
  isOperatorUser,
  withOperationalOverride,
} from "../lib/inventoryAccess.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api, ApiError } from "../lib/api.js";
import { buildInventoryListQuery, getDefaultFolderSelection } from "../lib/inventoryFolders.js";
import {
  notifyDoctorBagInventoryUpdated,
  notifyOcsInventoryUpdated,
  notifySupplyRequestsUpdated,
  DOCTOR_BAG_INVENTORY_EVENT,
  OCS_INVENTORY_EVENT,
} from "../lib/inventorySync.js";
import {
  applyOptimisticBagDeduct,
  applyOptimisticBagRestock,
  OFFLINE_QUEUE_FLUSH_COMPLETE,
  OFFLINE_QUEUE_ITEM_SYNCED,
  OFFLINE_SAVED_TOAST,
  queueInventoryMutation,
  shouldQueueInventoryMutation,
} from "../lib/inventoryOfflineSync.js";
import { loadAssignedPatientPicker } from "../lib/patientOfflineSync.js";
import { formatRupees } from "../lib/format.js";
import { doctorBagHeading, formatStockExpiryLabel, itemHasExpiredStock } from "../lib/inventoryStockDisplay.js";
import {
  isAtOrBelowPar,
  isExpiredItem,
  isMissingExpiryItem,
  isNearExpiryItem,
  readDoctorMetrics,
} from "../lib/doctorInventoryMetrics.js";
import { cx, pageContainerClass } from "../lib/utils.js";
import { printTransferReceipt } from "../lib/transferReceipt.js";

dayjs.extend(isoWeek);

const INVENTORY_PERIOD_PRESETS = [
  { id: "yearly", label: "Yearly" },
  { id: "monthly", label: "Monthly" },
  { id: "weekly", label: "Weekly" },
];

function inventoryTodayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function getInventoryDateRange(preset, anchorDateStr) {
  const anchor = dayjs(anchorDateStr || inventoryTodayInputValue());
  if (!anchor.isValid()) {
    const today = inventoryTodayInputValue();
    return { from: today, to: today };
  }
  switch (preset) {
    case "yearly":
      return {
        from: anchor.startOf("year").format("YYYY-MM-DD"),
        to: anchor.endOf("year").format("YYYY-MM-DD"),
      };
    case "monthly":
      return {
        from: anchor.startOf("month").format("YYYY-MM-DD"),
        to: anchor.endOf("month").format("YYYY-MM-DD"),
      };
    case "weekly":
      return {
        from: anchor.startOf("isoWeek").format("YYYY-MM-DD"),
        to: anchor.endOf("isoWeek").format("YYYY-MM-DD"),
      };
    case "specific":
      return {
        from: anchorDateStr,
        to: anchorDateStr,
      };
    default:
      return {
        from: anchor.startOf("month").format("YYYY-MM-DD"),
        to: anchor.endOf("month").format("YYYY-MM-DD"),
      };
  }
}

function formatInventoryExpiry(itemOrValue) {
  if (itemOrValue && typeof itemOrValue === "object") {
    return formatStockExpiryLabel(itemOrValue);
  }
  if (!itemOrValue) return "Expiry missing";
  const parsed = dayjs(itemOrValue);
  return parsed.isValid() ? parsed.format("D MMM YYYY") : "Expiry missing";
}

function InventoryQuantityLines({ item, compact = false, showMinimum = compact }) {
  const onHand = Number(item.on_hand_quantity ?? item.quantity ?? 0);
  const reserved = Number(item.reserved_quantity || 0);
  const expired = Number(item.expired_quantity || 0);
  const available = Number(item.available_to_use ?? Math.max(0, onHand - reserved - expired));
  const minimum = Number(item.minimum_quantity || 0);
  const lineClass = compact ? "text-[11px] leading-snug text-slate-500" : "text-xs text-slate-600";
  return (
    <div className={cx("flex flex-col gap-0.5", lineClass)}>
      <span>On hand: <strong className="tabular-nums text-slate-900">{onHand}</strong></span>
      {reserved > 0 ? <span>Reserved: <strong className="tabular-nums text-slate-900">{reserved}</strong></span> : null}
      <span className={expired > 0 ? "text-rose-700" : ""}>
        Expired: <strong className="tabular-nums">{expired}</strong>
      </span>
      <span>Available to use: <strong className="tabular-nums text-slate-900">{available}</strong></span>
      {showMinimum ? <span>Minimum: <strong className="tabular-nums text-slate-900">{minimum}</strong></span> : null}
    </div>
  );
}

function suggestedBagFillQty(currentQty, minQty, ocsAvailable) {
  const need = Math.max(Number(minQty || 0) - Number(currentQty || 0), 0);
  return Math.min(need, Math.max(0, Number(ocsAvailable || 0)));
}

function buildDoctorFillCandidate(myItem, source) {
  if (!source?.id) return null;
  const current = Number(myItem.quantity || 0);
  const min = Number(myItem.minimum_quantity || 0);
  const ocsAvailable = Number(source.available_to_use ?? source.quantity ?? 0);
  const required = suggestedBagFillQty(current, min, ocsAvailable);
  if (required <= 0) return null;
  return {
    ocs_item_id: Number(source.id),
    item_name: myItem.item_name,
    current_quantity: current,
    par_level: min,
    required_quantity: required,
    ocs_available: ocsAvailable,
    ocs_expiry: source.nearest_usable_expiry || source.expiry_date || null,
  };
}

function formatCompareMoney(amount, qty) {
  if (Number(qty || 0) > 0 && Number(amount || 0) === 0) return "Unpriced";
  return formatRupees(amount);
}

function formatCompareQty(qty) {
  const count = Number(qty || 0);
  return `${count} u`;
}

function InventoryStatusChips({ item }) {
  const quantity = Number(item.quantity || 0);
  const parLevel = Number(item.minimum_quantity || 0);
  const isLow = parLevel > 0 && quantity <= parLevel;
  const missingExpiry = Boolean(item.missing_expiry);
  const nearExpiry = Boolean(item.is_near_expiry);
  const expired = itemHasExpiredStock(item);
  const available = Number(item.available_to_use ?? 0);
  const nonExpiring = Boolean(item.is_non_expiring_only || item.has_non_expiring) && !missingExpiry && !expired;

  if (!isLow && !missingExpiry && !nearExpiry && !expired && !nonExpiring) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {expired ? (
        <span
          role="status"
          aria-label={`Stock status: ${available > 0 ? "Contains expired units" : "Expired"}`}
          className="inline-flex rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
        >
          <span className="sr-only">Stock status: </span>
          {available > 0 ? "Contains expired" : "Expired"}
        </span>
      ) : null}
      {isLow ? (
        <span
          role="status"
          aria-label="Stock status: At or below par"
          className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700"
        >
          Low
        </span>
      ) : null}
      {nearExpiry ? (
        <span
          role="status"
          aria-label="Stock status: Near expiry"
          className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
        >
          Near expiry
        </span>
      ) : null}
      {missingExpiry ? (
        <span
          role="status"
          aria-label="Stock status: Expiry missing"
          className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
        >
          Expiry missing
        </span>
      ) : null}
      {nonExpiring ? (
        <span
          role="status"
          aria-label="Stock status: Non-expiring"
          className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
        >
          Non-expiring
        </span>
      ) : null}
    </div>
  );
}

function formatInventoryPeriodLabel(preset, dateFrom, dateTo) {
  const from = dayjs(dateFrom);
  const to = dayjs(dateTo);
  if (preset === "specific" && from.isValid()) {
    return from.format("DD/MM/YYYY");
  }
  if (preset === "yearly" && from.isValid()) {
    return from.format("YYYY");
  }
  if (preset === "monthly" && from.isValid()) {
    return from.format("MMMM YYYY");
  }
  if (preset === "weekly" && from.isValid() && to.isValid()) {
    return `${from.format("DD MMM")} – ${to.format("DD MMM YYYY")}`;
  }
  if (from.isValid() && to.isValid()) {
    return `${from.format("DD/MM/YYYY")} – ${to.format("DD/MM/YYYY")}`;
  }
  return "Selected period";
}

function InventoryPeriodFilter({ preset, anchorDate, onPresetChange, onAnchorDateChange, className }) {
  return (
    <div
      className={cx(
        "flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm",
        className,
      )}
      role="group"
      aria-label="Time period"
    >
      {INVENTORY_PERIOD_PRESETS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onPresetChange(opt.id)}
          className={cx(
            "min-h-11 rounded-xl px-3 text-xs font-semibold transition",
            preset === opt.id
              ? "bg-[#2d8f98] text-white shadow-sm"
              : "border border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900",
          )}
        >
          {opt.label}
        </button>
      ))}
      <label
        title="Custom date"
        className={cx(
          "flex cursor-pointer items-center gap-1 rounded-xl border bg-white px-2 py-1 transition",
          preset === "specific"
            ? "border-[#2d8f98] bg-[#ecf8f7] ring-1 ring-[#2d8f98]/30"
            : "border-slate-200 hover:border-slate-300",
        )}
      >
        <Calendar className="size-3.5 shrink-0 text-[#2d8f98]" />
        <span className="sr-only">Custom date</span>
        <input
          type="date"
          value={anchorDate}
          onChange={(event) => {
            onAnchorDateChange(event.target.value);
            onPresetChange("specific");
          }}
          className="max-w-[10rem] cursor-pointer border-0 bg-transparent py-0.5 text-xs font-semibold text-slate-800 outline-none"
        />
      </label>
    </div>
  );
}

function inventorySortModeLabel(mode) {
  switch (mode) {
    case "name_asc":
      return "Name (A–Z)";
    case "qty_asc":
      return "Qty (Lowest)";
    case "qty_desc":
      return "Qty (Highest)";
    case "expiry_asc":
    default:
      return "Expiry (Soonest)";
  }
}

/** Safe segment for workbook / file names (no path separators). */
function sanitizeInventoryExportToken(value, fallback = "X") {
  const raw = String(value ?? "").trim();
  const cleaned = raw
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
  return cleaned || fallback;
}

function excelSafeSheetTitle(title) {
  const cleaned = String(title)
    .replace(/\\/g, "-")
    .replace(/\//g, "-")
    .replace(/\?/g, "-")
    .replace(/\*/g, "-")
    .replace(/:/g, "-")
    .replace(/\[/g, "-")
    .replace(/\]/g, "-")
    .trim()
    .slice(0, 31);
  return cleaned || "Stock";
}

const DOCTOR_MOBILE_STOCK_SCOPES = [
  { id: "my", label: "My bag" },
  { id: "ocs", label: "OCS depot" },
];

function SummaryCard({ title, value, tone = "teal", hint, onClick, active = false }) {
  const valueToneClass = tone === "amber" ? "text-amber-700" : tone === "rose" ? "text-rose-700" : "text-slate-950";
  const className = cx(
    "rounded-2xl border bg-white p-3 md:rounded-3xl md:p-5",
    active ? "border-ocs-teal/50 ring-2 ring-ocs-teal/20" : "border-slate-200/80",
    onClick && "cursor-pointer text-left transition hover:border-ocs-teal/40 hover:bg-slate-50",
  );
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      <p className={`mt-1.5 text-lg font-semibold leading-tight tabular-nums md:mt-2.5 md:text-2xl ${valueToneClass}`}>
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

function operatorItemFormState(folderId) {
  return {
    item_name: "",
    quantity: "0",
    minimum_quantity: "0",
    folder_id: folderId ? String(folderId) : "",
    unit: "unit",
    cost_price: "0",
    selling_price: "0",
    attributes: "",
    moa_notes: "",
  };
}

function resolveItemFolderId(item, folders = []) {
  if (!item) return "";
  const direct = folders.find((folder) => String(folder.id) === String(item.folder_id));
  if (direct) return String(direct.id);
  const byName = folders.find((folder) => folder.name === item.folder_name);
  if (byName) return String(byName.id);
  return item.folder_id ? String(item.folder_id) : "";
}

function ActionModal({ open, item, type, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [patientId, setPatientId] = useState("");
  const [consultationId, setConsultationId] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuantity("1");
      setNote("");
      setPatientId("");
      setConsultationId("");
    }
  }

  const isSell = type === "sell";
  const title = type === "add" ? "Add Stock" : isSell ? "Sell Item" : "Remove Stock";
  return (
    <Modal open={open} onClose={onClose} title={`${title}${item ? ` - ${item.item_name}` : ""}`} description="Record item usage and stock updates.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            action_type: type,
            quantity: Number(quantity || 0),
            note,
            patient_id: Number(patientId || 0),
            consultation_id: Number(consultationId || 0),
          });
        }}
      >
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Quantity</span>
          <input required min="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
        </label>
        {isSell ? (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Patient ID</span>
              <input required min="1" type="number" value={patientId} onChange={(event) => setPatientId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Consultation ID</span>
              <input required min="1" type="number" value={consultationId} onChange={(event) => setConsultationId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
            </label>
          </div>
        ) : null}
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Note</span>
          <textarea rows="3" value={note} onChange={(event) => setNote(event.target.value)} className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3" />
        </label>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="submit" disabled={isSaving} className="rounded-2xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{isSaving ? "Saving..." : title}</button>
        </div>
      </form>
    </Modal>
  );
}

function DoctorRestockModal({ open, item, candidates = [], isSaving, onClose, onSubmit }) {
  const isFill = !item;
  const fillRows = isFill
    ? (candidates || []).filter((row) => Number(row.required_quantity || 0) > 0 && Number(row.ocs_available || 0) > 0)
    : [];
  const available = Number(item?.ocs_available || 0);
  const suggestedSingle = item
    ? suggestedBagFillQty(item.current_quantity, item.par_level, item.ocs_available)
    : 0;

  const [quantity, setQuantity] = useState("1");
  const [qtyById, setQtyById] = useState({});
  const [syncedDeps, setSyncedDeps] = useState({ open, item, fillKey: "" });
  const fillKey = fillRows.map((row) => `${row.ocs_item_id}:${row.required_quantity}`).join("|");

  if (syncedDeps.open !== open || syncedDeps.item !== item || syncedDeps.fillKey !== fillKey) {
    setSyncedDeps({ open, item, fillKey });
    if (open) {
      const nextQty = suggestedSingle > 0 ? suggestedSingle : Math.min(1, available);
      setQuantity(String(nextQty > 0 ? nextQty : "1"));
      const nextMap = {};
      fillRows.forEach((row) => {
        nextMap[row.ocs_item_id] = String(row.required_quantity);
      });
      setQtyById(nextMap);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isFill ? "Emergency stock transfer" : `Emergency stock transfer — ${item?.item_name || ""}`.trim()}
      description={
        isFill
          ? "This bypasses the operator-prepared supply workflow. Operators and admins are notified."
          : "This bypasses the operator-prepared supply workflow. Quantity is suggested to reach minimum. Operators and admins are notified."
      }
      size="lg"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (isFill) {
            const requests = fillRows
              .map((row) => ({
                ocs_item_id: Number(row.ocs_item_id),
                quantity: Number(qtyById[row.ocs_item_id] || 0),
                item_name: row.item_name,
                ocs_available: Number(row.ocs_available || 0),
              }))
              .filter((row) => Number.isInteger(row.quantity) && row.quantity > 0);
            if (!requests.length) {
              toast.error("Set a quantity on at least one line.");
              return;
            }
            onSubmit(requests);
            return;
          }
          const qty = Number(quantity || 0);
          if (!Number.isInteger(qty) || qty <= 0) return;
          if (qty > available) {
            toast.error("Requested quantity exceeds OCS depot stock.");
            return;
          }
          onSubmit({
            ocs_item_id: Number(item?.ocs_item_id || 0),
            quantity: qty,
            item_name: item?.item_name || "",
            ocs_available: available,
          });
        }}
      >
        {isFill && fillRows.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">
            Nothing to pull. Either the bag is already at minimum, or the depot has none of those items.
          </p>
        ) : null}

        {isFill && fillRows.length ? (
          <div className="max-h-[min(24rem,50vh)] space-y-2 overflow-y-auto">
            {fillRows.map((row) => (
              <div key={row.ocs_item_id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{row.item_name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Bag {row.current_quantity} / {row.par_level} · Depot {row.ocs_available} · Exp{" "}
                      {formatInventoryExpiry(row.ocs_expiry)}
                    </p>
                  </div>
                  <label className="w-20 shrink-0">
                    <span className="sr-only">Quantity for {row.item_name}</span>
                    <input
                      type="number"
                      min="0"
                      max={row.ocs_available}
                      value={qtyById[row.ocs_item_id] ?? ""}
                      onChange={(event) =>
                        setQtyById((prev) => ({ ...prev, [row.ocs_item_id]: event.target.value }))
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-center text-sm"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {!isFill ? (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">{item?.item_name || "Selected item"}</p>
            <p className="mt-1 text-xs text-slate-600">
              In bag: {Number(item?.current_quantity || 0)} / {Number(item?.par_level || 0)} · Depot available:{" "}
              {available}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              Depot batch expiry: {formatInventoryExpiry(item?.ocs_expiry)}
            </p>
            <label className="mt-4 block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Quantity to pull</span>
              <input
                type="number"
                min="1"
                max={available || undefined}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
              />
            </label>
            {Number(quantity || 0) > available ? (
              <p className="mt-2 text-xs font-semibold text-rose-700">
                Requested quantity exceeds OCS depot stock.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
            Cancel
          </button>
          {isFill && fillRows.length === 0 ? null : (
            <button
              type="submit"
              disabled={
                isSaving ||
                (!isFill && (!item?.ocs_item_id || Number(quantity || 0) > available || Number(quantity || 0) < 1))
              }
              className="rounded-2xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isSaving ? "Transferring..." : isFill ? `Transfer ${fillRows.length} line${fillRows.length === 1 ? "" : "s"}` : "Confirm emergency transfer"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

const STOCK_OUT_REASONS = ["Sale", "Wasted", "Expired"];

function StockOutModal({ open, item, isSaving, assignedPatients = [], onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("Sale");
  const [note, setNote] = useState("");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [legacyUnknownLot, setLegacyUnknownLot] = useState(false);
  const [legacyExplanation, setLegacyExplanation] = useState("");
  const [syncedDeps, setSyncedDeps] = useState({ open, item });

  if (syncedDeps.open !== open || syncedDeps.item !== item) {
    setSyncedDeps({ open, item });
    if (open) {
      setQuantity("1");
      setReason("Sale");
      setNote("");
      setSelectedPatientId("");
      setSelectedLotId("");
      setLegacyUnknownLot(false);
      setLegacyExplanation("");
    }
  }

  const lots = Array.isArray(item?.lots) ? item.lots.filter((lot) => Number(lot.quantity_remaining || 0) > 0) : [];
  const unbatched = Number(item?.unbatched_quantity || 0);
  const isSale = reason === "Sale";
  const isLoss = reason === "Wasted" || reason === "Expired";
  const selectedLot = lots.find((lot) => String(lot.id) === String(selectedLotId)) || null;
  const lotBalance = legacyUnknownLot
    ? unbatched
    : selectedLot
      ? Number(selectedLot.quantity_remaining || 0)
      : isSale
        ? Number(item?.available_to_use ?? item?.quantity ?? 0)
        : 0;
  const available = isSale ? Number(item?.available_to_use ?? item?.quantity ?? 0) : lotBalance;
  const selectedPatient = isSale
    ? assignedPatients.find((entry) => String(entry.id) === String(selectedPatientId))
    : null;
  const saleRequiresPatient = isSale && !selectedPatient;
  const qty = Number(quantity || 0);
  const sellingPrice = Number(item?.selling_price || 0);
  const billAmount = isSale && Number.isInteger(qty) && qty > 0 ? sellingPrice * qty : 0;
  const resultingBalance = Math.max(0, Number(item?.quantity || 0) - (Number.isInteger(qty) ? qty : 0));
  const noteReady = !isLoss || String(note || "").trim().length >= 8;
  const lotReady = !isLoss || legacyUnknownLot || selectedLot;
  const legacyReady = !legacyUnknownLot || String(legacyExplanation || "").trim().length >= 8;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Use from bag"
      description={
        isSale
          ? "Deduct from your bag and add quantity × selling price to the patient’s unpaid bill."
          : "Record waste or expiry from your medical bag. This is not billed to a patient."
      }
      size="lg"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!Number.isInteger(qty) || qty <= 0) return;
          if (saleRequiresPatient) {
            toast.error("Select a patient before recording a Sale.");
            return;
          }
          if (isLoss && !noteReady) {
            toast.error("Enter a meaningful reason before confirming.");
            return;
          }
          if (isLoss && !lotReady) {
            toast.error("Select the affected bag lot or confirm this is a legacy/unknown lot.");
            return;
          }
          onSubmit({
            quantity: qty,
            reason,
            note: note.trim(),
            patient_id: selectedPatient ? Number(selectedPatient.id) : null,
            patient_label: selectedPatient
              ? `${selectedPatient.full_name}${selectedPatient.patient_identifier ? ` (${selectedPatient.patient_identifier})` : ""}`
              : "",
            batch_id: legacyUnknownLot ? null : selectedLot ? Number(selectedLot.id) : null,
            legacy_unknown_lot: Boolean(isLoss && legacyUnknownLot),
            legacy_explanation: legacyExplanation.trim(),
          });
        }}
      >
        {isSale ? (
          <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-xs text-teal-900">
            This deducts bag stock and adds the item to the patient&apos;s unpaid bill. If this visit has no consultation yet, the line is added when the note is saved.
          </div>
        ) : (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">
            Wasted and expired stock is logged as operational loss. It is not added to the patient bill.
          </div>
        )}
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">{item?.item_name || "Selected item"}</p>
          <InventoryQuantityLines item={item || {}} />
          <p className="mt-1 text-xs text-slate-600">
            {isSale ? `Available to use: ${available}` : `Selected lot balance: ${available}`}
          </p>

          <label className="mt-4 block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Quantity</span>
            <input
              type="number"
              min="1"
              max={available || undefined}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
            />
          </label>

          <label className="mt-4 block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Reason</span>
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
            >
              {STOCK_OUT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          {isLoss ? (
            <div className="mt-4 space-y-2">
              <span className="text-sm font-semibold text-slate-700">Affected lot</span>
              {lots.length ? (
                <select
                  value={legacyUnknownLot ? "legacy" : selectedLotId}
                  onChange={(event) => {
                    if (event.target.value === "legacy") {
                      setLegacyUnknownLot(true);
                      setSelectedLotId("");
                    } else {
                      setLegacyUnknownLot(false);
                      setSelectedLotId(event.target.value);
                    }
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <option value="">Select lot…</option>
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.expiry_label || formatStockExpiryLabel(lot)} · on hand {lot.quantity_remaining}
                      {lot.id ? ` · lot #${lot.id}` : ""}
                    </option>
                  ))}
                  {unbatched > 0 ? <option value="legacy">Legacy/unknown lot · {unbatched}</option> : null}
                </select>
              ) : (
                <p className="text-xs font-semibold text-amber-800">Legacy/unknown lot — no batch identity is recorded.</p>
              )}
              {(legacyUnknownLot || !lots.length) ? (
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Why is the lot identity unavailable?</span>
                  <textarea
                    rows={2}
                    value={legacyExplanation}
                    onChange={(event) => {
                      setLegacyUnknownLot(true);
                      setLegacyExplanation(event.target.value);
                    }}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    placeholder="e.g. bag stock predates lot tracking"
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {isSale ? (
            <label className="mt-4 block space-y-2">
              <span className="text-sm font-semibold text-slate-700">
                Assign to Patient <span className="text-rose-600">*</span>
              </span>
              <select
                value={selectedPatientId}
                onChange={(event) => setSelectedPatientId(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
              >
                <option value="" disabled>
                  {assignedPatients.length
                    ? "Select patient..."
                    : "No patients available"}
                </option>
                {assignedPatients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.full_name}
                    {patient.patient_identifier ? ` (${patient.patient_identifier})` : ""}
                  </option>
                ))}
              </select>
              {!assignedPatients.length ? (
                <p className="text-[11px] leading-tight text-rose-600">
                  Connect to the clinic network to refresh your patient list, then retry.
                </p>
              ) : null}
            </label>
          ) : null}

          <label className="mt-4 block space-y-2">
            <span className="text-sm font-semibold text-slate-700">
              {isLoss ? "Reason / note" : "Notes (optional)"} {isLoss ? <span className="text-rose-600">*</span> : null}
            </span>
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
              placeholder={
                isSale ? "e.g. payment reference, billing note" : "Describe why this stock is wasted or expired"
              }
            />
          </label>

          {isSale ? (
            <p className="mt-3 text-sm text-slate-700">
              Selling price {formatRupees(sellingPrice)} × {Number.isInteger(qty) ? qty : 0} ={" "}
              <strong>{formatRupees(billAmount)}</strong> will be added to the patient bill.
            </p>
          ) : null}
          <p className="mt-2 text-sm text-slate-700">
            Resulting bag on hand: <strong className="tabular-nums">{resultingBalance}</strong>
          </p>

          {Number(quantity || 0) > available ? (
            <p className="mt-2 text-xs font-semibold text-rose-700">Quantity exceeds available stock.</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
            Cancel
          </button>
          <button
            type="submit"
            disabled={
              isSaving ||
              !item?.id ||
              available < 1 ||
              !Number.isInteger(Number(quantity || 0)) ||
              Number(quantity || 0) <= 0 ||
              Number(quantity || 0) > available ||
              saleRequiresPatient ||
              !noteReady ||
              !lotReady ||
              !legacyReady
            }
            className="min-h-11 rounded-2xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {isSaving
              ? "Saving..."
              : isSale
                ? "Confirm sale"
                : "Confirm use"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const ACTIVITY_FILTER_SELECT_CLASS =
  "min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 outline-none transition focus:border-[#4FB8B3] focus:ring-1 focus:ring-[#4FB8B3]/25";

function formatMovementTimestampEnterprise(value) {
  if (!value) return "—";
  const d = dayjs(value);
  if (!d.isValid()) {
    const s = String(value);
    if (s.length >= 16) {
      const parsed = dayjs(s.slice(0, 16));
      if (parsed.isValid()) return parsed.format("DD MMM, HH:mm");
    }
    return s;
  }
  return d.format("DD MMM, HH:mm");
}

function resolveMovementRoute(movement) {
  const meta = movement.meta || {};
  const source = String(meta.source_location || "").trim();
  const destination = String(meta.destination_location || "").trim();
  if (source && destination) {
    return { source, destination };
  }

  const actionType = String(movement.action_type || "").toLowerCase();
  const doctorName =
    meta.received_by_name ||
    meta.doctor_name ||
    movement.target_doctor_name ||
    movement.owner_doctor_name ||
    "";
  const bag = doctorName ? `${doctorName}'s Bag` : "Doctor's Bag";
  const master = "Master Stock";

  if (actionType === "restock_in" || actionType === "restock_out") {
    return { source: master, destination: bag };
  }
  if (actionType === "sell") {
    return { source: bag, destination: "Patient Account" };
  }
  if (actionType === "stock_out") {
    const reason = String(meta.stock_out_reason || "").trim();
    const reasonLower = reason.toLowerCase();
    return {
      source: bag,
      destination:
        reasonLower === "sale" ? "Patient Account" : reason ? `Stock Out (${reason})` : "Stock Out",
    };
  }
  if (actionType === "stock_in" || actionType === "add") {
    return { source: "Supplier / Intake", destination: master };
  }
  if (actionType === "remove") {
    return { source: master, destination: String(meta.reason || movement.note || "Write-off") };
  }
  return { source: source || "—", destination: destination || "—" };
}

function movementActivityKind(actionType, meta = {}) {
  const at = String(actionType || "").toLowerCase();
  if (at === "restock_in" || at === "restock_out") return "allocation";
  if (at === "sell") return "consumption";
  if (at === "stock_out" && String(meta.stock_out_reason || "").trim().toLowerCase() === "sale") {
    return "consumption";
  }
  if (["adjustment", "override", "correction", "exceptional_correction", "remove", "stock_out"].includes(at)) return "correction";
  return "generic";
}

function movementCorrectionDelta(movement) {
  const prev = Number(movement.previous_quantity);
  const next = Number(movement.next_quantity);
  if (Number.isFinite(prev) && Number.isFinite(next)) {
    return next - prev;
  }
  const movementType = String(movement.movement_type || "").toLowerCase();
  const qty = Math.abs(Number(movement.quantity || 0));
  if (movementType === "out") return -qty;
  if (movementType === "in") return qty;
  return qty;
}

function movementReasonNote(movement) {
  const meta = movement.meta || {};
  return (
    String(meta.stock_out_note || "").trim() ||
    String(meta.reason || "").trim() ||
    String(movement.note || "").trim() ||
    String(meta.stock_out_reason || "").trim() ||
    "Inventory correction"
  );
}

function buildLiveActivityExportRow(movement) {
  const meta = movement.meta || {};
  const route = resolveMovementRoute(movement);
  const staff = meta.performed_by_name || "System";
  const qty = Math.abs(Number(movement.quantity ?? 0));
  const kind = movementActivityKind(movement.action_type, meta);
  const unitLabel = qty === 1 ? "unit" : "units";
  let summary = "";

  if (kind === "allocation") {
    summary = `${staff} allocated ${qty} ${unitLabel} of ${movement.item_name || "item"} (${route.source} ➔ ${route.destination})`;
  } else if (kind === "consumption") {
    summary = `${staff} consumed ${qty} ${unitLabel} of ${movement.item_name || "item"} (${route.source} ➔ ${route.destination})`;
  } else if (kind === "correction") {
    const delta = movementCorrectionDelta(movement);
    summary = `${staff} adjusted ${movement.item_name || "item"} quantity by ${delta} units (${movementReasonNote(movement)})`;
  } else {
    summary = `${staff} updated ${qty} ${unitLabel} of ${movement.item_name || "item"} (${route.source} ➔ ${route.destination})`;
  }

  return {
    Timestamp: formatMovementTimestampEnterprise(movement.created_at),
    "Staff name": staff,
    "Action type": movement.action_type || "",
    Quantity: qty,
    "Item name": movement.item_name || "",
    Source: route.source,
    Destination: route.destination,
    "Reason / notes": movementReasonNote(movement),
    Summary: summary,
  };
}

function buildCompareReconciliationExportRows(compareRows = []) {
  return compareRows.map((row) => ({
    Doctor: row.doctor_name || "",
    "Restocked (units)": Number(row.total_restocked_qty || 0),
    "Restocked (Rs)": Number(row.total_restocked || 0),
    "Sold (units)": Number(row.consumed_sales_qty || 0),
    "Sold (Rs)": Number(row.consumed_sales || 0),
    "Wasted (units)": Number(row.consumed_wasted_qty || 0),
    "Wasted (Rs)": Number(row.consumed_wasted || 0),
    "Expired (units)": Number(row.consumed_expired_qty || 0),
    "Expired (Rs)": Number(row.consumed_expired || 0),
    "Period remaining (Rs)": Number(row.remaining_in_bag || 0),
    "On hand (units)": Number(row.bag_on_hand_qty || 0),
    "On hand (Rs)": Number(row.bag_on_hand || 0),
    "Variance (Rs)": Number(row.variance_rs || 0),
  }));
}

function downloadCompareReconciliationExcel({ compareRows, periodLabel, startDate, endDate }) {
  if (!compareRows?.length) {
    toast.error("No reconciliation rows available for export.");
    return;
  }

  const fromToken = sanitizeInventoryExportToken(startDate, "start");
  const toToken = sanitizeInventoryExportToken(endDate, "end");
  const fileName = `OCS_Bag_Reconciliation_${fromToken}_${toToken}.xlsx`;

  const workbook = XLSX.utils.book_new();
  const reconSheet = XLSX.utils.json_to_sheet(buildCompareReconciliationExportRows(compareRows));
  XLSX.utils.book_append_sheet(workbook, reconSheet, excelSafeSheetTitle("Reconciliation"));

  const metaSheet = XLSX.utils.json_to_sheet([
    { Field: "Report", Value: "OCS Bag Reconciliation Matrix" },
    { Field: "Period label", Value: periodLabel },
    { Field: "Start date", Value: startDate },
    { Field: "End date", Value: endDate },
    { Field: "Doctor rows", Value: String(compareRows.length) },
    { Field: "Generated at", Value: dayjs().format("YYYY-MM-DD HH:mm") },
  ]);
  XLSX.utils.book_append_sheet(workbook, metaSheet, "Filters");

  XLSX.writeFile(workbook, fileName);
  toast.success("Reconciliation matrix exported.");
}

function downloadLiveActivityExcel({ rows, staffLabel, startDate, endDate, periodLabel, compareRows = [] }) {
  if (!rows.length && !compareRows?.length) {
    toast.error("No activity rows match the current filters.");
    return;
  }

  const staffToken = sanitizeInventoryExportToken(staffLabel.replace(/\s+/g, "_"), "All_Staff");
  const fromToken = sanitizeInventoryExportToken(startDate, "start");
  const toToken = sanitizeInventoryExportToken(endDate, "end");
  const fileName = `OCS_Inventory_History_${staffToken}_${fromToken}_${toToken}.xlsx`;

  const workbook = XLSX.utils.book_new();

  if (rows.length) {
    const sheetRows = rows.map(buildLiveActivityExportRow);
    const historySheet = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(workbook, historySheet, excelSafeSheetTitle("History"));
  }

  if (compareRows?.length) {
    const reconSheet = XLSX.utils.json_to_sheet(buildCompareReconciliationExportRows(compareRows));
    XLSX.utils.book_append_sheet(workbook, reconSheet, excelSafeSheetTitle("Reconciliation"));
  }

  const metaSheet = XLSX.utils.json_to_sheet([
    { Field: "Report", Value: "OCS Inventory History" },
    { Field: "Staff filter", Value: staffLabel },
    { Field: "Period label", Value: periodLabel },
    { Field: "Start date", Value: startDate },
    { Field: "End date", Value: endDate },
    { Field: "History rows", Value: String(rows.length) },
    { Field: "Reconciliation rows", Value: String(compareRows?.length || 0) },
    { Field: "Generated at", Value: dayjs().format("YYYY-MM-DD HH:mm") },
  ]);
  XLSX.utils.book_append_sheet(workbook, metaSheet, "Filters");

  XLSX.writeFile(workbook, fileName);
  toast.success("Inventory history exported.");
}

function CompareMetricCell({ amount, qty, onUnpriced }) {
  const unpriced = Number(qty || 0) > 0 && Number(amount || 0) === 0;
  return (
    <div className="text-right">
      <p className="tabular-nums text-slate-900">{formatCompareQty(qty)}</p>
      {unpriced && onUnpriced ? (
        <button type="button" onClick={onUnpriced} className="text-[11px] font-semibold text-amber-700 underline">
          Unpriced
        </button>
      ) : (
        <p className="break-words text-[11px] text-slate-400">{formatCompareMoney(amount, qty)}</p>
      )}
    </div>
  );
}

function CompareRemainingCell({ value, variance, qty }) {
  const amount = Number(value || 0);
  const drift = Number(variance || 0);
  const broken = Math.abs(drift) >= 0.5;
  return (
    <div className="text-right">
      <span
        className={cx(
          "tabular-nums",
          amount < 0 || broken ? "rounded bg-red-50 px-2 py-0.5 font-bold text-red-600" : "text-slate-800",
        )}
      >
        {formatCompareMoney(amount, qty)}
      </span>
      {broken ? (
        <p className="mt-0.5 text-[11px] font-semibold text-rose-600">Off by {formatRupees(drift)}</p>
      ) : null}
    </div>
  );
}

function MovementActivityLine({ movement }) {
  const meta = movement.meta || {};
  const staff = meta.performed_by_name || movement.actor_display_name || movement.actor_name || "Legacy staff record";
  const qty = Math.abs(Number(movement.quantity ?? 0));
  const itemName = movement.item_name || "item";
  const unitLabel = qty === 1 ? "unit" : "units";
  const route = resolveMovementRoute(movement);
  const kind = movementActivityKind(movement.action_type, meta);
  const timeLabel = formatMovementTimestampEnterprise(movement.created_at);

  let sentence = null;
  if (kind === "allocation") {
    sentence = (
      <>
        <strong className="font-bold text-slate-950">{staff}</strong>
        {" allocated "}
        <strong className="font-bold text-slate-950">{qty}</strong>
        {` ${unitLabel} of `}
        <strong className="font-bold text-slate-950">{itemName}</strong>
        {` (${route.source} ➔ ${route.destination})`}
      </>
    );
  } else if (kind === "consumption") {
    sentence = (
      <>
        <strong className="font-bold text-slate-950">{staff}</strong>
        {" consumed "}
        <strong className="font-bold text-slate-950">{qty}</strong>
        {` ${unitLabel} of `}
        <strong className="font-bold text-slate-950">{itemName}</strong>
        {` (${route.source} ➔ ${route.destination})`}
      </>
    );
  } else if (kind === "correction") {
    const delta = movementCorrectionDelta(movement);
    sentence = (
      <>
        <strong className="font-bold text-slate-950">{staff}</strong>
        {" adjusted "}
        <strong className="font-bold text-slate-950">{itemName}</strong>
        {" quantity by "}
        <strong className="font-bold text-slate-950">{delta}</strong>
        {` units (${movementReasonNote(movement)})`}
      </>
    );
  } else {
    sentence = (
      <>
        <strong className="font-bold text-slate-950">{staff}</strong>
        {" updated "}
        <strong className="font-bold text-slate-950">{qty}</strong>
        {` ${unitLabel} of `}
        <strong className="font-bold text-slate-950">{itemName}</strong>
        {` (${route.source} ➔ ${route.destination})`}
      </>
    );
  }

  const kindTone =
    kind === "allocation"
      ? "border-l-[#2d8f98]"
      : kind === "consumption"
        ? "border-l-amber-400"
        : kind === "correction"
          ? "border-l-rose-300"
          : "border-l-slate-200";

  return (
    <div className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 border-l-2 py-1.5 pl-2 text-sm last:border-b-0", kindTone)}>
      <span className="shrink-0 text-xs text-gray-400">{timeLabel}</span>
      <span className="shrink-0 text-xs text-gray-400" aria-hidden>
        •
      </span>
      <p className="min-w-0 flex-1 leading-snug text-slate-800">{sentence}</p>
    </div>
  );
}

function LiveActivitySection({
  movements,
  maxRows = 55,
  scrollClassName = "max-h-80",
  showStaffFilters = false,
  hidePeriodFilter = false,
  preview = false,
  staffOptions = [],
  activityStaffUserId = "",
  onActivityStaffUserIdChange,
  periodPreset = "monthly",
  periodAnchorDate = "",
  onPeriodPresetChange,
  onPeriodAnchorDateChange,
  dateFrom = "",
  dateTo = "",
  compareRows = [],
}) {
  const doctorStaff = useMemo(
    () => staffOptions.filter((member) => String(member.role || "").toLowerCase() === "doctor"),
    [staffOptions],
  );
  const operatorStaff = useMemo(
    () => staffOptions.filter((member) => String(member.role || "").toLowerCase() === "operator"),
    [staffOptions],
  );

  const periodLabel = useMemo(
    () => formatInventoryPeriodLabel(periodPreset, dateFrom, dateTo),
    [periodPreset, dateFrom, dateTo],
  );

  const filteredRows = useMemo(() => {
    if (!activityStaffUserId) return movements;
    return movements.filter((movement) => {
      const metaUserId = Number(movement.meta?.performed_by_user_id || 0);
      const recordedUserId = Number(movement.recorded_by_user_id || 0);
      const targetId = Number(activityStaffUserId);
      return metaUserId === targetId || recordedUserId === targetId;
    });
  }, [movements, activityStaffUserId]);

  const rows = filteredRows.slice(0, maxRows);

  const selectedStaffLabel = useMemo(() => {
    if (!activityStaffUserId) return "All Staff";
    const match = staffOptions.find((member) => String(member.id) === String(activityStaffUserId));
    return match?.full_name || "Selected Staff";
  }, [activityStaffUserId, staffOptions]);

  const emptyFilteredUser = showStaffFilters && rows.length === 0 && activityStaffUserId;

  return (
    <SectionCard className="min-w-0">
      <div className="mb-4 flex min-w-0 flex-col space-y-3 border-b border-gray-100 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-gray-900">Stock history</h3>
            {preview ? (
              <p className="mt-0.5 text-xs text-slate-500">Latest moves this period</p>
            ) : null}
          </div>
          {preview ? (
            <Link to="/stock-history" className="shrink-0 text-xs font-semibold text-ocs-teal hover:underline">
              Open Stock history
            </Link>
          ) : null}
        </div>
        {showStaffFilters ? (
          <div className="flex w-full min-w-0 flex-col gap-3">
            {hidePeriodFilter ? null : (
              <InventoryPeriodFilter
                preset={periodPreset}
                anchorDate={periodAnchorDate}
                onPresetChange={onPeriodPresetChange}
                onAnchorDateChange={onPeriodAnchorDateChange}
                className="w-full max-w-none"
              />
            )}
            <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Filter by Staff
                </span>
                <select
                  value={activityStaffUserId}
                  onChange={(event) => onActivityStaffUserIdChange?.(event.target.value)}
                  className={cx(ACTIVITY_FILTER_SELECT_CLASS, "w-full min-h-10 py-2 text-sm")}
                >
                  <option value="">All Staff / Users</option>
                  {doctorStaff.length ? (
                    <optgroup label="Doctors">
                      {doctorStaff.map((member) => (
                        <option key={member.id} value={String(member.id)}>
                          {member.full_name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {operatorStaff.length ? (
                    <optgroup label="Operators">
                      {operatorStaff.map((member) => (
                        <option key={member.id} value={String(member.id)}>
                          {member.full_name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  downloadLiveActivityExcel({
                    rows: filteredRows,
                    staffLabel: selectedStaffLabel,
                    startDate: dateFrom,
                    endDate: dateTo,
                    periodLabel,
                    compareRows,
                  })
                }
                className="inline-flex w-full min-h-10 shrink-0 items-center justify-center gap-2 self-stretch rounded-2xl bg-[#4FB8B3] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#3aa6a1] sm:w-auto"
              >
                <Download className="size-4 shrink-0" />
                <span className="whitespace-nowrap">Download history</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className={cx("overflow-y-auto rounded-2xl border border-slate-200 bg-white/80 px-2 py-2", scrollClassName)}>
        {emptyFilteredUser ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No logged stock movements found for this user.
          </p>
        ) : rows.length ? (
          <div className="flex flex-col space-y-1">
            {rows.map((movement) => (
              <MovementActivityLine key={`mv-${movement.id}`} movement={movement} />
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">No movement activity recorded yet.</p>
        )}
      </div>
    </SectionCard>
  );
}


function inventoryActionMenuPosition(anchor, { width = 224, estimatedHeight = 360 } = {}) {
  const rect = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(8, rect.right - width), Math.max(8, window.innerWidth - width - 8));
  const below = rect.bottom + 6;
  const maxHeight = Math.min(estimatedHeight, window.innerHeight - 16);
  const top = below + maxHeight > window.innerHeight - 8
    ? Math.max(8, rect.top - maxHeight - 6)
    : below;
  return { top, left, maxHeight };
}

const INVENTORY_MOBILE_MENU_ITEM =
  "flex w-full min-h-11 items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d8f98]";

function InventoryMobileActionTray({ primary, menuItems = [], moreLabel = "More actions" }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const menuRef = useRef(null);
  const menuPanelRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function handleMouseDown(event) {
      const target = event.target;
      if (menuRef.current?.contains(target) || menuPanelRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function handleEscape(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  function openMenu() {
    const anchor = menuRef.current;
    if (!anchor) return;
    setMenuPosition(inventoryActionMenuPosition(anchor, { width: 200, estimatedHeight: 280 }));
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="flex min-w-[70px] items-center justify-end gap-2">
      {primary ? (
        <button
          type="button"
          title={primary.title}
          aria-label={primary.title}
          disabled={primary.disabled}
          onClick={primary.onClick}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700 transition-colors hover:bg-teal-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {primary.icon || <Plus className="h-4 w-4" strokeWidth={2.5} />}
        </button>
      ) : null}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          title={moreLabel}
          aria-label={moreLabel}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => (menuOpen ? closeMenu() : openMenu())}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-gray-500 transition-colors hover:text-gray-700 active:scale-95"
        >
          <MoreVertical className="h-5 w-5" strokeWidth={2.5} />
        </button>
        {menuOpen && menuPosition && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={menuPanelRef}
                role="menu"
                className="fixed z-[100] min-w-[12.5rem] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                style={{ top: menuPosition.top, left: menuPosition.left, maxHeight: menuPosition.maxHeight }}
              >
                {menuItems.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    disabled={entry.disabled}
                    className={cx(
                      INVENTORY_MOBILE_MENU_ITEM,
                      entry.danger ? "text-rose-700 hover:bg-rose-50" : "",
                      entry.disabled ? "cursor-not-allowed opacity-40" : "",
                    )}
                    onClick={() => {
                      if (entry.disabled) return;
                      closeMenu();
                      entry.onClick();
                    }}
                  >
                    {entry.icon ? <span className="shrink-0 text-slate-500">{entry.icon}</span> : null}
                    {entry.label}
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null}
      </div>
    </div>
  );
}

function InventoryOcsMasterActions({
  item,
  user,
  touchWrap = false,
  onStockIn,
  onEdit,
  onRestockDoctor,
  onRemove,
  onDeleteItem,
  onExceptionalCorrection,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const menuRef = useRef(null);
  const menuPanelRef = useRef(null);
  const isAdmin = isAdminUser(user);
  const isOperator = isOperatorUser(user);

  useEffect(() => {
    if (!menuOpen || touchWrap) return undefined;
    function handleMouseDown(event) {
      const target = event.target;
      if (menuRef.current?.contains(target) || menuPanelRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function handleEscape(event) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen, touchWrap]);

  function openMenu() {
    const anchor = menuRef.current;
    if (!anchor) return;
    setMenuPosition(inventoryActionMenuPosition(anchor, { width: 224, estimatedHeight: 420 }));
    setMenuOpen(true);
  }

  const primaryBtn =
    "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-[#4FB8B3] px-3 text-xs font-semibold text-white transition hover:bg-[#3aa6a1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d8f98]";
  const moreBtn =
    "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d8f98]";

  const showArchive = Boolean(onDeleteItem);
  const menuItems = [];
  if (isOperator) {
    if (onRestockDoctor) {
      menuItems.push({
        key: "transfer",
        label: "Transfer to doctor bag",
        icon: <Truck className="size-3.5" />,
        onClick: () => onRestockDoctor(item),
      });
    }
    if (onRemove) {
      menuItems.push({
        key: "writeoff",
        label: "Write off stock",
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onClick: () => onRemove(item),
      });
    }
  }
  if (isAdmin) {
    if (onExceptionalCorrection) {
      menuItems.push({
        key: "correct",
        label: "Exceptional inventory correction",
        icon: <MinusCircle className="size-3.5" />,
        onClick: () => onExceptionalCorrection(item),
      });
    }
    if (showArchive) {
      menuItems.push({
        key: "archive",
        label: "Archive catalogue item",
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onClick: () => onDeleteItem(item),
      });
    }
    menuItems.push({ key: "sep", separator: true, label: "Exceptional actions" });
    if (onStockIn) {
      menuItems.push({
        key: "receive",
        label: "Receive stock (admin override)",
        icon: <Plus className="size-3.5" />,
        onClick: () => onStockIn(item),
      });
    }
    if (onRestockDoctor) {
      menuItems.push({
        key: "transfer",
        label: "Admin override transfer",
        icon: <Truck className="size-3.5" />,
        onClick: () => onRestockDoctor(item),
      });
    }
    if (onRemove) {
      menuItems.push({
        key: "writeoff",
        label: "Exceptional write-off",
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onClick: () => onRemove(item),
      });
    }
  }

  const primary = isAdmin
    ? {
        title: "Edit catalogue item",
        icon: <Pencil className="h-4 w-4" strokeWidth={2.5} />,
        onClick: () => onEdit(item),
      }
    : {
        title: "Receive stock",
        icon: <Plus className="h-4 w-4" strokeWidth={2.5} />,
        onClick: () => onStockIn(item),
      };

  if (touchWrap) {
    return (
      <InventoryMobileActionTray
        primary={primary}
        menuItems={menuItems.filter((row) => !row.separator)}
        moreLabel={isAdmin ? "Exceptional actions" : "More actions"}
      />
    );
  }

  return (
    <div className="ml-auto flex w-fit flex-wrap items-center justify-end gap-2">
      <button type="button" title={primary.title} aria-label={primary.title} className={primaryBtn} onClick={primary.onClick}>
        {primary.icon}
        <span>{isAdmin ? "Edit" : "Receive"}</span>
      </button>
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          title={isAdmin ? "Exceptional actions" : "More actions"}
          aria-label={isAdmin ? "Exceptional actions" : "More actions"}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className={moreBtn}
          onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
        >
          <MoreVertical className="size-3.5 shrink-0" />
          More
        </button>
        {menuOpen && menuPosition && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={menuPanelRef}
                role="menu"
                className="fixed z-[100] min-w-[14rem] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                style={{ top: menuPosition.top, left: menuPosition.left, maxHeight: menuPosition.maxHeight }}
              >
                {menuItems.map((entry) =>
                  entry.separator ? (
                    <p key={entry.key} className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                      {entry.label}
                    </p>
                  ) : (
                    <button
                      key={entry.key}
                      type="button"
                      role="menuitem"
                      className={`${INVENTORY_MOBILE_MENU_ITEM} ${entry.danger ? "text-rose-700 hover:bg-rose-50" : ""}`}
                      onClick={() => {
                        setMenuOpen(false);
                        entry.onClick();
                      }}
                    >
                      {entry.icon}
                      {entry.label}
                    </button>
                  ),
                )}
              </div>,
              document.body,
            )
          : null}
      </div>
    </div>
  );
}

function InventoryActionButtons({
  item,
  user,
  canManageOcs,
  contextIsOcs,
  isDoctor,
  doctorViewIsMy,
  doctorViewIsOcs,
  showDeleteItem = false,
  onStockIn,
  onEdit,
  onRestockDoctor,
  onRestockMyInventory,
  onRequestItem,
  onStockOut,
  onRemove,
  onDeleteItem,
  onExceptionalCorrection,
  touchWrap = false,
  omitRestock = false,
}) {
  if (canManageOcs && contextIsOcs) {
    return (
      <InventoryOcsMasterActions
        item={item}
        user={user}
        touchWrap={touchWrap}
        onStockIn={onStockIn}
        onEdit={onEdit}
        onRestockDoctor={onRestockDoctor}
        onRemove={onRemove}
        onDeleteItem={showDeleteItem ? onDeleteItem : undefined}
        onExceptionalCorrection={onExceptionalCorrection}
      />
    );
  }

  if (touchWrap) {
    const menuItems = [];
    if (isDoctor && !doctorViewIsOcs) {
      menuItems.push({
        key: "edit",
        label: "Bag settings",
        icon: <Pencil className="size-3.5" />,
        onClick: () => onEdit(item),
      });
    }
    if (isDoctor && onRequestItem) {
      menuItems.push({
        key: "request",
        label: doctorViewIsOcs ? "Add to request" : "Request this item",
        icon: <Truck className="size-3.5" />,
        onClick: () => onRequestItem(item),
      });
    }
    if (isDoctor && !omitRestock) {
      menuItems.push({
        key: "restock",
        label: "Emergency stock override",
        icon: <Truck className="size-3.5" />,
        onClick: () => onRestockMyInventory(item),
      });
    }
    if (canManageOcs && !contextIsOcs && onRemove) {
      menuItems.push({
        key: "remove",
        label: "Write off stock",
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onClick: () => onRemove(item),
      });
    }
    const primary = isDoctor && doctorViewIsMy && onStockOut
      ? {
          title: "Use",
          icon: <Minus className="h-4 w-4" strokeWidth={2.5} />,
          disabled: Number(item.quantity || 0) < 1,
          onClick: () => onStockOut(item),
        }
      : canManageOcs && !contextIsOcs && onRestockDoctor
        ? {
            title: "Transfer to doctor bag",
            icon: <Truck className="h-4 w-4" strokeWidth={2.5} />,
            onClick: () => onRestockDoctor(item),
          }
        : null;
    return (
      <InventoryMobileActionTray
        primary={primary}
        menuItems={menuItems}
        moreLabel={isAdminUser(user) ? "Exceptional actions" : "More actions"}
      />
    );
  }

  const btn =
    "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900";
  const restockBtn =
    "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#2d8f98] px-3 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
  const stockOutBtn =
    "inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="ml-auto flex w-fit items-center justify-end gap-2">
      {isDoctor && !doctorViewIsOcs ? (
        <button type="button" onClick={() => onEdit(item)} className={btn} title="Bag settings" aria-label="Bag settings">
          <Pencil className="size-3.5 shrink-0" />
          Settings
        </button>
      ) : null}

      {isDoctor && onRequestItem ? (
        <button type="button" onClick={() => onRequestItem(item)} className={restockBtn}>
          <Truck className="size-3.5 shrink-0" />
          {doctorViewIsOcs ? "Add to request" : "Request this item"}
        </button>
      ) : null}

      {isDoctor && !omitRestock ? (
        <button type="button" onClick={() => onRestockMyInventory(item)} className={restockBtn}>
          <Truck className="size-3.5 shrink-0" />
          Emergency stock override
        </button>
      ) : null}

      {isDoctor && doctorViewIsMy && onStockOut ? (
        <button
          type="button"
          onClick={() => onStockOut(item)}
          disabled={Number(item.quantity || 0) < 1}
          className={stockOutBtn}
        >
          <Minus className="size-3.5 shrink-0" />
          Use
        </button>
      ) : null}

      {canManageOcs && !contextIsOcs && onRestockDoctor ? (
        <button type="button" onClick={() => onRestockDoctor(item)} className={restockBtn}>
          <Truck className="size-3.5 shrink-0" />
          Transfer
        </button>
      ) : null}

      {canManageOcs && !contextIsOcs && onRemove ? (
        <button type="button" onClick={() => onRemove(item)} className={`${btn} border-rose-200 text-rose-700`}>
          <Trash2 className="size-3.5 shrink-0" />
          Write off
        </button>
      ) : null}
    </div>
  );
}

function RestockReceiptModal({ open, receipt, onClose, onPrint }) {
  return <TransferReceiptModal open={open} receipt={receipt} onClose={onClose} onPrint={onPrint} />;
}

const MOBILE_STOCK_OUT_OPTIONS = [
  { id: "wastage", reason: "Wasted", emoji: "🗑️", label: "Damaged / Broken (Wasted)" },
  { id: "expired", reason: "Expired", emoji: "⏳", label: "Expired (Discarded)" },
];

function OperatorAddItemDrawer({ open, onClose, folders, activeFolderId, activeCategory, isSaving, onSubmit }) {
  const [form, setForm] = useState(() => operatorItemFormState(activeFolderId));
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const [syncedDeps, setSyncedDeps] = useState({ open, activeFolderId });

  if (syncedDeps.open !== open || syncedDeps.activeFolderId !== activeFolderId) {
    setSyncedDeps({ open, activeFolderId });
    if (open) {
      setForm(operatorItemFormState(activeFolderId));
    }
  }

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onCloseRef.current?.();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, activeFolderId]);

  if (!open) return null;

  const fieldClass =
    "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-teal-500 focus:bg-white";

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex justify-end">
      <button
        type="button"
        aria-label="Close add item panel"
        className="absolute inset-0 bg-[rgba(34,72,91,0.35)] backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-slate-200/80 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.12)]"
        style={{
          paddingTop: "max(0px, var(--sat))",
          paddingBottom: "max(0px, var(--sab))",
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">Add New Item</h3>
            <p className="mt-1 text-xs text-slate-500">
              {activeCategory ? `Pre-selected: ${activeCategory}.` : "Category matches your active filter."} Adjust if needed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
          >
            <X className="size-5" />
          </button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({
              ...form,
              folder_id: Number(form.folder_id || 0),
              quantity: Number(form.quantity || 0),
              minimum_quantity: Number(form.minimum_quantity || 0),
              cost_price: Number(form.cost_price || 0),
              selling_price: Number(form.selling_price || 0),
            });
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Item Name</span>
              <input
                required
                name="item_name"
                value={form.item_name}
                onChange={(event) => setForm((prev) => ({ ...prev, item_name: event.target.value }))}
                className={fieldClass}
                placeholder="e.g. Paracetamol 500mg"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Quantity</span>
                <input
                  required
                  min="0"
                  type="number"
                  name="quantity"
                  value={form.quantity}
                  onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))}
                  className={fieldClass}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Min Quantity</span>
                <input
                  required
                  min="0"
                  type="number"
                  name="minimum_quantity"
                  value={form.minimum_quantity}
                  onChange={(event) => setForm((prev) => ({ ...prev, minimum_quantity: event.target.value }))}
                  className={fieldClass}
                />
              </label>
            </div>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Category</span>
              <select
                required
                name="folder_id"
                value={form.folder_id}
                onChange={(event) => setForm((prev) => ({ ...prev, folder_id: event.target.value }))}
                className={fieldClass}
              >
                <option value="">Select category</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={String(folder.id)}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className="flex shrink-0 gap-3 border-t border-slate-100 px-5 py-4"
            style={{ paddingBottom: "max(1rem, var(--sab))" }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="min-h-11 flex-1 rounded-2xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="min-h-11 flex-1 rounded-2xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Item"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function MobileBottomSheet({ open, onClose, title, subtitle, children }) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[61] rounded-t-[28px] border border-slate-200/80 bg-white px-4 pt-3 shadow-[0_-12px_40px_rgba(15,23,42,0.12)]"
        style={{
          paddingBottom: "max(1rem, var(--sab))",
          paddingLeft: "max(1rem, var(--sal))",
          paddingRight: "max(1rem, var(--sar))",
        }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" aria-hidden />
        {title ? <p className="truncate text-base font-semibold text-slate-950">{title}</p> : null}
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        {children}
      </div>
    </>
  );
}

function MobileStockOutBottomSheet({ open, item, onClose, onSelectReason, onBillPatient }) {
  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={item?.item_name || "Stock out"}
      subtitle="How is this item leaving your bag?"
    >
      <div className="mt-4 grid gap-2">
        <button
          type="button"
          onClick={onBillPatient}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3.5 text-left text-sm font-semibold text-teal-900 transition active:bg-teal-100"
        >
          <span className="text-lg" aria-hidden>
            🩺
          </span>
          <span>Bill to Patient (use Billing page)</span>
        </button>
        {MOBILE_STOCK_OUT_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelectReason(option)}
            className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 transition active:bg-slate-100"
          >
            <span className="text-lg" aria-hidden>
              {option.emoji}
            </span>
            <span>{option.label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="mt-1 min-h-11 w-full rounded-2xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600"
        >
          Cancel
        </button>
      </div>
    </MobileBottomSheet>
  );
}

function MobileQuickQuantitySheet({
  open,
  item,
  title,
  subtitle,
  maxQuantity,
  confirmLabel,
  confirmClassName,
  isSaving,
  onClose,
  onConfirm,
}) {
  const [quantity, setQuantity] = useState(1);
  const max = Math.max(0, Number(maxQuantity || 0));
  const atMax = quantity >= max;
  const [syncedDeps, setSyncedDeps] = useState({ open, itemId: item?.id });

  if (syncedDeps.open !== open || syncedDeps.itemId !== item?.id) {
    setSyncedDeps({ open, itemId: item?.id });
    if (open) {
      setQuantity(1);
    }
  }

  if (!open) return null;

  return (
    <MobileBottomSheet open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="mt-5 flex items-center justify-center gap-5">
        <button
          type="button"
          aria-label="Decrease quantity"
          disabled={quantity <= 1 || isSaving}
          onClick={() => setQuantity((prev) => Math.max(1, prev - 1))}
          className="inline-flex size-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-2xl font-bold text-slate-700 disabled:opacity-40"
        >
          <Minus className="size-6" />
        </button>
        <div className="min-w-[4.5rem] text-center">
          <p className="text-4xl font-bold tabular-nums text-slate-900">{quantity}</p>
          <p className="mt-1 text-xs font-medium text-slate-500">of {max}</p>
        </div>
        <button
          type="button"
          aria-label="Increase quantity"
          disabled={atMax || isSaving}
          onClick={() => setQuantity((prev) => Math.min(max, prev + 1))}
          className="inline-flex size-14 items-center justify-center rounded-2xl border border-slate-200 bg-white text-2xl font-bold text-slate-700 disabled:opacity-40"
        >
          <Plus className="size-6" />
        </button>
      </div>
      <div className="mt-6 grid gap-2">
        <button
          type="button"
          disabled={isSaving || max < 1 || quantity < 1 || quantity > max}
          onClick={() => onConfirm(quantity)}
          className={cx(
            "min-h-12 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white disabled:opacity-50",
            confirmClassName,
          )}
        >
          {isSaving ? "Saving..." : confirmLabel}
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={onClose}
          className="min-h-11 w-full rounded-2xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600"
        >
          Cancel
        </button>
      </div>
    </MobileBottomSheet>
  );
}

const MOBILE_DEDUCT_REASONS = [
  { id: "Sale", label: "Sale" },
  { id: "Damage", label: "Waste" },
  { id: "Expired", label: "Expired" },
];

function MobileDoctorRestockSheet({ open, item, ocsAvailable, isSaving, onClose, onSubmit }) {
  const max = Math.max(0, Number(ocsAvailable || 0));
  const suggested = item
    ? suggestedBagFillQty(item.current_quantity, item.par_level, max)
    : 0;
  const [quantity, setQuantity] = useState("1");
  const [syncedDeps, setSyncedDeps] = useState({
    open,
    itemId: item?.id,
    ocsItemId: item?.ocs_item_id,
  });

  if (
    syncedDeps.open !== open ||
    syncedDeps.itemId !== item?.id ||
    syncedDeps.ocsItemId !== item?.ocs_item_id
  ) {
    setSyncedDeps({ open, itemId: item?.id, ocsItemId: item?.ocs_item_id });
    if (open) {
      const nextQty = suggested > 0 ? suggested : Math.min(1, max);
      setQuantity(String(nextQty > 0 ? nextQty : "1"));
    }
  }

  if (!open || !item) return null;

  const qty = Number(quantity || 0);

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={`Emergency stock transfer — ${item.item_name || "item"}`}
      subtitle={`This bypasses the operator workflow. Depot available: ${max} · Batch exp ${formatInventoryExpiry(item.ocs_expiry)}`}
    >
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!Number.isInteger(qty) || qty <= 0) return;
          if (qty > max) {
            toast.error("Quantity exceeds OCS depot stock.");
            return;
          }
          onSubmit({ quantity: qty });
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Quantity to pull</span>
          <input
            required
            min="1"
            max={max || undefined}
            type="number"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none focus:border-teal-500 focus:bg-white"
          />
        </label>
        <p className="text-xs text-slate-500">
          In bag {Number(item.current_quantity || 0)} / {Number(item.par_level || 0)}. Expiry comes from the depot batch.
        </p>
        <div className="grid gap-2 pt-1">
          <button
            type="submit"
            disabled={isSaving || max < 1 || qty < 1 || qty > max}
            className="min-h-12 w-full rounded-2xl bg-[#2d8f98] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {isSaving ? "Transferring..." : "Confirm emergency transfer"}
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="min-h-11 w-full rounded-2xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600"
          >
            Cancel
          </button>
        </div>
      </form>
    </MobileBottomSheet>
  );
}

function MobileDoctorDeductSheet({
  open,
  item,
  isSaving,
  assignedPatients = [],
  onClose,
  onSubmit,
}) {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("Sale");
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [note, setNote] = useState("");
  const [selectedLotId, setSelectedLotId] = useState("");
  const [legacyUnknownLot, setLegacyUnknownLot] = useState(false);
  const [legacyExplanation, setLegacyExplanation] = useState("");
  const [syncedDeps, setSyncedDeps] = useState({ open, itemId: item?.id });

  if (syncedDeps.open !== open || syncedDeps.itemId !== item?.id) {
    setSyncedDeps({ open, itemId: item?.id });
    if (open) {
      setQuantity("1");
      setReason("Sale");
      setSelectedPatientId("");
      setNote("");
      setSelectedLotId("");
      setLegacyUnknownLot(false);
      setLegacyExplanation("");
    }
  }

  if (!open || !item) return null;

  const lots = Array.isArray(item.lots) ? item.lots.filter((lot) => Number(lot.quantity_remaining || 0) > 0) : [];
  const isSale = reason === "Sale";
  const isLoss = reason === "Expired" || reason === "Damage";
  const selectedLot = lots.find((lot) => String(lot.id) === String(selectedLotId)) || null;
  const max = isSale
    ? Math.max(0, Number(item.available_to_use ?? item.quantity ?? 0))
    : Math.max(0, Number((legacyUnknownLot || !lots.length ? item.unbatched_quantity : selectedLot?.quantity_remaining) || item.quantity || 0));
  const qty = Number(quantity || 0);
  const selectedPatient = isSale
    ? assignedPatients.find((entry) => String(entry.id) === String(selectedPatientId))
    : null;
  const saleRequiresPatient = isSale && !selectedPatient;
  const noteReady = !isLoss || String(note || "").trim().length >= 8;
  const lotReady = !isLoss || legacyUnknownLot || !lots.length || selectedLot;
  const submitDisabled = isSaving || max < 1 || qty < 1 || qty > max || saleRequiresPatient || !noteReady || !lotReady;

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={`Use ${item.item_name || "item"}`}
      subtitle={`In your bag: ${max}`}
    >
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!Number.isInteger(qty) || qty <= 0) return;
          if (qty > max) {
            toast.error("Quantity exceeds available stock.");
            return;
          }
          if (saleRequiresPatient) {
            toast.error("Select a patient before saving.");
            return;
          }
          onSubmit({
            quantity: qty,
            reason,
            note: note.trim(),
            batch_id: isLoss && selectedLot ? Number(selectedLot.id) : null,
            legacy_unknown_lot: Boolean(isLoss && (legacyUnknownLot || !lots.length)),
            legacy_explanation: legacyExplanation.trim(),
            patient_id: selectedPatient ? Number(selectedPatient.id) : null,
            patient_label: selectedPatient
              ? `${selectedPatient.full_name}${selectedPatient.patient_identifier ? ` (${selectedPatient.patient_identifier})` : ""}`
              : "",
          });
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Quantity Removed</span>
          <input
            required
            min="1"
            max={max || undefined}
            type="number"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none focus:border-teal-500 focus:bg-white"
          />
        </label>
        <div className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Select reason</span>
          <div className="flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
            {MOBILE_DEDUCT_REASONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setReason(option.id)}
                className={cx(
                  "min-h-10 flex-1 rounded-xl px-2 text-sm font-bold transition",
                  reason === option.id
                    ? option.id === "Sale"
                      ? "bg-teal-600 text-white shadow-sm"
                      : option.id === "Damage"
                        ? "bg-rose-100 text-rose-700"
                        : "bg-amber-100 text-amber-800"
                    : "text-slate-600",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {isSale ? (
            <p className="mt-1 block text-[10px] leading-tight text-gray-400">
              Sale deducts bag stock and adds quantity × selling price to this patient&apos;s unpaid bill. If there is no consultation yet, the line is added when the visit is saved.
            </p>
          ) : null}
        </div>

        {isSale ? (
          <div className="animate-fade-in mt-4 flex flex-col gap-1.5">
            <label
              htmlFor="mobile-deduct-patient-select"
              className="text-xs font-bold text-gray-700"
            >
              Assign to Patient *
            </label>
            <div className="relative">
              <select
                id="mobile-deduct-patient-select"
                value={selectedPatientId}
                onChange={(event) => setSelectedPatientId(event.target.value)}
                className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 pr-10 text-sm font-semibold text-gray-800 focus:border-[#557373] focus:outline-none"
              >
                <option value="" disabled>
                  {assignedPatients.length
                    ? "Select patient..."
                    : "No patients available"}
                </option>
                {assignedPatients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.full_name}
                    {patient.patient_identifier ? ` (${patient.patient_identifier})` : ""}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-gray-400">
                <ChevronDown className="size-4" aria-hidden />
              </div>
            </div>
            {!assignedPatients.length ? (
              <p className="mt-1 text-[10px] leading-tight text-rose-500">
                Connect to the clinic Wi-Fi to refresh your patient list, then retry.
              </p>
            ) : null}
          </div>
        ) : null}

        {isLoss ? (
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Affected lot</span>
            {lots.length ? (
              <select
                value={legacyUnknownLot ? "legacy" : selectedLotId}
                onChange={(event) => {
                  if (event.target.value === "legacy") {
                    setLegacyUnknownLot(true);
                    setSelectedLotId("");
                  } else {
                    setLegacyUnknownLot(false);
                    setSelectedLotId(event.target.value);
                  }
                }}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm"
              >
                <option value="">Select lot…</option>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.expiry_label || formatStockExpiryLabel(lot)} · {lot.quantity_remaining}
                  </option>
                ))}
                {Number(item.unbatched_quantity || 0) > 0 ? <option value="legacy">Legacy/unknown lot</option> : null}
              </select>
            ) : (
              <p className="text-xs font-semibold text-amber-800">Legacy/unknown lot</p>
            )}
          </label>
        ) : null}

        {!isSale ? (
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Reason / note *</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
              placeholder="Describe the wastage or expiry"
            />
          </label>
        ) : (
          <p className="text-sm text-slate-700">
            Selling price {formatRupees(Number(item.selling_price || 0))} × {Number.isInteger(qty) ? qty : 0} ={" "}
            <strong>{formatRupees(Number(item.selling_price || 0) * (Number.isInteger(qty) ? qty : 0))}</strong>
          </p>
        )}

        <div className="grid gap-2 pt-1">
          <button
            type="submit"
            disabled={submitDisabled}
            className={cx(
              "min-h-12 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white disabled:opacity-50",
              isSale ? "bg-teal-600" : "bg-rose-600",
            )}
          >
            {isSaving ? "Saving..." : isSale ? "Confirm sale" : "Confirm use"}
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="min-h-11 w-full rounded-2xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600"
          >
            Cancel
          </button>
        </div>
      </form>
    </MobileBottomSheet>
  );
}

function MobileDoctorBagActions({
  onUse,
  onRequest,
  onEmergencyOverride,
  useDisabled = false,
  requestOnly = false,
}) {
  const requestBtn =
    "inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[#2d8f98] px-3 text-sm font-bold text-white";
  const useBtn =
    "inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-bold text-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400";

  if (requestOnly) {
    return (
      <button type="button" onClick={onRequest} className={`${requestBtn} w-full`}>
        Add to request
      </button>
    );
  }

  return (
    <div className="grid w-full grid-cols-2 gap-2">
      <button type="button" disabled={useDisabled} onClick={onUse} className={useBtn}>
        Use
      </button>
      <button type="button" onClick={onRequest} className={requestBtn}>
        Request this item
      </button>
      {onEmergencyOverride ? (
        <button type="button" onClick={onEmergencyOverride} className={`${useBtn} col-span-2 text-xs`}>
          Emergency stock override
        </button>
      ) : null}
    </div>
  );
}

function MobileInventoryStockCard({ item, isLowStock, actions }) {
  const currentQuantity = Number(item.on_hand_quantity ?? item.quantity ?? 0);
  const parLevel = Number(item.minimum_quantity || 0);
  const low = isLowStock ?? (parLevel > 0 && currentQuantity <= parLevel);
  const qtyTone = low ? "text-rose-700" : "text-slate-900";

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={cx(
            "mt-1.5 inline-block size-2.5 shrink-0 rounded-full",
            low ? "bg-rose-500" : "bg-teal-500",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-bold leading-snug tracking-wide text-slate-800 [overflow-wrap:anywhere]">
            {item.item_name}
          </p>
          <InventoryStatusChips item={item} />
          <div className={cx("mt-1", qtyTone)}>
            <InventoryQuantityLines item={item} compact />
          </div>
          <p className="mt-1 text-xs font-semibold leading-snug text-slate-500">
            <span className={!item.nearest_usable_expiry && !item.has_non_expiring ? "text-slate-400" : ""}>
              {formatInventoryExpiry(item)}
            </span>
          </p>
        </div>
      </div>
      {actions}
    </div>
  );
}

function mobileBagChipClass(active) {
  return cx(
    "shrink-0 select-none whitespace-nowrap rounded-full px-3 py-2 text-xs font-bold",
    active ? "bg-[#2d8f98] text-white" : "border border-slate-200 bg-white text-slate-700",
  );
}

function MobileDoctorBagLayout({
  search,
  setSearch,
  doctorContext,
  onDoctorContextChange,
  folders,
  selectedView,
  onSelectedViewChange,
  doctorViewIsOcs,
  mobileBagPagedItems,
  mobileBagTotalPages,
  currentPage,
  setCurrentPage,
  onOpenDeduct,
  onOpenRequest,
  onOpenRestock,
  showLowStockOnly = false,
  showMissingExpiryOnly = false,
  showExpiredOnly = false,
  onToggleLowStock,
  onToggleMissingExpiry,
  onToggleExpired,
  listRefreshing = false,
  folderCounts,
  bagItemCount = 0,
}) {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-md flex-col gap-2.5 bg-slate-50">
      <header className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 rounded-2xl bg-slate-200/80 p-1">
          {DOCTOR_MOBILE_STOCK_SCOPES.map((scope) => (
            <button
              key={scope.id}
              type="button"
              onClick={() => onDoctorContextChange(scope.id)}
              className={cx(
                "min-h-10 min-w-0 flex-1 rounded-xl px-2 text-sm font-bold transition",
                doctorContext === scope.id ? "bg-[#2d8f98] text-white shadow-sm" : "text-slate-600",
              )}
            >
              {scope.label}
            </button>
          ))}
        </div>
        <Link
          to="/supply-requests"
          aria-label="Request supply"
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-[#2d8f98] px-3 text-sm font-bold text-white"
        >
          <Truck className="size-4 shrink-0" />
          Request
        </Link>
      </header>

      <label className="relative block w-full min-w-0">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search items"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          className="h-11 w-full min-w-0 rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-base outline-none transition placeholder:text-sm placeholder:text-gray-400 focus:border-[#2d8f98]"
        />
      </label>

      <div className="ocs-h-scroll pb-0.5">
        <button
          type="button"
          onClick={() => onSelectedViewChange("all")}
          className={mobileBagChipClass(selectedView === "all" || selectedView === "")}
        >
          All ({bagItemCount})
        </button>
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => onSelectedViewChange(String(folder.id))}
            className={mobileBagChipClass(selectedView === String(folder.id))}
          >
            {folder.name} ({folderCounts?.get(String(folder.id)) || 0})
          </button>
        ))}
        {!doctorViewIsOcs ? (
          <>
            <button type="button" onClick={onToggleLowStock} className={mobileBagChipClass(showLowStockOnly)}>
              Below min
            </button>
            <button
              type="button"
              onClick={onToggleMissingExpiry}
              className={mobileBagChipClass(showMissingExpiryOnly)}
            >
              Missing expiry
            </button>
            <button type="button" onClick={onToggleExpired} className={mobileBagChipClass(showExpiredOnly)}>
              Expired
            </button>
          </>
        ) : null}
        <span className="w-1 shrink-0" aria-hidden />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {listRefreshing ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500" aria-live="polite">
            Updating items…
          </div>
        ) : mobileBagPagedItems.length ? (
          <>
            <div className="flex w-full min-w-0 flex-col gap-2.5">
              {mobileBagPagedItems.map((item) => {
                const currentQuantity = Number(item.quantity || 0);

                return (
                  <MobileInventoryStockCard
                    key={`mobile-bag-${item.id}`}
                    item={item}
                    actions={
                      doctorViewIsOcs ? (
                        <MobileDoctorBagActions
                          requestOnly
                          onRequest={() => onOpenRequest?.(item)}
                        />
                      ) : (
                        <MobileDoctorBagActions
                          useDisabled={!onOpenDeduct || currentQuantity < 1}
                          onUse={() => onOpenDeduct?.(item)}
                          onRequest={() => onOpenRequest?.(item)}
                          onEmergencyOverride={onOpenRestock ? () => onOpenRestock(item) : undefined}
                        />
                      )
                    }
                  />
                );
              })}
            </div>

            {mobileBagTotalPages > 1 ? (
              <div className="flex items-center justify-between gap-3 pt-2">
                <p className="text-sm text-slate-500">
                  Page {currentPage} of {mobileBagTotalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={currentPage >= mobileBagTotalPages}
                    onClick={() => setCurrentPage((prev) => Math.min(mobileBagTotalPages, prev + 1))}
                    className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            title={doctorViewIsOcs ? "No items in this category" : "No stock items found"}
            description={
              doctorViewIsOcs
                ? "Try another category or search term."
                : "Search or request supply from the OCS depot to fill your bag."
            }
          />
        )}
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const hasInventoryDataRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef(null);
  const [selectedView, setSelectedView] = useState("");
  const [activeCategory, setActiveCategory] = useState("Consumable");
  const [operatorAddOpen, setOperatorAddOpen] = useState(false);
  const [selectedContextDoctorId, setSelectedContextDoctorId] = useState("");
  const [doctorContext, setDoctorContext] = useState("my");
  const doctorContextRef = useRef(doctorContext);
  doctorContextRef.current = doctorContext;
  const [contextSearch, setContextSearch] = useState("OCS Stock");
  const [editor, setEditor] = useState(null);
  const [movement, setMovement] = useState(null);
  const [restock, setRestock] = useState(null);
  const [doctorRestockOpen, setDoctorRestockOpen] = useState(false);
  const [doctorRestockItem, setDoctorRestockItem] = useState(null);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState(null);
  const [addStock, setAddStock] = useState(null);
  const [removeStock, setRemoveStock] = useState(null);
  const [stockOut, setStockOut] = useState(null);
  const [mobileDeductItem, setMobileDeductItem] = useState(null);
  const [assignedPatientsList, setAssignedPatientsList] = useState([]);
  const [mobileRestockTarget, setMobileRestockTarget] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [correction, setCorrection] = useState(null);
  const [stockFiltersOpen, setStockFiltersOpen] = useState(false);
  const [headerActionsOpen, setHeaderActionsOpen] = useState(false);
  const headerActionsButtonRef = useRef(null);
  const [unpricedFromBags, setUnpricedFromBags] = useState(false);
  const [showUnpricedOnly, setShowUnpricedOnly] = useState(false);
  const [stocktakeStatusFilter, setStocktakeStatusFilter] = useState("");
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [showNearExpiryOnly, setShowNearExpiryOnly] = useState(false);
  const [showMissingExpiryOnly, setShowMissingExpiryOnly] = useState(false);
  const [showExpiredOnly, setShowExpiredOnly] = useState(false);
  const [sortMode, setSortMode] = useState("expiry_asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState({});
  const [batchMap, setBatchMap] = useState({});
  const [activityStaffUserId, setActivityStaffUserId] = useState("");
  const [adminPeriodPreset, setAdminPeriodPreset] = useState("monthly");
  const [adminPeriodAnchor, setAdminPeriodAnchor] = useState(() => inventoryTodayInputValue());
  const [logisticsTab, setLogisticsTab] = useState(user.role === "operator" ? "queues" : "stock");
  const inventoryTabListRef = useRef(null);
  const [emergencyRestockEnabled, setEmergencyRestockEnabled] = useState(false);
  const isDoctor = user.role === "doctor";
  const commitInventoryData = useCallback(
    (next, { silent = false } = {}) => {
      setData(next);
      hasInventoryDataRef.current = Boolean(next);
      if (silent) return;
      if (isDoctor) {
        notifyDoctorBagInventoryUpdated();
      }
      if (user.role === "admin" || user.role === "operator") {
        notifyOcsInventoryUpdated();
      }
    },
    [isDoctor, user.role],
  );
  const isOperator = user.role === "operator";
  const canManageOcs = user.role === "admin" || isOperator;
  const isAdmin = user.role === "admin";
  const canUseAdminInventory = isAdmin || isOperator;
  const folders = useMemo(() => data?.folders || [], [data?.folders]);
  const pendingStagingCount = useMemo(
    () =>
      Array.isArray(data?.incoming_shipments)
        ? data.incoming_shipments.length
        : Array.isArray(data?.staging)
          ? data.staging.filter((row) => row.status === "pending").length
          : 0,
    [data?.incoming_shipments, data?.staging],
  );
  const openItemEditor = useCallback(
    (nextItem) => {
      const folderId = resolveItemFolderId(nextItem, folders);
      setEditor({
        item: {
          ...nextItem,
          folder_id: folderId ? Number(folderId) : Number(nextItem.folder_id || 0),
        },
      });
    },
    [folders],
  );
  const doctors = useMemo(() => data?.doctors || [], [data?.doctors]);
  const doctorOptions = useMemo(
    () => [...doctors].sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""))),
    [doctors],
  );
  const contextIsOcs = !selectedContextDoctorId;
  const selectedDoctorName =
    doctorOptions.find((doctor) => String(doctor.id) === String(selectedContextDoctorId))?.full_name
    || contextSearch;
  const staffLocationHeading = contextIsOcs ? "OCS warehouse" : doctorBagHeading(selectedDoctorName);
  const doctorViewIsOcs = isDoctor && doctorContext === "ocs";
  const doctorViewIsMy = isDoctor && doctorContext === "my";
  const isMobile = useIsMobile();
  const showDeleteStockItem = isAdmin && contextIsOcs;
  const showMobileDoctorBag = isDoctor && isMobile;
  const adminPeriodRange = useMemo(
    () => getInventoryDateRange(adminPeriodPreset, adminPeriodAnchor),
    [adminPeriodPreset, adminPeriodAnchor],
  );
  const items = useMemo(() => {
    if (isDoctor) {
      return doctorViewIsOcs ? data?.ocs_stock || [] : data?.my_stock || [];
    }
    return selectedContextDoctorId ? data?.selected_doctor_stock || [] : data?.ocs_stock || [];
  }, [
    isDoctor,
    doctorViewIsOcs,
    data?.ocs_stock,
    data?.my_stock,
    selectedContextDoctorId,
    data?.selected_doctor_stock,
  ]);
  /** Always show all seven category pills; empty categories display an empty list. */
  const categoryFolders = folders;
  const inventoryListQuery = useMemo(
    () =>
      buildInventoryListQuery({
        contextDoctorId: selectedContextDoctorId,
        doctorContext,
        includeDoctorContext: isDoctor,
        includeAdminFilters: canUseAdminInventory,
        adminPeriodRange,
        activityStaffUserId,
      }),
    [
      selectedContextDoctorId,
      doctorContext,
      isDoctor,
      canUseAdminInventory,
      adminPeriodRange,
      activityStaffUserId,
    ],
  );
  const summary = data?.summary || {};
  const folderCounts = useMemo(() => {
    const map = new Map();
    for (const item of items) {
      const id = String(item.folder_id);
      map.set(id, (map.get(id) || 0) + 1);
    }
    return map;
  }, [items]);
  const chaseCounts = useMemo(
    () => ({
      low: items.filter((item) => isAtOrBelowPar(item)).length,
      near: items.filter((item) => isNearExpiryItem(item)).length,
      missing: items.filter((item) => isMissingExpiryItem(item)).length,
      expired: items.filter((item) => isExpiredItem(item)).length,
      reconciliation: Number(data?.tab_summaries?.stock?.reconciliation_required || 0),
    }),
    [items, data?.tab_summaries?.stock?.reconciliation_required],
  );
  const doctorMetrics = useMemo(() => readDoctorMetrics(data), [data]);
  const compareRows = useMemo(() => {
    const rows = data?.compare_rows || [];
    return rows.filter(
      (row) =>
        Number(row.total_restocked_qty || 0) > 0 ||
        Number(row.consumed_sales_qty || 0) > 0 ||
        Number(row.consumed_wasted_qty || 0) > 0 ||
        Number(row.consumed_expired_qty || 0) > 0 ||
        Number(row.bag_on_hand_qty || 0) > 0 ||
        Number(row.total_restocked || 0) !== 0 ||
        Number(row.variance_rs || 0) !== 0,
    );
  }, [data?.compare_rows]);
  const pageSize = 50;
  const inventoryTableScrollClass = isOperator
    ? "max-h-[min(calc(100svh-16rem),960px)]"
    : "max-h-[560px]";
  const doctorDesktopBagTable = isDoctor && doctorViewIsMy;
  const staffDoctorBagTable = canManageOcs && !contextIsOcs;
  const inventoryActionsColWidth = doctorDesktopBagTable || staffDoctorBagTable ? "30%" : "32%";
  const inventoryTableMinWidth = doctorDesktopBagTable ? "56rem" : "48rem";
  const movements = useMemo(() => data?.movements || [], [data?.movements]);

  const doctorRestockCandidates = useMemo(() => {
    if (!isDoctor || !Array.isArray(data?.my_stock) || !Array.isArray(data?.ocs_stock)) return [];
    const ocsMap = new Map(
      (data.ocs_stock || []).map((item) => [`${item.folder_id}::${String(item.item_name || "").toLowerCase()}`, item]),
    );
    return (data.my_stock || [])
      .map((myItem) =>
        buildDoctorFillCandidate(
          myItem,
          ocsMap.get(`${myItem.folder_id}::${String(myItem.item_name || "").toLowerCase()}`),
        ),
      )
      .filter(Boolean);
  }, [isDoctor, data]);
  const ocsByFolderAndName = useMemo(() => {
    const map = new Map();
    (data?.ocs_stock || []).forEach((item) => {
      map.set(`${item.folder_id}::${String(item.item_name || "").toLowerCase()}`, item);
    });
    return map;
  }, [data]);

  const parsedMovements = useMemo(
    () =>
      movements.map((movement) => ({
        ...movement,
        meta: (() => {
          try {
            return JSON.parse(movement.meta_json || "{}");
          } catch {
            return {};
          }
        })(),
      })),
    [movements],
  );

  const load = useCallback(
    async (
      contextDoctorId = selectedContextDoctorId,
      nextDoctorContext = doctorContextRef.current,
      { silent = false } = {},
    ) => {
      const keepShell = silent || hasInventoryDataRef.current;
      if (!keepShell) setLoading(true);
      else setListRefreshing(true);
      try {
        const payload = await api.get(
          `/inventory${buildInventoryListQuery({
            contextDoctorId,
            doctorContext: nextDoctorContext,
            includeDoctorContext: isDoctor,
            includeAdminFilters: canUseAdminInventory,
            adminPeriodRange,
            activityStaffUserId,
          })}`,
        );
        commitInventoryData(payload, { silent: true });
        if (isDoctor) {
          setEmergencyRestockEnabled(Boolean(payload.emergency_restock_enabled));
        }
      } catch (error) {
        toast.error(error.message);
        if (!keepShell) setData(null);
      } finally {
        setLoading(false);
        setListRefreshing(false);
      }
    },
    [
      selectedContextDoctorId,
      isDoctor,
      canUseAdminInventory,
      adminPeriodRange,
      activityStaffUserId,
      commitInventoryData,
    ],
  );

  const liveActivityStaffFilterProps = canUseAdminInventory
    ? {
        showStaffFilters: true,
        staffOptions: data?.activity_staff || [],
        activityStaffUserId,
        onActivityStaffUserIdChange: setActivityStaffUserId,
        periodPreset: adminPeriodPreset,
        periodAnchorDate: adminPeriodAnchor,
        onPeriodPresetChange: setAdminPeriodPreset,
        onPeriodAnchorDateChange: setAdminPeriodAnchor,
        dateFrom: adminPeriodRange.from,
        dateTo: adminPeriodRange.to,
        compareRows,
      }
    : {};

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handleInventoryRefresh = () => {
      void load(selectedContextDoctorId, doctorContext, { silent: true });
    };
    window.addEventListener(OCS_INVENTORY_EVENT, handleInventoryRefresh);
    window.addEventListener(DOCTOR_BAG_INVENTORY_EVENT, handleInventoryRefresh);
    return () => {
      window.removeEventListener(OCS_INVENTORY_EVENT, handleInventoryRefresh);
      window.removeEventListener(DOCTOR_BAG_INVENTORY_EVENT, handleInventoryRefresh);
    };
  }, [load, selectedContextDoctorId, doctorContext]);

  useEffect(() => {
    setHeaderActionsOpen(false);
  }, [logisticsTab]);

  useEffect(() => {
    if (!headerActionsOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        setHeaderActionsOpen(false);
        headerActionsButtonRef.current?.focus();
      }
    };
    const onPointer = (event) => {
      if (headerActionsButtonRef.current?.contains(event.target)) return;
      if (event.target?.closest?.("[data-inventory-header-menu]")) return;
      setHeaderActionsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [headerActionsOpen]);

  useEffect(() => {
    if (user?.role !== "doctor" || !user?.id || !user?.doctor_id) {
      return;
    }

    const needsPicker = Boolean(mobileDeductItem) || Boolean(stockOut?.item);
    if (!needsPicker) {
      return;
    }

    let cancelled = false;

    (async () => {
      const list = await loadAssignedPatientPicker(user.id, {
        doctorId: user.doctor_id,
      });
      if (!cancelled) {
        setAssignedPatientsList(list);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mobileDeductItem, stockOut, user?.id, user?.doctor_id, user?.role]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "/") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tag = String(target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }
      event.preventDefault();
      setLogisticsTab("stock");
      searchInputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Default category: first folder with stock, else Consumable (pills may list all categories on OCS view).
  useEffect(() => {
    if (!folders.length) return;
    const valid = selectedView === "all" || folders.some((f) => String(f.id) === String(selectedView));
    if (!selectedView || !valid) {
      if (isDoctor) {
        setSelectedView("all");
        setActiveCategory("All");
        return;
      }
      const next = getDefaultFolderSelection(folders, items);
      if (!next) return;
      setSelectedView(String(next.id));
      if (next.name) setActiveCategory(next.name);
    }
  }, [folders, items, selectedView, isDoctor]);

  useEffect(() => {
    if (!folders.length || !selectedView) return;
    const folder = folders.find((f) => String(f.id) === String(selectedView));
    if (folder?.name) setActiveCategory(folder.name);
  }, [folders, selectedView]);

  useEffect(() => {
    if (!selectedContextDoctorId) {
      setContextSearch("OCS Stock");
      return;
    }
    const doctor = doctorOptions.find((d) => String(d.id) === String(selectedContextDoctorId));
    setContextSearch(doctor?.full_name || "OCS Stock");
  }, [selectedContextDoctorId, doctorOptions]);

  useEffect(() => {
    if (!isDoctor) return;
    const nextContext = searchParams.get("context");
    if (nextContext === "ocs" || nextContext === "my") {
      setDoctorContext(nextContext);
    }
  }, [isDoctor, searchParams]);

  useEffect(() => {
    if (!isDoctor || !data) return;
    const shouldOpenRestock = searchParams.get("restock") === "alert";
    if (!shouldOpenRestock) return;
    if (doctorRestockCandidates.length) {
      setDoctorRestockItem(null);
      setDoctorRestockOpen(true);
    } else {
      toast("OCS has no stock to fill lines that are below minimum.");
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("restock");
    setSearchParams(nextParams, { replace: true });
  }, [isDoctor, data, doctorRestockCandidates, searchParams, setSearchParams]);

  useEffect(() => {
    const selected = inventoryTabListRef.current?.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [logisticsTab]);

  const unpricedProductKeys = useMemo(
    () => data?.tab_summaries?.bags?.unpriced_product_keys || [],
    [data?.tab_summaries?.bags?.unpriced_product_keys],
  );
  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const folderId = selectedView && selectedView !== "all" ? selectedView : "";
    const source = folderId ? items.filter((item) => String(item.folder_id) === String(folderId)) : items;
    const unpricedKeys = new Set(
      (Array.isArray(unpricedProductKeys) ? unpricedProductKeys : []).map((key) => String(key || "").trim().toLowerCase()).filter(Boolean),
    );
    return source
      .filter((item) => !needle || item.item_name.toLowerCase().includes(needle))
      .filter((item) => !showLowStockOnly || isAtOrBelowPar(item))
      .filter((item) => !showNearExpiryOnly || isNearExpiryItem(item))
      .filter((item) => !showMissingExpiryOnly || isMissingExpiryItem(item))
      .filter((item) => !showExpiredOnly || isExpiredItem(item))
      .filter((item) => {
        if (!showUnpricedOnly) return true;
        if (unpricedFromBags && unpricedKeys.size) {
          return unpricedKeys.has(String(item.item_name || "").trim().toLowerCase());
        }
        return Number(item.cost_price || 0) === 0;
      });
  }, [
    items,
    search,
    selectedView,
    showLowStockOnly,
    showNearExpiryOnly,
    showMissingExpiryOnly,
    showExpiredOnly,
    showUnpricedOnly,
    unpricedFromBags,
    unpricedProductKeys,
  ]);

  const sortedItems = useMemo(() => {
    const rows = [...filteredItems];
    if (sortMode === "name_asc") {
      rows.sort((a, b) => String(a.item_name || "").localeCompare(String(b.item_name || ""), undefined, { sensitivity: "base" }));
      return rows;
    }
    if (sortMode === "qty_asc") {
      rows.sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0));
      return rows;
    }
    if (sortMode === "qty_desc") {
      rows.sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0));
      return rows;
    }
    const expiryRank = (date) => (date ? new Date(date).getTime() : Number.MAX_SAFE_INTEGER);
    rows.sort((a, b) => expiryRank(a.expiry_date) - expiryRank(b.expiry_date));
    return rows;
  }, [filteredItems, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, currentPage]);

  const mobileBagFilteredItems = useMemo(() => {
    if (!showMobileDoctorBag) return [];
    const needle = search.trim().toLowerCase();
    const folderId = selectedView && selectedView !== "all" ? selectedView : "";
    const sourceStock = doctorViewIsOcs ? data?.ocs_stock || [] : data?.my_stock || [];
    let rows = folderId
      ? sourceStock.filter((item) => String(item.folder_id) === String(folderId))
      : sourceStock;
    rows = rows.filter(
      (item) => !needle || String(item.item_name || "").toLowerCase().includes(needle),
    );
    if (!doctorViewIsOcs && showLowStockOnly) {
      rows = rows.filter((item) => isAtOrBelowPar(item));
    }
    if (!doctorViewIsOcs && showMissingExpiryOnly) {
      rows = rows.filter((item) => isMissingExpiryItem(item));
    }
    if (!doctorViewIsOcs && showNearExpiryOnly) {
      rows = rows.filter((item) => isNearExpiryItem(item));
    }
    if (!doctorViewIsOcs && showExpiredOnly) {
      rows = rows.filter((item) => isExpiredItem(item));
    }
    const expiryRank = (date) => (date ? new Date(date).getTime() : Number.MAX_SAFE_INTEGER);
    return [...rows].sort((a, b) => expiryRank(a.expiry_date) - expiryRank(b.expiry_date));
  }, [showMobileDoctorBag, doctorViewIsOcs, data?.my_stock, data?.ocs_stock, search, selectedView, showLowStockOnly, showMissingExpiryOnly, showNearExpiryOnly, showExpiredOnly]);

  const mobileBagPagedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return mobileBagFilteredItems.slice(start, start + pageSize);
  }, [mobileBagFilteredItems, currentPage, pageSize]);

  const mobileBagTotalPages = Math.max(1, Math.ceil(mobileBagFilteredItems.length / pageSize));

  const filteredContextOptions = useMemo(() => {
    const needle = contextSearch.trim().toLowerCase();
    const ocsOption = [{ id: "", label: "OCS Stock" }];
    const doctorRows = doctorOptions.map((doctor) => ({ id: String(doctor.id), label: doctor.full_name }));
    const all = [...ocsOption, ...doctorRows];
    if (!needle) return all;
    return all.filter((opt) => opt.label.toLowerCase().includes(needle));
  }, [contextSearch, doctorOptions]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedView, showLowStockOnly, showNearExpiryOnly, showMissingExpiryOnly, sortMode, doctorContext]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (showMobileDoctorBag && currentPage > mobileBagTotalPages) {
      setCurrentPage(mobileBagTotalPages);
    }
  }, [showMobileDoctorBag, currentPage, mobileBagTotalPages]);

  useEffect(() => {
    if (!showMobileDoctorBag) {
      return undefined;
    }

    function handleItemSynced(event) {
      const result = event.detail?.result;
      if (result) {
        commitInventoryData(result);
      }
    }

    function handleFlushComplete() {
      void load(selectedContextDoctorId, doctorContext, { silent: true });
    }

    window.addEventListener(OFFLINE_QUEUE_ITEM_SYNCED, handleItemSynced);
    window.addEventListener(OFFLINE_QUEUE_FLUSH_COMPLETE, handleFlushComplete);

    return () => {
      window.removeEventListener(OFFLINE_QUEUE_ITEM_SYNCED, handleItemSynced);
      window.removeEventListener(OFFLINE_QUEUE_FLUSH_COMPLETE, handleFlushComplete);
    };
  }, [showMobileDoctorBag, commitInventoryData, selectedContextDoctorId, doctorContext, load]);

  async function loadBatches(itemId) {
    const key = Number(itemId);
    if (!key || batchMap[key]) return;
    try {
      const response = await api.get(`/inventory/items/${key}/batches`);
      setBatchMap((prev) => ({ ...prev, [key]: response.batches || [] }));
    } catch (error) {
      toast.error(error.message);
    }
  }

  function openDoctorRestockForItem(nextItem) {
    const source = ocsByFolderAndName.get(`${nextItem.folder_id}::${String(nextItem.item_name || "").toLowerCase()}`);
    if (!source?.id) {
      toast.error("Item not available in the OCS depot.");
      return;
    }
    if (Number(source.quantity || 0) < 1) {
      toast.error("OCS depot has none of this item.");
      return;
    }
    setDoctorRestockItem({
      ocs_item_id: Number(source.id),
      item_name: nextItem.item_name,
      ocs_available: Number(source.quantity || 0),
      current_quantity: Number(nextItem.quantity || 0),
      par_level: Number(nextItem.minimum_quantity || 0),
      ocs_expiry: source.expiry_date || null,
    });
    setDoctorRestockOpen(true);
  }

  function openDoctorFillBag() {
    setDoctorContext("my");
    setDoctorRestockItem(null);
    setDoctorRestockOpen(true);
  }

  function handleDoctorContextChange(next) {
    if (next === doctorContext) return;
    setShowLowStockOnly(false);
    setShowNearExpiryOnly(false);
    setShowMissingExpiryOnly(false);
    setShowExpiredOnly(false);
    setDoctorContext(next);
  }

  function openDoctorRequestForItem(nextItem) {
    const source = doctorViewIsOcs
      ? nextItem
      : ocsByFolderAndName.get(`${nextItem.folder_id}::${String(nextItem.item_name || "").toLowerCase()}`);
    if (!source?.id) {
      toast.error("Item not available in the OCS depot.");
      return;
    }
    const params = new URLSearchParams({
      compose: "1",
      itemId: String(source.id),
      return: "/inventory",
    });
    navigate(`/supply-requests?${params.toString()}`);
  }

  function applyDoctorBagFilter(kind) {
    setDoctorContext("my");
    applyChaseFilter(kind);
  }

  function openStaffRestockForDoctorItem(nextItem) {
    if (!selectedContextDoctorId) {
      toast.error("Select a doctor from the stock context dropdown first.");
      return;
    }
    const source = ocsByFolderAndName.get(`${nextItem.folder_id}::${String(nextItem.item_name || "").toLowerCase()}`);
    if (!source?.id) {
      toast.error("Item not available in OCS Master Stock.");
      return;
    }
    const doctor = doctorOptions.find((row) => String(row.id) === String(selectedContextDoctorId));
    setRestock({
      item: source,
      doctorId: Number(selectedContextDoctorId),
      doctorName: doctor?.full_name || contextSearch || "Selected doctor",
    });
  }

  function handleRestockDoctor(nextItem) {
    if (contextIsOcs) {
      setRestock({ item: nextItem });
      return;
    }
    openStaffRestockForDoctorItem(nextItem);
  }

  function applyChaseFilter(kind) {
    const next =
      (kind === "low" && showLowStockOnly) ||
      (kind === "near" && showNearExpiryOnly) ||
      (kind === "missing" && showMissingExpiryOnly) ||
      (kind === "expired" && showExpiredOnly)
        ? ""
        : kind;
    setLogisticsTab("stock");
    setSelectedView("all");
    setShowLowStockOnly(next === "low");
    setShowNearExpiryOnly(next === "near");
    setShowMissingExpiryOnly(next === "missing");
    setShowExpiredOnly(next === "expired");
    setShowUnpricedOnly(false);
    setUnpricedFromBags(false);
    if (kind === "reconciliation") {
      setLogisticsTab("queues");
    }
  }

  function openDoctorBagFromCompare(doctorId) {
    setSelectedContextDoctorId(String(doctorId));
    setLogisticsTab("stock");
    setSelectedView("all");
  }

  function downloadAdminStockExcel() {
    if (!canUseAdminInventory) return;
    if (!sortedItems.length) {
      toast.error("No stock rows match the current filters.");
      return;
    }

    const activeFolder = folders.find((f) => String(f.id) === String(selectedView));
    const categoryDisplay = activeFolder?.name || "All categories";
    const categoryFileToken = sanitizeInventoryExportToken(categoryDisplay.replace(/\s+/g, "_"));

    const selectedDoctor = doctorOptions.find((d) => String(d.id) === String(selectedContextDoctorId));
    const scopeIsMaster = !selectedContextDoctorId;
    const scopeFileToken = scopeIsMaster
      ? "Master"
      : `Dr_${sanitizeInventoryExportToken(String(selectedDoctor?.full_name || `id_${selectedContextDoctorId}`).replace(/\s+/g, "_"))}`;

    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `OCS_Stock_Report_${scopeFileToken}_${categoryFileToken}_${stamp}.xlsx`;

    const mainSheetLabel = scopeIsMaster
      ? `OCS_${categoryDisplay}`
      : `Dr ${String(selectedDoctor?.full_name || selectedContextDoctorId).slice(0, 18)} · ${categoryDisplay}`;
    const mainSheetName = excelSafeSheetTitle(mainSheetLabel);

    const stockRows = sortedItems.map((item) => ({
      "Stock scope": scopeIsMaster ? "Master (OCS)" : "Doctor stock",
      "Doctor ID": scopeIsMaster ? "" : String(selectedContextDoctorId),
      Category: item.folder_name || "",
      "Item name": item.item_name || "",
      Quantity: Number(item.quantity ?? 0),
      "On hand": Number(item.on_hand_quantity ?? item.quantity ?? 0),
      Reserved: Number(item.reserved_quantity ?? 0),
      Expired: Number(item.expired_quantity ?? 0),
      "Available to use": Number(item.available_to_use ?? item.quantity ?? 0),
      "Min qty": Number(item.minimum_quantity ?? 0),
      Unit: item.unit ?? "",
      "Nearest usable expiry": item.nearest_usable_expiry || formatInventoryExpiry(item),
      "Cost (Rs)": Number(item.cost_price ?? 0),
      "Selling price (Rs)": Number(item.selling_price ?? 0),
      Attributes: item.attributes || "",
      "MOA notes": item.moa_notes || "",
    }));

    const filterMetaRows = [
      { Field: "Report", Value: "OCS Stock Report" },
      { Field: "Scope", Value: scopeIsMaster ? "Master Stock (OCS)" : `Doctor: ${selectedDoctor?.full_name || selectedContextDoctorId}` },
      { Field: "Doctor ID (export scope)", Value: scopeIsMaster ? "—" : String(selectedContextDoctorId) },
      { Field: "Active category (folder)", Value: categoryDisplay },
      { Field: "Search text", Value: search.trim() || "—" },
      { Field: "Show low stock only", Value: showLowStockOnly ? "Yes" : "No" },
      { Field: "Show near expiry only", Value: showNearExpiryOnly ? "Yes" : "No" },
      { Field: "Show missing expiry only", Value: showMissingExpiryOnly ? "Yes" : "No" },
      { Field: "Sort order", Value: inventorySortModeLabel(sortMode) },
      { Field: "Exported rows", Value: String(sortedItems.length) },
    ];

    const workbook = XLSX.utils.book_new();
    const stockSheet = XLSX.utils.json_to_sheet(stockRows);
    XLSX.utils.book_append_sheet(workbook, stockSheet, mainSheetName);
    const filtersSheet = XLSX.utils.json_to_sheet(filterMetaRows);
    XLSX.utils.book_append_sheet(workbook, filtersSheet, excelSafeSheetTitle("Export filters"));

    XLSX.writeFile(workbook, fileName);
    toast.success("Excel file downloaded.");
  }

  if (loading && !data) return <LoadingState label="Loading inventory workspace" />;
  if (!data) return <EmptyState title="Inventory unavailable" description="Unable to load stock data right now." />;

  async function saveItem(payload) {
    if (payload.quantity != null && !isDoctor) {
      delete payload.quantity;
    }
    if (!Number.isInteger(payload.minimum_quantity) || payload.minimum_quantity < 0) {
      toast.error("Minimum quantity must be zero or more.");
      return;
    }
    if (payload.selling_price != null && Number(payload.selling_price || 0) < Number(payload.cost_price || 0)) {
      toast.error("Selling price cannot be lower than cost price.");
      return;
    }

    setIsSaving(true);
    try {
      const next = editor?.item
        ? await api.put(`/inventory/items/${editor.item.id}${inventoryListQuery}`, payload)
        : await api.post(`/inventory/items${inventoryListQuery}`, { ...payload, quantity: 0 });
      commitInventoryData(next);
      setEditor(null);
      setOperatorAddOpen(false);
      if (!editor?.item && payload.folder_id) {
        setSelectedView(String(payload.folder_id));
        const folder = (next?.folders || folders).find((f) => String(f.id) === String(payload.folder_id));
        if (folder?.name) setActiveCategory(folder.name);
      }
      toast.success(editor?.item ? "Catalogue item updated." : "Catalogue item added.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveMovement(payload) {
    if (!movement?.item) return;
    setIsSaving(true);
    try {
      const next = await api.post(`/inventory/items/${movement.item.id}/actions${inventoryListQuery}`, payload);
      commitInventoryData(next);
      setMovement(null);
      toast.success("Stock action saved.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveRestock(payload) {
    setIsSaving(true);
    try {
      const next = await api.post(
        `/inventory/restock${inventoryListQuery}`,
        withOperationalOverride(user, payload, payload.override_reason),
      );
      commitInventoryData(next);
      setRestock(null);
      toast.success("Transferred to doctor bag.");
      if (next?.restock_receipt) {
        setActiveReceipt(next.restock_receipt);
        setReceiptModalOpen(true);
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveDoctorRestock(restockRequest) {
    const requests = Array.isArray(restockRequest)
      ? restockRequest
      : restockRequest?.ocs_item_id && Number(restockRequest?.quantity || 0) > 0
        ? [restockRequest]
        : [];
    if (!requests.length) return;

    const invalid = requests.find((item) => Number(item.quantity || 0) > Number(item.ocs_available || Number.MAX_SAFE_INTEGER));
    if (invalid) {
      toast.error(`Requested quantity exceeds OCS stock for ${invalid.item_name || "an item"}.`);
      return;
    }

    if (!emergencyRestockEnabled) {
      toast.error("Use a supply request to replenish your bag.");
      return;
    }
    const reason = window.prompt(
      "Emergency stock transfer bypasses the operator-prepared workflow. Enter a reason (10–500 characters).",
    );
    if (!reason || reason.trim().length < 10 || reason.trim().length > 500) {
      toast.error("A reason between 10 and 500 characters is required.");
      return;
    }
    if (!window.confirm("This is an emergency stock transfer and will be reported to operators and admins. Continue?")) {
      return;
    }

    setIsSaving(true);
    try {
      const next = await api.post(`/inventory/restock/my-inventory${inventoryListQuery}`, {
        items: requests.map((item) => ({
          ocs_item_id: Number(item.ocs_item_id),
          quantity: Number(item.required_quantity || item.quantity),
        })),
        reason: reason.trim(),
        confirm: true,
      });
      commitInventoryData(next);
      setDoctorRestockOpen(false);
      setDoctorRestockItem(null);
      toast.success("My inventory restocked successfully.");
      if (next?.restock_receipt) {
        setActiveReceipt(next.restock_receipt);
        setReceiptModalOpen(true);
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  function printReceipt(receipt) {
    if (!receipt) return;
    const printed = printTransferReceipt(receipt);
    if (!printed) {
      toast.error("Unable to open print preview.");
      return;
    }
    toast.success("Receipt generated successfully.");
  }

  async function saveAddStock(payload) {
    if (!addStock?.item) return;
    const quantity = Number(payload?.quantity || 0);
    if (!Number.isInteger(quantity) || quantity <= 0) return;
    if (!payload?.is_non_expiring && !String(payload?.expiry_date || "").trim()) {
      toast.error("Set the batch expiry date, or mark the batch as non-expiring.");
      return;
    }

    setIsSaving(true);
    try {
      const next = await api.post(
        `/inventory/items/${addStock.item.id}/ocs-actions${inventoryListQuery}`,
        withOperationalOverride(
          user,
          {
            action_type: "stock_in",
            quantity,
            expiry_date: payload.expiry_date || "",
            is_non_expiring: Boolean(payload.is_non_expiring),
            cost_price: Number(payload.cost_price || 0),
          },
          payload.override_reason,
        ),
      );
      commitInventoryData(next);
      setAddStock(null);
      toast.success("Stock received.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveRemoveStock(payload) {
    if (!removeStock?.item) return;
    const quantity = Number(payload?.quantity || 0);
    if (!Number.isInteger(quantity) || quantity <= 0) return;

    const item = removeStock.item;
    const isDoctorBag = item.stock_scope === "doctor" || Boolean(item.owner_doctor_id);
    const endpoint = isDoctorBag
      ? `/inventory/items/${item.id}/bag-actions`
      : `/inventory/items/${item.id}/ocs-actions`;

    setIsSaving(true);
    try {
      await api.post(
        `${endpoint}${inventoryListQuery}`,
        withOperationalOverride(
          user,
          {
            action_type: "remove",
            quantity,
            reason: payload.reason,
            note: payload.note || "",
            confirm: true,
          },
          payload.override_reason,
        ),
      );
      setRemoveStock(null);
      await load(selectedContextDoctorId, doctorContext, { silent: true });
      toast.success(isDoctorBag ? "Doctor bag stock written off." : "Stock written off.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveExceptionalCorrection(payload) {
    if (!correction?.item) return;
    setIsSaving(true);
    try {
      const next = await api.post(
        `/inventory/items/${correction.item.id}/exceptional-correction${inventoryListQuery}`,
        payload,
      );
      commitInventoryData(next);
      setCorrection(null);
      notifySupplyRequestsUpdated();
      toast.success(next?.idempotent ? "Correction already applied." : "Exceptional correction applied.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveStockOut(payload) {
    if (!stockOut?.item) return;
    const quantity = Number(payload?.quantity || 0);
    if (!Number.isInteger(quantity) || quantity <= 0) return;

    const item = stockOut.item;
    const isSale = payload.reason === "Sale";
    if (isSale && !payload.patient_id) {
      toast.error("Select a patient before recording a Sale.");
      return;
    }

    const requestBody = {
      action_type: "stock_out",
      quantity,
      reason: payload.reason,
      note: payload.note || "",
      expected_version: Number(item.row_version || 0),
      batch_id: payload.batch_id || null,
      legacy_unknown_lot: Boolean(payload.legacy_unknown_lot),
      legacy_explanation: payload.legacy_explanation || "",
      ...(isSale
        ? {
            patient_id: Number(payload.patient_id),
            patient_label: payload.patient_label || "",
          }
        : {}),
    };

    setIsSaving(true);
    try {
      const next = await api.post(
        `/inventory/items/${item.id}/actions${inventoryListQuery}`,
        requestBody,
      );
      const saleBilling = next?.sale_billing;
      commitInventoryData(next);
      setStockOut(null);
      toast.success(
        isSale
          ? saleBilling?.attached
            ? payload.patient_label
              ? `Stock deducted and added to ${payload.patient_label}'s bill.`
              : "Stock deducted and added to the patient's bill."
            : payload.patient_label
              ? `Stock deducted for ${payload.patient_label}. It will be added to the bill when the consultation is saved.`
              : "Stock deducted. It will be added to the bill when the consultation is saved."
          : payload.reason === "Expired"
            ? "Expired stock logged."
            : "Stock out recorded.",
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (error.data?.inventory) {
          commitInventoryData(error.data.inventory);
        } else {
          await load(selectedContextDoctorId, doctorContext, { silent: true });
        }
        setStockOut(null);
        toast.error("Stock changed on another device. Quantities refreshed.");
        return;
      }
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  function resolveOcsSourceForBagItem(bagItem) {
    if (!bagItem) return null;
    const myMatch = (data?.my_stock || []).find(
      (row) =>
        String(row.folder_id) === String(bagItem.folder_id) &&
        String(row.item_name || "").toLowerCase() === String(bagItem.item_name || "").toLowerCase(),
    );
    if (bagItem.stock_scope === "ocs" || doctorViewIsOcs) {
      return {
        ocs_item_id: Number(bagItem.id),
        item_name: bagItem.item_name,
        ocs_available: Number(bagItem.quantity || 0),
        current_quantity: Number(myMatch?.quantity || 0),
        par_level: Number(myMatch?.minimum_quantity || bagItem.minimum_quantity || 0),
        ocs_expiry: bagItem.expiry_date || null,
      };
    }
    const source = ocsByFolderAndName.get(
      `${bagItem.folder_id}::${String(bagItem.item_name || "").toLowerCase()}`,
    );
    if (!source?.id) return null;
    return {
      ocs_item_id: Number(source.id),
      item_name: bagItem.item_name,
      ocs_available: Number(source.quantity || 0),
      current_quantity: Number(bagItem.quantity || 0),
      par_level: Number(bagItem.minimum_quantity || 0),
      ocs_expiry: source.expiry_date || null,
    };
  }

  function openMobileDoctorRestock(item) {
    const resolved = resolveOcsSourceForBagItem(item);
    if (!resolved?.ocs_item_id) {
      toast.error("Item not available in the OCS depot.");
      return;
    }
    if (Number(resolved.ocs_available || 0) < 1) {
      toast.error("OCS depot has none of this item.");
      return;
    }
    setMobileRestockTarget(resolved);
  }

  async function saveMobileDoctorRestock({ quantity }) {
    const target = mobileRestockTarget;
    if (!target?.ocs_item_id) return;
    const qty = Number(quantity || 0);
    if (!Number.isInteger(qty) || qty <= 0) return;
    if (qty > Number(target.ocs_available || 0)) {
      toast.error(`Requested quantity exceeds OCS stock for ${target.item_name || "this item"}.`);
      return;
    }

    const endpoint = `/inventory/restock/my-inventory${inventoryListQuery}`;
    const payload = {
      items: [
        {
          ocs_item_id: Number(target.ocs_item_id),
          quantity: qty,
        },
      ],
    };

    setIsSaving(true);
    try {
      if (shouldQueueInventoryMutation()) {
        await queueInventoryMutation({
          kind: "inventory_restock",
          endpoint,
          payload,
          meta: {
            ocsItemId: target.ocs_item_id,
            itemName: target.item_name,
            quantity: qty,
            doctorId: user.doctor_id,
          },
        });
        if (data) {
          commitInventoryData(
            applyOptimisticBagRestock(data, {
              ocsItemId: target.ocs_item_id,
              itemName: target.item_name,
              quantity: qty,
            }),
          );
        }
        setMobileRestockTarget(null);
        toast.success(OFFLINE_SAVED_TOAST);
        return;
      }

      const next = await api.post(endpoint, payload);
      commitInventoryData(next);
      setMobileRestockTarget(null);
      toast.success("Restocked from OCS master into your bag.");
      if (next?.restock_receipt) {
        setActiveReceipt(next.restock_receipt);
        setReceiptModalOpen(true);
      }
    } catch (error) {
      if (shouldQueueInventoryMutation(error)) {
        await queueInventoryMutation({
          kind: "inventory_restock",
          endpoint,
          payload,
          meta: {
            ocsItemId: target.ocs_item_id,
            itemName: target.item_name,
            quantity: qty,
            doctorId: user.doctor_id,
          },
        });
        if (data) {
          commitInventoryData(
            applyOptimisticBagRestock(data, {
              ocsItemId: target.ocs_item_id,
              itemName: target.item_name,
              quantity: qty,
            }),
          );
        }
        setMobileRestockTarget(null);
        toast.success(OFFLINE_SAVED_TOAST);
        return;
      }
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveMobileDoctorDeduct({
    quantity,
    reason,
    patient_id = null,
    patient_label = "",
    note = "",
    batch_id = null,
    legacy_unknown_lot = false,
    legacy_explanation = "",
  }) {
    const item = mobileDeductItem;
    if (!item?.id) return;
    const qty = Number(quantity || 0);
    if (!Number.isInteger(qty) || qty <= 0) return;
    const stockOutReason =
      reason === "Sale" ? "Sale" : reason === "Expired" ? "Expired" : "Wasted";
    const available = stockOutReason === "Sale"
      ? Number(item.available_to_use ?? item.quantity ?? 0)
      : Number(item.quantity || 0);
    if (qty > available) {
      toast.error("Quantity exceeds available stock.");
      return;
    }

    const resolvedNote = String(note || (reason === "Damage" ? "Damaged in bag" : "")).trim();
    if (stockOutReason !== "Sale" && resolvedNote.length < 8) {
      toast.error("Enter a meaningful reason before confirming wastage or expiry.");
      return;
    }

    if (stockOutReason === "Sale" && !patient_id) {
      toast.error("Select a patient before logging this Sale.");
      return;
    }

    const endpoint = `/inventory/items/${item.id}/actions${inventoryListQuery}`;
    const payload = {
      action_type: "stock_out",
      quantity: qty,
      reason: stockOutReason,
      note: resolvedNote,
      expected_version: Number(item.row_version || 0),
      batch_id,
      legacy_unknown_lot: Boolean(legacy_unknown_lot),
      legacy_explanation,
      ...(stockOutReason === "Sale"
        ? {
            patient_id: Number(patient_id),
            patient_label,
          }
        : {}),
    };

    setIsSaving(true);
    try {
      const queueMeta = {
        itemId: item.id,
        itemName: item.item_name,
        quantity: qty,
        reason,
        doctorId: user.doctor_id,
        ...(stockOutReason === "Sale"
          ? { patientId: Number(patient_id), patientLabel: patient_label }
          : {}),
      };

      if (shouldQueueInventoryMutation()) {
        await queueInventoryMutation({
          kind: "inventory_deduct",
          endpoint,
          payload,
          meta: queueMeta,
        });
        if (data) {
          commitInventoryData(applyOptimisticBagDeduct(data, item.id, qty));
        }
        setMobileDeductItem(null);
        toast.success(OFFLINE_SAVED_TOAST);
        return;
      }

      const next = await api.post(endpoint, payload);
      const saleBilling = next?.sale_billing;
      commitInventoryData(next);
      setMobileDeductItem(null);
      if (reason === "Sale") {
        toast.success(
          saleBilling?.attached
            ? patient_label
              ? `Stock deducted and added to ${patient_label}'s bill.`
              : "Stock deducted and added to the patient's bill."
            : patient_label
              ? `Stock deducted for ${patient_label}. It will be added to the bill when the consultation is saved.`
              : "Stock deducted. It will be added to the bill when the consultation is saved.",
        );
      } else if (reason === "Expired") {
        toast.success("Expired stock logged to operational loss.");
      } else {
        toast.success("Damaged stock logged to operational loss.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (error.data?.inventory) {
          commitInventoryData(error.data.inventory);
        } else {
          await load(selectedContextDoctorId, doctorContext, { silent: true });
        }
        // Close the sheet so the doctor re-opens it against the freshly
        // refreshed row (avoids retry loops on stale expected_version).
        setMobileDeductItem(null);
        toast.error("Stock changed on another device. Quantities refreshed.");
        return;
      }

      if (shouldQueueInventoryMutation(error)) {
        await queueInventoryMutation({
          kind: "inventory_deduct",
          endpoint,
          payload,
          meta: {
            itemId: item.id,
            itemName: item.item_name,
            quantity: qty,
            reason,
            doctorId: user.doctor_id,
            ...(stockOutReason === "Sale"
              ? { patientId: Number(patient_id), patientLabel: patient_label }
              : {}),
          },
        });
        if (data) {
          commitInventoryData(applyOptimisticBagDeduct(data, item.id, qty));
        }
        setMobileDeductItem(null);
        toast.success(OFFLINE_SAVED_TOAST);
        return;
      }
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  function toggleExpanded(itemId) {
    const key = Number(itemId);
    const willExpand = !expandedRows[key];
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
    if (willExpand) {
      loadBatches(key);
    }
  }

  async function removeItem() {
    if (!itemToDelete) return;
    try {
      await api.delete(`/inventory/items/${itemToDelete.id}`);
      setItemToDelete(null);
      await load(selectedContextDoctorId, doctorContext, { silent: true });
      toast.success("Catalogue item archived.");
    } catch (error) {
      toast.error(error.message);
    }
  }

  return (
    <>
      {showMobileDoctorBag ? (
        <>
          <MobileDoctorBagLayout
            search={search}
            setSearch={setSearch}
            doctorContext={doctorContext}
            onDoctorContextChange={handleDoctorContextChange}
            folders={categoryFolders}
            selectedView={selectedView}
            onSelectedViewChange={setSelectedView}
            doctorViewIsOcs={doctorViewIsOcs}
            mobileBagPagedItems={mobileBagPagedItems}
            mobileBagTotalPages={mobileBagTotalPages}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            onOpenDeduct={(item) => setMobileDeductItem(item)}
            onOpenRequest={openDoctorRequestForItem}
            onOpenRestock={emergencyRestockEnabled ? openMobileDoctorRestock : undefined}
            showLowStockOnly={showLowStockOnly}
            showMissingExpiryOnly={showMissingExpiryOnly}
            showExpiredOnly={showExpiredOnly}
            onToggleLowStock={() => applyDoctorBagFilter("low")}
            onToggleMissingExpiry={() => applyDoctorBagFilter("missing")}
            onToggleExpired={() => applyDoctorBagFilter("expired")}
            listRefreshing={listRefreshing}
            folderCounts={folderCounts}
            bagItemCount={items.length}
          />
          <MobileDoctorDeductSheet
            open={Boolean(mobileDeductItem)}
            item={mobileDeductItem}
            isSaving={isSaving}
            assignedPatients={assignedPatientsList}
            onClose={() => setMobileDeductItem(null)}
            onSubmit={saveMobileDoctorDeduct}
          />
          <MobileDoctorRestockSheet
            open={Boolean(mobileRestockTarget)}
            item={mobileRestockTarget}
            ocsAvailable={mobileRestockTarget?.ocs_available}
            isSaving={isSaving}
            onClose={() => setMobileRestockTarget(null)}
            onSubmit={saveMobileDoctorRestock}
          />
        </>
      ) : (
        <div className={cx(pageContainerClass, isOperator ? "space-y-4 pb-1" : "space-y-6")}>
      <PageHeader
        className={isOperator ? "mb-0" : undefined}
        eyebrow="Logistics"
        title={isDoctor ? (doctorViewIsOcs ? "OCS depot" : "My bag") : staffLocationHeading}
        actions={
          isDoctor ? (
            emergencyRestockEnabled ? (
            <button
              type="button"
              onClick={openDoctorFillBag}
              className="inline-flex items-center gap-2 rounded-2xl bg-rose-700 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            >
              <Truck className="size-4" />
              Emergency stock transfer
            </button>
            ) : (
              <Link
                to="/supply-requests"
                className="inline-flex items-center gap-2 rounded-2xl bg-[#2d8f98] px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                <Truck className="size-4" />
                Request supply
              </Link>
            )
          ) : (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {canUseAdminInventory && isAdmin && logisticsTab === "stock" ? (
                <>
                  <div className="hidden gap-2 lg:flex">
                    <button
                      type="button"
                      onClick={downloadAdminStockExcel}
                      className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-[#4FB8B3]/50 hover:bg-slate-50"
                    >
                      <Download className="size-4 text-[#1f7f7b]" />
                      Download inventory
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditor({ item: null })}
                      className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-[#4FB8B3] px-4 text-sm font-semibold text-white transition hover:bg-[#3aa6a1] lg:bg-ocs-teal lg:hover:bg-ocs-teal/90"
                    >
                      <Plus className="size-4" />
                      Add catalogue item
                    </button>
                  </div>
                  <div className="relative lg:hidden">
                    <button
                      ref={headerActionsButtonRef}
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={headerActionsOpen}
                      aria-label="Inventory actions"
                      onClick={() => setHeaderActionsOpen((open) => !open)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
                    >
                      <Ellipsis className="size-4" />
                      Actions
                    </button>
                    {headerActionsOpen ? (
                      <div
                        data-inventory-header-menu="true"
                        role="menu"
                        aria-label="Inventory actions"
                        className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-slate-200 bg-white py-1 shadow-lg"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => {
                            setHeaderActionsOpen(false);
                            downloadAdminStockExcel();
                          }}
                        >
                          <Download className="size-4" />
                          Download inventory
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          onClick={() => {
                            setHeaderActionsOpen(false);
                            setEditor({ item: null });
                          }}
                        >
                          <Plus className="size-4" />
                          Add catalogue item
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          )
        }
      />

      {canUseAdminInventory && logisticsTab !== "queues" ? (
        <InventoryTabSummaries
          tab={logisticsTab}
          summaries={data?.tab_summaries}
          chaseCounts={chaseCounts}
          warehouseValue={summary.total_amount_rs || 0}
          filters={{ low: showLowStockOnly, near: showNearExpiryOnly, missing: showMissingExpiryOnly, expired: showExpiredOnly }}
          onFilter={applyChaseFilter}
          onOpenIncoming={() => setLogisticsTab("shipments")}
          onOpenApproval={(status) => {
            setLogisticsTab("count");
            setStocktakeStatusFilter(status);
          }}
          onOpenUnpriced={() => {
            setLogisticsTab("stock");
            setSelectedView("all");
            setActiveCategory("All");
            setSearch("");
            setShowUnpricedOnly(true);
            setUnpricedFromBags(true);
            setShowLowStockOnly(false);
            setShowNearExpiryOnly(false);
            setShowMissingExpiryOnly(false);
            setShowExpiredOnly(false);
          }}
        />
      ) : isDoctor ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <SummaryCard
            title="My bag at or below par"
            value={doctorMetrics.at_or_below_par}
            tone="rose"
            hint="Click to filter my bag"
            active={doctorViewIsMy && showLowStockOnly}
            onClick={() => applyDoctorBagFilter("low")}
          />
          <SummaryCard
            title="My bag missing expiry"
            value={doctorMetrics.missing_expiry}
            hint="Click to filter my bag"
            active={doctorViewIsMy && showMissingExpiryOnly}
            onClick={() => applyDoctorBagFilter("missing")}
          />
          <SummaryCard
            title="My bag near expiry"
            value={doctorMetrics.near_expiry}
            tone="amber"
            hint="Within 90 days"
            active={doctorViewIsMy && showNearExpiryOnly}
            onClick={() => applyDoctorBagFilter("near")}
          />
          <SummaryCard
            title="My bag expired"
            value={doctorMetrics.expired}
            tone="rose"
            hint="Unusable until written off"
            active={doctorViewIsMy && showExpiredOnly}
            onClick={() => applyDoctorBagFilter("expired")}
          />
          <SummaryCard
            title="Depot can fill"
            value={doctorMetrics.ocs_can_fill}
            hint="At or below par with usable depot stock"
            onClick={() => navigate("/supply-requests")}
          />
        </div>
      ) : null}

      {canManageOcs ? (
        <div className="relative">
          <div
            ref={inventoryTabListRef}
            role="tablist"
            aria-label="Inventory sections"
            className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory [scrollbar-width:thin]"
          >
          {[
            ...(isOperator ? [{ id: "queues", label: "Work queues", shortLabel: "Queues" }] : []),
            { id: "stock", label: isOperator ? "Warehouse stock" : "Stock", shortLabel: "Stock" },
            { id: "shipments", label: "Shipments", shortLabel: "Shipments", badge: pendingStagingCount },
            { id: "count", label: "Count", shortLabel: "Count" },
            ...(isAdmin ? [{ id: "bags", label: "Bags", shortLabel: "Bags" }] : []),
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={logisticsTab === tab.id}
              aria-current={logisticsTab === tab.id ? "page" : undefined}
              onClick={() => setLogisticsTab(tab.id)}
              className={`inline-flex min-h-11 shrink-0 snap-start items-center justify-center gap-1 rounded-full px-3 text-sm font-semibold transition ${
                logisticsTab === tab.id
                  ? "bg-[#2d8f98] text-white shadow-sm ring-2 ring-[#2d8f98] ring-offset-2"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge > 0 ? (
                <span
                  className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                    logisticsTab === tab.id ? "bg-white/90 text-[#2d8f98]" : "bg-[#2d8f98] text-white"
                  }`}
                >
                  {tab.badge > 9 ? "9+" : tab.badge}
                </span>
              ) : null}
            </button>
          ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-slate-50 to-transparent sm:hidden" aria-hidden="true" />
        </div>
      ) : null}

      {canManageOcs && logisticsTab === "queues" ? (
        <OperatorWorkQueuesPanel
          onOpenShipments={() => setLogisticsTab("shipments")}
          onOpenCount={() => setLogisticsTab("count")}
        />
      ) : null}

      {canManageOcs && logisticsTab === "stock" && isAdmin ? (
        <OperatorSupplyRequestsPanel />
      ) : null}

      {canManageOcs && logisticsTab === "stock" && showUnpricedOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p>Showing unique catalogue products that need pricing.</p>
          {unpricedFromBags ? (
            <button
              type="button"
              onClick={() => {
                setLogisticsTab("bags");
                setShowUnpricedOnly(false);
                setUnpricedFromBags(false);
              }}
              className="inline-flex min-h-11 items-center rounded-xl border border-amber-300 bg-white px-3 text-sm font-semibold"
            >
              Return to Bags
            </button>
          ) : null}
        </div>
      ) : null}

      {canManageOcs && logisticsTab === "shipments" ? (
        <>
          <InventoryCsvImport onImported={() => load(undefined, undefined, { silent: true })} />
          <InventoryStagingQueue
            rows={data?.staging}
            shipments={data?.shipments}
            incomingShipments={data?.incoming_shipments}
            onReleased={() => load(undefined, undefined, { silent: true })}
          />
        </>
      ) : null}

      {canManageOcs && logisticsTab === "count" ? (
        <InventoryStocktakePanel
          items={data?.ocs_stock || items}
          folders={folders}
          sessions={data?.stocktake_sessions || []}
          requestedStatus={stocktakeStatusFilter}
          onApplied={() => load(undefined, undefined, { silent: true })}
        />
      ) : null}

      {!canManageOcs || logisticsTab === "stock" ? (
      <SectionCard
        className={isOperator ? "pb-3" : undefined}
        title={
          isDoctor
            ? doctorViewIsOcs
              ? "OCS depot"
              : "Bag items"
            : contextIsOcs
              ? "OCS warehouse items"
              : staffLocationHeading
        }
      >
        <div className="sticky top-0 z-20 mb-4 space-y-3 border-b border-slate-100 bg-white pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {isDoctor ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleDoctorContextChange("my")}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${doctorViewIsMy ? "bg-[#2d8f98] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                >
                  My bag
                </button>
                <button
                  type="button"
                  onClick={() => handleDoctorContextChange("ocs")}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${doctorViewIsOcs ? "bg-[#2d8f98] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                >
                  OCS depot
                </button>
              </div>
            ) : (
              <select
                aria-label="Stock location"
                value={selectedContextDoctorId}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedContextDoctorId(value);
                  const option = filteredContextOptions.find((row) => String(row.id) === String(value));
                  setContextSearch(option?.label || "OCS Stock");
                }}
                className="w-full shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 sm:w-56"
              >
                <option value="">OCS warehouse</option>
                {doctorOptions.map((doctor) => (
                  <option key={`ctx-doctor-${doctor.id}`} value={String(doctor.id)}>
                    {doctor.full_name} bag
                  </option>
                ))}
              </select>
            )}
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by item name  (press / )"
                className="w-full min-h-11 min-w-0 rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#4FB8B3]"
              />
            </label>
            <button
              type="button"
              aria-expanded={stockFiltersOpen}
              onClick={() => setStockFiltersOpen((open) => !open)}
              className="inline-flex min-h-11 shrink-0 items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 lg:hidden"
            >
              Filters
            </button>
          </div>
          <div className="-mx-1 flex items-center gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => {
                setSelectedView("all");
                setActiveCategory("All");
              }}
              className={`min-h-11 shrink-0 rounded-2xl px-3 text-xs font-semibold sm:text-sm ${selectedView === "all" ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
            >
              All ({items.length})
            </button>
            {categoryFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => {
                  setSelectedView(String(folder.id));
                  setActiveCategory(folder.name);
                }}
                className={`min-h-11 shrink-0 rounded-2xl px-3 text-xs font-semibold sm:text-sm ${selectedView === String(folder.id) ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
              >
                {folder.name} ({folderCounts.get(String(folder.id)) || 0})
              </button>
            ))}
          </div>
          <div className={cx("flex flex-wrap items-center gap-2", stockFiltersOpen ? "flex" : "hidden lg:flex")}>
            <button
              type="button"
              onClick={() => applyChaseFilter("low")}
              className={`min-h-11 rounded-2xl px-3 text-xs font-semibold ${showLowStockOnly ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
            >
              Low stock ({chaseCounts.low})
            </button>
            <button
              type="button"
              onClick={() => applyChaseFilter("near")}
              className={`min-h-11 rounded-2xl px-3 text-xs font-semibold ${showNearExpiryOnly ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
            >
              Near expiry ({chaseCounts.near})
            </button>
            <button
              type="button"
              onClick={() => applyChaseFilter("missing")}
              className={`min-h-11 rounded-2xl px-3 text-xs font-semibold ${showMissingExpiryOnly ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
            >
              Missing expiry ({chaseCounts.missing})
            </button>
            <button
              type="button"
              onClick={() => applyChaseFilter("expired")}
              className={`min-h-11 rounded-2xl px-3 text-xs font-semibold ${showExpiredOnly ? "bg-rose-600 text-white" : "border border-rose-200 bg-white text-rose-700"}`}
            >
              Expired stock ({chaseCounts.expired})
            </button>
            {chaseCounts.reconciliation > 0 ? (
              <button
                type="button"
                onClick={() => setLogisticsTab("queues")}
                className="min-h-11 rounded-2xl border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-900"
              >
                Reconciliation required ({chaseCounts.reconciliation})
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                const token = window.localStorage.getItem("ocs_medecins_auth_token");
                void fetch(`/api/inventory/data-quality.csv${selectedContextDoctorId ? `?doctorId=${encodeURIComponent(selectedContextDoctorId)}` : ""}`, {
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                }).then(async (response) => {
                  const blob = await response.blob();
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "inventory-data-quality.csv";
                  link.click();
                  URL.revokeObjectURL(url);
                });
              }}
              className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
            >
              Export data-quality CSV
            </button>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  setShowUnpricedOnly((value) => !value);
                  setUnpricedFromBags(false);
                }}
                className={`min-h-11 rounded-2xl px-3 text-xs font-semibold ${showUnpricedOnly ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
              >
                Unpriced
              </button>
            ) : null}
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
              <option value="name_asc">Sort: Name (A–Z)</option>
              <option value="expiry_asc">Sort: Expiry (Soonest)</option>
              <option value="qty_asc">Sort: Qty (Lowest)</option>
              <option value="qty_desc">Sort: Qty (Highest)</option>
            </select>
          </div>
        </div>

        {listRefreshing ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500" aria-live="polite">
            Updating items…
          </div>
        ) : pagedItems.length ? (
          <>
            <div className="hidden rounded-3xl border border-slate-200/80 bg-white lg:block">
              <div className={cx("overflow-x-auto overflow-y-auto", inventoryTableScrollClass)}>
                <table className="w-full table-fixed text-left text-sm" style={{ minWidth: inventoryTableMinWidth }}>
                  <colgroup>
                    <col style={{ width: doctorDesktopBagTable ? "28%" : "34%" }} />
                    <col style={{ width: doctorDesktopBagTable ? "11%" : "10%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: doctorDesktopBagTable ? "21%" : "26%" }} />
                    <col style={{ width: inventoryActionsColWidth }} />
                  </colgroup>
                  <thead className="sticky top-0 z-20 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-gray-500 lg:text-ocs-slate">
                    <tr>
                      <th className="px-3 py-2 text-left align-middle">Item Name</th>
                      <th className="px-3 py-2 text-center align-middle">On hand</th>
                      <th className="px-3 py-2 text-center align-middle">Minimum</th>
                      <th className="px-3 py-2 text-center align-middle">Nearest usable expiry</th>
                      <th className="sticky right-0 z-30 bg-slate-50 px-3 py-2 text-right align-middle shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.18)]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((item) => {
                      const isLow = isAtOrBelowPar(item);
                      const expanded = Boolean(expandedRows[item.id]);
                      const batches = batchMap[item.id] || [];
                      return (
                        <Fragment key={item.id}>
                          <tr
                            className={`group border-t border-slate-200/70 align-middle text-slate-700 transition-colors hover:bg-slate-50 ${isLow ? "bg-red-50" : ""}`}
                            onClick={() => toggleExpanded(item.id)}
                          >
                            <td className="px-3 py-1.5 align-middle text-left">
                              <div className="flex min-w-0 items-center gap-2">
                                <button
                                  type="button"
                                  aria-expanded={expanded}
                                  aria-label={`${expanded ? "Hide" : "Show"} details for ${item.item_name}`}
                                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-slate-200 p-1 text-slate-500"
                                >
                                  {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                </button>
                                <span
                                  className="min-w-0 flex-1 truncate font-semibold text-slate-900"
                                  title={item.item_name}
                                >
                                  {item.item_name}
                                </span>
                              </div>
                              <InventoryStatusChips item={item} />
                            </td>
                            <td className="px-3 py-1.5 align-middle text-center">
                              <div className="flex flex-col items-center gap-0.5 text-left" title="On-hand is physical stock. Available to use excludes reserved and expired units.">
                                <InventoryQuantityLines item={item} showMinimum={false} />
                              </div>
                            </td>
                            <td className="px-3 py-1.5 align-middle text-center tabular-nums">{item.minimum_quantity}</td>
                            <td
                              className={cx(
                                "truncate px-3 py-1.5 align-middle text-center",
                                !item.nearest_usable_expiry && "text-slate-400",
                                item.is_near_expiry && "font-semibold text-amber-800",
                                itemHasExpiredStock(item) && "font-semibold text-rose-700",
                              )}
                              title={formatInventoryExpiry(item)}
                            >
                              {formatInventoryExpiry(item)}
                            </td>
                            <td
                              className="sticky right-0 z-10 bg-white px-3 py-2 align-middle shadow-[-8px_0_12px_-8px_rgba(15,23,42,0.12)]"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="flex justify-end">
                              <InventoryActionButtons
                                item={item}
                                user={user}
                                canManageOcs={canManageOcs}
                                contextIsOcs={contextIsOcs}
                                isDoctor={isDoctor}
                                doctorViewIsMy={doctorViewIsMy}
                                doctorViewIsOcs={doctorViewIsOcs}
                                onStockIn={canReceiveWarehouseStock(user) ? (nextItem) => setAddStock({ item: nextItem }) : undefined}
                                onEdit={openItemEditor}
                                onRestockDoctor={canTransferToDoctorBag(user) ? handleRestockDoctor : undefined}
                                onRestockMyInventory={openDoctorRestockForItem}
                                onRequestItem={openDoctorRequestForItem}
                                omitRestock={isDoctor ? !emergencyRestockEnabled : false}
                                onStockOut={(nextItem) => setStockOut({ item: nextItem })}
                                onRemove={canWriteOffWarehouseStock(user) ? (nextItem) => setRemoveStock({ item: nextItem }) : undefined}
                                showDeleteItem={showDeleteStockItem}
                                onDeleteItem={canArchiveCatalogueItem(user) ? (nextItem) => setItemToDelete(nextItem) : undefined}
                                onExceptionalCorrection={canApplyExceptionalCorrection(user) ? (nextItem) => setCorrection({ item: nextItem }) : undefined}
                              />
                              </div>
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="border-t border-slate-100 bg-slate-50/60">
                              <td colSpan={5} className="px-3 py-2">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Details</p>
                                    <p className="mt-2 text-sm text-slate-700">Attributes: {item.attributes || "N/A"}</p>
                                    <p className="mt-1 text-sm text-slate-700">MOA Notes: {item.moa_notes || "N/A"}</p>
                                    <p className="mt-1 text-sm text-slate-700">Cost / Sell: {formatRupees(item.cost_price)} / {formatRupees(item.selling_price)}</p>
                                  </div>
                                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Batch List (FEFO)</p>
                                    <div className="mt-2 space-y-1">
                                      {batches.length ? batches.map((batch) => (
                                        <p key={batch.id} className="text-sm text-slate-700">
                                          Batch #{batch.id} - Qty {batch.quantity_remaining} - {batch.expiry_label || formatStockExpiryLabel(batch)} - Cost {formatRupees(batch.unit_cost)}
                                        </p>
                                      )) : <p className="text-sm text-slate-500">No batches loaded.</p>}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-2 flex w-full flex-col gap-3.5 bg-slate-50 px-1 py-3 lg:hidden">
              {pagedItems.map((item) => (
                <MobileInventoryStockCard
                  key={`m-${item.id}`}
                  item={item}
                  actions={
                    <InventoryActionButtons
                      item={item}
                      user={user}
                      canManageOcs={canManageOcs}
                      contextIsOcs={contextIsOcs}
                      isDoctor={isDoctor}
                      doctorViewIsMy={doctorViewIsMy}
                      doctorViewIsOcs={doctorViewIsOcs}
                      onStockIn={canReceiveWarehouseStock(user) ? (nextItem) => setAddStock({ item: nextItem }) : undefined}
                      onEdit={openItemEditor}
                      onRestockDoctor={canTransferToDoctorBag(user) ? handleRestockDoctor : undefined}
                      onRestockMyInventory={openDoctorRestockForItem}
                      onRequestItem={openDoctorRequestForItem}
                      omitRestock={isDoctor ? !emergencyRestockEnabled : false}
                      onStockOut={(nextItem) => setStockOut({ item: nextItem })}
                      onRemove={canWriteOffWarehouseStock(user) ? (nextItem) => setRemoveStock({ item: nextItem }) : undefined}
                      showDeleteItem={showDeleteStockItem}
                      onDeleteItem={canArchiveCatalogueItem(user) ? (nextItem) => setItemToDelete(nextItem) : undefined}
                      onExceptionalCorrection={canApplyExceptionalCorrection(user) ? (nextItem) => setCorrection({ item: nextItem }) : undefined}
                      touchWrap
                    />
                  }
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            title="No stock items found"
            description={
              canManageOcs && contextIsOcs
                ? "Add stock in Consumable or pick another category when adding a new item."
                : isDoctor && doctorViewIsMy
                  ? "Open the OCS depot to pull items into your bag, or pick another category."
                  : "Try another category, search term, or restock from the OCS depot."
            }
          />
        )}

        <div className={cx("flex items-center justify-between", isOperator ? "mt-2" : "mt-3")} data-testid="inventory-pagination">
          <p className="text-xs text-slate-500">
            Page {currentPage} of {totalPages} - {sortedItems.length} filtered item(s)
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} className="min-h-11 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
              Previous
            </button>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} className="min-h-11 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
              Next
            </button>
          </div>
        </div>
      </SectionCard>
      ) : null}

      {isDoctor ? null : canUseAdminInventory && logisticsTab === "bags" ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ocs-slate">Doctor bags</h2>
              <p className="text-xs text-slate-500">
                {formatInventoryPeriodLabel(adminPeriodPreset, adminPeriodRange.from, adminPeriodRange.to)}
                . One period for both tables. Click a doctor to open their bag.
              </p>
            </div>
            <InventoryPeriodFilter
              preset={adminPeriodPreset}
              anchorDate={adminPeriodAnchor}
              onPresetChange={setAdminPeriodPreset}
              onAnchorDateChange={setAdminPeriodAnchor}
              className="w-full min-w-0 shrink-0 overflow-x-auto sm:w-auto"
            />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard
            title="Bag movement"
            subtitle="Units first, rupees second. Unpriced means cost is missing."
            actions={
              <button
                type="button"
                onClick={() =>
                  downloadCompareReconciliationExcel({
                    compareRows,
                    periodLabel: formatInventoryPeriodLabel(
                      adminPeriodPreset,
                      adminPeriodRange.from,
                      adminPeriodRange.to,
                    ),
                    startDate: adminPeriodRange.from,
                    endDate: adminPeriodRange.to,
                  })
                }
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-sm transition hover:border-[#4FB8B3]/50 hover:bg-slate-50"
              >
                <Download className="size-4 shrink-0 text-[#1f7f7b]" />
                Export bag reconciliation
              </button>
            }
          >
          {compareRows.length === 0 ? (
            <EmptyState
              title="No bag movement this period"
              description="There were no restocks, documented use, wastage, expiry write-offs or exceptional corrections in this period. Doctors with empty bags stay hidden."
            />
          ) : (
          <>
          <div className="space-y-3 lg:hidden">
            {compareRows.map((row) => (
              <button
                key={`bag-card-${row.doctor_id}`}
                type="button"
                onClick={() => openDoctorBagFromCompare(row.doctor_id)}
                aria-label={`View ${doctorBagHeading(row.doctor_name)}`}
                className="flex min-h-11 w-full flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-[#2d8f98] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d8f98] active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="break-words font-semibold text-slate-900">{row.doctor_name}</p>
                  <span className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[#2d8f98]">
                    View bag
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>On hand <strong className="block tabular-nums text-slate-900">{formatCompareQty(row.bag_on_hand_qty)}</strong></div>
                  <div>Restocked <strong className="block tabular-nums text-slate-900">{formatCompareQty(row.total_restocked_qty)}</strong></div>
                  <div>Used/sold <strong className="block tabular-nums text-slate-900">{formatCompareQty(row.consumed_sales_qty)}</strong></div>
                  <div>Wasted/expired <strong className="block tabular-nums text-slate-900">{formatCompareQty(Number(row.consumed_wasted_qty || 0) + Number(row.consumed_expired_qty || 0))}</strong></div>
                </dl>
                {Number(row.unpriced_qty || 0) > 0 ? (
                  <p className="text-xs font-semibold text-amber-700">Unpriced items in this bag</p>
                ) : (
                  <p className="break-words text-xs text-slate-500">{formatCompareMoney(row.bag_on_hand, row.bag_on_hand_qty)}</p>
                )}
                {Number(row.exceptional_correction_qty || 0) > 0 || !row.has_period_workflow ? (
                  <p className="text-[11px] text-slate-500">
                    {Number(row.exceptional_correction_qty || 0) > 0
                      ? "Includes exceptional corrections"
                      : "No workflow movements in this period"}
                  </p>
                ) : null}
              </button>
            ))}
          </div>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 lg:block">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Doctor</th>
                  <th className="px-3 py-2 text-right">Restocked</th>
                  <th className="px-3 py-2 text-right">Sold</th>
                  <th className="px-3 py-2 text-right">Wasted</th>
                  <th className="px-3 py-2 text-right">Expired</th>
                  <th className="px-3 py-2 text-right">On hand</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr
                    key={row.doctor_id}
                    tabIndex={0}
                    role="button"
                    className="cursor-pointer border-t border-slate-200/70 text-xs hover:bg-slate-50"
                    onClick={() => openDoctorBagFromCompare(row.doctor_id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openDoctorBagFromCompare(row.doctor_id);
                      }
                    }}
                  >
                    <td className="px-3 py-2 font-medium text-slate-900">
                      <span className="break-words">{row.doctor_name}</span>
                    {Number(row.exceptional_correction_qty || 0) > 0 ? (
                      <p className="mt-1 text-[11px] font-semibold text-amber-700">Exceptional correction in period</p>
                    ) : !row.has_period_workflow ? (
                      <p className="mt-1 text-[11px] text-slate-400">No workflow movements this period</p>
                    ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <CompareMetricCell
                        amount={row.total_restocked}
                        qty={row.total_restocked_qty}
                        onUnpriced={
                          isAdmin && Number(row.unpriced_qty || 0) > 0
                            ? (event) => {
                                event.stopPropagation();
                                setLogisticsTab("stock");
                                setShowUnpricedOnly(true);
                              }
                            : undefined
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CompareMetricCell amount={row.consumed_sales} qty={row.consumed_sales_qty} />
                    </td>
                    <td className="px-3 py-2">
                      <CompareMetricCell amount={row.consumed_wasted} qty={row.consumed_wasted_qty} />
                    </td>
                    <td className="px-3 py-2">
                      <CompareMetricCell amount={row.consumed_expired} qty={row.consumed_expired_qty} />
                    </td>
                    <td className="px-3 py-2">
                      <CompareRemainingCell
                        value={row.bag_on_hand}
                        variance={row.variance_rs}
                        qty={row.bag_on_hand_qty}
                      />
                      <p className="mt-0.5 text-right text-[11px] text-slate-400">
                        {formatCompareQty(row.bag_on_hand_qty)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
          )}
        </SectionCard>
        <LiveActivitySection
          movements={parsedMovements}
          maxRows={10}
          preview
          hidePeriodFilter
          scrollClassName="max-h-[min(28rem,55vh)]"
          {...liveActivityStaffFilterProps}
        />
        </div>
        </div>
      ) : !canUseAdminInventory ? (
        <div className="hidden lg:block">
          <LiveActivitySection movements={parsedMovements} />
        </div>
      ) : null}

        </div>
      )}

      {isAdmin ? (
      <OperatorAddItemDrawer
        open={operatorAddOpen}
        folders={folders}
        activeFolderId={selectedView}
        activeCategory={activeCategory}
        isSaving={isSaving}
        onClose={() => setOperatorAddOpen(false)}
        onSubmit={saveItem}
      />
      ) : null}
      <ItemEditorModal
        open={Boolean(editor)}
        item={editor?.item}
        folders={folders}
        isSaving={isSaving}
        lockMasterFields={(Boolean(editor?.item) && isDoctor) || isOperator}
        bagSettingsOnly={Boolean(editor?.item) && isDoctor}
        onClose={() => setEditor(null)}
        onSubmit={saveItem}
      />
      <ActionModal open={Boolean(movement)} item={movement?.item} type={movement?.type} isSaving={isSaving} onClose={() => setMovement(null)} onSubmit={saveMovement} />
      <DoctorTransferModal
        open={Boolean(restock)}
        doctors={doctors}
        item={restock?.item}
        user={user}
        presetDoctorId={restock?.doctorId}
        presetDoctorName={restock?.doctorName}
        isSaving={isSaving}
        onClose={() => setRestock(null)}
        onSubmit={saveRestock}
      />
      <DoctorRestockModal
        open={doctorRestockOpen}
        item={doctorRestockItem}
        candidates={doctorRestockCandidates}
        isSaving={isSaving}
        onClose={() => {
          setDoctorRestockOpen(false);
          setDoctorRestockItem(null);
        }}
        onSubmit={saveDoctorRestock}
      />
      <StockOutModal
        open={Boolean(stockOut)}
        item={stockOut?.item}
        isSaving={isSaving}
        assignedPatients={assignedPatientsList}
        onClose={() => setStockOut(null)}
        onSubmit={saveStockOut}
      />
      <RestockReceiptModal
        open={receiptModalOpen}
        receipt={activeReceipt}
        onClose={() => setReceiptModalOpen(false)}
        onPrint={() => printReceipt(activeReceipt)}
      />
      <AddStockModal open={Boolean(addStock)} item={addStock?.item} user={user} isSaving={isSaving} onClose={() => setAddStock(null)} onSubmit={saveAddStock} />
      <WriteOffStockModal
        open={Boolean(removeStock)}
        item={removeStock?.item}
        user={user}
        isDoctorBag={removeStock?.item?.stock_scope === "doctor" || Boolean(removeStock?.item?.owner_doctor_id)}
        isSaving={isSaving}
        onClose={() => setRemoveStock(null)}
        onSubmit={saveRemoveStock}
      />
      <ExceptionalCorrectionModal
        open={Boolean(correction)}
        item={correction?.item}
        isSaving={isSaving}
        onClose={() => setCorrection(null)}
        onSubmit={saveExceptionalCorrection}
      />
      <ConfirmDialog
        open={Boolean(itemToDelete)}
        onClose={() => setItemToDelete(null)}
        onConfirm={removeItem}
        title="Archive catalogue item?"
        description={
          itemToDelete
            ? `${itemToDelete.item_name} will no longer appear in the active catalogue. Existing requests, receipts, movements and reporting history will remain. No historical record will be permanently deleted.`
            : ""
        }
        confirmLabel="Archive catalogue item"
      />
    </>
  );
}
