import { useEffect, useMemo, useState } from "react";
import { FileUp, MinusCircle, Plus, Search, ShoppingCart, Trash2, Truck } from "lucide-react";
import toast from "react-hot-toast";
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
    <div className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_36px_rgba(34,72,91,0.06)]">
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
  const [quantityDelta, setQuantityDelta] = useState("1");

  useEffect(() => {
    if (!open) return;
    setQuantityDelta("1");
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={`Add stock${item ? ` - ${item.item_name}` : ""}`} description="Increase item quantity in OCS Stock.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const delta = Number(quantityDelta || 0);
          if (!Number.isInteger(delta) || delta <= 0) return toast.error("Quantity must be a whole number greater than 0.");
          onSubmit({ quantity_delta: delta });
        }}
      >
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Quantity to add</span>
          <input
            required
            min={1}
            step={1}
            type="number"
            value={quantityDelta}
            onChange={(event) => setQuantityDelta(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
        </label>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
            Cancel
          </button>
          <button type="submit" disabled={isSaving} className="rounded-2xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {isSaving ? "Adding..." : "Add"}
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

export default function InventoryPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedView, setSelectedView] = useState("");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [editor, setEditor] = useState(null);
  const [movement, setMovement] = useState(null);
  const [restock, setRestock] = useState(null);
  const [addStock, setAddStock] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [csvText, setCsvText] = useState("");

  const isDoctor = user.role === "doctor";
  const canManageOcs = user.role === "admin" || user.role === "operator";
  const isAdmin = user.role === "admin";
  const folders = data?.folders || [];
  const doctors = data?.doctors || [];
  const items = isDoctor ? data?.my_stock || [] : data?.ocs_stock || [];
  const lowStockItems = data?.low_stock_items || [];
  const summary = data?.summary || {};

  async function load(doctorId = selectedDoctorId) {
    setLoading(true);
    try {
      const params = doctorId ? `?doctorId=${doctorId}` : "";
      const payload = await api.get(`/inventory${params}`);
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
  }, [selectedDoctorId]);

  // Default "View By" folder after inventory payload loads.
  useEffect(() => {
    if (!data?.folders?.length) return;
    const valid = data.folders.some((f) => String(f.id) === String(selectedView));
    if (!selectedView || !valid) {
      setSelectedView(String(data.folders[0].id));
    }
  }, [data, selectedView]);

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const source = selectedView ? items.filter((item) => String(item.folder_id) === String(selectedView)) : items;
    return source.filter((item) => !needle || item.item_name.toLowerCase().includes(needle));
  }, [items, search, selectedView]);
  const doctorOptions = useMemo(
    () => [...doctors].sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""))),
    [doctors],
  );
  const stockViewerItemCount = selectedDoctorId ? (data?.selected_doctor_stock || []).length : items.length;

  if (loading) return <LoadingState label="Loading inventory workspace" />;
  if (!data) return <EmptyState title="Inventory unavailable" description="Unable to load stock data right now." />;

  async function saveItem(payload) {
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

  async function saveAddStock(payload) {
    if (!addStock?.item) return;
    const delta = Number(payload?.quantity_delta || 0);
    if (!Number.isInteger(delta) || delta <= 0) return;

    setIsSaving(true);
    try {
      const item = addStock.item;
      const nextQuantity = Number(item.quantity || 0) + delta;
      const next = await api.put(`/inventory/items/${item.id}`, {
        item_name: item.item_name,
        folder_id: item.folder_id,
        quantity: nextQuantity,
        minimum_quantity: item.minimum_quantity,
        unit: item.unit,
        cost_price: item.cost_price,
        selling_price: item.selling_price,
        attributes: item.attributes || "",
        moa_notes: item.moa_notes || "",
        expiry_date: item.expiry_date || "",
        adjustment_note: `Added ${delta} units`,
      });
      setData(next);
      setAddStock(null);
      toast.success("Stock added.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function importCsv() {
    if (!csvText.trim()) {
      toast.error("Paste CSV content first.");
      return;
    }
    setIsSaving(true);
    try {
      const next = await api.post("/inventory/staging/import-csv", { csv_text: csvText });
      setData(next);
      setCsvText("");
      toast.success("CSV shipment imported to staging.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function releaseStaging(stagingId) {
    setIsSaving(true);
    try {
      const next = await api.post(`/inventory/staging/${stagingId}/release`);
      setData(next);
      toast.success("Staging row released to OCS stock.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Logistics"
        title={isDoctor ? "My Stock" : "OCS Stock"}
        description={isDoctor ? "Editable personal inventory with billing-linked sell flow and expiry safety checks." : "Central master stock with replenishment controls, staging imports, and stocktake tools."}
        actions={
          <button type="button" onClick={() => setEditor({ item: null })} className="inline-flex items-center gap-2 rounded-2xl bg-[#4FB8B3] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#3aa6a1]">
            <Plus className="size-4" />
            Add Item
          </button>
        }
      />

      {isAdmin ? (
        <SectionCard title="Stock Viewer" subtitle="Inspect any doctor's My Stock instantly.">
          <div className="flex flex-wrap items-center gap-3">
            <select value={selectedDoctorId} onChange={(event) => setSelectedDoctorId(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm">
              <option value="">OCS Stock</option>
              {doctorOptions.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>
              ))}
            </select>
            <span className="text-sm text-slate-500">Selected stock items: {stockViewerItemCount}</span>
          </div>
        </SectionCard>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard title="Total Stock Value" value={formatRupees(summary.total_amount_rs || 0)} description="Based on cost price." />
        <SummaryCard title="Monthly Sales" value={formatRupees(summary.total_monthly_sales_rs || 0)} description="Sell actions synced to billing." />
        <SummaryCard title="Monthly Replenishments" value={formatRupees(summary.total_monthly_replenishments_rs || 0)} description="Inbound restock and intake value." />
        <SummaryCard title="Low / Near Expiry" value={`${summary.low_stock_count || 0} / ${summary.near_expiry_count || 0}`} tone="amber" description="Traffic-light alert counters." />
      </div>

      <SectionCard title="View By" subtitle="Filter OCS Stock by folder.">
        <div className="space-y-4">
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

      <SectionCard title={isDoctor ? "My Stock Items" : "OCS Stock Items"} subtitle={`${visibleItems.length} item(s) found`}>
        {visibleItems.length ? (
          <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Item Name</th>
                    <th className="px-4 py-3">Qty</th>
                    <th className="px-4 py-3">Min Qty</th>
                    <th className="px-4 py-3">Cost / Sell</th>
                    <th className="px-4 py-3">Expiry</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => {
                    const isLow = Number(item.quantity || 0) <= Number(item.minimum_quantity || 0);
                    return (
                      <tr key={item.id} className={`border-t border-slate-200/70 ${isLow ? "bg-red-50" : ""}`}>
                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold text-slate-900">{item.item_name}</p>
                          <p className="mt-1 text-xs text-slate-500">Attributes: {item.attributes || "N/A"}</p>
                          <p className="mt-1 text-xs text-slate-500">MOA: {item.moa_notes || "N/A"}</p>
                        </td>
                        <td className="px-4 py-3">{item.quantity}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${isLow ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>
                            {item.minimum_quantity}
                          </span>
                        </td>
                        <td className="px-4 py-3">{formatRupees(item.cost_price)} / {formatRupees(item.selling_price)}</td>
                        <td className="px-4 py-3">{item.expiry_date || "Not set"}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {canManageOcs ? (
                              <button
                                type="button"
                                onClick={() => setAddStock({ item })}
                                className="rounded-xl border border-[#4FB8B3]/40 bg-[#4FB8B3]/10 px-2.5 py-1.5 text-xs font-semibold text-[#4FB8B3]"
                              >
                                Add
                              </button>
                            ) : null}
                            <button type="button" onClick={() => setEditor({ item })} className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700">Edit</button>
                            {isDoctor ? (
                              <>
                                <button type="button" onClick={() => setMovement({ item, type: "add" })} className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700"><Plus className="size-3.5" />Add</button>
                                <button type="button" onClick={() => setMovement({ item, type: "remove" })} className="inline-flex items-center gap-1 rounded-xl border border-amber-200 px-2.5 py-1.5 text-xs font-semibold text-amber-700"><MinusCircle className="size-3.5" />Remove</button>
                                <button type="button" onClick={() => setMovement({ item, type: "sell" })} className="inline-flex items-center gap-1 rounded-xl border border-sky-200 px-2.5 py-1.5 text-xs font-semibold text-sky-700"><ShoppingCart className="size-3.5" />Sell</button>
                              </>
                            ) : canManageOcs ? (
                              <button type="button" onClick={() => setRestock({ item })} className="inline-flex items-center gap-1 rounded-xl bg-[#4FB8B3] px-2.5 py-1.5 text-xs font-semibold text-white"><Truck className="size-3.5" />Restock Doctor</button>
                            ) : null}
                            <button type="button" onClick={() => setItemToDelete(item)} className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700"><Trash2 className="size-3.5" />Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState title="No stock items found" description="Add stock to one of the required folders to begin tracking." />
        )}
      </SectionCard>

      {canManageOcs ? (
        <SectionCard title="Staging Area (CSV Intake)" subtitle="Paste shipment CSV, verify in staging, then release to OCS stock.">
          <div className="space-y-4">
            <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} rows={6} placeholder="folder,item_name,quantity,minimum_quantity,unit,cost_price,selling_price,expiry_date" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm" />
            <button type="button" onClick={importCsv} disabled={isSaving} className="inline-flex items-center gap-2 rounded-2xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              <FileUp className="size-4" />
              {isSaving ? "Importing..." : "Import to staging"}
            </button>
            <div className="space-y-2">
              {(data.staging || []).slice(0, 20).map((row) => (
                <div key={row.id} className="flex flex-wrap items-center justify-between rounded-2xl border border-slate-200 px-4 py-2">
                  <p className="text-sm text-slate-700">
                    #{row.id} {row.item_name} ({row.quantity}) - {row.status}
                  </p>
                  {row.status === "pending" ? (
                    <button type="button" onClick={() => releaseStaging(row.id)} disabled={isSaving} className="rounded-xl border border-cyan-200 px-3 py-1 text-xs font-semibold text-cyan-700">
                      Release
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      ) : null}

      {isAdmin ? (
        <SectionCard title="Admin Compare Tool" subtitle="Compare doctor consumption against patient volume (current month).">
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.2em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Doctor</th>
                  <th className="px-4 py-3 text-left">Patient Volume</th>
                  <th className="px-4 py-3 text-left">Stock Consumption</th>
                </tr>
              </thead>
              <tbody>
                {(data.compare_rows || []).map((row) => (
                  <tr key={row.doctor_id} className="border-t border-slate-200/70">
                    <td className="px-4 py-3">{row.doctor_name}</td>
                    <td className="px-4 py-3">{row.patient_volume}</td>
                    <td className="px-4 py-3">{row.stock_consumption}</td>
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
      <AddStockModal open={Boolean(addStock)} item={addStock?.item} isSaving={isSaving} onClose={() => setAddStock(null)} onSubmit={saveAddStock} />
      <ConfirmDialog open={Boolean(itemToDelete)} onClose={() => setItemToDelete(null)} onConfirm={removeItem} title="Delete stock item?" description={`This will remove ${itemToDelete?.item_name || "this item"} and related movement history.`} confirmLabel="Delete item" />
    </div>
  );
}
