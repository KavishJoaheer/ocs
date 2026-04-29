import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Download, MinusCircle, Pencil, Plus, Search, ShoppingCart, Trash2, Truck } from "lucide-react";
import toast from "react-hot-toast";
import { useSearchParams } from "react-router-dom";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { formatRupees } from "../lib/format.js";

function SummaryCard({ title, value, tone = "teal", description }) {
  const toneClass = tone === "amber" ? "text-amber-700" : "text-[#4FB8B3]";
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_16px_36px_rgba(34,72,91,0.06)]">
      <p className={`text-xs font-semibold uppercase tracking-[0.22em] ${toneClass}`}>{title}</p>
      <p className="mt-3 text-3xl font-bold text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
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

function ItemModal({ open, item, folders, isSaving, onClose, onSubmit }) {
  const [form, setForm] = useState(itemFormState(item));

  useEffect(() => {
    if (open) setForm(itemFormState(item));
  }, [item, open]);

  return (
    <Modal open={open} onClose={onClose} title={item ? "Edit stock item" : "Add stock item"} description="Save quantity, pricing, and expiry details." size="xl">
      <form
        className="space-y-4"
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
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Item Name</span>
            <input required name="item_name" value={form.item_name} onChange={(event) => setForm((prev) => ({ ...prev, item_name: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Folder</span>
            <select required name="folder_id" value={form.folder_id} onChange={(event) => setForm((prev) => ({ ...prev, folder_id: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
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
            <input name="attributes" value={form.attributes} onChange={(event) => setForm((prev) => ({ ...prev, attributes: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Expiry Date</span>
            <input type="date" name="expiry_date" value={form.expiry_date} onChange={(event) => setForm((prev) => ({ ...prev, expiry_date: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          </label>
        </div>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">MOA Notes</span>
          <textarea rows="3" name="moa_notes" value={form.moa_notes} onChange={(event) => setForm((prev) => ({ ...prev, moa_notes: event.target.value }))} className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3" />
        </label>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Current Quantity</span>
            <input required min="0" type="number" name="quantity" value={form.quantity} onChange={(event) => setForm((prev) => ({ ...prev, quantity: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Minimum Quantity</span>
            <input required min="0" type="number" name="minimum_quantity" value={form.minimum_quantity} onChange={(event) => setForm((prev) => ({ ...prev, minimum_quantity: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Unit</span>
            <input required name="unit" value={form.unit} onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Cost Price (Rs)</span>
            <input required min="0" step="0.01" type="number" name="cost_price" value={form.cost_price} onChange={(event) => setForm((prev) => ({ ...prev, cost_price: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Selling Price (Rs)</span>
            <input required min="0" step="0.01" type="number" name="selling_price" value={form.selling_price} onChange={(event) => setForm((prev) => ({ ...prev, selling_price: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
          </label>
        </div>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Adjustment Note</span>
          <input name="adjustment_note" value={form.adjustment_note} onChange={(event) => setForm((prev) => ({ ...prev, adjustment_note: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" />
        </label>
        <div className="flex justify-end gap-3 pt-2">
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
    <Modal open={open} onClose={onClose} title={`Stock In${item ? ` - ${item.item_name}` : ""}`} description="Add a new inventory batch using FEFO-safe batch tracking.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const qty = Number(quantity || 0);
          const cost = Number(costPrice || 0);
          if (!Number.isInteger(qty) || qty <= 0) return toast.error("Quantity must be a whole number greater than 0.");
          if (cost < 0) return toast.error("Cost price must be zero or more.");
          onSubmit({ quantity: qty, expiry_date: expiryDate, cost_price: cost });
        }}
      >
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

        <div className="flex justify-end gap-3">
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

function BulkRemoveModal({ open, count, isSaving, onClose, onSubmit }) {
  const [reason, setReason] = useState("Discontinued");

  useEffect(() => {
    if (!open) return;
    setReason("Discontinued");
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Bulk Remove" description={`Apply write-off to ${count} selected item(s).`}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ reason });
        }}
      >
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Reason</span>
          <select value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <option value="Expired">Expired</option>
            <option value="Discontinued">Discontinued</option>
            <option value="Damaged">Damaged</option>
          </select>
        </label>

        <p className="text-xs text-rose-700">
          This action removes all currently available quantity for selected items using FEFO batch deduction.
        </p>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {isSaving ? "Removing..." : "Confirm Bulk Remove"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BulkEditModal({ open, folders, isSaving, onClose, onSubmit }) {
  const [minimumQty, setMinimumQty] = useState("");
  const [folderId, setFolderId] = useState("");

  useEffect(() => {
    if (!open) return;
    setMinimumQty("");
    setFolderId("");
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Bulk Edit" description="Update minimum qty and/or folder for selected items.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            minimum_quantity: minimumQty,
            folder_id: folderId,
          });
        }}
      >
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Minimum Qty (optional)</span>
          <input
            min={0}
            step={1}
            type="number"
            value={minimumQty}
            onChange={(event) => setMinimumQty(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
        </label>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Category / Folder (optional)</span>
          <select value={folderId} onChange={(event) => setFolderId(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <option value="">Keep existing folder</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="rounded-2xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {isSaving ? "Saving..." : "Apply Bulk Edit"}
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
      description="Transfer this item from OCS Master Stock into your inventory using atomic FEFO deduction."
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
  onAdjustReclaim,
  onRemove,
}) {
  return (
    <div className="flex flex-nowrap items-center gap-2">
      {canManageOcs && contextIsOcs ? (
        <button
          type="button"
          onClick={() => onStockIn(item)}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-[#4FB8B3]/40 bg-[#4FB8B3]/10 px-2.5 py-1 text-xs font-semibold text-[#4FB8B3]"
        >
          <Plus className="size-3" />
          In
        </button>
      ) : null}

      {!(isDoctor && doctorViewIsOcs) ? (
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700"
        >
          <Pencil className="size-3" />
        </button>
      ) : null}

      {canManageOcs && contextIsOcs ? (
        <button
          type="button"
          onClick={() => onRestockDoctor(item)}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl bg-[#4FB8B3] px-2.5 py-1 text-xs font-semibold text-white"
        >
          <Truck className="size-3" />
          Restock
        </button>
      ) : null}

      {isDoctor && doctorViewIsMy ? (
        <button
          type="button"
          onClick={() => onRestockMyInventory(item)}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-[#4FB8B3] px-3 py-1 text-xs font-semibold text-white"
        >
          <Truck className="size-3" />
          Restock
        </button>
      ) : null}

      {canManageOcs && !contextIsOcs ? (
        <button
          type="button"
          onClick={() => onAdjustReclaim(item)}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-700"
        >
          <MinusCircle className="size-3" />
          Adjust
        </button>
      ) : null}

      {canManageOcs && contextIsOcs ? (
        <button
          type="button"
          onClick={() => onRemove(item)}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700"
        >
          <Trash2 className="size-3" />
        </button>
      ) : null}
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
  const [addStock, setAddStock] = useState(null);
  const [removeStock, setRemoveStock] = useState(null);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [showNearExpiryOnly, setShowNearExpiryOnly] = useState(false);
  const [sortMode, setSortMode] = useState("expiry_asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedItems, setSelectedItems] = useState([]);
  const [expandedRows, setExpandedRows] = useState({});
  const [batchMap, setBatchMap] = useState({});
  const [consumptionPeriod, setConsumptionPeriod] = useState("month");

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

  async function load(contextDoctorId = selectedContextDoctorId, nextDoctorContext = doctorContext) {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (contextDoctorId) query.set("doctorId", String(contextDoctorId));
      if (isDoctor) query.set("context", nextDoctorContext);
      const payload = await api.get(`/inventory${query.toString() ? `?${query.toString()}` : ""}`);
      setData(payload);
    } catch (error) {
      toast.error(error.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContextDoctorId, doctorContext]);

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
    if (!shouldOpenRestock || !doctorRestockCandidates.length) return;
    setDoctorRestockOpen(true);
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
  }, [search, selectedView, showLowStockOnly, showNearExpiryOnly, sortMode]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    // Keep only still-visible selections when filtering changes.
    const allowed = new Set(sortedItems.map((item) => Number(item.id)));
    setSelectedItems((prev) => prev.filter((id) => allowed.has(Number(id))));
  }, [sortedItems]);

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
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
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

  function toggleExpanded(itemId) {
    const key = Number(itemId);
    const willExpand = !expandedRows[key];
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
    if (willExpand) {
      loadBatches(key);
    }
  }

  function toggleSelected(itemId) {
    const key = Number(itemId);
    setSelectedItems((prev) => (prev.includes(key) ? prev.filter((id) => id !== key) : [...prev, key]));
  }

  function toggleSelectAllFiltered() {
    const filteredIds = sortedItems.map((item) => Number(item.id));
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedItems.includes(id));
    if (allSelected) {
      setSelectedItems((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedItems((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  }

  async function runBulkRemove({ reason }) {
    if (!selectedItems.length) return;
    setIsSaving(true);
    try {
      const next = await api.post("/inventory/bulk/remove", {
        item_ids: selectedItems,
        reason,
      });
      setData(next);
      setSelectedItems([]);
      setBulkRemoveOpen(false);
      toast.success("Bulk remove completed.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function runBulkEdit({ minimum_quantity, folder_id }) {
    if (!selectedItems.length) return;
    const hasMin = minimum_quantity !== undefined && minimum_quantity !== null && String(minimum_quantity) !== "";
    const hasFolder = folder_id !== undefined && folder_id !== null && String(folder_id) !== "";
    if (!hasMin && !hasFolder) {
      toast.error("Set at least one value for bulk edit.");
      return;
    }
    setIsSaving(true);
    try {
      const next = await api.post("/inventory/bulk/edit", {
        item_ids: selectedItems,
        minimum_quantity,
        folder_id,
      });
      setData(next);
      setSelectedItems([]);
      setBulkEditOpen(false);
      toast.success("Bulk edit applied.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  function exportSelectedCsv() {
    if (!selectedItems.length) return;
    const selectedSet = new Set(selectedItems.map((id) => Number(id)));
    const rows = sortedItems.filter((item) => selectedSet.has(Number(item.id)));
    const header = ["Item Name", "Qty", "Min Qty", "Nearest Expiry", "Cost (Rs)", "Sell (Rs)", "Folder"];
    const lines = rows.map((item) => [
      item.item_name,
      item.quantity,
      item.minimum_quantity,
      item.expiry_date || "",
      Number(item.cost_price || 0).toFixed(2),
      Number(item.selling_price || 0).toFixed(2),
      item.folder_name || "",
    ]);
    const csv = [header, ...lines]
      .map((line) => line.map((value) => `"${String(value).replace(/"/g, "\"\"")}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ocs-stock-selection-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Logistics"
        title={isDoctor ? (doctorViewIsOcs ? "OCS Master Stock" : "My Stock") : "OCS Stock"}
        description={isDoctor ? "Doctor-facing inventory with read-only master visibility, FEFO restocking, and consumption tracking." : "Central master stock with replenishment controls and stocktake tools."}
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
            <button type="button" onClick={() => setEditor({ item: null })} className="inline-flex items-center gap-2 rounded-2xl bg-[#4FB8B3] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#3aa6a1]">
              <Plus className="size-4" />
              Add Item
            </button>
          )
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard title="Total Stock Value" value={formatRupees(summary.total_amount_rs || 0)} description="Based on cost price." />
        <SummaryCard title="Monthly Sales" value={formatRupees(summary.total_monthly_sales_rs || 0)} description="Sell actions synced to billing." />
        <SummaryCard title="Monthly Replenishments" value={formatRupees(summary.total_monthly_replenishments_rs || 0)} description="Inbound restock and intake value." />
        <SummaryCard title="Low / Near Expiry" value={`${summary.low_stock_count || 0} / ${summary.near_expiry_count || 0}`} tone="amber" description="Traffic-light alert counters." />
      </div>

      <SectionCard title="View Stock Context" subtitle="Switch between Master OCS Stock and individual Doctor inventories.">
        <div className="space-y-4">
          {isDoctor ? (
            <div className="flex flex-wrap gap-2">
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
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Stock Context</label>
              <select
                value={selectedContextDoctorId}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedContextDoctorId(value);
                  const option = filteredContextOptions.find((row) => String(row.id) === String(value));
                  setContextSearch(option?.label || "OCS Stock");
                }}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
              >
                <option value="">OCS Stock</option>
                {doctorOptions.map((doctor) => (
                  <option key={`ctx-doctor-${doctor.id}`} value={String(doctor.id)}>
                    {doctor.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by item name" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4" />
          </label>
          <div className="flex flex-wrap gap-2">
            {folders.map((folder) => (
              <button key={folder.id} type="button" onClick={() => setSelectedView(String(folder.id))} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${selectedView === String(folder.id) ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}>
                {folder.name}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={
          isDoctor
            ? "My Stock Items"
            : contextIsOcs
              ? "OCS Stock Items"
              : `${contextSearch || "Doctor"} - My Stock`
        }
        subtitle={`${sortedItems.length} filtered item(s)`}
      >
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

        {canManageOcs && selectedItems.length > 0 ? (
          <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-[#4FB8B3] px-3 py-2 text-white shadow">
            <span className="text-sm font-semibold">{selectedItems.length} selected</span>
            <button type="button" onClick={() => setBulkRemoveOpen(true)} className="rounded-xl bg-white/20 px-3 py-1 text-xs font-semibold">Bulk Remove</button>
            <button type="button" onClick={() => setBulkEditOpen(true)} className="rounded-xl bg-white/20 px-3 py-1 text-xs font-semibold">Bulk Edit</button>
            <button type="button" onClick={exportSelectedCsv} className="inline-flex items-center gap-1 rounded-xl bg-white/20 px-3 py-1 text-xs font-semibold">
              <Download className="size-3.5" />
              Bulk Export CSV
            </button>
          </div>
        ) : null}

        {pagedItems.length ? (
          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white">
            <div className="max-h-[560px] overflow-auto overflow-x-auto">
              <table className="min-w-full table-fixed text-left text-sm">
                <colgroup>
                  <col style={{ width: "50px" }} />
                  <col style={{ width: "30%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "25%" }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <tr>
                    <th className="w-[50px] px-4 py-2.5 align-middle">
                      {canManageOcs ? (
                        <input
                          type="checkbox"
                          checked={sortedItems.length > 0 && sortedItems.every((item) => selectedItems.includes(Number(item.id)))}
                          onChange={toggleSelectAllFiltered}
                          className="size-4 accent-[#4FB8B3]"
                        />
                      ) : null}
                    </th>
                    <th className="w-[30%] px-4 py-2.5 text-left align-middle">Item Name</th>
                    <th className="w-[10%] px-4 py-2.5 text-center align-middle">Qty</th>
                    <th className="w-[10%] px-4 py-2.5 text-center align-middle">Min Qty</th>
                    <th className="w-[20%] px-4 py-2.5 text-center align-middle">Nearest Expiry</th>
                    <th className="w-[25%] px-4 py-2.5 text-left align-middle">Actions</th>
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
                          <td className="px-4 py-2 align-middle" onClick={(event) => event.stopPropagation()}>
                            {canManageOcs ? (
                              <input
                                type="checkbox"
                                checked={selectedItems.includes(Number(item.id))}
                                onChange={() => toggleSelected(item.id)}
                                className="size-4 accent-[#4FB8B3]"
                              />
                            ) : null}
                          </td>
                          <td className="px-4 py-2 align-middle text-left">
                            <div className="flex items-center gap-2">
                              <button type="button" className="rounded-md border border-slate-200 p-1 text-slate-500">
                                {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                              </button>
                              <span className="font-semibold text-slate-900">{item.item_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 align-middle text-center">
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
                          <td className="px-4 py-2 align-middle text-center">{item.minimum_quantity}</td>
                          <td className="px-4 py-2 align-middle text-center">{item.expiry_date || "Not set"}</td>
                          <td className="px-4 py-2 align-middle text-left" onClick={(event) => event.stopPropagation()}>
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
                              onRestockMyInventory={(nextItem) => {
                                const source = ocsByFolderAndName.get(
                                  `${nextItem.folder_id}::${String(nextItem.item_name || "").toLowerCase()}`,
                                );
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
                              }}
                              onAdjustReclaim={(nextItem) => setRemoveStock({ item: nextItem })}
                              onRemove={(nextItem) => setRemoveStock({ item: nextItem })}
                            />
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="border-t border-slate-100 bg-slate-50/60">
                            <td colSpan={6} className="px-4 py-3">
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
        <SectionCard title="My Consumption Record" subtitle="Track patient volume and stock consumption across key periods.">
          <div className="mb-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setConsumptionPeriod("week")} className={`rounded-2xl px-3 py-1.5 text-xs font-semibold ${consumptionPeriod === "week" ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}>This Week</button>
            <button type="button" onClick={() => setConsumptionPeriod("month")} className={`rounded-2xl px-3 py-1.5 text-xs font-semibold ${consumptionPeriod === "month" ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}>This Month</button>
            <button type="button" onClick={() => setConsumptionPeriod("ytd")} className={`rounded-2xl px-3 py-1.5 text-xs font-semibold ${consumptionPeriod === "ytd" ? "bg-[#4FB8B3] text-white" : "border border-slate-200 bg-white text-slate-700"}`}>Year to Date</button>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.2em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Period</th>
                  <th className="px-4 py-3 text-left">Patient Volume</th>
                  <th className="px-4 py-3 text-left">Stock Consumption (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {selectedConsumption ? (
                  <tr className="border-t border-slate-200/70 text-xs">
                    <td className="px-4 py-3">{selectedConsumption.period}</td>
                    <td className="px-4 py-3">{selectedConsumption.patient_volume}</td>
                    <td className="px-4 py-3">{formatRupees(selectedConsumption.stock_consumption_rs)}</td>
                  </tr>
                ) : (
                  <tr className="border-t border-slate-200/70 text-xs">
                    <td className="px-4 py-3 text-slate-500" colSpan={3}>No consumption record available yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : canManageOcs ? (
        <SectionCard title="Admin Compare Tool" subtitle="Compare doctor consumption against patient volume (current month).">
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.2em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Doctor</th>
                  <th className="px-4 py-3 text-left">Patient Volume</th>
                  <th className="px-4 py-3 text-left">Stock Consumption (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {(data.compare_rows || []).map((row) => (
                  <tr key={row.doctor_id} className="border-t border-slate-200/70 text-xs">
                    <td className="px-4 py-3">{row.doctor_name}</td>
                    <td className="px-4 py-3">{row.patient_volume}</td>
                    <td className="px-4 py-3">{formatRupees(row.stock_consumption)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      <ItemModal open={Boolean(editor)} item={editor?.item} folders={folders} isSaving={isSaving} onClose={() => setEditor(null)} onSubmit={saveItem} />
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
      <AddStockModal open={Boolean(addStock)} item={addStock?.item} isSaving={isSaving} onClose={() => setAddStock(null)} onSubmit={saveAddStock} />
      <RemoveStockModal open={Boolean(removeStock)} item={removeStock?.item} isSaving={isSaving} onClose={() => setRemoveStock(null)} onSubmit={saveRemoveStock} />
      <BulkRemoveModal open={bulkRemoveOpen} count={selectedItems.length} isSaving={isSaving} onClose={() => setBulkRemoveOpen(false)} onSubmit={runBulkRemove} />
      <BulkEditModal open={bulkEditOpen} folders={folders} isSaving={isSaving} onClose={() => setBulkEditOpen(false)} onSubmit={runBulkEdit} />
      <ConfirmDialog open={Boolean(itemToDelete)} onClose={() => setItemToDelete(null)} onConfirm={removeItem} title="Delete stock item?" description={`This will remove ${itemToDelete?.item_name || "this item"} and related movement history.`} confirmLabel="Delete item" />
    </div>
  );
}
