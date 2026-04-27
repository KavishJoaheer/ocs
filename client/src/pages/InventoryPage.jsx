import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, MinusCircle, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
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
  const toneClass = tone === "amber" ? "text-amber-700" : "text-[#2d8f98]";
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
    if (open) {
      setForm(itemFormState(item));
    }
  }, [item, open]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? "Edit stock item" : "Add stock item"}
      description="Save item identity, quantity thresholds, pricing, and expiry reminders."
      size="xl"
    >
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
            <input required name="item_name" value={form.item_name} onChange={handleChange} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Folder</span>
            <select required name="folder_id" value={form.folder_id} onChange={handleChange} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white">
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
            <input name="attributes" value={form.attributes} onChange={handleChange} placeholder="Size, color, concentration..." className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Expiry Date</span>
            <input type="date" name="expiry_date" value={form.expiry_date} onChange={handleChange} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
          </label>
        </div>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">MOA Notes</span>
          <textarea rows="3" name="moa_notes" value={form.moa_notes} onChange={handleChange} className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
        </label>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Current Quantity</span>
            <input required min="0" type="number" name="quantity" value={form.quantity} onChange={handleChange} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Minimum Quantity</span>
            <input required min="0" type="number" name="minimum_quantity" value={form.minimum_quantity} onChange={handleChange} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Unit</span>
            <input required name="unit" value={form.unit} onChange={handleChange} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Cost Price (Rs)</span>
            <input required min="0" step="0.01" type="number" name="cost_price" value={form.cost_price} onChange={handleChange} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">Selling Price (Rs)</span>
            <input required min="0" step="0.01" type="number" name="selling_price" value={form.selling_price} onChange={handleChange} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
          </label>
        </div>

        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Adjustment Note</span>
          <input name="adjustment_note" value={form.adjustment_note} onChange={handleChange} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="submit" disabled={isSaving} className="rounded-2xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{isSaving ? "Saving..." : item ? "Update Item" : "Add Item"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ActionModal({ open, item, type, isSaving, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setQuantity("1");
      setNote("");
    }
  }, [open]);

  const isAdd = type === "add";
  const isSell = type === "sell";
  const title = isAdd ? "Add Stock" : isSell ? "Sell Item" : "Remove Stock";

  return (
    <Modal open={open} onClose={onClose} title={`${title}${item ? ` - ${item.item_name}` : ""}`} description="Record stock movement for accurate quantity and consumption tracking.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            movement_type: isAdd ? "in" : "out",
            action_type: type,
            quantity: Number(quantity || 0),
            note,
          });
        }}
      >
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Quantity</span>
          <input required min="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-semibold text-slate-700">Note</span>
          <textarea rows="3" value={note} onChange={(event) => setNote(event.target.value)} className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white" />
        </label>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="submit" disabled={isSaving} className="rounded-2xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{isSaving ? "Saving..." : title}</button>
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
  const [selectedView, setSelectedView] = useState("all");
  const [editor, setEditor] = useState(null);
  const [movement, setMovement] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const payload = await api.get("/inventory");
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
  }, []);

  if (loading) return <LoadingState label="Loading My Stock" />;
  if (!data) return <EmptyState title="My Stock unavailable" description="Unable to load stock data right now." />;

  const folders = data.folders || [];
  const items = data.items || [];
  const lowStockItems = data.low_stock_items || [];
  const summary = data.summary || { total_amount_rs: 0, total_amount_consumed_rs: 0, low_stock_count: 0 };

  const visibleItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const pool = selectedView === "low-stock" ? lowStockItems : selectedView === "all" ? items : items.filter((item) => String(item.folder_id) === String(selectedView));
    return pool.filter((item) => !normalizedSearch || item.item_name.toLowerCase().includes(normalizedSearch));
  }, [items, lowStockItems, search, selectedView]);

  async function saveItem(payload) {
    setIsSaving(true);
    try {
      const next = editor?.item ? await api.put(`/inventory/${editor.item.id}`, payload) : await api.post("/inventory", payload);
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
      const next = await api.post(`/inventory/${movement.item.id}/movements`, payload);
      setData(next);
      setMovement(null);
      toast.success("Stock action saved.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function removeItem() {
    if (!itemToDelete) return;
    try {
      await api.delete(`/inventory/${itemToDelete.id}`);
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
        title="My Stock"
        description={user.role === "doctor" ? "Track your stock value, monthly consumption, and low-stock alerts in one workspace." : "This workspace is doctor-specific."}
        actions={
          <button type="button" onClick={() => setEditor({ item: null })} className="inline-flex items-center gap-2 rounded-2xl bg-[#2d8f98] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#26717c]">
            <Plus className="size-4" />
            Add Item
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="Total Amount" value={formatRupees(summary.total_amount_rs)} description="Current stock value based on cost price." />
        <SummaryCard title="Total Amount Consumed" value={formatRupees(summary.total_amount_consumed_rs)} description="Current month value used/sold from stock." />
        <SummaryCard title="Low Stock" value={String(summary.low_stock_count || 0)} tone="amber" description="Items at or below their minimum quantity." />
      </div>

      <SectionCard title="Folders and Search" subtitle="Browse mandatory stock folders, search items, and open low-stock reorder alerts.">
        <div className="space-y-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by item name" className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedView("all")} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${selectedView === "all" ? "bg-[#2d8f98] text-white" : "border border-slate-200 bg-white text-slate-700"}`}>All</button>
            <button type="button" onClick={() => setSelectedView("low-stock")} className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-semibold ${selectedView === "low-stock" ? "bg-amber-500 text-white" : "border border-amber-200 bg-amber-50 text-amber-800"}`}>
              <AlertTriangle className="size-4" />
              Low Stock Dashboard
            </button>
            {folders.map((folder) => (
              <button key={folder.id} type="button" onClick={() => setSelectedView(String(folder.id))} className={`rounded-2xl px-4 py-2 text-sm font-semibold ${selectedView === String(folder.id) ? "bg-[#2d8f98] text-white" : "border border-slate-200 bg-white text-slate-700"}`}>
                {folder.name}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Stock Items" subtitle={`${visibleItems.length} item(s) found`}>
        {visibleItems.length ? (
          <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Folder</th>
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
                      <tr key={item.id} className="border-t border-slate-200/70">
                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold text-slate-900">{item.item_name}</p>
                          <p className="mt-1 text-xs text-slate-500">Attributes: {item.attributes || "N/A"}</p>
                          <p className="mt-1 text-xs text-slate-500">MOA: {item.moa_notes || "N/A"}</p>
                        </td>
                        <td className="px-4 py-3">{item.folder_name}</td>
                        <td className="px-4 py-3">{item.quantity} {item.unit}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${isLow ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>
                            {item.minimum_quantity}
                          </span>
                        </td>
                        <td className="px-4 py-3">{formatRupees(item.cost_price)} / {formatRupees(item.selling_price)}</td>
                        <td className="px-4 py-3">{item.expiry_date || "Not set"}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => setEditor({ item })} className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700">Edit</button>
                            <button type="button" onClick={() => setMovement({ item, type: "add" })} className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700"><Plus className="size-3.5" />Add</button>
                            <button type="button" onClick={() => setMovement({ item, type: "remove" })} className="inline-flex items-center gap-1 rounded-xl border border-amber-200 px-2.5 py-1.5 text-xs font-semibold text-amber-700"><MinusCircle className="size-3.5" />Remove</button>
                            <button type="button" onClick={() => setMovement({ item, type: "sell" })} className="inline-flex items-center gap-1 rounded-xl border border-sky-200 px-2.5 py-1.5 text-xs font-semibold text-sky-700"><ShoppingCart className="size-3.5" />Sell</button>
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
          <EmptyState title="No stock items found" description="Add a stock item to one of the required folders to begin tracking." />
        )}
      </SectionCard>

      <ItemModal open={Boolean(editor)} item={editor?.item} folders={folders} isSaving={isSaving} onClose={() => setEditor(null)} onSubmit={saveItem} />
      <ActionModal open={Boolean(movement)} item={movement?.item} type={movement?.type} isSaving={isSaving} onClose={() => setMovement(null)} onSubmit={saveMovement} />
      <ConfirmDialog open={Boolean(itemToDelete)} onClose={() => setItemToDelete(null)} onConfirm={removeItem} title="Delete stock item?" description={`This will remove ${itemToDelete?.item_name || "this item"} and related movement history.`} confirmLabel="Delete item" />
    </div>
  );
}
