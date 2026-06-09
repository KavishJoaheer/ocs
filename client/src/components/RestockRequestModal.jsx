import { useMemo, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import { getValidCollectionDays } from "../lib/collectionDays.js";

export default function RestockRequestModal({
  open,
  onClose,
  onSubmit,
  catalogItems,
  isSaving,
  editingRequest = null,
}) {
  const isEditing = Boolean(editingRequest?.id);
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [collectionDate, setCollectionDate] = useState("");
  const [note, setNote] = useState("");

  const collectionOptions = useMemo(() => getValidCollectionDays(4), [open]);

  const [syncedDeps, setSyncedDeps] = useState({ open, editingRequest, collectionOptions });

  if (
    syncedDeps.open !== open ||
    syncedDeps.editingRequest !== editingRequest ||
    syncedDeps.collectionOptions !== collectionOptions
  ) {
    setSyncedDeps({ open, editingRequest, collectionOptions });

    if (open) {
      setSearchQuery("");
      setSuggestionsOpen(false);

      if (editingRequest) {
        setItems(
          (editingRequest.items || []).map((row) => ({
            inventory_id: row.inventory_id ? Number(row.inventory_id) : null,
            item_name: row.item_name,
            quantity: Number(row.quantity || 1),
            ocs_available: row.inventory_quantity ?? null,
          })),
        );
        setNote(String(editingRequest.note || ""));
        const existingDate = String(editingRequest.collection_date || "");
        const stillValid = collectionOptions.some((option) => option.iso === existingDate);
        setCollectionDate(stillValid ? existingDate : collectionOptions[0]?.iso || "");
      } else {
        setItems([]);
        setNote("");
        setCollectionDate(collectionOptions[0]?.iso || "");
      }
    }
  }

  const selectedKeys = useMemo(
    () =>
      new Set(
        items.map((row) =>
          row.inventory_id ? `inv:${row.inventory_id}` : `name:${row.item_name.toLowerCase()}`,
        ),
      ),
    [items],
  );

  const filteredCatalog = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (catalogItems || [])
      .filter((item) => {
        const name = String(item.item_name || "").toLowerCase();
        if (!name) return false;
        if (query && !name.includes(query)) return false;
        const key = `inv:${item.id}`;
        return !selectedKeys.has(key);
      })
      .slice(0, 8);
  }, [catalogItems, searchQuery, selectedKeys]);

  function addItem(catalogItem) {
    setItems((prev) => [
      ...prev,
      {
        inventory_id: Number(catalogItem.id) || null,
        item_name: catalogItem.item_name,
        quantity: 1,
        ocs_available: Number(catalogItem.quantity || 0),
      },
    ]);
    setSearchQuery("");
    setSuggestionsOpen(false);
  }

  function changeQuantity(idx, delta) {
    setItems((prev) =>
      prev.map((row, i) =>
        i === idx
          ? { ...row, quantity: Math.max(1, Math.min(999, Number(row.quantity || 0) + delta)) }
          : row,
      ),
    );
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    if (!items.length) {
      toast.error("Add at least one item to your supply request.");
      return;
    }
    if (!collectionDate) {
      toast.error("Pick a target collection day.");
      return;
    }
    onSubmit({
      collection_date: collectionDate,
      note: note.trim(),
      items: items.map((row) => ({
        inventory_id: row.inventory_id,
        item_name: row.item_name,
        quantity: Number(row.quantity || 0),
      })),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit Supply Request" : "Request Supply from OCS"}
      description={
        isEditing
          ? "Update items or collection day while your request is still pending."
          : "Choose stock items and a target collection day. Operators will prepare your pack."
      }
      size="md"
    >
      <div className="flex flex-col gap-4">
        <div className="relative">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Add item
          </label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={() => setTimeout(() => setSuggestionsOpen(false), 120)}
              placeholder="Search OCS stock by name"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#4FB8B3]"
            />
          </div>
          {suggestionsOpen && filteredCatalog.length ? (
            <div className="absolute z-20 mt-1 max-h-[220px] w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-lg">
              {filteredCatalog.map((catalogItem) => (
                <button
                  key={catalogItem.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    addItem(catalogItem);
                  }}
                  className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-slate-50"
                >
                  <span className="font-semibold text-slate-800">{catalogItem.item_name}</span>
                  <span className="text-xs text-slate-500">
                    {Number(catalogItem.quantity || 0)} in OCS
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
              No items added yet. Search above to start your request.
            </div>
          ) : (
            items.map((row, idx) => (
              <div
                key={`${row.inventory_id || row.item_name}-${idx}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{row.item_name}</p>
                  {Number.isFinite(row.ocs_available) ? (
                    <p className="text-[11px] text-slate-500">
                      {row.ocs_available} available in OCS
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Decrease ${row.item_name}`}
                    onClick={() => changeQuantity(idx, -1)}
                    disabled={row.quantity <= 1}
                    className="inline-flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-40"
                  >
                    <Minus className="size-4" />
                  </button>
                  <span className="min-w-8 text-center text-base font-bold tabular-nums text-slate-900">
                    {row.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase ${row.item_name}`}
                    onClick={() => changeQuantity(idx, +1)}
                    className="inline-flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"
                  >
                    <Plus className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${row.item_name}`}
                    onClick={() => removeItem(idx)}
                    className="inline-flex size-9 items-center justify-center rounded-xl text-rose-500 transition hover:bg-rose-50"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Target collection day
          </label>
          <select
            value={collectionDate}
            onChange={(event) => setCollectionDate(event.target.value)}
            className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 focus:border-[#4FB8B3] focus:outline-none"
          >
            {collectionOptions.map((option) => (
              <option key={option.iso} value={option.iso}>
                {option.formatted}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 500))}
            rows={2}
            placeholder="Anything operators should know? (e.g. priority items, packaging)"
            className="mt-1 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:border-[#4FB8B3] focus:outline-none"
          />
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-[11px] font-medium leading-normal text-gray-500">
          Restock requests can be submitted at any time, but logistics packing preparations are
          completed solely for collection on{" "}
          <strong>Mondays, Wednesdays, Fridays, and Saturdays</strong>.
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || items.length === 0}
            className="min-h-11 rounded-2xl bg-[#ba5a32] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#9d4a28] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? "Saving…" : isEditing ? "Save changes" : "Submit request"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
