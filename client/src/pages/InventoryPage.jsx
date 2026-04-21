import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  ClipboardList,
  FolderPlus,
  Package,
  Plus,
  Search,
  SquarePen,
  Trash2,
  Warehouse,
} from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { api } from "../lib/api.js";
import { formatRupees } from "../lib/format.js";

const REPORT_TABS = [
  { id: "doctor", label: "By doctor" },
  { id: "month", label: "By month" },
  { id: "items", label: "By items" },
];

function formatTimestamp(value) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function scrollToSection(sectionId) {
  if (typeof document === "undefined") {
    return;
  }

  const element = document.getElementById(sectionId);
  if (!element) {
    return;
  }

  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildFolderTree(folders) {
  const byParent = new Map();

  folders.forEach((folder) => {
    const key = folder.parent_id === null ? "root" : String(folder.parent_id);
    const siblings = byParent.get(key) || [];
    siblings.push(folder);
    byParent.set(key, siblings);
  });

  function build(parentId = null) {
    const key = parentId === null ? "root" : String(parentId);
    return (byParent.get(key) || []).map((folder) => ({
      ...folder,
      children: build(folder.id),
    }));
  }

  return build();
}

function collectFolderIds(folders, folderId) {
  const descendants = [folderId];

  folders
    .filter((folder) => Number(folder.parent_id) === Number(folderId))
    .forEach((folder) => {
      descendants.push(...collectFolderIds(folders, folder.id));
    });

  return descendants;
}

function getFolderPath(folder, folderMap) {
  if (!folder) {
    return "Unassigned";
  }

  const parts = [folder.name];
  let current = folder.parent_id ? folderMap.get(String(folder.parent_id)) : null;

  while (current) {
    parts.unshift(current.name);
    current = current.parent_id ? folderMap.get(String(current.parent_id)) : null;
  }

  return parts.join(" / ");
}

function movementTone(type) {
  if (type === "in") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (type === "out") {
    return "bg-amber-100 text-amber-700";
  }

  return "bg-slate-100 text-slate-700";
}

function movementLabel(type) {
  if (type === "in") {
    return "Stock in";
  }

  if (type === "out") {
    return "Stock out";
  }

  return "Adjustment";
}

function InventoryStatCard({ icon: Icon, label, value, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[28px] border border-[rgba(65,200,198,0.18)] bg-white/88 p-5 text-left shadow-[0_22px_54px_rgba(34,72,91,0.08)] transition hover:-translate-y-0.5 hover:border-[rgba(45,143,152,0.26)] hover:shadow-[0_28px_70px_rgba(34,72,91,0.12)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#2d8f98]">
            {label}
          </p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
          <p className="mt-3 text-sm leading-6 text-[#51717b]">{description}</p>
        </div>
        <div className="rounded-3xl bg-[linear-gradient(145deg,#2d8f98,#41c8c6)] p-4 text-white shadow-[0_18px_36px_rgba(45,143,152,0.2)]">
          <Icon className="size-6" />
        </div>
      </div>
    </button>
  );
}

function FolderModal({ open, folders, onClose, onSubmit, isSaving }) {
  const [form, setForm] = useState({
    name: "",
    parent_id: "",
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm({
      name: "",
      parent_id: "",
    });
  }, [open]);

  function handleSubmit(event) {
    event.preventDefault();

    onSubmit({
      name: form.name,
      parent_id: form.parent_id ? Number(form.parent_id) : null,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add folder"
      description="Create a main folder or a sub-folder so stock can be grouped the way your team works."
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Folder name</span>
          <input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            placeholder="Main Stock, Consumable, IM Drugs..."
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Parent folder</span>
          <select
            value={form.parent_id}
            onChange={(event) =>
              setForm((current) => ({ ...current, parent_id: event.target.value }))
            }
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
          >
            <option value="">No parent folder</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Create folder"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function getItemFormState(item) {
  return {
    item_name: item?.item_name ?? "",
    folder_id: item?.folder_id ? String(item.folder_id) : "",
    quantity: String(item?.quantity ?? 0),
    minimum_quantity: String(item?.minimum_quantity ?? 0),
    unit: item?.unit ?? "",
    cost_price: String(item?.cost_price ?? 0),
    selling_price: String(item?.selling_price ?? 0),
    notes: item?.notes ?? "",
    adjustment_note: "",
  };
}

function InventoryItemModal({ open, item, folders, onClose, onSubmit, isSaving }) {
  const [form, setForm] = useState(getItemFormState(item));

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm(getItemFormState(item));
  }, [item, open]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();

    onSubmit({
      item_name: form.item_name,
      folder_id: form.folder_id ? Number(form.folder_id) : null,
      quantity: Number(form.quantity || 0),
      minimum_quantity: Number(form.minimum_quantity || 0),
      unit: form.unit,
      cost_price: Number(form.cost_price || 0),
      selling_price: Number(form.selling_price || 0),
      notes: form.notes,
      adjustment_note: form.adjustment_note,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? "Edit item" : "Add item"}
      description="Capture item specifications, folder placement, and stock values in one place."
      size="xl"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-[1fr_0.6fr]">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Item name</span>
            <input
              required
              name="item_name"
              value={form.item_name}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Folder</span>
            <select
              name="folder_id"
              value={form.folder_id}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            >
              <option value="">Unassigned</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Quantity</span>
            <input
              required
              min="0"
              type="number"
              name="quantity"
              value={form.quantity}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Minimum qty</span>
            <input
              required
              min="0"
              type="number"
              name="minimum_quantity"
              value={form.minimum_quantity}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Unit</span>
            <input
              required
              name="unit"
              value={form.unit}
              onChange={handleChange}
              placeholder="Boxes, vials, pieces..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Adjustment note</span>
            <input
              name="adjustment_note"
              value={form.adjustment_note}
              onChange={handleChange}
              placeholder="Optional when quantity changes"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Cost price</span>
            <input
              required
              min="0"
              step="0.01"
              type="number"
              name="cost_price"
              value={form.cost_price}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Selling price</span>
            <input
              required
              min="0"
              step="0.01"
              type="number"
              name="selling_price"
              value={form.selling_price}
              onChange={handleChange}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>
        </div>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Notes</span>
          <textarea
            rows="4"
            name="notes"
            value={form.notes}
            onChange={handleChange}
            placeholder="Storage notes, use case, reminders..."
            className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 leading-7 outline-none transition focus:border-sky-400 focus:bg-white"
          />
        </label>

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : item ? "Update item" : "Add item"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StockMovementModal({ open, item, doctors, onClose, onSubmit, isSaving }) {
  const [form, setForm] = useState({
    movement_type: "out",
    quantity: "1",
    doctor_id: "",
    note: "",
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm({
      movement_type: "out",
      quantity: "1",
      doctor_id: "",
      note: "",
    });
  }, [open]);

  function handleSubmit(event) {
    event.preventDefault();

    onSubmit({
      movement_type: form.movement_type,
      quantity: Number(form.quantity || 0),
      doctor_id: form.doctor_id ? Number(form.doctor_id) : null,
      note: form.note,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Stock movement${item ? ` - ${item.item_name}` : ""}`}
      description="Record stock coming in or going out so the inventory history stays accurate."
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Movement type</span>
            <select
              value={form.movement_type}
              onChange={(event) =>
                setForm((current) => ({ ...current, movement_type: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            >
              <option value="out">Stock out</option>
              <option value="in">Stock in</option>
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Quantity</span>
            <input
              required
              min="1"
              type="number"
              value={form.quantity}
              onChange={(event) =>
                setForm((current) => ({ ...current, quantity: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>
        </div>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Doctor</span>
          <select
            value={form.doctor_id}
            onChange={(event) =>
              setForm((current) => ({ ...current, doctor_id: event.target.value }))
            }
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
          >
            <option value="">No linked doctor</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.full_name} - {doctor.specialization}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Note</span>
          <textarea
            rows="4"
            value={form.note}
            onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
            placeholder="Why was this stock moved?"
            className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 leading-7 outline-none transition focus:border-sky-400 focus:bg-white"
          />
        </label>

        <div className="flex justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save movement"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FolderTreeBranch({
  node,
  folderMap,
  itemCountMap,
  selectedFolderId,
  onSelect,
  depth = 0,
}) {
  const itemCount = itemCountMap.get(String(node.id)) || 0;
  const isActive = selectedFolderId === String(node.id);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onSelect(String(node.id))}
        className={`flex w-full items-center justify-between rounded-[22px] px-4 py-3 text-left transition ${
          isActive
            ? "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white shadow-[0_20px_40px_rgba(45,143,152,0.2)]"
            : "border border-slate-200/80 bg-slate-50/70 text-slate-700 hover:border-sky-300 hover:bg-white"
        }`}
        style={{ marginLeft: depth ? depth * 12 : 0 }}
      >
        <div>
          <p className="text-sm font-semibold">{node.name}</p>
          <p className={`mt-1 text-xs uppercase tracking-[0.18em] ${isActive ? "text-white/80" : "text-slate-500"}`}>
            {getFolderPath(node, folderMap)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isActive ? "bg-white/15 text-white" : "bg-white text-slate-600"}`}>
          {itemCount} items
        </span>
      </button>

      {node.children?.length ? (
        <div className="space-y-3">
          {node.children.map((child) => (
            <FolderTreeBranch
              key={child.id}
              depth={depth + 1}
              folderMap={folderMap}
              itemCountMap={itemCountMap}
              node={child}
              onSelect={onSelect}
              selectedFolderId={selectedFolderId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function InventoryPage() {
  const [inventoryData, setInventoryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("all");
  const [reportTab, setReportTab] = useState("doctor");
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [itemEditor, setItemEditor] = useState(null);
  const [movementItem, setMovementItem] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);

  async function loadInventory() {
    setLoading(true);

    try {
      const data = await api.get("/inventory");
      setInventoryData(data);
    } catch (error) {
      toast.error(error.message || "Failed to load inventory");
      setInventoryData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInventory();
  }, []);

  const folders = inventoryData?.folders || [];
  const items = inventoryData?.items || [];
  const movements = inventoryData?.movements || [];
  const doctors = inventoryData?.doctors || [];
  const summary = inventoryData?.summary || {
    total_items: 0,
    low_stock_count: 0,
    total_amount_rs: 0,
    recent_movements: 0,
  };
  const reports = inventoryData?.reports || {
    byDoctor: [],
    byMonth: [],
    byItems: [],
  };

  const folderMap = useMemo(
    () => new Map(folders.map((folder) => [String(folder.id), folder])),
    [folders],
  );
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const itemCountMap = useMemo(() => {
    const counts = new Map();
    items.forEach((item) => {
      const key = item.folder_id ? String(item.folder_id) : "unassigned";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [items]);
  const selectedFolder = selectedFolderId === "all" ? null : folderMap.get(String(selectedFolderId));
  const selectedFolderSet = useMemo(() => {
    if (selectedFolderId === "all") {
      return null;
    }

    return new Set(collectFolderIds(folders, Number(selectedFolderId)).map(String));
  }, [folders, selectedFolderId]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return items.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        item.item_name.toLowerCase().includes(normalizedSearch) ||
        String(item.notes || "").toLowerCase().includes(normalizedSearch) ||
        String(item.folder_name || "").toLowerCase().includes(normalizedSearch);

      const matchesFolder =
        !selectedFolderSet ||
        (item.folder_id && selectedFolderSet.has(String(item.folder_id)));

      return matchesSearch && matchesFolder;
    });
  }, [items, search, selectedFolderSet]);

  const itemReportMap = useMemo(
    () => new Map(reports.byItems.map((item) => [String(item.item_id), item])),
    [reports.byItems],
  );

  async function handleCreateFolder(payload) {
    setIsSaving(true);

    try {
      const data = await api.post("/inventory/folders", payload);
      setInventoryData(data);
      setFolderModalOpen(false);
      toast.success("Folder created.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveItem(payload) {
    setIsSaving(true);

    try {
      const data =
        itemEditor?.mode === "edit"
          ? await api.put(`/inventory/${itemEditor.item.id}`, payload)
          : await api.post("/inventory", payload);

      setInventoryData(data);
      setItemEditor(null);
      toast.success(itemEditor?.mode === "edit" ? "Item updated." : "Item added.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveMovement(payload) {
    if (!movementItem) {
      return;
    }

    setIsSaving(true);

    try {
      const data = await api.post(`/inventory/${movementItem.id}/movements`, payload);
      setInventoryData(data);
      setMovementItem(null);
      toast.success("Stock movement recorded.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!itemToDelete) {
      return;
    }

    try {
      await api.delete(`/inventory/${itemToDelete.id}`);
      toast.success("Item deleted.");
      setItemToDelete(null);
      await loadInventory();
    } catch (error) {
      toast.error(error.message);
    }
  }

  if (loading) {
    return <LoadingState label="Loading inventory" />;
  }

  if (!inventoryData) {
    return (
      <EmptyState
        title="Inventory unavailable"
        description="The inventory workspace could not be loaded right now. Please refresh and try again."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Logistics"
        title="Inventory"
        description="Organize stock by folder, capture item specifications, record stock in and out, and generate quick operational reports."
        actions={
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onClick={() => setFolderModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
            >
              <FolderPlus className="size-4" />
              Add folder
            </button>
            <button
              type="button"
              onClick={() => setItemEditor({ mode: "create", item: null })}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-700"
            >
              <Plus className="size-4" />
              Add item
            </button>
          </div>
        }
      />

      {summary.low_stock_count ? (
        <div className="rounded-[28px] border border-amber-200 bg-amber-50/80 px-5 py-4 text-sm text-amber-800">
          {summary.low_stock_count} item{summary.low_stock_count === 1 ? "" : "s"} currently sit at or below the minimum quantity.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InventoryStatCard
          icon={Warehouse}
          label="Inventory Folder"
          value={String(folders.length)}
          description="Browse the main folders and sub-folders that structure stock."
          onClick={() => scrollToSection("inventory-folders")}
        />
        <InventoryStatCard
          icon={Package}
          label="Total Amount Rs"
          value={formatRupees(summary.total_amount_rs)}
          description="Current total stock value based on cost price."
          onClick={() => scrollToSection("inventory-items")}
        />
        <InventoryStatCard
          icon={ArrowRightLeft}
          label="Inventory History"
          value={String(summary.recent_movements)}
          description="Review recent in and out movements recorded by the team."
          onClick={() => scrollToSection("inventory-history")}
        />
        <InventoryStatCard
          icon={ClipboardList}
          label="Report"
          value={String(reports.byItems.length)}
          description="Open report views by doctor, by month, and by items."
          onClick={() => scrollToSection("inventory-report")}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <div id="inventory-folders">
          <SectionCard
            title="Inventory folder"
            subtitle="Keep stock grouped into main folders and sub-folders."
            actions={
              <button
                type="button"
                onClick={() => setFolderModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
              >
                <FolderPlus className="size-4" />
                Add sub-folder
              </button>
            }
          >
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setSelectedFolderId("all")}
                className={`flex w-full items-center justify-between rounded-[22px] px-4 py-3 text-left transition ${
                  selectedFolderId === "all"
                    ? "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white shadow-[0_20px_40px_rgba(45,143,152,0.2)]"
                    : "border border-slate-200/80 bg-slate-50/70 text-slate-700 hover:border-sky-300 hover:bg-white"
                }`}
              >
                <div>
                  <p className="text-sm font-semibold">All folders</p>
                  <p className={`mt-1 text-xs uppercase tracking-[0.18em] ${selectedFolderId === "all" ? "text-white/80" : "text-slate-500"}`}>
                    Complete inventory workspace
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedFolderId === "all" ? "bg-white/15 text-white" : "bg-white text-slate-600"}`}>
                  {items.length} items
                </span>
              </button>

              {folderTree.length ? (
                <div className="space-y-3">
                  {folderTree.map((node) => (
                    <FolderTreeBranch
                      key={node.id}
                      folderMap={folderMap}
                      itemCountMap={itemCountMap}
                      node={node}
                      onSelect={setSelectedFolderId}
                      selectedFolderId={selectedFolderId}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No folders yet"
                  description="Create your first folder to organize stock into a clear structure."
                />
              )}
            </div>
          </SectionCard>
        </div>

        <div id="inventory-items">
          <SectionCard
            title={selectedFolder ? selectedFolder.name : "All items"}
            subtitle={
              selectedFolder
                ? `${getFolderPath(selectedFolder, folderMap)} - ${filteredItems.length} item(s)`
                : `${filteredItems.length} item(s) across the full inventory`
            }
          >
            <div className="space-y-5">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by item name, note, or folder"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                />
              </label>

              {filteredItems.length ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {filteredItems.map((item) => {
                    const folder = item.folder_id ? folderMap.get(String(item.folder_id)) : null;
                    const reportRow = itemReportMap.get(String(item.id));
                    const isLowStock = Number(item.quantity || 0) <= Number(item.minimum_quantity || 0);

                    return (
                      <article
                        key={item.id}
                        className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_18px_44px_rgba(34,72,91,0.06)]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-lg font-semibold text-slate-950">{item.item_name}</p>
                            <p className="mt-1 text-sm text-slate-500">
                              {getFolderPath(folder, folderMap)}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                              isLowStock
                                ? "bg-amber-100 text-amber-700"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {isLowStock ? "Low stock" : "In stock"}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Qty
                            </p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">
                              {item.quantity} {item.unit}
                            </p>
                          </div>
                          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Minimum qty
                            </p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">
                              {item.minimum_quantity} {item.unit}
                            </p>
                          </div>
                          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Cost price
                            </p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">
                              {formatRupees(item.cost_price)}
                            </p>
                          </div>
                          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Selling price
                            </p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">
                              {formatRupees(item.selling_price)}
                            </p>
                          </div>
                          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Total amount Rs
                            </p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">
                              {formatRupees(item.current_cost_value)}
                            </p>
                          </div>
                          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              History
                            </p>
                            <p className="mt-2 text-sm font-semibold text-slate-900">
                              {reportRow ? `${reportRow.movement_count} movement(s)` : "No movements"}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Notes
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">
                            {item.notes || "No notes recorded for this item."}
                          </p>
                        </div>

                        <div className="mt-5 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setItemEditor({ mode: "edit", item })}
                            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                          >
                            <SquarePen className="size-4" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setMovementItem(item)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                          >
                            <ArrowRightLeft className="size-4" />
                            In / Out
                          </button>
                          <button
                            type="button"
                            onClick={() => setItemToDelete(item)}
                            className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="No items found"
                  description="Add items to this folder, or widen the search to see more of the inventory."
                  action={
                    <button
                      type="button"
                      onClick={() => setItemEditor({ mode: "create", item: null })}
                      className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700"
                    >
                      <Plus className="size-4" />
                      Add item
                    </button>
                  }
                />
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      <div id="inventory-history">
        <SectionCard
          title="Inventory history (In & Out)"
          subtitle="Track who moved stock, what changed, and when it happened."
        >
          {movements.length ? (
            <div className="space-y-3">
              {movements.map((movement) => (
                <div
                  key={movement.id}
                  className="rounded-[26px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_36px_rgba(34,72,91,0.05)]"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-lg font-semibold text-slate-950">{movement.item_name}</p>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${movementTone(movement.movement_type)}`}>
                          {movementLabel(movement.movement_type)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        {movement.folder_name || "Unassigned"} - {movement.quantity} {movement.unit}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Quantity changed from {movement.previous_quantity} to {movement.next_quantity}
                      </p>
                    </div>
                    <div className="text-sm text-slate-500 lg:text-right">
                      <p>{formatTimestamp(movement.created_at)}</p>
                      <p className="mt-1">
                        Recorded by {movement.recorded_by_name || "OCS team"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Doctor
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {movement.doctor_name || "No doctor linked"}
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Note
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {movement.note || "No note recorded"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No stock movements yet"
              description="As soon as items are stocked in or out, the movement history will appear here."
            />
          )}
        </SectionCard>
      </div>

      <div id="inventory-report">
        <SectionCard
          title="Report"
          subtitle="Generate quick operational views by doctor, by month, and by items."
          actions={
            <div className="flex flex-wrap gap-2">
              {REPORT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setReportTab(tab.id)}
                  className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                    reportTab === tab.id
                      ? "bg-sky-600 text-white shadow-lg shadow-sky-600/20"
                      : "border border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          }
        >
          {reportTab === "doctor" ? (
            reports.byDoctor.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {reports.byDoctor.map((row) => (
                  <div
                    key={row.doctor_id}
                    className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_36px_rgba(34,72,91,0.05)]"
                  >
                    <p className="text-lg font-semibold text-slate-950">{row.doctor_name}</p>
                    <div className="mt-4 grid gap-3">
                      <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Total out
                        </p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {row.total_out_quantity}
                        </p>
                      </div>
                      <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Items used
                        </p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {row.item_count}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No doctor report yet"
                description="Doctor usage appears here once stock-out movements are linked to a doctor."
              />
            )
          ) : null}

          {reportTab === "month" ? (
            reports.byMonth.length ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {reports.byMonth.map((row) => (
                  <div
                    key={row.month_label}
                    className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_36px_rgba(34,72,91,0.05)]"
                  >
                    <p className="text-lg font-semibold text-slate-950">{row.month_label}</p>
                    <div className="mt-4 grid gap-3">
                      <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Stock in
                        </p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {row.in_quantity}
                        </p>
                      </div>
                      <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Stock out
                        </p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {row.out_quantity}
                        </p>
                      </div>
                      <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Movements
                        </p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {row.movement_count}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No monthly report yet"
                description="Monthly movement totals will appear here once stock begins moving."
              />
            )
          ) : null}

          {reportTab === "items" ? (
            reports.byItems.length ? (
              <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                      <tr>
                        <th className="px-5 py-4">Item</th>
                        <th className="px-5 py-4">Folder</th>
                        <th className="px-5 py-4">Current qty</th>
                        <th className="px-5 py-4">Total in</th>
                        <th className="px-5 py-4">Total out</th>
                        <th className="px-5 py-4">Movements</th>
                        <th className="px-5 py-4">Total amount Rs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.byItems.map((row) => (
                        <tr key={row.item_id} className="border-t border-slate-200/70">
                          <td className="px-5 py-4 font-semibold text-slate-950">{row.item_name}</td>
                          <td className="px-5 py-4 text-sm text-slate-600">{row.folder_name}</td>
                          <td className="px-5 py-4 text-sm text-slate-600">
                            {row.quantity} {row.unit}
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-600">{row.total_in}</td>
                          <td className="px-5 py-4 text-sm text-slate-600">{row.total_out}</td>
                          <td className="px-5 py-4 text-sm text-slate-600">{row.movement_count}</td>
                          <td className="px-5 py-4 text-sm font-semibold text-slate-900">
                            {formatRupees(row.current_cost_value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No item report yet"
                description="Item-level stock reporting will appear here as inventory is created and moved."
              />
            )
          ) : null}
        </SectionCard>
      </div>

      <FolderModal
        open={folderModalOpen}
        folders={folders}
        isSaving={isSaving}
        onClose={() => setFolderModalOpen(false)}
        onSubmit={handleCreateFolder}
      />

      <InventoryItemModal
        open={Boolean(itemEditor)}
        item={itemEditor?.item}
        folders={folders}
        isSaving={isSaving}
        onClose={() => setItemEditor(null)}
        onSubmit={handleSaveItem}
      />

      <StockMovementModal
        doctors={doctors}
        item={movementItem}
        isSaving={isSaving}
        open={Boolean(movementItem)}
        onClose={() => setMovementItem(null)}
        onSubmit={handleSaveMovement}
      />

      <ConfirmDialog
        confirmLabel="Delete item"
        description={`This will permanently remove ${itemToDelete?.item_name || "this item"} and its movement history.`}
        onClose={() => setItemToDelete(null)}
        onConfirm={handleDelete}
        open={Boolean(itemToDelete)}
        title="Delete inventory item?"
      />
    </div>
  );
}
