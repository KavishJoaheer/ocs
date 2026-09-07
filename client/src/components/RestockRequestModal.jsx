import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Modal from "./Modal.jsx";
import { getValidCollectionDays } from "../lib/collectionDays.js";
import { setUnsavedWork } from "../lib/unsavedWork.js";

function catalogAvailable(item) {
  return Number(item?.available_to_use ?? item?.available_to_promise ?? item?.quantity ?? 0);
}

function snapshotDraft({ items, note, collectionDate }) {
  return JSON.stringify({
    items: (items || []).map((row) => ({
      inventory_id: row.inventory_id || null,
      item_name: row.item_name,
      quantity: Number(row.quantity || 0),
    })),
    note: String(note || ""),
    collectionDate: String(collectionDate || ""),
  });
}

export default function RestockRequestModal({
  open,
  onClose,
  onSubmit,
  catalogItems,
  isSaving,
  editingRequest = null,
  mode = null,
  initialItems = [],
  activeRequests = [],
}) {
  const resolvedMode =
    mode || (editingRequest?.id ? "edit" : "create");
  const isEditing = resolvedMode === "edit";
  const isAmending = resolvedMode === "amend";
  const [items, setItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [collectionDate, setCollectionDate] = useState("");
  const [note, setNote] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [baseline, setBaseline] = useState("");

  const collectionOptions = useMemo(() => {
    const days = getValidCollectionDays(4);
    const existingDate = String(editingRequest?.collection_date || "");
    if (open && existingDate && !days.some((option) => option.iso === existingDate)) {
      const existing = new Date(`${existingDate}T00:00:00`);
      return [
        {
          formatted: Number.isNaN(existing.getTime())
            ? existingDate
            : existing.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
          iso: existingDate,
          weekday: Number.isNaN(existing.getTime()) ? null : existing.getDay(),
        },
        ...days,
      ];
    }
    return days;
  }, [open, editingRequest]);

  const [syncedDeps, setSyncedDeps] = useState({ open, editingRequest, collectionOptions, initialItems });

  if (
    syncedDeps.open !== open ||
    syncedDeps.editingRequest !== editingRequest ||
    syncedDeps.collectionOptions !== collectionOptions ||
    syncedDeps.initialItems !== initialItems
  ) {
    setSyncedDeps({ open, editingRequest, collectionOptions, initialItems });

    if (open) {
      setSearchQuery("");
      setSuggestionsOpen(false);
      setDiscardOpen(false);

      if (editingRequest) {
        const nextItems = (editingRequest.items || []).map((row) => ({
          inventory_id: row.inventory_id ? Number(row.inventory_id) : null,
          item_name: row.item_name,
          quantity: Number(row.quantity || 1),
          ocs_available: Number(row.available_to_use ?? row.inventory_quantity ?? row.ocs_available ?? 0),
        }));
        const nextNote = String(editingRequest.note || "");
        const existingDate = String(editingRequest.collection_date || "");
        const nextDate = existingDate || collectionOptions[0]?.iso || "";
        setItems(nextItems);
        setNote(nextNote);
        setCollectionDate(nextDate);
        setBaseline(snapshotDraft({ items: nextItems, note: nextNote, collectionDate: nextDate }));
      } else {
        const seeded = (Array.isArray(initialItems) ? initialItems : []).map((row) => ({
          inventory_id: Number(row.inventory_id || row.id) || null,
          item_name: row.item_name,
          quantity: Number(row.quantity || 1),
          ocs_available: catalogAvailable(row),
        }));
        const nextDate = collectionOptions[0]?.iso || "";
        setItems(seeded);
        setNote("");
        setCollectionDate(nextDate);
        setBaseline(snapshotDraft({ items: [], note: "", collectionDate: nextDate }));
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

  const isDirty = open && snapshotDraft({ items, note, collectionDate }) !== baseline;
  const draftHasContent =
    items.length > 0 || String(note || "").trim().length > 0 || Boolean(collectionDate && collectionDate !== (collectionOptions[0]?.iso || ""));

  useEffect(() => {
    setUnsavedWork("supply-request-draft", Boolean(open && isDirty && draftHasContent));
    return () => setUnsavedWork("supply-request-draft", false);
  }, [open, isDirty, draftHasContent]);

  function requestClose() {
    if (isDirty && draftHasContent) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }

  function addItem(catalogItem) {
    setItems((prev) => [
      ...prev,
      {
        inventory_id: Number(catalogItem.id) || null,
        item_name: catalogItem.item_name,
        quantity: 1,
        ocs_available: catalogAvailable(catalogItem),
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

  function matchingActiveRequests(row) {
    return (activeRequests || []).filter((request) => {
      const status = String(request.status || "").toLowerCase();
      if (!["pending", "accepted", "ready"].includes(status)) return false;
      return (request.items || []).some(
        (item) =>
          (row.inventory_id && Number(item.inventory_id) === Number(row.inventory_id)) ||
          String(item.item_name || "").toLowerCase() === String(row.item_name || "").toLowerCase(),
      );
    });
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
    <>
    <Modal
      open={open}
      onClose={requestClose}
      title={
        isAmending
          ? "Request Changes"
          : isEditing
            ? "Edit Supply Request"
            : "Request Supply from OCS"
      }
      description={
        isAmending
          ? "Propose updates for operator review. The accepted request stays unchanged until they accept your changes."
          : isEditing
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
              {filteredCatalog.map((catalogItem) => {
                const available = catalogAvailable(catalogItem);
                return (
                <button
                  key={catalogItem.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    addItem(catalogItem);
                  }}
                  className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-slate-50"
                >
                  <span className="min-w-0 break-words font-semibold text-slate-800">{catalogItem.item_name}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {available} available now
                  </span>
                </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
              No items added yet. Search above to start your request.
            </div>
          ) : (
            items.map((row, idx) => {
              const available = Number.isFinite(Number(row.ocs_available)) ? Number(row.ocs_available) : null;
              const shortage = available != null && Number(row.quantity || 0) > available;
              const duplicates = matchingActiveRequests(row);
              return (
              <div
                key={`${row.inventory_id || row.item_name}-${idx}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-slate-900">{row.item_name}</p>
                  {available != null ? (
                    <p className="text-[11px] text-slate-500">
                      {available} available now
                    </p>
                  ) : null}
                  {shortage ? (
                    <p className="text-[11px] font-semibold text-amber-800">
                      Full fulfilment is not currently available.
                    </p>
                  ) : null}
                  {duplicates.length ? (
                    <p className="text-[11px] font-semibold text-amber-800">
                      Already on request #{duplicates.map((request) => request.id).join(", #")} ({duplicates[0].status}).
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Decrease ${row.item_name}`}
                    onClick={() => changeQuantity(idx, -1)}
                    disabled={row.quantity <= 1}
                    className="inline-flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 disabled:opacity-40"
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
                    className="inline-flex size-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"
                  >
                    <Plus className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${row.item_name}`}
                    onClick={() => removeItem(idx)}
                    className="inline-flex size-11 items-center justify-center rounded-xl text-rose-500 transition hover:bg-rose-50"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
              );
            })
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

        <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 bg-white pt-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={requestClose}
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
            {isSaving
              ? "Saving…"
              : isAmending
                ? "Submit change request"
                : isEditing
                  ? "Save changes"
                  : "Submit request"}
          </button>
        </div>
      </div>
    </Modal>
    <ConfirmDialog
      open={discardOpen}
      onClose={() => setDiscardOpen(false)}
      title="Discard this request draft?"
      description="You have selected items or changed details. Closing now will discard this draft."
      cancelLabel="Continue editing"
      confirmLabel="Discard draft"
      onConfirm={() => {
        setDiscardOpen(false);
        onClose();
      }}
    />
    </>
  );
}
