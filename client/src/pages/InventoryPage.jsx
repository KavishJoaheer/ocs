import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Download,
  Minus,
  MinusCircle,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import toast from "react-hot-toast";
import { useSearchParams, useNavigate } from "react-router-dom";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import { buildInventoryListQuery, getDefaultFolderSelection } from "../lib/inventoryFolders.js";
import { notifyDoctorBagInventoryUpdated } from "../lib/inventorySync.js";
import { formatRupees } from "../lib/format.js";
import { cx, pageContainerClass } from "../lib/utils.js";

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
            "rounded-xl px-3 py-1.5 text-xs font-semibold transition",
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
  { id: "my", label: "My Stock" },
  { id: "ocs", label: "OCS Stock" },
];

function SummaryCard({ title, value, tone = "teal" }) {
  const valueToneClass = tone === "amber" ? "text-amber-700" : "text-slate-950";
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[0_16px_36px_rgba(34,72,91,0.06)] md:rounded-3xl md:p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</p>
      <p
        className={`mt-1.5 text-lg font-semibold leading-tight tabular-nums md:mt-2.5 md:text-2xl ${valueToneClass}`}
      >
        {value}
      </p>
    </div>
  );
}

function OperatorInventoryLogisticsGrid({
  lowStockCount,
  nearExpiryCount,
  showLowStockOnly,
  showNearExpiryOnly,
  onToggleLowStock,
  onToggleNearExpiry,
}) {
  return (
    <div className="mb-6 grid w-full grid-cols-1 gap-6 md:grid-cols-2">
      <button
        type="button"
        onClick={onToggleLowStock}
        className={cx(
          "flex w-full items-center justify-between rounded-2xl border border-[#e6ebd9] bg-[#f4f6f0] p-6 text-left shadow-sm transition hover:shadow-md",
          showLowStockOnly && "ring-2 ring-[#8fa382]/40",
        )}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#8fa382]">Low Stock Alerts</p>
          <p className="mt-1.5 text-3xl font-black tabular-nums text-[#3b4733]">{lowStockCount}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-2xl bg-[#e6ebd9] p-3 text-[#5a7353]">
            <AlertTriangle className="size-6" strokeWidth={2.25} aria-hidden />
          </div>
          <ChevronRight className="size-5 text-[#8fa382]" aria-hidden />
        </div>
      </button>

      <button
        type="button"
        onClick={onToggleNearExpiry}
        className={cx(
          "flex w-full items-center justify-between rounded-2xl border border-[#f5e3d7] border-l-4 border-l-[#d9744b] bg-[#fcf3ee] p-6 text-left shadow-sm transition hover:shadow-md",
          showNearExpiryOnly && "ring-2 ring-[#d9744b]/35",
        )}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#ba5a32]">Near Expiry Items</p>
          <p className="mt-1.5 text-3xl font-black tabular-nums text-[#6e2f14]">{nearExpiryCount}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-2xl bg-[#f5e3d7] p-3 text-[#ba5a32]">
            <Clock className="size-6" strokeWidth={2.25} aria-hidden />
          </div>
          <ChevronRight className="size-5 text-[#ba5a32]" aria-hidden />
        </div>
      </button>
    </div>
  );
}

function operatorItemFormState(folderId) {
  return {
    item_name: "",
    quantity: "0",
    minimum_quantity: "0",
    expiry_date: "",
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

function itemFormState(item, folders = []) {
  return {
    item_name: item?.item_name ?? "",
    folder_id: resolveItemFolderId(item, folders),
    attributes: item?.attributes ?? "",
    moa_notes: item?.moa_notes ?? "",
    quantity: String(item?.quantity ?? 0),
    minimum_quantity: String(item?.minimum_quantity ?? 0),
    unit: item?.unit ?? "unit",
    cost_price: String(item?.cost_price ?? 0),
    selling_price: String(item?.selling_price ?? 0),
    expiry_date: item?.expiry_date ?? "",
    adjustment_note: "",
  };
}

function ItemModal({ open, item, folders, isSaving, lockMasterFields = false, onClose, onSubmit }) {
  const [form, setForm] = useState(() => itemFormState(item, folders));

  useEffect(() => {
    if (open) setForm(itemFormState(item, folders));
  }, [item, open, folders]);

  const masterReadOnly = lockMasterFields;
  const fieldClass = (locked) =>
    cx(
      "w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none transition",
      locked ? "cursor-not-allowed bg-slate-100 text-slate-600" : "bg-slate-50",
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? "Edit stock item" : "Add stock item"}
      description="Save quantity, pricing, and expiry details."
      size="xl"
      innerScroll={false}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          const payload = {
            ...form,
            folder_id: Number(form.folder_id || 0),
            quantity: Number(form.quantity || 0),
            minimum_quantity: Number(form.minimum_quantity || 0),
            cost_price: Number(form.cost_price || 0),
            selling_price: Number(form.selling_price || 0),
          };
          if (!item) delete payload.adjustment_note;
          onSubmit(payload);
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-24 pr-1">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Item Name</span>
            <input
              required
              name="item_name"
              value={form.item_name}
              readOnly={masterReadOnly}
              onChange={(event) => setForm((prev) => ({ ...prev, item_name: event.target.value }))}
              className={fieldClass(masterReadOnly)}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Folder</span>
            <select
              required
              name="folder_id"
              value={form.folder_id}
              disabled={masterReadOnly}
              onChange={(event) => setForm((prev) => ({ ...prev, folder_id: event.target.value }))}
              className={fieldClass(masterReadOnly)}
            >
              <option value="">Select folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={String(folder.id)}>{folder.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Attributes</span>
            <input name="attributes" value={form.attributes} onChange={(event) => setForm((prev) => ({ ...prev, attributes: event.target.value }))} className={fieldClass(false)} />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Expiry Date</span>
            <input type="date" name="expiry_date" value={form.expiry_date} onChange={(event) => setForm((prev) => ({ ...prev, expiry_date: event.target.value }))} className={fieldClass(false)} />
          </label>
        </div>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">MOA Notes</span>
          <textarea rows="3" name="moa_notes" value={form.moa_notes} onChange={(event) => setForm((prev) => ({ ...prev, moa_notes: event.target.value }))} className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition" />
        </label>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Current Quantity</span>
            <input required min="0" type="number" name="quantity" value={form.quantity} onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))} className={fieldClass(false)} />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Minimum Quantity</span>
            <input required min="0" type="number" name="minimum_quantity" value={form.minimum_quantity} onChange={(event) => setForm((prev) => ({ ...prev, minimum_quantity: event.target.value }))} className={fieldClass(false)} />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Unit</span>
            <input required name="unit" value={form.unit} onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))} className={fieldClass(false)} />
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Cost Price (Rs)</span>
            <input
              required
              min="0"
              step="0.01"
              type="number"
              name="cost_price"
              value={form.cost_price}
              readOnly={masterReadOnly}
              onChange={(event) => setForm((prev) => ({ ...prev, cost_price: event.target.value }))}
              className={fieldClass(masterReadOnly)}
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Selling Price (Rs)</span>
            <input
              required
              min="0"
              step="0.01"
              type="number"
              name="selling_price"
              value={form.selling_price}
              readOnly={masterReadOnly}
              onChange={(event) => setForm((prev) => ({ ...prev, selling_price: event.target.value }))}
              className={fieldClass(masterReadOnly)}
            />
          </label>
        </div>
        {item ? (
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Adjustment Note</span>
            <input name="adjustment_note" value={form.adjustment_note} onChange={(event) => setForm((prev) => ({ ...prev, adjustment_note: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          </label>
        ) : null}
        </div>
        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-white/95 py-4">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="submit" disabled={isSaving} className="rounded-2xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{isSaving ? "Saving..." : item ? "Update Item" : "Add Item"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ActionModal({ open, item, type, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [patientId, setPatientId] = useState("");
  const [consultationId, setConsultationId] = useState("");

  useEffect(() => {
    if (open) {
      setQuantity("1");
      setNote("");
      setPatientId("");
      setConsultationId("");
    }
  }, [open]);

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

function AddStockModal({ open, item, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [expiryDate, setExpiryDate] = useState("");
  const [costPrice, setCostPrice] = useState("0.00");

  useEffect(() => {
    if (!open) return;
    setQuantity("1");
    setExpiryDate("");
    setCostPrice(String(item?.cost_price ?? 0));
  }, [open, item]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Stock In${item ? ` - ${item.item_name}` : ""}`}
      description="Add a new inventory batch using FEFO-safe batch tracking."
      size="lg"
      innerScroll={false}
    >
      <form
        className="flex min-h-0 w-full flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          const qty = Number(quantity || 0);
          const cost = Number(costPrice || 0);
          if (!Number.isInteger(qty) || qty <= 0) return toast.error("Quantity must be a whole number greater than 0.");
          if (cost < 0) return toast.error("Cost price must be zero or more.");
          onSubmit({ quantity: qty, expiry_date: expiryDate, cost_price: cost });
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-24 pr-1">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Quantity to Add</span>
            <input
              required
              min={1}
              step={1}
              type="number"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Batch Expiry Date</span>
            <input
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Current Cost Price (Rs)</span>
            <input
              required
              min={0}
              step="0.01"
              type="number"
              value={costPrice}
              onChange={(event) => setCostPrice(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            />
          </label>
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-200 bg-white/95 py-4">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="rounded-2xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {isSaving ? "Saving..." : "Stock In"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveStockModal({ open, item, isSaving, isDoctorBag, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("Expired");

  useEffect(() => {
    if (!open) return;
    setQuantity("1");
    setReason("Expired");
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={`Remove Stock${item ? ` - ${item.item_name}` : ""}`} description={isDoctorBag ? "Write off quantity from the doctor medical bag." : "Write off inventory using FEFO batch deduction."}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const qty = Number(quantity || 0);
          if (!Number.isInteger(qty) || qty <= 0) return toast.error("Quantity must be a whole number greater than 0.");
          onSubmit({ quantity: qty, reason });
        }}
      >
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Quantity to Remove</span>
          <input
            required
            min={1}
            step={1}
            type="number"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Reason</span>
          <select value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <option value="Expired">Expired</option>
            <option value="Discontinued">Discontinued</option>
            <option value="Damaged">Damaged</option>
            {isDoctorBag ? <option value="Wasted">Wasted</option> : null}
          </select>
        </label>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {isSaving ? "Removing..." : "Remove"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RestockModal({ open, doctors, item, presetDoctorId = null, presetDoctorName = "", isSaving, onClose, onSubmit }) {
  const [doctorId, setDoctorId] = useState("");
  const [doctorQuery, setDoctorQuery] = useState("");
  const [quantity, setQuantity] = useState("1");
  const doctorLocked = Boolean(presetDoctorId);

  useEffect(() => {
    if (open) {
      setDoctorId(presetDoctorId ? String(presetDoctorId) : "");
      setDoctorQuery(presetDoctorName || "");
      setQuantity("1");
    }
  }, [open, presetDoctorId, presetDoctorName]);

  const doctorOptions = useMemo(() => {
    const q = doctorQuery.trim().toLowerCase();
    const sorted = doctors
      .slice()
      .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
    if (!q) return sorted;
    return sorted.filter((d) => String(d.full_name || "").toLowerCase().includes(q));
  }, [doctors, doctorQuery]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Restock doctor${item ? ` - ${item.item_name}` : ""}`}
      description={
        doctorLocked
          ? `Transfer stock from OCS master into ${presetDoctorName || "this doctor"}'s medical bag.`
          : "Transfer stock atomically from OCS Stock to selected doctor."
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!doctorId) return toast.error("Select a doctor.");
          onSubmit({
            ocs_item_id: item?.id,
            doctor_id: Number(doctorId || 0),
            quantity: Number(quantity || 0),
          });
        }}
      >
        {doctorLocked ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Doctor</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{presetDoctorName || "Selected doctor"}</p>
          </div>
        ) : (
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Doctor (search)</span>
            <input
              required
              value={doctorQuery}
              onChange={(event) => setDoctorQuery(event.target.value)}
              placeholder="Search doctor by name..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
            />

            <div className="max-h-44 overflow-auto rounded-2xl border border-slate-200 bg-white">
              {doctorOptions.length ? (
                doctorOptions.map((doctor) => (
                  <button
                    key={doctor.id}
                    type="button"
                    onClick={() => setDoctorId(String(doctor.id))}
                    className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-50 ${
                      String(doctor.id) === String(doctorId) ? "bg-[rgba(79,184,179,0.12)]" : ""
                    }`}
                  >
                    {doctor.full_name}
                  </button>
                ))
              ) : (
                <div className="px-4 py-3 text-sm text-slate-500">No matches</div>
              )}
            </div>
          </label>
        )}

        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Quantity</span>
          <input required min="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
        </label>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="submit" disabled={isSaving} className="rounded-2xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {isSaving ? "Restocking..." : "Restock Doctor"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DoctorRestockModal({ open, item, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");

  useEffect(() => {
    if (!open) return;
    setQuantity("1");
  }, [open, item]);

  const available = Number(item?.ocs_available || 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Restock My Inventory"
      description="Transfer this item from Master Stock into your medical bag."
      size="lg"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const qty = Number(quantity || 0);
          if (!Number.isInteger(qty) || qty <= 0) return;
          onSubmit({
            ocs_item_id: Number(item?.ocs_item_id || 0),
            quantity: qty,
            item_name: item?.item_name || "",
            ocs_available: available,
          });
        }}
      >
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">{item?.item_name || "Selected item"}</p>
          <p className="mt-1 text-xs text-slate-600">OCS Master available: {available}</p>
          <label className="mt-4 block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Quantity to restock from Master Stock</span>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
            />
          </label>
          {Number(quantity || 0) > available ? (
            <p className="mt-2 text-xs font-semibold text-rose-700">
              Requested quantity exceeds OCS Master availability.
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={isSaving || !item?.ocs_item_id || Number(quantity || 0) > available} className="rounded-2xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {isSaving ? "Restocking..." : "Restock My Inventory"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const STOCK_OUT_REASONS = ["Wasted", "Expired", "Sale"];

function StockOutModal({ open, item, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("Wasted");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuantity("1");
    setReason("Wasted");
    setNote("");
  }, [open, item]);

  const available = Number(item?.quantity || 0);
  const isSale = reason === "Sale";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Stock Out"
      description={
        isSale
          ? "Record a direct sale from your medical bag. This is counted in the doctor sales report."
          : "Record wastage or expiry from your medical bag. For billed patient sales, use the Billing page."
      }
      size="lg"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const qty = Number(quantity || 0);
          if (!Number.isInteger(qty) || qty <= 0) return;
          onSubmit({ quantity: qty, reason, note: note.trim() });
        }}
      >
        {isSale ? (
          <div className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-xs text-teal-900">
            This sale is recorded in the <strong>doctor sales report</strong>. To link stock removal to a patient invoice, use the <strong>Billing</strong> page instead.
          </div>
        ) : (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">
            To bill a patient for an item, open the consultation on the <strong>Billing</strong> page — stock and revenue are recorded together there.
          </div>
        )}
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">{item?.item_name || "Selected item"}</p>
          <p className="mt-1 text-xs text-slate-600">Available in your stock: {available}</p>

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

          <label className="mt-4 block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Notes (optional)</span>
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
              placeholder={
                isSale ? "e.g. patient name, payment reference" : "e.g. batch reference, disposal details"
              }
            />
          </label>

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
              !Number.isInteger(Number(quantity || 0)) ||
              Number(quantity || 0) <= 0 ||
              Number(quantity || 0) > available
            }
            className="rounded-2xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
          >
            {isSaving ? "Recording..." : "Confirm Stock Out"}
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
  if (["adjustment", "override", "correction", "remove", "stock_out"].includes(at)) return "correction";
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
    "Total Restocked (Rs)": Number(row.total_restocked || 0),
    "Consumed: Sales (Rs)": Number(row.consumed_sales || 0),
    "Consumed: Wasted (Rs)": Number(row.consumed_wasted || 0),
    "Consumed: Expired (Rs)": Number(row.consumed_expired || 0),
    "Remaining in Bag (Rs)": Number(row.remaining_in_bag || 0),
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

function CompareRemainingCell({ value }) {
  const amount = Number(value || 0);
  if (amount < 0) {
    return (
      <span className="rounded bg-red-50 px-2 py-0.5 font-bold text-red-600">
        {formatRupees(amount)}
      </span>
    );
  }
  return <span className="text-slate-800">{formatRupees(amount)}</span>;
}

function MovementActivityLine({ movement }) {
  const meta = movement.meta || {};
  const staff = meta.performed_by_name || "System";
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

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 py-1.5 text-sm last:border-b-0">
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
        <h3 className="text-base font-bold text-gray-900">Live Activity</h3>
        {showStaffFilters ? (
          <div className="flex w-full min-w-0 flex-col gap-3">
            <InventoryPeriodFilter
              preset={periodPreset}
              anchorDate={periodAnchorDate}
              onPresetChange={onPeriodPresetChange}
              onAnchorDateChange={onPeriodAnchorDateChange}
              className="w-full max-w-none"
            />
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
                <span className="whitespace-nowrap">📥 Download History Excel</span>
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


const INVENTORY_MOBILE_MENU_ITEM =
  "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50";

function InventoryMobileActionTray({ quickAddTitle, quickAddDisabled, onQuickAdd, menuItems = [] }) {
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
    const rect = anchor.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 6,
      left: Math.max(8, rect.right - 200),
    });
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <div className="flex min-w-[70px] items-center justify-end gap-3">
      <button
        type="button"
        title={quickAddTitle}
        aria-label={quickAddTitle}
        disabled={quickAddDisabled}
        onClick={onQuickAdd}
        className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 text-teal-600 transition-colors hover:bg-teal-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          title="More actions"
          aria-label="More actions"
          aria-expanded={menuOpen}
          onClick={() => (menuOpen ? closeMenu() : openMenu())}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-400 transition-colors hover:text-gray-600 active:scale-95"
        >
          <MoreVertical className="h-5 w-5" strokeWidth={2.5} />
        </button>
        {menuOpen && menuPosition && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={menuPanelRef}
                className="fixed z-[100] min-w-[12.5rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                style={{ top: menuPosition.top, left: menuPosition.left }}
              >
                {menuItems.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={cx(
                      INVENTORY_MOBILE_MENU_ITEM,
                      entry.danger ? "text-rose-700 hover:bg-rose-50" : "",
                    )}
                    onClick={() => {
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
  touchWrap = false,
  omitRestock = false,
  showDeleteItem = false,
  onStockIn,
  onEdit,
  onRestockDoctor,
  onRemove,
  onDeleteItem,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const menuRef = useRef(null);
  const menuPanelRef = useRef(null);

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
    const rect = anchor.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 6,
      left: Math.max(8, rect.right - 200),
    });
    setMenuOpen(true);
  }

  const receiveBtn =
    "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-[#4FB8B3]/40 bg-[#4FB8B3]/10 text-[#1f7f7b] transition hover:bg-[#4FB8B3]/20";
  const editBtn =
    "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900";
  const moreBtn =
    "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900";

  if (touchWrap) {
    const menuItems = [
      {
        key: "edit",
        label: "Edit item",
        icon: <Pencil className="size-3.5" />,
        onClick: () => onEdit(item),
      },
      ...(!omitRestock
        ? [
            {
              key: "restock",
              label: "Restock / Transfer",
              icon: <Truck className="size-3.5" />,
              onClick: () => onRestockDoctor(item),
            },
          ]
        : []),
      {
        key: "remove",
        label: "Remove stock",
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onClick: () => onRemove(item),
      },
      ...(showDeleteItem && onDeleteItem
        ? [
            {
              key: "delete",
              label: "Delete item",
              icon: <Trash2 className="size-3.5" />,
              danger: true,
              onClick: () => onDeleteItem(item),
            },
          ]
        : []),
    ];

    return (
      <InventoryMobileActionTray
        quickAddTitle="Receive stock"
        onQuickAdd={() => onStockIn(item)}
        menuItems={menuItems}
      />
    );
  }

  return (
    <div className="ml-auto flex w-fit items-center justify-end gap-1.5">
      <button
        type="button"
        title="Receive stock"
        aria-label="Receive stock"
        className={receiveBtn}
        onClick={() => onStockIn(item)}
      >
        <Plus className="size-4 shrink-0" />
      </button>
      <button
        type="button"
        title="Edit item"
        aria-label="Edit item"
        className={editBtn}
        onClick={() => onEdit(item)}
      >
        <Pencil className="size-4 shrink-0" />
      </button>
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          title="More actions"
          aria-label="More actions"
          aria-expanded={menuOpen}
          className={moreBtn}
          onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
        >
          <MoreVertical className="size-4 shrink-0" />
        </button>
        {menuOpen && menuPosition && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={menuPanelRef}
                className="fixed z-[100] min-w-[12.5rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                style={{ top: menuPosition.top, left: menuPosition.left }}
              >
                <button
                  type="button"
                  className={INVENTORY_MOBILE_MENU_ITEM}
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit(item);
                  }}
                >
                  <Pencil className="size-3.5 shrink-0 text-slate-500" />
                  Edit item
                </button>
                {!omitRestock ? (
                  <button
                    type="button"
                    className={INVENTORY_MOBILE_MENU_ITEM}
                    onClick={() => {
                      setMenuOpen(false);
                      onRestockDoctor(item);
                    }}
                  >
                    <Truck className="size-3.5 shrink-0 text-slate-500" />
                    Restock / Transfer
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`${INVENTORY_MOBILE_MENU_ITEM} text-rose-700 hover:bg-rose-50`}
                  onClick={() => {
                    setMenuOpen(false);
                    onRemove(item);
                  }}
                >
                  <Trash2 className="size-3.5 shrink-0" />
                  Remove stock
                </button>
                {showDeleteItem && onDeleteItem ? (
                  <button
                    type="button"
                    className={`${INVENTORY_MOBILE_MENU_ITEM} text-rose-700 hover:bg-rose-50`}
                    onClick={() => {
                      setMenuOpen(false);
                      onDeleteItem(item);
                    }}
                  >
                    <Trash2 className="size-3.5 shrink-0" />
                    Delete item
                  </button>
                ) : null}
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
  onStockOut,
  onAdjustReclaim,
  onRemove,
  onDeleteItem,
  touchWrap = false,
  omitRestock = false,
}) {
  if (canManageOcs && contextIsOcs) {
    return (
      <InventoryOcsMasterActions
        item={item}
        touchWrap={touchWrap}
        omitRestock={omitRestock}
        showDeleteItem={showDeleteItem}
        onStockIn={onStockIn}
        onEdit={onEdit}
        onRestockDoctor={onRestockDoctor}
        onRemove={onRemove}
        onDeleteItem={onDeleteItem}
      />
    );
  }

  if (touchWrap) {
    const menuItems = [];

    if (!(isDoctor && doctorViewIsOcs)) {
      menuItems.push({
        key: "edit",
        label: "Edit item",
        icon: <Pencil className="size-3.5" />,
        onClick: () => onEdit(item),
      });
    }

    if (isDoctor && !omitRestock) {
      menuItems.push({
        key: "restock",
        label: "Restock",
        icon: <Truck className="size-3.5" />,
        onClick: () => onRestockMyInventory(item),
      });
    }

    if (isDoctor && doctorViewIsMy && onStockOut) {
      menuItems.push({
        key: "stock-out",
        label: "Stock Out",
        icon: <Minus className="size-3.5" />,
        onClick: () => onStockOut(item),
      });
    }

    if (canManageOcs && !contextIsOcs) {
      menuItems.push({
        key: "adjust",
        label: "Adjust",
        icon: <MinusCircle className="size-3.5" />,
        onClick: () => onAdjustReclaim(item),
      });
    }

    if (canManageOcs && !contextIsOcs && onRestockDoctor) {
      menuItems.push({
        key: "restock",
        label: "Restock from OCS",
        icon: <Truck className="size-3.5" />,
        onClick: () => onRestockDoctor(item),
      });
    }

    if (onRemove) {
      menuItems.push({
        key: "remove",
        label: "Remove stock",
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onClick: () => onRemove(item),
      });
    }

    if (showDeleteItem && onDeleteItem) {
      menuItems.push({
        key: "delete",
        label: "Delete item",
        icon: <Trash2 className="size-3.5" />,
        danger: true,
        onClick: () => onDeleteItem(item),
      });
    }

    return (
      <InventoryMobileActionTray
        quickAddTitle="Quick add stock"
        onQuickAdd={() => onStockIn(item)}
        menuItems={menuItems}
      />
    );
  }

  const btn =
    "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900";
  const restockBtn =
    "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#4FB8B3] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#3aa6a1]";
  const stockOutBtn =
    "inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl bg-orange-100 px-3 text-xs font-semibold text-orange-700 transition hover:bg-orange-200";
  const adjustBtn = "inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl px-3 text-xs font-semibold";

  return (
    <div className="ml-auto flex w-fit items-center justify-end gap-1.5">
      {!(isDoctor && doctorViewIsOcs) ? (
        <button type="button" onClick={() => onEdit(item)} className={btn}>
          <Pencil className="size-3.5 shrink-0" />
        </button>
      ) : null}

      {isDoctor && !omitRestock ? (
        <button type="button" onClick={() => onRestockMyInventory(item)} className={restockBtn}>
          <Truck className="size-3.5 shrink-0" />
          Restock
        </button>
      ) : null}

      {isDoctor && doctorViewIsMy && onStockOut ? (
        <button type="button" onClick={() => onStockOut(item)} className={stockOutBtn}>
          <Minus className="size-3.5 shrink-0" />
          Stock Out
        </button>
      ) : null}

      {canManageOcs && !contextIsOcs && onRestockDoctor ? (
        <button type="button" onClick={() => onRestockDoctor(item)} className={restockBtn}>
          <Truck className="size-3.5 shrink-0" />
          Restock
        </button>
      ) : null}

      {canManageOcs && !contextIsOcs ? (
        <button type="button" onClick={() => onAdjustReclaim(item)} className={`${adjustBtn} border border-amber-200 text-amber-700`}>
          <MinusCircle className="size-3.5 shrink-0" />
          Adjust
        </button>
      ) : null}

      {showDeleteItem && onDeleteItem ? (
        <button
          type="button"
          title="Delete item"
          aria-label="Delete item"
          onClick={() => onDeleteItem(item)}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
        >
          <Trash2 className="size-3.5 shrink-0" />
        </button>
      ) : null}
    </div>
  );
}

function RestockReceiptModal({ open, receipt, onClose, onPrint }) {
  if (!receipt) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Restock completed"
      description="Transfer saved successfully. You can print the stock transfer note now."
      size="lg"
    >
      <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-semibold text-slate-900">Transaction ID: {receipt.transaction_id}</p>
        <p className="text-xs text-slate-600">
          Issued by {receipt.issued_by_name || "OCS User"} - Received by {receipt.received_by_name || "Doctor"}
        </p>
      </div>
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
          Close
        </button>
        <button type="button" onClick={onPrint} className="inline-flex items-center gap-2 rounded-2xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white">
          <Printer className="size-4" />
          Print Restock Receipt
        </button>
      </div>
    </Modal>
  );
}

const MOBILE_STOCK_OUT_OPTIONS = [
  { id: "wastage", reason: "Wasted", emoji: "🗑️", label: "Damaged / Broken (Wasted)" },
  { id: "expired", reason: "Expired", emoji: "⏳", label: "Expired (Discarded)" },
];

function OperatorAddItemDrawer({ open, onClose, folders, activeFolderId, activeCategory, isSaving, onSubmit }) {
  const [form, setForm] = useState(() => operatorItemFormState(activeFolderId));

  useEffect(() => {
    if (!open) return undefined;

    setForm(operatorItemFormState(activeFolderId));

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, activeFolderId, onClose]);

  if (!open) return null;

  const fieldClass =
    "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-teal-500 focus:bg-white";

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <button
        type="button"
        aria-label="Close add item panel"
        className="absolute inset-0 bg-[rgba(34,72,91,0.35)] backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside
        className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-slate-200/80 bg-white shadow-[-12px_0_40px_rgba(15,23,42,0.12)]"
        style={{ paddingTop: "max(0px, var(--sat))" }}
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
              <span className="text-sm font-semibold text-slate-700">Expiry Date</span>
              <input
                type="date"
                name="expiry_date"
                value={form.expiry_date}
                onChange={(event) => setForm((prev) => ({ ...prev, expiry_date: event.target.value }))}
                className={fieldClass}
              />
            </label>
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
          <div className="flex shrink-0 gap-3 border-t border-slate-100 px-5 py-4">
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

  useEffect(() => {
    if (!open) return;
    setQuantity(1);
  }, [open, item?.id]);

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
  { id: "Damage", label: "Damage" },
  { id: "Expired", label: "Expired" },
];

function MobileDoctorRestockSheet({ open, item, ocsAvailable, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [expiryDate, setExpiryDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuantity("1");
    setExpiryDate("");
  }, [open, item?.id, item?.ocs_item_id]);

  if (!open || !item) return null;

  const max = Math.max(0, Number(ocsAvailable || 0));
  const qty = Number(quantity || 0);

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={`Restock Kit: ${item.item_name || "Item"}`}
      subtitle={`Depot available: ${max}`}
    >
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!Number.isInteger(qty) || qty <= 0) return;
          if (qty > max) {
            toast.error("Quantity exceeds OCS master stock.");
            return;
          }
          if (!expiryDate) {
            toast.error("Select a batch expiry date.");
            return;
          }
          onSubmit({ quantity: qty, expiry_date: expiryDate });
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Quantity to Pull</span>
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
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Batch Expiry Date</span>
          <input
            required
            type="date"
            value={expiryDate}
            onChange={(event) => setExpiryDate(event.target.value)}
            className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base outline-none focus:border-teal-500 focus:bg-white"
          />
        </label>
        <div className="grid gap-2 pt-1">
          <button
            type="submit"
            disabled={isSaving || max < 1 || qty < 1 || qty > max || !expiryDate}
            className="min-h-12 w-full rounded-2xl bg-teal-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {isSaving ? "Restocking..." : "Pull from Master Stock"}
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

function MobileDoctorDeductSheet({ open, item, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("Damage");

  useEffect(() => {
    if (!open) return;
    setQuantity("1");
    setReason("Damage");
  }, [open, item?.id]);

  if (!open || !item) return null;

  const max = Math.max(0, Number(item.quantity || 0));
  const qty = Number(quantity || 0);

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={`Log Item Removal: ${item.item_name || "Item"}`}
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
          onSubmit({ quantity: qty, reason });
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
          {reason === "Sale" ? (
            <p className="mt-1 block text-[10px] leading-tight text-gray-400">
              Selecting Sale logs this product usage for corporate inventory tracking. Remember to add this item
              manually inside the Billing tab when calculating the patient&apos;s final consultation charges.
            </p>
          ) : null}
        </div>
        <div className="grid gap-2 pt-1">
          <button
            type="submit"
            disabled={isSaving || max < 1 || qty < 1 || qty > max}
            className={cx(
              "min-h-12 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white disabled:opacity-50",
              reason === "Sale" ? "bg-teal-600" : "bg-rose-600",
            )}
          >
            {isSaving ? "Saving..." : reason === "Sale" ? "Record Sale for Admin Audit" : "Confirm Removal"}
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

function MobileTerracottaActionPill({
  onDeduct,
  onRestock,
  deductDisabled = false,
  restockDisabled = false,
  singlePlus = false,
  deductLabel = "Deduct from bag",
  restockLabel = "Restock from master",
}) {
  const btnClass =
    "flex h-8 w-10 items-center justify-center rounded-lg text-lg font-bold text-[#ba5a32] transition-all hover:bg-[#f5e3d7] active:scale-90 disabled:cursor-not-allowed disabled:opacity-40";

  if (singlePlus) {
    return (
      <div className="flex h-10 min-w-[92px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#f5e3d7] bg-[#fcf3ee] p-1 shadow-sm">
        <button
          type="button"
          disabled={restockDisabled}
          onClick={onRestock}
          className={btnClass}
          aria-label={restockLabel}
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-10 min-w-[92px] shrink-0 items-center justify-between overflow-hidden rounded-xl border border-[#f5e3d7] bg-[#fcf3ee] p-1 shadow-sm">
      <button
        type="button"
        disabled={deductDisabled}
        onClick={onDeduct}
        className={btnClass}
        aria-label={deductLabel}
      >
        −
      </button>
      <div className="h-5 w-px bg-[#f5e3d7]" aria-hidden />
      <button
        type="button"
        disabled={restockDisabled}
        onClick={onRestock}
        className={btnClass}
        aria-label={restockLabel}
      >
        +
      </button>
    </div>
  );
}

function MobileInventoryStockCard({ item, quantityLabel = "In Bag:", isLowStock, actions }) {
  const currentQuantity = Number(item.quantity || 0);
  const parLevel = Number(item.minimum_quantity || 0);
  const low = isLowStock ?? (parLevel > 0 && currentQuantity <= parLevel);
  const qtyTone = low ? "text-rose-600" : "text-emerald-700";

  return (
    <div className="flex min-h-[72px] items-center justify-between rounded-2xl border border-gray-100/50 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)] transition-all active:scale-[0.99]">
      <div className="flex max-w-[65%] min-w-0 items-center gap-3">
        <span
          className={cx(
            "inline-block h-2 w-2 shrink-0 rounded-full",
            low
              ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]"
              : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]",
          )}
          aria-hidden
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-bold tracking-wide text-gray-800">{item.item_name}</span>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400">
            <span>
              {quantityLabel}{" "}
              <span className={cx("font-bold", qtyTone)}>{currentQuantity}</span>
            </span>
            <span className="text-gray-200">•</span>
            <span>
              Min: <span className="font-bold text-gray-600">{parLevel}</span>
            </span>
          </div>
        </div>
      </div>
      {actions}
    </div>
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
  doctorRestockCandidates = [],
  onOpenRestockInventory,
  onOpenDeduct,
  onOpenRestock,
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.25rem)] w-full max-w-md flex-col gap-3 bg-[#f8f9fa] px-4 py-3">
      <header className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-gray-900">
          {doctorViewIsOcs ? "OCS Stock" : "My Stock"}
        </h1>
        {!doctorViewIsOcs ? (
          <button
            type="button"
            onClick={onOpenRestockInventory}
            disabled={!doctorRestockCandidates.length}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-[#4FB8B3] px-3.5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#3aa6a1] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Truck className="size-4" />
            Restock
          </button>
        ) : null}
      </header>

      <div className="flex gap-2">
        {DOCTOR_MOBILE_STOCK_SCOPES.map((scope) => (
          <button
            key={scope.id}
            type="button"
            onClick={() => onDoctorContextChange(scope.id)}
            className={cx(
              "min-h-11 flex-1 rounded-2xl px-3 py-2.5 text-sm font-bold transition",
              doctorContext === scope.id
                ? "bg-[#4FB8B3] text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-700",
            )}
          >
            {scope.label}
          </button>
        ))}
      </div>

      <label className="relative block w-full">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by item name"
          className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition placeholder:text-sm placeholder:text-gray-400 focus:border-[#4FB8B3] focus:bg-white"
        />
      </label>

      {folders.length ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => onSelectedViewChange(String(folder.id))}
              className={cx(
                "shrink-0 rounded-2xl px-3.5 py-2 text-xs font-bold transition",
                selectedView === String(folder.id)
                  ? "bg-[#4FB8B3] text-white shadow-sm"
                  : "border border-slate-200 bg-white text-slate-700",
              )}
            >
              {folder.name}
            </button>
          ))}
        </div>
      ) : null}

      {doctorViewIsOcs ? (
        <p className="text-xs font-medium leading-relaxed text-gray-500">
          Tap + to pull stock from the depot into your medical bag (set quantity and expiry).
        </p>
      ) : (
        <p className="text-xs font-medium leading-relaxed text-gray-500">
          Tap − to log removal (sale, damage, or expired). Tap + to restock from OCS master.
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col pb-8">
        {mobileBagPagedItems.length ? (
          <>
            <div className="mt-2 flex w-full flex-col gap-3.5">
              {mobileBagPagedItems.map((item) => {
                const currentQuantity = Number(item.quantity || 0);

                return (
                  <MobileInventoryStockCard
                    key={`mobile-bag-${item.id}`}
                    item={item}
                    quantityLabel={doctorViewIsOcs ? "Available:" : "In Bag:"}
                    actions={
                      doctorViewIsOcs ? (
                        <MobileTerracottaActionPill
                          singlePlus
                          restockDisabled={!onOpenRestock}
                          onRestock={() => onOpenRestock?.(item)}
                          restockLabel="Add to bag from depot"
                        />
                      ) : (
                        <MobileTerracottaActionPill
                          deductDisabled={!onOpenDeduct || currentQuantity < 1}
                          restockDisabled={!onOpenRestock}
                          onDeduct={() => onOpenDeduct?.(item)}
                          onRestock={() => onOpenRestock?.(item)}
                        />
                      )
                    }
                  />
                );
              })}
            </div>

            {mobileBagTotalPages > 1 ? (
              <div className="flex items-center justify-between gap-3 pt-3">
                <p className="text-sm text-slate-500">
                  Page {currentPage} of {mobileBagTotalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={currentPage >= mobileBagTotalPages}
                    onClick={() => setCurrentPage((prev) => Math.min(mobileBagTotalPages, prev + 1))}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-50"
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
                : "Search or restock from OCS Master Stock to fill your medical bag."
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
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedView, setSelectedView] = useState("");
  const [activeCategory, setActiveCategory] = useState("Consumable");
  const [operatorAddOpen, setOperatorAddOpen] = useState(false);
  const [selectedContextDoctorId, setSelectedContextDoctorId] = useState("");
  const [doctorContext, setDoctorContext] = useState("my");
  const [contextSearch, setContextSearch] = useState("OCS Stock");
  const [contextOpen, setContextOpen] = useState(false);
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
  const [mobileRestockTarget, setMobileRestockTarget] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [showNearExpiryOnly, setShowNearExpiryOnly] = useState(false);
  const [sortMode, setSortMode] = useState("expiry_asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState({});
  const [batchMap, setBatchMap] = useState({});
  const [consumptionPeriod, setConsumptionPeriod] = useState("month");
  const [activityStaffUserId, setActivityStaffUserId] = useState("");
  const [adminPeriodPreset, setAdminPeriodPreset] = useState("monthly");
  const [adminPeriodAnchor, setAdminPeriodAnchor] = useState(() => inventoryTodayInputValue());
  const isDoctor = user.role === "doctor";
  const commitInventoryData = useCallback(
    (next) => {
      setData(next);
      if (isDoctor) {
        notifyDoctorBagInventoryUpdated();
      }
    },
    [isDoctor],
  );
  const isOperator = user.role === "operator";
  const canManageOcs = user.role === "admin" || isOperator;
  const isAdmin = user.role === "admin";
  const folders = data?.folders || [];
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
  const doctors = data?.doctors || [];
  const doctorOptions = useMemo(
    () => [...doctors].sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""))),
    [doctors],
  );
  const contextIsOcs = !selectedContextDoctorId;
  const doctorViewIsOcs = isDoctor && doctorContext === "ocs";
  const doctorViewIsMy = isDoctor && doctorContext === "my";
  const isMobile = useIsMobile();
  const showDeleteStockItem = (canManageOcs && contextIsOcs) || (isAdmin && !contextIsOcs && !isMobile);
  const showMobileDoctorBag = isDoctor && isMobile;
  const adminPeriodRange = useMemo(
    () => getInventoryDateRange(adminPeriodPreset, adminPeriodAnchor),
    [adminPeriodPreset, adminPeriodAnchor],
  );
  const items = isDoctor
    ? doctorViewIsOcs
      ? data?.ocs_stock || []
      : data?.my_stock || []
    : selectedContextDoctorId
      ? data?.selected_doctor_stock || []
      : data?.ocs_stock || [];
  /** Always show all seven category pills; empty categories display an empty list. */
  const categoryFolders = folders;
  const inventoryListQuery = useMemo(
    () =>
      buildInventoryListQuery({
        contextDoctorId: selectedContextDoctorId,
        doctorContext,
        includeDoctorContext: isDoctor,
        includeAdminFilters: isAdmin,
        adminPeriodRange,
        activityStaffUserId,
      }),
    [
      selectedContextDoctorId,
      doctorContext,
      isDoctor,
      isAdmin,
      adminPeriodRange,
      activityStaffUserId,
    ],
  );
  const summary = data?.summary || {};
  const pageSize = 50;
  const inventoryTableScrollClass = isOperator
    ? "max-h-[min(calc(100svh-16rem),960px)]"
    : "max-h-[560px]";
  const doctorDesktopBagTable = isDoctor && doctorViewIsMy;
  const staffDoctorBagTable = canManageOcs && !contextIsOcs;
  const inventoryActionsColWidth = doctorDesktopBagTable || staffDoctorBagTable ? "30%" : "18%";
  const inventoryTableMinWidth = doctorDesktopBagTable ? "56rem" : "48rem";
  const doctorConsumptionRows = data?.my_consumption_rows || [];
  const movements = data?.movements || [];

  const doctorRestockCandidates = useMemo(() => {
    if (!isDoctor || !Array.isArray(data?.my_stock) || !Array.isArray(data?.ocs_stock)) return [];
    const ocsMap = new Map(
      (data.ocs_stock || []).map((item) => [`${item.folder_id}::${String(item.item_name || "").toLowerCase()}`, item]),
    );
    return (data.my_stock || [])
      .map((myItem) => {
        const parLevel = Number(myItem.minimum_quantity || 0);
        const currentQuantity = Number(myItem.quantity || 0);
        const ratio = parLevel > 0 ? currentQuantity / parLevel : 1;
        if (parLevel <= 0 || ratio >= 0.5) return null;
        const needed = Math.max(parLevel - currentQuantity, 0);
        const source = ocsMap.get(`${myItem.folder_id}::${String(myItem.item_name || "").toLowerCase()}`);
        const ocsAvailable = Number(source?.quantity || 0);
        const transferQty = Math.min(needed, ocsAvailable);
        if (!source?.id || transferQty <= 0) return null;
        return {
          ocs_item_id: Number(source.id),
          item_name: myItem.item_name,
          current_quantity: currentQuantity,
          par_level: parLevel,
          required_quantity: transferQty,
          ocs_available: ocsAvailable,
        };
      })
      .filter(Boolean);
  }, [isDoctor, data]);
  const ocsByFolderAndName = useMemo(() => {
    const map = new Map();
    (data?.ocs_stock || []).forEach((item) => {
      map.set(`${item.folder_id}::${String(item.item_name || "").toLowerCase()}`, item);
    });
    return map;
  }, [data]);

  const selectedConsumption = useMemo(
    () => doctorConsumptionRows.find((row) => row.period_key === consumptionPeriod) || null,
    [doctorConsumptionRows, consumptionPeriod],
  );
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

  async function load(
    contextDoctorId = selectedContextDoctorId,
    nextDoctorContext = doctorContext,
    { silent = false } = {},
  ) {
    if (!silent) setLoading(true);
    try {
      const payload = await api.get(
        `/inventory${buildInventoryListQuery({
          contextDoctorId,
          doctorContext: nextDoctorContext,
          includeDoctorContext: isDoctor,
          includeAdminFilters: isAdmin,
          adminPeriodRange,
          activityStaffUserId,
        })}`,
      );
      commitInventoryData(payload);
    } catch (error) {
      toast.error(error.message);
      if (!silent) setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  const liveActivityStaffFilterProps = isAdmin
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
        compareRows: data?.compare_rows || [],
      }
    : {};

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContextDoctorId, doctorContext]);

  useEffect(() => {
    if (!isAdmin) return;
    load(selectedContextDoctorId, doctorContext, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPeriodPreset, adminPeriodAnchor, activityStaffUserId]);

  // Default category: first folder with stock, else Consumable (pills may list all categories on OCS view).
  useEffect(() => {
    if (!folders.length) return;
    const valid = folders.some((f) => String(f.id) === String(selectedView));
    if (!selectedView || !valid) {
      const next = getDefaultFolderSelection(folders, items);
      if (!next) return;
      setSelectedView(String(next.id));
      if (next.name) setActiveCategory(next.name);
    }
  }, [folders, items, selectedView]);

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
      setDoctorRestockOpen(true);
    } else {
      toast("Stock levels look healthy — no restock needed right now.");
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("restock");
    setSearchParams(nextParams, { replace: true });
  }, [isDoctor, data, doctorRestockCandidates, searchParams, setSearchParams]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const source = selectedView ? items.filter((item) => String(item.folder_id) === String(selectedView)) : items;
    return source
      .filter((item) => !needle || item.item_name.toLowerCase().includes(needle))
      .filter((item) => !showLowStockOnly || Number(item.quantity || 0) <= Number(item.minimum_quantity || 0))
      .filter((item) => !showNearExpiryOnly || Boolean(item.is_near_expiry));
  }, [items, search, selectedView, showLowStockOnly, showNearExpiryOnly]);

  const sortedItems = useMemo(() => {
    const rows = [...filteredItems];
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
    const sourceStock = doctorViewIsOcs ? data?.ocs_stock || [] : data?.my_stock || [];
    let rows = selectedView
      ? sourceStock.filter((item) => String(item.folder_id) === String(selectedView))
      : sourceStock;
    rows = rows.filter(
      (item) => !needle || String(item.item_name || "").toLowerCase().includes(needle),
    );
    const expiryRank = (date) => (date ? new Date(date).getTime() : Number.MAX_SAFE_INTEGER);
    return [...rows].sort((a, b) => expiryRank(a.expiry_date) - expiryRank(b.expiry_date));
  }, [showMobileDoctorBag, doctorViewIsOcs, data?.my_stock, data?.ocs_stock, search, selectedView]);

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
  }, [search, selectedView, showLowStockOnly, showNearExpiryOnly, sortMode, doctorContext]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (showMobileDoctorBag && currentPage > mobileBagTotalPages) {
      setCurrentPage(mobileBagTotalPages);
    }
  }, [showMobileDoctorBag, currentPage, mobileBagTotalPages]);

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
      toast.error("Item not available in OCS Master Stock.");
      return;
    }
    setDoctorRestockItem({
      ocs_item_id: Number(source.id),
      item_name: nextItem.item_name,
      ocs_available: Number(source.quantity || 0),
    });
    setDoctorRestockOpen(true);
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

  function downloadAdminStockExcel() {
    if (!isAdmin) return;
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
      "Min qty": Number(item.minimum_quantity ?? 0),
      Unit: item.unit ?? "",
      "Nearest expiry": item.expiry_date || "Not set",
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

  if (loading) return <LoadingState label="Loading inventory workspace" />;
  if (!data) return <EmptyState title="Inventory unavailable" description="Unable to load stock data right now." />;

  async function saveItem(payload) {
    if (!Number.isInteger(payload.quantity) || payload.quantity < 0) {
      toast.error("Quantity must be zero or more.");
      return;
    }
    if (!Number.isInteger(payload.minimum_quantity) || payload.minimum_quantity < 0) {
      toast.error("Minimum quantity must be zero or more.");
      return;
    }
    if (Number(payload.selling_price || 0) < Number(payload.cost_price || 0)) {
      toast.error("Selling price cannot be lower than cost price.");
      return;
    }

    setIsSaving(true);
    try {
      const next = editor?.item
        ? await api.put(`/inventory/items/${editor.item.id}${inventoryListQuery}`, payload)
        : await api.post(`/inventory/items${inventoryListQuery}`, payload);
      commitInventoryData(next);
      setEditor(null);
      setOperatorAddOpen(false);
      if (!editor?.item && payload.folder_id) {
        setSelectedView(String(payload.folder_id));
        const folder = (next?.folders || folders).find((f) => String(f.id) === String(payload.folder_id));
        if (folder?.name) setActiveCategory(folder.name);
      }
      toast.success(editor?.item ? "Stock item updated." : "Stock item added.");
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
      const next = await api.post(`/inventory/restock${inventoryListQuery}`, payload);
      commitInventoryData(next);
      setRestock(null);
      toast.success("Doctor restock completed.");
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

    setIsSaving(true);
    try {
      const next = await api.post(`/inventory/restock/my-inventory${inventoryListQuery}`, {
        items: requests.map((item) => ({
          ocs_item_id: Number(item.ocs_item_id),
          quantity: Number(item.required_quantity || item.quantity),
        })),
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

  function buildReceiptPrintHtml(receipt) {
    const rows = (receipt.items || [])
      .map(
        (line) => `
          <tr>
            <td>${line.item_name || ""}</td>
            <td>${line.batch_number || "N/A"} / ${line.expiry || "N/A"}</td>
            <td>${line.quantity || 0}</td>
            <td>${line.unit || "unit"}</td>
          </tr>
        `,
      )
      .join("");
    return `
      <html>
        <head>
          <title>Stock Transfer Note - ${receipt.transaction_id}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #111; padding: 20px; }
            .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; }
            .logo { font-weight:700; font-size:18px; }
            .meta { font-size:12px; margin: 12px 0; }
            table { width:100%; border-collapse:collapse; margin-top:12px; font-size:12px; }
            th, td { border:1px solid #111; padding:8px; text-align:left; }
            .footer { margin-top:24px; font-size:12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="logo">OCS Medecins</div>
              <div>Stock Transfer Note</div>
            </div>
            <div><strong>Transaction ID:</strong> ${receipt.transaction_id}</div>
          </div>
          <div class="meta">
            <div><strong>Date & Time:</strong> ${receipt.date_time || ""}</div>
            <div><strong>Issued By:</strong> ${receipt.issued_by_name || ""}</div>
            <div><strong>Received By:</strong> ${receipt.received_by_name || ""}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Batch Number / Expiry</th>
                <th>Quantity Transferred</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
          <div class="footer">
            <div>Digital Signature: ____________________</div>
            <div>Generated at: ${new Date().toLocaleString()}</div>
          </div>
        </body>
      </html>
    `;
  }

  function printReceipt(receipt) {
    if (!receipt) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      toast.error("Unable to open print preview.");
      return;
    }
    printWindow.document.write(buildReceiptPrintHtml(receipt));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    toast.success("Receipt generated successfully.");
  }

  async function reprintByTransactionId(transactionId) {
    if (!transactionId) return;
    try {
      const receipt = await api.get(`/inventory/receipts/${encodeURIComponent(transactionId)}`);
      printReceipt(receipt);
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function saveAddStock(payload) {
    if (!addStock?.item) return;
    const quantity = Number(payload?.quantity || 0);
    if (!Number.isInteger(quantity) || quantity <= 0) return;

    setIsSaving(true);
    try {
      const next = await api.post(`/inventory/items/${addStock.item.id}/ocs-actions${inventoryListQuery}`, {
        action_type: "stock_in",
        quantity,
        expiry_date: payload.expiry_date || "",
        cost_price: Number(payload.cost_price || 0),
      });
      commitInventoryData(next);
      setAddStock(null);
      toast.success("Stock In recorded.");
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
      await api.post(`${endpoint}${inventoryListQuery}`, {
        action_type: "remove",
        quantity,
        reason: payload.reason,
      });
      setRemoveStock(null);
      await load(selectedContextDoctorId, doctorContext, { silent: true });
      toast.success(isDoctorBag ? "Doctor bag stock adjusted." : "Stock removed.");
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

    setIsSaving(true);
    try {
      const next = await api.post(`/inventory/items/${stockOut.item.id}/actions${inventoryListQuery}`, {
        action_type: "stock_out",
        quantity,
        reason: payload.reason,
        note: payload.note || "",
      });
      commitInventoryData(next);
      setStockOut(null);
      toast.success(
        payload.reason === "Sale"
          ? "Sale recorded in your sales report."
          : payload.reason === "Expired"
            ? "Expired stock logged."
            : "Stock out recorded.",
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  function resolveOcsSourceForBagItem(bagItem) {
    if (!bagItem) return null;
    if (bagItem.stock_scope === "ocs" || doctorViewIsOcs) {
      return {
        ocs_item_id: Number(bagItem.id),
        item_name: bagItem.item_name,
        ocs_available: Number(bagItem.quantity || 0),
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
    };
  }

  function openMobileDoctorRestock(item) {
    const resolved = resolveOcsSourceForBagItem(item);
    if (!resolved?.ocs_item_id) {
      toast.error("Item not available in OCS Master Stock.");
      return;
    }
    setMobileRestockTarget(resolved);
  }

  async function saveMobileDoctorRestock({ quantity, expiry_date }) {
    const target = mobileRestockTarget;
    if (!target?.ocs_item_id) return;
    const qty = Number(quantity || 0);
    if (!Number.isInteger(qty) || qty <= 0) return;
    if (qty > Number(target.ocs_available || 0)) {
      toast.error(`Requested quantity exceeds OCS stock for ${target.item_name || "this item"}.`);
      return;
    }

    setIsSaving(true);
    try {
      const next = await api.post(`/inventory/restock/my-inventory${inventoryListQuery}`, {
        items: [
          {
            ocs_item_id: Number(target.ocs_item_id),
            quantity: qty,
            expiry_date,
          },
        ],
      });
      commitInventoryData(next);
      setMobileRestockTarget(null);
      toast.success("Restocked from OCS master into your bag.");
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

  async function saveMobileDoctorDeduct({ quantity, reason }) {
    const item = mobileDeductItem;
    if (!item?.id) return;
    const qty = Number(quantity || 0);
    if (!Number.isInteger(qty) || qty <= 0) return;
    const available = Number(item.quantity || 0);
    if (qty > available) {
      toast.error("Quantity exceeds available stock.");
      return;
    }

    const stockOutReason =
      reason === "Sale" ? "Sale" : reason === "Expired" ? "Expired" : "Wasted";
    const note =
      reason === "Sale"
        ? "Pending Manual Entry"
        : reason === "Damage"
          ? "Damage"
          : "";

    setIsSaving(true);
    try {
      const next = await api.post(`/inventory/items/${item.id}/actions${inventoryListQuery}`, {
        action_type: "stock_out",
        quantity: qty,
        reason: stockOutReason,
        note,
      });
      commitInventoryData(next);
      setMobileDeductItem(null);
      if (reason === "Sale") {
        toast.success("Sale transaction recorded successfully for Admin audit.");
      } else if (reason === "Expired") {
        toast.success("Expired stock logged to operational loss.");
      } else {
        toast.success("Damaged stock logged to operational loss.");
      }
    } catch (error) {
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
      toast.success("Stock item deleted.");
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
            onDoctorContextChange={setDoctorContext}
            folders={categoryFolders}
            selectedView={selectedView}
            onSelectedViewChange={setSelectedView}
            doctorViewIsOcs={doctorViewIsOcs}
            mobileBagPagedItems={mobileBagPagedItems}
            mobileBagTotalPages={mobileBagTotalPages}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            doctorRestockCandidates={doctorRestockCandidates}
            onOpenRestockInventory={() => setDoctorRestockOpen(true)}
            onOpenDeduct={(item) => setMobileDeductItem(item)}
            onOpenRestock={openMobileDoctorRestock}
          />
          <MobileDoctorDeductSheet
            open={Boolean(mobileDeductItem)}
            item={mobileDeductItem}
            isSaving={isSaving}
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
        title={isDoctor ? (doctorViewIsOcs ? "OCS Master Stock" : "My Stock") : "OCS Stock"}
        actions={
          isDoctor ? (
            <button
              type="button"
              onClick={() => setDoctorRestockOpen(true)}
              disabled={!doctorRestockCandidates.length}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#4FB8B3] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#3aa6a1] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Truck className="size-4" />
              Restock My Inventory
            </button>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {isAdmin ? (
                <>
                  <button
                    type="button"
                    onClick={downloadAdminStockExcel}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:border-[#4FB8B3]/50 hover:bg-slate-50"
                  >
                    <Download className="size-4 text-[#1f7f7b]" />
                    Download Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditor({ item: null })}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#4FB8B3] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#3aa6a1]"
                  >
                    <Plus className="size-4" />
                    Add Item
                  </button>
                </>
              ) : null}
            </div>
          )
        }
      />

      {isOperator ? (
        <OperatorInventoryLogisticsGrid
          lowStockCount={Number(summary.low_stock_count || 0)}
          nearExpiryCount={Number(summary.near_expiry_count || 0)}
          showLowStockOnly={showLowStockOnly}
          showNearExpiryOnly={showNearExpiryOnly}
          onToggleLowStock={() => {
            setShowLowStockOnly((prev) => !prev);
            setShowNearExpiryOnly(false);
          }}
          onToggleNearExpiry={() => {
            setShowNearExpiryOnly((prev) => !prev);
            setShowLowStockOnly(false);
          }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          <SummaryCard title="Total Stock Value" value={formatRupees(summary.total_amount_rs || 0)} />
          <SummaryCard title="Monthly Sales" value={formatRupees(summary.total_monthly_sales_rs || 0)} />
          <SummaryCard title="Monthly Replenishments" value={formatRupees(summary.total_monthly_replenishments_rs || 0)} />
          <SummaryCard
            title="Low / Near Expiry"
            value={`${summary.low_stock_count || 0} / ${summary.near_expiry_count || 0}`}
            tone="amber"
          />
        </div>
      )}

      <SectionCard
        className={isOperator ? "pb-3" : undefined}
        title={
          isDoctor
            ? "My Stock Items"
            : contextIsOcs
              ? "OCS Stock Items"
              : `${contextSearch || "Doctor"} - My Stock`
        }
      >
        <div className="mb-4 space-y-3 border-b border-slate-100 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {isDoctor ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDoctorContext("my")}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${doctorViewIsMy ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                >
                  My Stock (Default)
                </button>
                <button
                  type="button"
                  onClick={() => setDoctorContext("ocs")}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold ${doctorViewIsOcs ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
                >
                  OCS Master Stock (Read-only)
                </button>
              </div>
            ) : (
              <select
                aria-label="Stock context"
                value={selectedContextDoctorId}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedContextDoctorId(value);
                  const option = filteredContextOptions.find((row) => String(row.id) === String(value));
                  setContextSearch(option?.label || "OCS Stock");
                }}
                className="w-full shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 sm:w-56"
              >
                <option value="">OCS Stock</option>
                {doctorOptions.map((doctor) => (
                  <option key={`ctx-doctor-${doctor.id}`} value={String(doctor.id)}>
                    {doctor.full_name}
                  </option>
                ))}
              </select>
            )}
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by item name"
                className="w-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#4FB8B3]"
              />
            </label>
            {isOperator && contextIsOcs ? (
              <button
                type="button"
                onClick={() => setOperatorAddOpen(true)}
                className="bg-teal-600 text-white text-xs font-semibold px-4 py-2.5 rounded-xl hover:bg-teal-700 transition-colors shadow-sm flex items-center gap-1.5 ml-auto shrink-0"
              >
                <Plus className="size-3.5" />
                Add New Item
              </button>
            ) : null}
          </div>
          <div className="-mx-1 flex flex-wrap items-center gap-2">
            {categoryFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => {
                  setSelectedView(String(folder.id));
                  setActiveCategory(folder.name);
                }}
                className={`shrink-0 rounded-2xl px-3 py-1.5 text-xs font-semibold sm:text-sm ${selectedView === String(folder.id) ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
              >
                {folder.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowLowStockOnly((prev) => !prev)}
            className={`rounded-2xl px-3 py-1.5 text-xs font-semibold ${showLowStockOnly ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
          >
            Show Low Stock
          </button>
          <button
            type="button"
            onClick={() => setShowNearExpiryOnly((prev) => !prev)}
            className={`rounded-2xl px-3 py-1.5 text-xs font-semibold ${showNearExpiryOnly ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}
          >
            Show Near Expiry
          </button>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            <option value="expiry_asc">Sort: Expiry (Soonest)</option>
            <option value="qty_asc">Sort: Qty (Lowest)</option>
            <option value="qty_desc">Sort: Qty (Highest)</option>
          </select>
        </div>

        {pagedItems.length ? (
          <>
            <div className="hidden rounded-3xl border border-slate-200/80 bg-white md:block">
              <div className={cx("overflow-x-auto overflow-y-auto", inventoryTableScrollClass)}>
                <table className="w-full table-fixed text-left text-sm" style={{ minWidth: inventoryTableMinWidth }}>
                  <colgroup>
                    <col style={{ width: doctorDesktopBagTable ? "28%" : "34%" }} />
                    <col style={{ width: doctorDesktopBagTable ? "11%" : "10%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: doctorDesktopBagTable ? "21%" : "26%" }} />
                    <col style={{ width: inventoryActionsColWidth }} />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left align-middle">Item Name</th>
                      <th className="px-3 py-2 text-center align-middle">Qty</th>
                      <th className="px-3 py-2 text-center align-middle">Min Qty</th>
                      <th className="px-3 py-2 text-center align-middle">Nearest Expiry</th>
                      <th className="px-3 py-2 text-right align-middle">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedItems.map((item) => {
                      const isLow = Number(item.quantity || 0) <= Number(item.minimum_quantity || 0);
                      const expanded = Boolean(expandedRows[item.id]);
                      const batches = batchMap[item.id] || [];
                      const parLevel = Number(item.minimum_quantity || 0);
                      const quantity = Number(item.quantity || 0);
                      const ratio = parLevel > 0 ? quantity / parLevel : 1;
                      const trafficTone = quantity <= 0 ? "critical" : parLevel > 0 && ratio < 0.5 ? "warning" : "healthy";
                      return (
                        <Fragment key={item.id}>
                          <tr
                            className={`group border-t border-slate-200/70 align-middle transition-colors hover:bg-slate-50/70 ${isLow ? "bg-red-50" : ""}`}
                            onClick={() => toggleExpanded(item.id)}
                          >
                            <td className="px-3 py-1.5 align-middle text-left">
                              <div className="flex items-center gap-2">
                                <button type="button" className="rounded-md border border-slate-200 p-1 text-slate-500">
                                  {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                </button>
                                <span className="font-semibold text-slate-900">{item.item_name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-1.5 align-middle text-center">
                              {doctorDesktopBagTable ? (
                                <div className="flex flex-col items-center gap-1">
                                  <span className="font-medium tabular-nums text-slate-900">{item.quantity}</span>
                                  <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                                      trafficTone === "critical"
                                        ? "bg-rose-100 text-rose-700"
                                        : trafficTone === "warning"
                                          ? "bg-amber-100 text-amber-700"
                                          : "bg-teal-100 text-teal-700"
                                    }`}
                                  >
                                    {trafficTone === "critical" ? "Critical" : trafficTone === "warning" ? "Below 50%" : "Healthy"}
                                  </span>
                                </div>
                              ) : (
                                <div className="inline-flex items-center justify-center gap-2">
                                  <span>{item.quantity}</span>
                                  {isDoctor && doctorViewIsMy ? (
                                    <span
                                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                                        trafficTone === "critical"
                                          ? "bg-rose-100 text-rose-700"
                                          : trafficTone === "warning"
                                            ? "bg-amber-100 text-amber-700"
                                            : "bg-teal-100 text-teal-700"
                                      }`}
                                    >
                                      {trafficTone === "critical" ? "Critical" : trafficTone === "warning" ? "Below 50%" : "Healthy"}
                                    </span>
                                  ) : null}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-1.5 align-middle text-center">{item.minimum_quantity}</td>
                            <td className="px-3 py-1.5 align-middle text-center">{item.expiry_date || "Not set"}</td>
                            <td
                              className="px-3 py-2 align-middle"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="flex justify-end">
                              <InventoryActionButtons
                                item={item}
                                canManageOcs={canManageOcs}
                                contextIsOcs={contextIsOcs}
                                isDoctor={isDoctor}
                                doctorViewIsMy={doctorViewIsMy}
                                doctorViewIsOcs={doctorViewIsOcs}
                                onStockIn={(nextItem) => setAddStock({ item: nextItem })}
                                onEdit={openItemEditor}
                                onRestockDoctor={canManageOcs ? handleRestockDoctor : undefined}
                                onRestockMyInventory={openDoctorRestockForItem}
                                onStockOut={(nextItem) => setStockOut({ item: nextItem })}
                                onAdjustReclaim={(nextItem) => setRemoveStock({ item: nextItem })}
                                onRemove={(nextItem) => setRemoveStock({ item: nextItem })}
                                showDeleteItem={showDeleteStockItem}
                                onDeleteItem={(nextItem) => setItemToDelete(nextItem)}
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
                                          Batch #{batch.id} - Qty {batch.quantity_remaining} - Exp {batch.expiry_date || "N/A"} - Cost {formatRupees(batch.unit_cost)}
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

            <div className="mt-2 flex w-full flex-col gap-3.5 bg-[#f8f9fa] px-1 py-3 md:hidden">
              {pagedItems.map((item) => (
                <MobileInventoryStockCard
                  key={`m-${item.id}`}
                  item={item}
                  quantityLabel={contextIsOcs ? "Available:" : "In Bag:"}
                  actions={
                    <InventoryActionButtons
                      item={item}
                      canManageOcs={canManageOcs}
                      contextIsOcs={contextIsOcs}
                      isDoctor={isDoctor}
                      doctorViewIsMy={doctorViewIsMy}
                      doctorViewIsOcs={doctorViewIsOcs}
                      onStockIn={(nextItem) => setAddStock({ item: nextItem })}
                      onEdit={openItemEditor}
                      onRestockDoctor={canManageOcs ? handleRestockDoctor : undefined}
                      onRestockMyInventory={openDoctorRestockForItem}
                      onStockOut={(nextItem) => setStockOut({ item: nextItem })}
                      onAdjustReclaim={(nextItem) => setRemoveStock({ item: nextItem })}
                      onRemove={(nextItem) => setRemoveStock({ item: nextItem })}
                      showDeleteItem={showDeleteStockItem}
                      onDeleteItem={(nextItem) => setItemToDelete(nextItem)}
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
                  ? "Open OCS Master Stock to add items to your bag, or pick another category."
                  : "Try another category, search term, or restock from OCS Master Stock."
            }
          />
        )}

        <div className={cx("flex items-center justify-between", isOperator ? "mt-2" : "mt-3")}>
          <p className="text-xs text-slate-500">
            Page {currentPage} of {totalPages} - {sortedItems.length} filtered item(s)
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
              Previous
            </button>
            <button type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
              Next
            </button>
          </div>
        </div>
      </SectionCard>

      {isDoctor ? (
        <div className="hidden md:grid md:grid-cols-1 md:gap-6 lg:grid-cols-2">
          <SectionCard title="My Consumption Record">
          <div className="mb-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setConsumptionPeriod("week")} className={`rounded-2xl px-3 py-1.5 text-xs font-semibold ${consumptionPeriod === "week" ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}>This Week</button>
            <button type="button" onClick={() => setConsumptionPeriod("month")} className={`rounded-2xl px-3 py-1.5 text-xs font-semibold ${consumptionPeriod === "month" ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}>This Month</button>
            <button type="button" onClick={() => setConsumptionPeriod("ytd")} className={`rounded-2xl px-3 py-1.5 text-xs font-semibold ${consumptionPeriod === "ytd" ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}>Year to Date</button>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs sm:tracking-[0.2em]">
                <tr>
                  <th className="px-3 py-2 text-left">Period</th>
                  <th className="px-3 py-2 text-left">Patient Volume</th>
                  <th className="px-3 py-2 text-left">Stock Consumption (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {selectedConsumption ? (
                  <tr className="border-t border-slate-200/70 text-xs">
                    <td className="px-3 py-2">{selectedConsumption.period}</td>
                    <td className="px-3 py-2">{selectedConsumption.patient_volume}</td>
                    <td className="px-3 py-2">{formatRupees(selectedConsumption.stock_consumption_rs)}</td>
                  </tr>
                ) : (
                  <tr className="border-t border-slate-200/70 text-xs">
                    <td className="px-3 py-2 text-slate-500" colSpan={3}>No consumption record available yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
        <LiveActivitySection movements={parsedMovements} />
        </div>
      ) : isAdmin ? (
        <div className="hidden md:grid md:grid-cols-1 md:gap-6 lg:grid-cols-2">
          <SectionCard
            title="Admin Compare Tool"
            subtitle={formatInventoryPeriodLabel(adminPeriodPreset, adminPeriodRange.from, adminPeriodRange.to)}
            actions={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <InventoryPeriodFilter
                  preset={adminPeriodPreset}
                  anchorDate={adminPeriodAnchor}
                  onPresetChange={setAdminPeriodPreset}
                  onAnchorDateChange={setAdminPeriodAnchor}
                  className="shrink-0"
                />
                <button
                  type="button"
                  onClick={() =>
                    downloadCompareReconciliationExcel({
                      compareRows: data?.compare_rows || [],
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
                  📥 Download Compare Excel
                </button>
              </div>
            }
          >
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs sm:tracking-[0.15em]">
                <tr>
                  <th className="px-3 py-2 text-left">Doctor</th>
                  <th className="px-3 py-2 text-right">Total Restocked (Rs)</th>
                  <th className="px-3 py-2 text-right">Consumed: Sales (Rs)</th>
                  <th className="px-3 py-2 text-right">Consumed: Wasted (Rs)</th>
                  <th className="px-3 py-2 text-right">Consumed: Expired (Rs)</th>
                  <th className="px-3 py-2 text-right">Remaining in Bag (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {(data.compare_rows || []).map((row) => (
                  <tr key={row.doctor_id} className="border-t border-slate-200/70 text-xs">
                    <td className="px-3 py-2 font-medium text-slate-900">{row.doctor_name}</td>
                    <td className="px-3 py-2 text-right text-slate-800">{formatRupees(row.total_restocked)}</td>
                    <td className="px-3 py-2 text-right text-slate-800">{formatRupees(row.consumed_sales)}</td>
                    <td className="px-3 py-2 text-right text-slate-800">{formatRupees(row.consumed_wasted)}</td>
                    <td className="px-3 py-2 text-right text-slate-800">{formatRupees(row.consumed_expired)}</td>
                    <td className="px-3 py-2 text-right">
                      <CompareRemainingCell value={row.remaining_in_bag} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
        <LiveActivitySection
          movements={parsedMovements}
          maxRows={55}
          scrollClassName="max-h-[min(28rem,55vh)]"
          {...liveActivityStaffFilterProps}
        />
        </div>
      ) : !isOperator ? (
        <div className="hidden md:block">
          <LiveActivitySection movements={parsedMovements} />
        </div>
      ) : null}

        </div>
      )}

      <OperatorAddItemDrawer
        open={operatorAddOpen}
        folders={folders}
        activeFolderId={selectedView}
        activeCategory={activeCategory}
        isSaving={isSaving}
        onClose={() => setOperatorAddOpen(false)}
        onSubmit={saveItem}
      />
      <ItemModal
        open={Boolean(editor)}
        item={editor?.item}
        folders={folders}
        isSaving={isSaving}
        lockMasterFields={Boolean(editor?.item) && isDoctor}
        onClose={() => setEditor(null)}
        onSubmit={saveItem}
      />
      <ActionModal open={Boolean(movement)} item={movement?.item} type={movement?.type} isSaving={isSaving} onClose={() => setMovement(null)} onSubmit={saveMovement} />
      <RestockModal
        open={Boolean(restock)}
        doctors={doctors}
        item={restock?.item}
        presetDoctorId={restock?.doctorId}
        presetDoctorName={restock?.doctorName}
        isSaving={isSaving}
        onClose={() => setRestock(null)}
        onSubmit={saveRestock}
      />
      <DoctorRestockModal
        open={doctorRestockOpen}
        item={doctorRestockItem}
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
        onClose={() => setStockOut(null)}
        onSubmit={saveStockOut}
      />
      <RestockReceiptModal
        open={receiptModalOpen}
        receipt={activeReceipt}
        onClose={() => setReceiptModalOpen(false)}
        onPrint={() => printReceipt(activeReceipt)}
      />
      <AddStockModal open={Boolean(addStock)} item={addStock?.item} isSaving={isSaving} onClose={() => setAddStock(null)} onSubmit={saveAddStock} />
      <RemoveStockModal
        open={Boolean(removeStock)}
        item={removeStock?.item}
        isDoctorBag={removeStock?.item?.stock_scope === "doctor" || Boolean(removeStock?.item?.owner_doctor_id)}
        isSaving={isSaving}
        onClose={() => setRemoveStock(null)}
        onSubmit={saveRemoveStock}
      />
      <ConfirmDialog
        open={Boolean(itemToDelete)}
        onClose={() => setItemToDelete(null)}
        onConfirm={removeItem}
        title="Delete stock item?"
        description={
          itemToDelete?.stock_scope === "doctor" || itemToDelete?.owner_doctor_id
            ? `This will remove ${itemToDelete?.item_name || "this item"} from this doctor's medical bag and delete related movement history.`
            : `This will remove ${itemToDelete?.item_name || "this item"} and related movement history. OCS master items will not be auto-re-added from the catalog.`
        }
        confirmLabel="Delete item"
      />
    </>
  );
}
