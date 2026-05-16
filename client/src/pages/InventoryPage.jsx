import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
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
} from "lucide-react";
import * as XLSX from "xlsx";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import { useSearchParams } from "react-router-dom";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import { formatRupees } from "../lib/format.js";
import { cx, pageContainerClass } from "../lib/utils.js";

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

const DOCTOR_MOBILE_BAG_TABS = [
  { id: "all", label: "All Stock Items" },
  { id: "stock_out", label: "Stock Out" },
  { id: "restock_request", label: "Restock Request" },
];

function formatDoctorMobileBatchLabel(item, batches) {
  const first = Array.isArray(batches) ? batches[0] : null;
  if (first?.batch_number && first.batch_number !== "N/A") {
    return first.batch_number;
  }
  if (first?.id) {
    return `BATCH-${String(first.id).padStart(3, "0")}`;
  }
  if (item?.id) {
    return `BATCH-${String(item.id).padStart(3, "0")}`;
  }
  return "—";
}

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

function itemFormState(item) {
  return {
    item_name: item?.item_name ?? "",
    folder_id: item?.folder_id ? String(item.folder_id) : "",
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
  const [form, setForm] = useState(itemFormState(item));

  useEffect(() => {
    if (open) setForm(itemFormState(item));
  }, [item, open]);

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
                <option key={folder.id} value={folder.id}>{folder.name}</option>
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

function RemoveStockModal({ open, item, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("Expired");

  useEffect(() => {
    if (!open) return;
    setQuantity("1");
    setReason("Expired");
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={`Remove Stock${item ? ` - ${item.item_name}` : ""}`} description="Write off inventory using FEFO batch deduction.">
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

function RestockModal({ open, doctors, item, isSaving, onClose, onSubmit }) {
  const [doctorId, setDoctorId] = useState("");
  const [doctorQuery, setDoctorQuery] = useState("");
  const [quantity, setQuantity] = useState("1");

  useEffect(() => {
    if (open) {
      setDoctorId("");
      setDoctorQuery("");
      setQuantity("1");
    }
  }, [open]);

  const doctorOptions = useMemo(() => {
    const q = doctorQuery.trim().toLowerCase();
    const sorted = doctors
      .slice()
      .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
    if (!q) return sorted;
    return sorted.filter((d) => String(d.full_name || "").toLowerCase().includes(q));
  }, [doctors, doctorQuery]);

  return (
    <Modal open={open} onClose={onClose} title={`Restock doctor${item ? ` - ${item.item_name}` : ""}`} description="Transfer stock atomically from OCS Stock to selected doctor.">
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

const STOCK_OUT_REASONS = ["Sold", "Wasted", "Expired"];

function StockOutModal({ open, item, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("Sold");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuantity("1");
    setReason("Sold");
    setNote("");
  }, [open, item]);

  const available = Number(item?.quantity || 0);

  return (
    <Modal open={open} onClose={onClose} title="Stock Out" description="Remove quantity from your medical bag and record why it left your stock." size="lg">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const qty = Number(quantity || 0);
          if (!Number.isInteger(qty) || qty <= 0) return;
          onSubmit({ quantity: qty, reason, note: note.trim() });
        }}
      >
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
              placeholder="e.g. batch reference, disposal details"
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

function formatMovementVerb(actionType, meta) {
  if (actionType === "stock_out" && meta?.stock_out_reason) {
    return `stocked out (${meta.stock_out_reason})`;
  }
  const map = {
    restock: "restocked",
    add: "added",
    remove: "removed",
    sell: "sold",
    stock_out: "stocked out",
    adjustment: "adjusted",
    override: "adjusted",
  };
  if (map[actionType]) return map[actionType];
  return String(actionType || "updated").replace(/_/g, " ");
}

function MovementActionBadge({ actionType }) {
  if (actionType === "restock_in") {
    return (
      <span className="inline-flex shrink-0 items-center rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
        Inflow
      </span>
    );
  }
  if (actionType === "restock_out") {
    return (
      <span className="inline-flex shrink-0 items-center rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-700">
        Outflow
      </span>
    );
  }
  if (actionType === "correction" || actionType === "adjustment" || actionType === "override") {
    return (
      <span className="inline-flex shrink-0 items-center rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
        Correction
      </span>
    );
  }
  return null;
}

const BADGED_ACTION_TYPES = new Set(["restock_in", "restock_out", "correction", "adjustment", "override"]);

function LiveActivitySection({
  movements,
  onReprint,
  maxRows = 55,
  scrollClassName = "max-h-80",
  showStaffFilters = false,
  staffOptions = [],
  activityRoleFilter = "",
  activityStaffUserId = "",
  onActivityRoleFilterChange,
  onActivityStaffUserIdChange,
  staffFilterActive = false,
}) {
  const monthKey = dayjs().format("YYYY-MM");
  const monthRows = useMemo(
    () => movements.filter((m) => dayjs(m.created_at).format("YYYY-MM") === monthKey),
    [movements, monthKey],
  );
  const rows = monthRows.slice(0, maxRows);

  const staffSelectOptions = useMemo(() => {
    if (!showStaffFilters) return [];
    const role = activityRoleFilter;
    return staffOptions.filter((member) => {
      if (!role) return true;
      return String(member.role || "").toLowerCase() === role;
    });
  }, [showStaffFilters, staffOptions, activityRoleFilter]);

  const emptyFilteredUser =
    staffFilterActive && rows.length === 0 && (activityStaffUserId || activityRoleFilter);
  return (
    <SectionCard title="Live Activity">
      {showStaffFilters ? (
        <div className="mb-4 mt-2 flex flex-row flex-wrap items-center gap-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial sm:min-w-[10rem]">
            <span className="sr-only">Filter by role</span>
            <select
              value={activityRoleFilter}
              onChange={(event) => onActivityRoleFilterChange?.(event.target.value)}
              className={cx(ACTIVITY_FILTER_SELECT_CLASS, "flex-1 sm:w-40")}
            >
              <option value="">All Accounts</option>
              <option value="doctor">Doctors</option>
              <option value="operator">Operators</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial sm:min-w-[12rem]">
            <span className="sr-only">Filter by staff member</span>
            <select
              value={activityStaffUserId}
              onChange={(event) => onActivityStaffUserIdChange?.(event.target.value)}
              className={cx(ACTIVITY_FILTER_SELECT_CLASS, "flex-1 sm:w-52")}
            >
              <option value="">All staff</option>
              {staffSelectOptions.map((member) => (
                <option key={member.id} value={String(member.id)}>
                  {member.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className={cx("overflow-y-auto rounded-2xl border border-slate-200 bg-white/80 px-2 py-2", scrollClassName)}>
        {emptyFilteredUser ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No logged stock movements found for this user.
          </p>
        ) : rows.length ? (
          <div className="flex flex-col space-y-1">
            {rows.map((movement) => {
              const transactionId = movement.meta?.transaction_id || "";
              const canPrint = movement.action_type === "restock_in" || movement.action_type === "restock_out";
              const actor = movement.meta?.performed_by_name || "System";
              const qty = Number(movement.quantity ?? 0);
              const itemName = movement.item_name || "item";
              const verb = formatMovementVerb(movement.action_type, movement.meta);
              const unitLabel = qty === 1 ? "unit" : "units";
              const timeLabel = formatMovementTimestampEnterprise(movement.created_at);

              return (
                <div
                  key={`mv-${movement.id}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 py-1.5 text-sm last:border-b-0"
                >
                  <span className="shrink-0 text-xs text-gray-400">{timeLabel}</span>
                  <span className="shrink-0 text-xs text-gray-400" aria-hidden>
                    •
                  </span>
                  <p className="min-w-0 flex flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-snug text-slate-900">
                    <span className="font-medium text-slate-900">{actor}</span>
                    <MovementActionBadge actionType={movement.action_type} />
                    {!BADGED_ACTION_TYPES.has(movement.action_type) ? (
                      <span className="text-xs font-semibold text-slate-600">{verb}</span>
                    ) : null}
                    <span className="tabular-nums text-slate-800">
                      {qty} {unitLabel} of{" "}
                    </span>
                    <span className="font-semibold text-slate-950">{itemName}</span>
                  </p>
                  {canPrint && transactionId ? (
                    <button
                      type="button"
                      onClick={() => onReprint(transactionId)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-1.5 py-0.5 text-slate-600 hover:bg-slate-50"
                      title="Print receipt"
                    >
                      <Printer className="size-3.5 shrink-0" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">No movement activity recorded yet.</p>
        )}
      </div>
    </SectionCard>
  );
}

function InventoryOcsMasterActions({
  item,
  touchWrap = false,
  omitRestock = false,
  onStockIn,
  onEdit,
  onRestockDoctor,
  onRemove,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function handleMouseDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [menuOpen]);

  const receiveBtn = touchWrap
    ? "inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-[#4FB8B3]/40 bg-[#4FB8B3]/10 text-[#1f7f7b]"
    : "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-[#4FB8B3]/40 bg-[#4FB8B3]/10 text-[#1f7f7b] transition hover:bg-[#4FB8B3]/20";

  const moreBtn = touchWrap
    ? "inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
    : "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-900";

  const menuItem =
    "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50";

  return (
    <div className={cx("flex w-full min-w-0 items-center justify-end gap-2", touchWrap && "flex-wrap")}>
      <button
        type="button"
        title="Receive stock"
        aria-label="Receive stock"
        className={receiveBtn}
        onClick={() => onStockIn(item)}
      >
        <Plus className="size-4 shrink-0" />
      </button>
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          title="More actions"
          aria-label="More actions"
          aria-expanded={menuOpen}
          className={moreBtn}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <MoreVertical className="size-4 shrink-0" />
        </button>
        {menuOpen ? (
          <div className="absolute right-0 z-30 mt-1 min-w-[12.5rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <button
              type="button"
              className={menuItem}
              onClick={() => {
                setMenuOpen(false);
                onEdit(item);
              }}
            >
              <Pencil className="size-3.5 shrink-0 text-slate-500" />
              Edit
            </button>
            {!omitRestock ? (
              <button
                type="button"
                className={menuItem}
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
              className={`${menuItem} text-rose-700 hover:bg-rose-50`}
              onClick={() => {
                setMenuOpen(false);
                onRemove(item);
              }}
            >
              <Trash2 className="size-3.5 shrink-0" />
              Remove stock
            </button>
          </div>
        ) : null}
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
  onStockIn,
  onEdit,
  onRestockDoctor,
  onRestockMyInventory,
  onStockOut,
  onAdjustReclaim,
  onRemove,
  touchWrap = false,
  omitRestock = false,
}) {
  if (canManageOcs && contextIsOcs) {
    return (
      <InventoryOcsMasterActions
        item={item}
        touchWrap={touchWrap}
        omitRestock={omitRestock}
        onStockIn={onStockIn}
        onEdit={onEdit}
        onRestockDoctor={onRestockDoctor}
        onRemove={onRemove}
      />
    );
  }

  const btn = touchWrap
    ? "inline-flex min-h-10 items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold"
    : "inline-flex items-center gap-1 whitespace-nowrap rounded-xl px-2.5 py-1 text-xs font-semibold";
  const restockBtn = touchWrap
    ? "inline-flex min-h-10 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-xl bg-[#4FB8B3] px-4 py-2 text-xs font-bold text-white shadow-sm"
    : "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#4FB8B3] px-3 py-1 text-xs font-semibold text-white";
  const stockOutBtn = touchWrap
    ? "inline-flex min-h-10 items-center justify-center gap-1 rounded-xl bg-orange-100 px-3 py-2 text-xs font-semibold text-orange-700 hover:bg-orange-200"
    : "inline-flex items-center gap-1 whitespace-nowrap rounded-xl bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-200";

  return (
    <div className={cx("flex items-center gap-2", touchWrap ? "max-w-full flex-wrap justify-end" : "flex-nowrap")}>
      {!(isDoctor && doctorViewIsOcs) ? (
        <button type="button" onClick={() => onEdit(item)} className={`${btn} border border-slate-200 text-slate-700`}>
          <Pencil className="size-3.5 shrink-0" />
        </button>
      ) : null}

      {isDoctor && !omitRestock ? (
        <button type="button" onClick={() => onRestockMyInventory(item)} className={`${restockBtn}`}>
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

      {canManageOcs && !contextIsOcs ? (
        <button type="button" onClick={() => onAdjustReclaim(item)} className={`${btn} border border-amber-200 text-amber-700`}>
          <MinusCircle className="size-3.5 shrink-0" />
          Adjust
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

function MobileDoctorBagLayout({
  search,
  setSearch,
  mobileBagTab,
  setMobileBagTab,
  mobileBagPagedItems,
  mobileBagTotalPages,
  currentPage,
  setCurrentPage,
  batchMap,
  doctorRestockCandidates,
  onOpenRestockInventory,
  onRestockItem,
  onStockOutItem,
  findMyStockItemByName,
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.25rem)] w-full max-w-md flex-col space-y-3">
      <header className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-gray-900">My Stock</h1>
        <button
          type="button"
          onClick={onOpenRestockInventory}
          disabled={!doctorRestockCandidates.length}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-[#4FB8B3] px-3.5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#3aa6a1] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Truck className="size-4" />
          Restock
        </button>
      </header>

      <label className="relative block w-full">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by item name"
          className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm outline-none transition placeholder:text-sm placeholder:text-gray-400 focus:border-[#4FB8B3] focus:bg-white"
        />
      </label>

      <div className="flex justify-between space-x-2">
        {DOCTOR_MOBILE_BAG_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMobileBagTab(tab.id)}
            className={cx(
              "min-h-11 flex-1 rounded-2xl px-2 py-2.5 text-center text-[11px] font-bold leading-tight transition",
              mobileBagTab === tab.id
                ? "bg-[#4FB8B3] text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-600",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <SectionCard className="flex min-h-0 flex-1 flex-col rounded-[24px] p-3 shadow-[0_16px_40px_rgba(34,72,91,0.06)]">
        {mobileBagTab === "restock_request" ? (
          doctorRestockCandidates.length ? (
            <div className="flex flex-col space-y-4 pb-8">
              {doctorRestockCandidates.map((candidate) => {
                const myItem = findMyStockItemByName(candidate.item_name);
                const unit = myItem?.unit || "units";
                return (
                  <div
                    key={`${candidate.ocs_item_id}-${candidate.item_name}`}
                    className="rounded-[20px] border border-amber-200/80 bg-amber-50/50 px-4 py-3.5"
                  >
                    <p className="text-base font-bold text-gray-900">{candidate.item_name}</p>
                    <p className="mt-1 text-sm font-medium text-gray-500">
                      Par {candidate.par_level} • Bag {candidate.current_quantity} {unit} • Need{" "}
                      {candidate.required_quantity}
                    </p>
                    <button
                      type="button"
                      disabled={!myItem}
                      onClick={() => myItem && onRestockItem(myItem)}
                      className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#4FB8B3] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Truck className="size-4" />
                      Restock Request
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No restock requests"
              description="Your bag stock is above the restock threshold for all tracked items."
            />
          )
        ) : mobileBagPagedItems.length ? (
          <div className="flex flex-col space-y-4 pb-8">
            {mobileBagPagedItems.map((item) => {
              const batches = batchMap[item.id] || [];
              const quantity = Number(item.quantity || 0);
              const unit = item.unit || "units";
              const batchLabel = formatDoctorMobileBatchLabel(item, batches);
              const showStockOut = mobileBagTab === "stock_out" || mobileBagTab === "all";

              return (
                <div
                  key={`mobile-bag-${item.id}`}
                  className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-3.5 shadow-sm"
                >
                  <p className="text-base font-bold text-gray-900">{item.item_name}</p>
                  <p className="mt-1 text-sm font-medium text-gray-500">
                    Batch: {batchLabel} • Qty: {quantity} {unit}
                  </p>
                  {showStockOut && quantity > 0 ? (
                    <button
                      type="button"
                      onClick={() => onStockOutItem(item)}
                      className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-orange-100 px-4 py-2.5 text-sm font-semibold text-orange-800 transition active:brightness-95"
                    >
                      <Minus className="size-4" />
                      Stock Out
                    </button>
                  ) : null}
                  {mobileBagTab === "all" && quantity <= Number(item.minimum_quantity || 0) ? (
                    <button
                      type="button"
                      onClick={() => onRestockItem(item)}
                      className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-[#4FB8B3]/40 bg-[#4FB8B3]/10 px-4 py-2.5 text-sm font-bold text-[#1f7f7b]"
                    >
                      <Truck className="size-4" />
                      Restock Request
                    </button>
                  ) : null}
                </div>
              );
            })}

            {mobileBagTotalPages > 1 ? (
              <div className="flex items-center justify-between gap-3 pt-1">
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
          </div>
        ) : (
          <EmptyState
            title={mobileBagTab === "stock_out" ? "No stock to remove" : "No stock items found"}
            description={
              mobileBagTab === "stock_out"
                ? "Items with available quantity will appear here for stock out."
                : "Search or restock from OCS Master Stock to fill your medical bag."
            }
          />
        )}
      </SectionCard>
    </div>
  );
}

export default function InventoryPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedView, setSelectedView] = useState("");
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
  const [itemToDelete, setItemToDelete] = useState(null);
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [showNearExpiryOnly, setShowNearExpiryOnly] = useState(false);
  const [sortMode, setSortMode] = useState("expiry_asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState({});
  const [batchMap, setBatchMap] = useState({});
  const [consumptionPeriod, setConsumptionPeriod] = useState("month");
  const [activityRoleFilter, setActivityRoleFilter] = useState("");
  const [activityStaffUserId, setActivityStaffUserId] = useState("");
  const [mobileBagTab, setMobileBagTab] = useState("all");

  const isDoctor = user.role === "doctor";
  const canManageOcs = user.role === "admin" || user.role === "operator";
  const isAdmin = user.role === "admin";
  const folders = data?.folders || [];
  const doctors = data?.doctors || [];
  const doctorOptions = useMemo(
    () => [...doctors].sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""))),
    [doctors],
  );
  const contextIsOcs = !selectedContextDoctorId;
  const doctorViewIsOcs = isDoctor && doctorContext === "ocs";
  const doctorViewIsMy = isDoctor && doctorContext === "my";
  const isMobile = useIsMobile();
  const showMobileDoctorBag = isDoctor && isMobile && doctorViewIsMy;
  const items = isDoctor
    ? doctorViewIsOcs
      ? data?.ocs_stock || []
      : data?.my_stock || []
    : selectedContextDoctorId
      ? data?.selected_doctor_stock || []
      : data?.ocs_stock || [];
  const summary = data?.summary || {};
  const pageSize = 50;
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
      const query = new URLSearchParams();
      if (contextDoctorId) query.set("doctorId", String(contextDoctorId));
      if (isDoctor) query.set("context", nextDoctorContext);
      if (isAdmin && activityRoleFilter) query.set("activityRole", activityRoleFilter);
      if (isAdmin && activityStaffUserId) query.set("activityUserId", activityStaffUserId);
      const payload = await api.get(`/inventory${query.toString() ? `?${query.toString()}` : ""}`);
      setData(payload);
    } catch (error) {
      toast.error(error.message);
      if (!silent) setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function handleActivityRoleFilterChange(value) {
    setActivityRoleFilter(value);
    setActivityStaffUserId("");
  }

  const liveActivityStaffFilterProps = isAdmin
    ? {
        showStaffFilters: true,
        staffOptions: data?.activity_staff || [],
        activityRoleFilter,
        activityStaffUserId,
        onActivityRoleFilterChange: handleActivityRoleFilterChange,
        onActivityStaffUserIdChange: setActivityStaffUserId,
        staffFilterActive: true,
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
  }, [activityRoleFilter, activityStaffUserId]);

  // Default "View By" folder after inventory payload loads.
  useEffect(() => {
    if (!data?.folders?.length) return;
    const valid = data.folders.some((f) => String(f.id) === String(selectedView));
    if (!selectedView || !valid) {
      setSelectedView(String(data.folders[0].id));
    }
  }, [data, selectedView]);

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
    let rows = (data?.my_stock || []).filter(
      (item) => !needle || String(item.item_name || "").toLowerCase().includes(needle),
    );
    if (mobileBagTab === "stock_out") {
      rows = rows.filter((item) => Number(item.quantity || 0) > 0);
    }
    const expiryRank = (date) => (date ? new Date(date).getTime() : Number.MAX_SAFE_INTEGER);
    return [...rows].sort((a, b) => expiryRank(a.expiry_date) - expiryRank(b.expiry_date));
  }, [showMobileDoctorBag, data?.my_stock, search, mobileBagTab]);

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
  }, [search, selectedView, showLowStockOnly, showNearExpiryOnly, sortMode, mobileBagTab]);

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

  useEffect(() => {
    if (loading || !data || !showMobileDoctorBag || mobileBagTab === "restock_request") {
      return;
    }
    mobileBagPagedItems.forEach((item) => {
      if (!batchMap[item.id]) {
        loadBatches(item.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, data, showMobileDoctorBag, mobileBagTab, mobileBagPagedItems]);

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
      const next = editor?.item ? await api.put(`/inventory/items/${editor.item.id}`, payload) : await api.post("/inventory/items", payload);
      setData(next);
      setEditor(null);
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
      const next = await api.post(`/inventory/items/${movement.item.id}/actions`, payload);
      setData(next);
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
      const next = await api.post("/inventory/restock", payload);
      setData(next);
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
      const next = await api.post("/inventory/restock/my-inventory", {
        items: requests.map((item) => ({
          ocs_item_id: Number(item.ocs_item_id),
          quantity: Number(item.required_quantity || item.quantity),
        })),
      });
      setData(next);
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
      const next = await api.post(`/inventory/items/${addStock.item.id}/ocs-actions`, {
        action_type: "stock_in",
        quantity,
        expiry_date: payload.expiry_date || "",
        cost_price: Number(payload.cost_price || 0),
      });
      setData(next);
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

    setIsSaving(true);
    try {
      const next = await api.post(`/inventory/items/${removeStock.item.id}/ocs-actions`, {
        action_type: "remove",
        quantity,
        reason: payload.reason,
      });
      setData(next);
      setRemoveStock(null);
      toast.success("Stock removed.");
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
      const next = await api.post(`/inventory/items/${stockOut.item.id}/actions`, {
        action_type: "stock_out",
        quantity,
        reason: payload.reason,
        note: payload.note || "",
      });
      setData(next);
      setStockOut(null);
      toast.success("Stock out recorded.");
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
      await load();
      toast.success("Stock item deleted.");
    } catch (error) {
      toast.error(error.message);
    }
  }

  return (
    <>
      {showMobileDoctorBag ? (
        <MobileDoctorBagLayout
          search={search}
          setSearch={setSearch}
          mobileBagTab={mobileBagTab}
          setMobileBagTab={setMobileBagTab}
          mobileBagPagedItems={mobileBagPagedItems}
          mobileBagTotalPages={mobileBagTotalPages}
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          batchMap={batchMap}
          doctorRestockCandidates={doctorRestockCandidates}
          onOpenRestockInventory={() => setDoctorRestockOpen(true)}
          onRestockItem={openDoctorRestockForItem}
          onStockOutItem={(item) => setStockOut({ item })}
          findMyStockItemByName={(name) =>
            (data?.my_stock || []).find(
              (item) =>
                String(item.item_name || "").toLowerCase() === String(name || "").toLowerCase(),
            )
          }
        />
      ) : (
        <div className={cx(pageContainerClass, "space-y-6")}>
      <PageHeader
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <SummaryCard title="Total Stock Value" value={formatRupees(summary.total_amount_rs || 0)} />
        <SummaryCard title="Monthly Sales" value={formatRupees(summary.total_monthly_sales_rs || 0)} />
        <SummaryCard title="Monthly Replenishments" value={formatRupees(summary.total_monthly_replenishments_rs || 0)} />
        <SummaryCard title="Low / Near Expiry" value={`${summary.low_stock_count || 0} / ${summary.near_expiry_count || 0}`} tone="amber" />
      </div>

      <SectionCard
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
          </div>
          <div className="-mx-1 flex flex-wrap gap-2">
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => setSelectedView(String(folder.id))}
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
            <div className="hidden overflow-hidden rounded-3xl border border-slate-200/80 bg-white md:block">
              <div className="max-h-[560px] overflow-auto overflow-x-auto">
                <table className="min-w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col style={{ width: "32%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "22%" }} />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left align-middle">Item Name</th>
                      <th className="px-3 py-2 text-center align-middle">Qty</th>
                      <th className="px-3 py-2 text-center align-middle">Min Qty</th>
                      <th className="px-3 py-2 text-center align-middle">Nearest Expiry</th>
                      <th className="px-3 py-2 text-left align-middle">Actions</th>
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
                          <tr className={`border-t border-slate-200/70 align-middle transition-colors hover:bg-slate-50/70 ${isLow ? "bg-red-50" : ""}`} onClick={() => toggleExpanded(item.id)}>
                            <td className="px-3 py-1.5 align-middle text-left">
                              <div className="flex items-center gap-2">
                                <button type="button" className="rounded-md border border-slate-200 p-1 text-slate-500">
                                  {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                </button>
                                <span className="font-semibold text-slate-900">{item.item_name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-1.5 align-middle text-center">
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
                            </td>
                            <td className="px-3 py-1.5 align-middle text-center">{item.minimum_quantity}</td>
                            <td className="px-3 py-1.5 align-middle text-center">{item.expiry_date || "Not set"}</td>
                            <td className="px-3 py-1.5 align-middle text-left" onClick={(event) => event.stopPropagation()}>
                              <InventoryActionButtons
                                item={item}
                                canManageOcs={canManageOcs}
                                contextIsOcs={contextIsOcs}
                                isDoctor={isDoctor}
                                doctorViewIsMy={doctorViewIsMy}
                                doctorViewIsOcs={doctorViewIsOcs}
                                onStockIn={(nextItem) => setAddStock({ item: nextItem })}
                                onEdit={(nextItem) => setEditor({ item: nextItem })}
                                onRestockDoctor={(nextItem) => setRestock({ item: nextItem })}
                                onRestockMyInventory={openDoctorRestockForItem}
                                onStockOut={(nextItem) => setStockOut({ item: nextItem })}
                                onAdjustReclaim={(nextItem) => setRemoveStock({ item: nextItem })}
                                onRemove={(nextItem) => setRemoveStock({ item: nextItem })}
                              />
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

            <div className="space-y-2 md:hidden">
              {pagedItems.map((item) => {
                const isLow = Number(item.quantity || 0) <= Number(item.minimum_quantity || 0);
                const expanded = Boolean(expandedRows[item.id]);
                const batches = batchMap[item.id] || [];
                const parLevel = Number(item.minimum_quantity || 0);
                const quantity = Number(item.quantity || 0);
                const ratio = parLevel > 0 ? quantity / parLevel : 1;
                const trafficTone = quantity <= 0 ? "critical" : parLevel > 0 && ratio < 0.5 ? "warning" : "healthy";
                const stockLabel =
                  isDoctor && doctorViewIsMy
                    ? trafficTone === "critical"
                      ? "CRITICAL"
                      : trafficTone === "warning"
                        ? "LOW"
                        : "HEALTHY"
                    : isLow
                      ? "LOW"
                      : "OK";
                const badgeIsAlert =
                  quantity <= 0 ||
                  isLow ||
                  trafficTone === "critical" ||
                  (isDoctor && doctorViewIsMy && trafficTone === "warning");
                const showProminentRestock = isDoctor || (canManageOcs && contextIsOcs);

                return (
                  <div
                    key={`m-${item.id}`}
                    className={`rounded-xl border px-2.5 py-2 shadow-sm ${isLow ? "border-rose-200/80 bg-rose-50/40" : "border-slate-200/80 bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(item.id)}
                            className="grid size-7 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500"
                            aria-expanded={expanded}
                          >
                            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                          </button>
                          <p className="truncate font-bold leading-snug text-slate-950">{item.item_name}</p>
                        </div>
                      </div>
                      <span
                        className={cx(
                          "shrink-0 rounded-full px-2 py-0.5 text-center text-[10px] font-bold uppercase leading-tight tracking-wide",
                          badgeIsAlert ? "bg-rose-100 text-rose-700" : "bg-[#4FB8B3]/20 text-[#1f7f7b]",
                        )}
                      >
                        {quantity} {stockLabel}
                      </span>
                    </div>

                    <div className="mt-1.5 flex min-h-10 items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                      <p className="min-w-0 text-[11px] leading-tight text-slate-500">
                        <span className="font-semibold text-slate-600">Exp:</span> {item.expiry_date || "—"}
                      </p>
                      {showProminentRestock ? (
                        <div className="flex shrink-0 items-center gap-2">
                          {isDoctor ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openDoctorRestockForItem(item)}
                                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#4FB8B3] px-3.5 py-2 text-xs font-bold text-white shadow-sm active:brightness-95"
                              >
                                <Truck className="size-3.5" />
                                Restock
                              </button>
                              {doctorViewIsMy ? (
                                <button
                                  type="button"
                                  onClick={() => setStockOut({ item })}
                                  className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-orange-100 px-3.5 py-2 text-xs font-semibold text-orange-700 hover:bg-orange-200 active:brightness-95"
                                >
                                  <Minus className="size-3.5" />
                                  Stock Out
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setRestock({ item })}
                              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#4FB8B3] px-3.5 py-2 text-xs font-bold text-white shadow-sm active:brightness-95"
                            >
                              <Truck className="size-3.5" />
                              Restock
                            </button>
                          )}
                        </div>
                      ) : (
                        <InventoryActionButtons
                          item={item}
                          canManageOcs={canManageOcs}
                          contextIsOcs={contextIsOcs}
                          isDoctor={isDoctor}
                          doctorViewIsMy={doctorViewIsMy}
                          doctorViewIsOcs={doctorViewIsOcs}
                          onStockIn={(nextItem) => setAddStock({ item: nextItem })}
                          onEdit={(nextItem) => setEditor({ item: nextItem })}
                          onRestockDoctor={(nextItem) => setRestock({ item: nextItem })}
                          onRestockMyInventory={openDoctorRestockForItem}
                          onStockOut={(nextItem) => setStockOut({ item: nextItem })}
                          onAdjustReclaim={(nextItem) => setRemoveStock({ item: nextItem })}
                          onRemove={(nextItem) => setRemoveStock({ item: nextItem })}
                          touchWrap
                        />
                      )}
                    </div>

                    {showProminentRestock ? (
                      <div className="mt-1.5 flex flex-wrap justify-end gap-1.5 border-t border-slate-100 pt-1.5">
                        <InventoryActionButtons
                          item={item}
                          canManageOcs={canManageOcs}
                          contextIsOcs={contextIsOcs}
                          isDoctor={isDoctor}
                          doctorViewIsMy={doctorViewIsMy}
                          doctorViewIsOcs={doctorViewIsOcs}
                          onStockIn={(nextItem) => setAddStock({ item: nextItem })}
                          onEdit={(nextItem) => setEditor({ item: nextItem })}
                          onRestockDoctor={(nextItem) => setRestock({ item: nextItem })}
                          onRestockMyInventory={openDoctorRestockForItem}
                          onStockOut={(nextItem) => setStockOut({ item: nextItem })}
                          onAdjustReclaim={(nextItem) => setRemoveStock({ item: nextItem })}
                          onRemove={(nextItem) => setRemoveStock({ item: nextItem })}
                          touchWrap
                          omitRestock
                        />
                      </div>
                    ) : null}

                    {expanded ? (
                      <div className="mt-1.5 space-y-2 border-t border-slate-100 pt-1.5">
                        <p className="text-[11px] text-slate-600">
                          Min {item.minimum_quantity} · {formatRupees(item.cost_price)} / {formatRupees(item.selling_price)}
                        </p>
                        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-2 text-[11px] text-slate-700">
                          {batches.length
                            ? batches.map((batch) => (
                                <p key={batch.id}>
                                  #{batch.id} · Qty {batch.quantity_remaining} · Exp {batch.expiry_date || "—"}
                                </p>
                              ))
                            : "Open row to load batches."}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState title="No stock items found" description="Add stock to one of the required folders to begin tracking." />
        )}

        <div className="mt-3 flex items-center justify-between">
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
        <LiveActivitySection movements={parsedMovements} onReprint={reprintByTransactionId} />
        </div>
      ) : isAdmin ? (
        <div className="hidden md:grid md:grid-cols-1 md:gap-6 lg:grid-cols-2">
          <SectionCard title="Admin Compare Tool">
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-xs sm:tracking-[0.2em]">
                <tr>
                  <th className="px-3 py-2 text-left">Doctor</th>
                  <th className="px-3 py-2 text-left">Patient Volume</th>
                  <th className="px-3 py-2 text-left">Stock Consumption (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {(data.compare_rows || []).map((row) => (
                  <tr key={row.doctor_id} className="border-t border-slate-200/70 text-xs">
                    <td className="px-3 py-2">{row.doctor_name}</td>
                    <td className="px-3 py-2">{row.patient_volume}</td>
                    <td className="px-3 py-2">{formatRupees(row.stock_consumption)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
        <LiveActivitySection
          movements={parsedMovements}
          onReprint={reprintByTransactionId}
          maxRows={55}
          scrollClassName="max-h-[min(28rem,55vh)]"
          {...liveActivityStaffFilterProps}
        />
        </div>
      ) : canManageOcs ? (
        <div className="hidden md:block">
          <LiveActivitySection
            movements={parsedMovements}
            onReprint={reprintByTransactionId}
            maxRows={80}
            scrollClassName="max-h-[min(36rem,60vh)]"
          />
        </div>
      ) : (
        <div className="hidden md:block">
          <LiveActivitySection movements={parsedMovements} onReprint={reprintByTransactionId} />
        </div>
      )}

        </div>
      )}

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
      <RestockModal open={Boolean(restock)} doctors={doctors} item={restock?.item} isSaving={isSaving} onClose={() => setRestock(null)} onSubmit={saveRestock} />
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
      <RemoveStockModal open={Boolean(removeStock)} item={removeStock?.item} isSaving={isSaving} onClose={() => setRemoveStock(null)} onSubmit={saveRemoveStock} />
      <ConfirmDialog open={Boolean(itemToDelete)} onClose={() => setItemToDelete(null)} onConfirm={removeItem} title="Delete stock item?" description={`This will remove ${itemToDelete?.item_name || "this item"} and related movement history.`} confirmLabel="Delete item" />
    </>
  );
}
