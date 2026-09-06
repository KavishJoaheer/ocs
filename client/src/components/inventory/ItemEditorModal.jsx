import { useState } from "react";
import Modal from "../Modal.jsx";
import { cx } from "../../lib/utils.js";

const FIELD = (locked) =>
  cx(
    "w-full min-h-11 rounded-2xl border border-slate-200 px-4 py-3 outline-none transition",
    locked ? "cursor-not-allowed bg-slate-100 text-slate-600" : "bg-slate-50 focus:border-[#2d8f98] focus:bg-white",
  );

function catalogueFormState(item, folders = []) {
  const direct = folders.find((folder) => String(folder.id) === String(item?.folder_id));
  const byName = folders.find((folder) => folder.name === item?.folder_name);
  return {
    item_name: item?.item_name ?? "",
    folder_id: String(direct?.id || byName?.id || item?.folder_id || ""),
    attributes: item?.attributes ?? "",
    moa_notes: item?.moa_notes ?? "",
    minimum_quantity: String(item?.minimum_quantity ?? 0),
    unit: item?.unit ?? "unit",
    cost_price: String(item?.cost_price ?? 0),
    selling_price: String(item?.selling_price ?? 0),
  };
}

export default function ItemEditorModal({
  open,
  item,
  folders = [],
  isSaving,
  lockMasterFields = false,
  bagSettingsOnly = false,
  onClose,
  onSubmit,
}) {
  const [form, setForm] = useState(() => catalogueFormState(item, folders));
  const [baseline, setBaseline] = useState(() => catalogueFormState(item, folders));
  const [section, setSection] = useState("definition");
  const [syncedDeps, setSyncedDeps] = useState({ open, itemId: item?.id, bagSettingsOnly });

  if (
    syncedDeps.open !== open
    || syncedDeps.itemId !== item?.id
    || syncedDeps.bagSettingsOnly !== bagSettingsOnly
  ) {
    setSyncedDeps({ open, itemId: item?.id, bagSettingsOnly });
    if (open) {
      const next = catalogueFormState(item, folders);
      setForm(next);
      setBaseline(next);
      setSection(bagSettingsOnly ? "policy" : "definition");
    }
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);

  function requestClose() {
    if (dirty && !window.confirm("You have unsaved catalogue changes. Close without saving?")) {
      return;
    }
    onClose();
  }

  const masterReadOnly = lockMasterFields;

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title={bagSettingsOnly ? "Bag settings" : item ? "Edit catalogue item" : "Add catalogue item"}
      description={
        bagSettingsOnly
          ? "Update the minimum/par quantity for this bag item. Quantity changes through documented stock movements only."
          : "Edit definition, stock policy and pricing. On-hand quantity is not changed here."
      }
      size="lg"
      innerScroll={false}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (bagSettingsOnly) {
            onSubmit({ minimum_quantity: Number(form.minimum_quantity || 0) });
            return;
          }
          onSubmit({
            item_name: form.item_name,
            folder_id: Number(form.folder_id || 0),
            attributes: form.attributes,
            moa_notes: form.moa_notes,
            minimum_quantity: Number(form.minimum_quantity || 0),
            unit: form.unit,
            cost_price: Number(form.cost_price || 0),
            selling_price: Number(form.selling_price || 0),
            quantity: item ? undefined : 0,
          });
        }}
      >
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pr-1">
          {bagSettingsOnly ? (
            <label className="space-y-2">
              <span className="text-sm font-semibold text-slate-700">Minimum / par quantity</span>
              <input
                required
                min="0"
                type="number"
                name="minimum_quantity"
                value={form.minimum_quantity}
                onChange={(event) => setForm((prev) => ({ ...prev, minimum_quantity: event.target.value }))}
                className={FIELD(false)}
              />
            </label>
          ) : (
            <>
              <div className="flex gap-1 overflow-x-auto rounded-2xl bg-slate-50 p-1" role="tablist" aria-label="Catalogue sections">
                {[
                  { id: "definition", label: "Definition" },
                  { id: "policy", label: "Stock policy" },
                  { id: "pricing", label: "Pricing" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={section === tab.id}
                    onClick={() => setSection(tab.id)}
                    className={cx(
                      "min-h-11 flex-1 rounded-xl px-3 text-sm font-semibold",
                      section === tab.id ? "bg-[#2d8f98] text-white" : "text-slate-600",
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {section === "definition" ? (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Definition</h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Item name</span>
                      <input
                        required
                        name="item_name"
                        value={form.item_name}
                        readOnly={masterReadOnly}
                        onChange={(event) => setForm((prev) => ({ ...prev, item_name: event.target.value }))}
                        className={FIELD(masterReadOnly)}
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
                        className={FIELD(masterReadOnly)}
                      >
                        <option value="">Select folder</option>
                        {folders.map((folder) => (
                          <option key={folder.id} value={String(folder.id)}>
                            {folder.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Attributes</span>
                    <input
                      name="attributes"
                      value={form.attributes}
                      onChange={(event) => setForm((prev) => ({ ...prev, attributes: event.target.value }))}
                      className={FIELD(false)}
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Unit</span>
                    <input
                      required
                      name="unit"
                      value={form.unit}
                      readOnly={masterReadOnly}
                      onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
                      className={FIELD(masterReadOnly)}
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">MOA notes</span>
                    <textarea
                      rows="3"
                      name="moa_notes"
                      value={form.moa_notes}
                      onChange={(event) => setForm((prev) => ({ ...prev, moa_notes: event.target.value }))}
                      className="w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 outline-none"
                    />
                  </label>
                </div>
              ) : null}

              {section === "policy" ? (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Stock policy</h4>
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Minimum quantity</span>
                    <input
                      required
                      min="0"
                      type="number"
                      name="minimum_quantity"
                      value={form.minimum_quantity}
                      onChange={(event) => setForm((prev) => ({ ...prev, minimum_quantity: event.target.value }))}
                      className={FIELD(false)}
                    />
                  </label>
                  <p className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    Expiry is recorded on each received batch. Catalogue items do not have an expiry date, and this editor cannot change existing batch expiry dates.
                  </p>
                </div>
              ) : null}

              {section === "pricing" ? (
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Pricing</h4>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Cost price (Rs)</span>
                      <input
                        required
                        min="0"
                        step="0.01"
                        type="number"
                        name="cost_price"
                        value={form.cost_price}
                        readOnly={masterReadOnly}
                        onChange={(event) => setForm((prev) => ({ ...prev, cost_price: event.target.value }))}
                        className={FIELD(masterReadOnly)}
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-slate-700">Selling price (Rs)</span>
                      <input
                        required
                        min="0"
                        step="0.01"
                        type="number"
                        name="selling_price"
                        value={form.selling_price}
                        readOnly={masterReadOnly}
                        onChange={(event) => setForm((prev) => ({ ...prev, selling_price: event.target.value }))}
                        className={FIELD(masterReadOnly)}
                      />
                    </label>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 py-4 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={requestClose}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-[#4FB8B3] px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isSaving ? "Saving…" : bagSettingsOnly ? "Save settings" : item ? "Update item" : "Add item"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
