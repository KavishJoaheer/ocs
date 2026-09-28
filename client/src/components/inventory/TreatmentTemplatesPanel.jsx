import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/api.js";
import Modal from "../Modal.jsx";
import SectionCard from "../SectionCard.jsx";

const FIELD = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-[#2d8f98]";

function blankComponent(componentType) {
  return { component_type: componentType, item_name: "", selection_role: "", quantity: 1 };
}

function editorState(template) {
  return {
    id: template?.id || null,
    name: template?.name || "",
    active: template?.active !== false,
    components: template?.components?.length
      ? template.components.map((component) => ({
          component_type: component.component_type,
          item_name: component.item_name || "",
          selection_role: component.selection_role || "",
          quantity: Number(component.quantity || 1),
        }))
      : [blankComponent("billable"), blankComponent("included")],
  };
}

function componentLabel(component) {
  return component.selection_role
    ? `Choose ${component.selection_role} at billing`
    : component.item_name;
}

function formatRupees(value) {
  return `Rs ${Number(value || 0).toLocaleString("en-MU", { maximumFractionDigits: 2 })}`;
}

export default function TreatmentTemplatesPanel() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState(null);

  async function load() {
    setLoading(true);
    try {
      setPayload(await api.get("/inventory/treatment-templates"));
    } catch (error) {
      toast.error(error.message || "Treatment templates could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const templates = payload?.templates || [];
  const stockItems = payload?.stock_items || [];
  const roles = payload?.selection_roles || [];
  const roleByKey = new Map(roles.map((role) => [role.key, role]));

  function updateComponent(index, patch) {
    setEditor((current) => ({
      ...current,
      components: current.components.map((component, componentIndex) =>
        componentIndex === index ? { ...component, ...patch } : component,
      ),
    }));
  }

  function addComponent(componentType) {
    setEditor((current) => ({
      ...current,
      components: [...current.components, blankComponent(componentType)],
    }));
  }

  function removeComponent(index) {
    setEditor((current) => ({
      ...current,
      components: current.components.filter((_, componentIndex) => componentIndex !== index),
    }));
  }

  async function save(event) {
    event.preventDefault();
    if (!editor || saving) return;
    setSaving(true);
    try {
      const body = {
        name: editor.name.trim(),
        active: editor.active,
        components: editor.components.map((component) => ({
          component_type: component.component_type,
          item_name: component.item_name,
          selection_role: component.selection_role,
          quantity: Number(component.quantity || 0),
        })),
      };
      const next = editor.id
        ? await api.put(`/inventory/treatment-templates/${editor.id}`, body)
        : await api.post("/inventory/treatment-templates", body);
      setPayload(next);
      setEditor(null);
      toast.success(editor.id ? "Treatment template updated." : "Treatment template created.");
    } catch (error) {
      toast.error(error.message || "Treatment template could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function renderRows(componentType, title, hint) {
    const rows = editor.components
      .map((component, index) => ({ component, index }))
      .filter(({ component }) => component.component_type === componentType);
    return (
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-black text-slate-800">{title}</h4>
            <p className="mt-1 text-xs font-semibold text-slate-500">{hint}</p>
          </div>
          <button type="button" onClick={() => addComponent(componentType)} className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-white px-3 text-sm font-black text-[#17666a] shadow-sm">
            <Plus className="size-4" /> Add
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {rows.map(({ component, index }) => {
            const selectedValue = component.selection_role
              ? `role:${component.selection_role}`
              : component.item_name ? `item:${component.item_name}` : "";
            return (
              <div key={`${componentType}-${index}`} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_7rem_3rem] sm:items-end">
                <label>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{componentType === "billable" ? "Medicine or supply" : "Consumable"}</span>
                  <select
                    required
                    value={selectedValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      updateComponent(index, value.startsWith("role:")
                        ? { selection_role: value.slice(5), item_name: "" }
                        : { selection_role: "", item_name: value.slice(5) });
                    }}
                    className={`${FIELD} mt-1`}
                  >
                    <option value="">Choose stock item</option>
                    {componentType === "included" ? roles.map((role) => (
                      <option key={`role-${role.key}`} value={`role:${role.key}`}>{role.label} — clinician chooses size</option>
                    )) : null}
                    {stockItems.map((itemName) => <option key={itemName} value={`item:${itemName}`}>{itemName}</option>)}
                  </select>
                </label>
                <label>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Quantity</span>
                  <input
                    required
                    min="1"
                    max="100"
                    type="number"
                    value={component.quantity}
                    onChange={(event) => updateComponent(index, { quantity: event.target.value })}
                    className={`${FIELD} mt-1`}
                  />
                </label>
                <button type="button" onClick={() => removeComponent(index)} className="flex size-11 items-center justify-center rounded-xl bg-rose-50 text-rose-700" aria-label={`Remove ${componentLabel(component) || "component"}`}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
          {!rows.length ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-500">Add at least one item.</p> : null}
        </div>
      </section>
    );
  }

  return (
    <>
      <SectionCard
        title="Treatment templates"
        subtitle="Configure what the patient is charged and which consumables are silently deducted from the doctor’s bag. Every change is recorded in an append-only audit history."
        actions={(
          <button type="button" onClick={() => setEditor(editorState())} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#2d8f98] px-4 text-sm font-black text-white">
            <Plus className="size-4" /> New template
          </button>
        )}
      >
        {loading ? <p className="py-8 text-center text-sm font-semibold text-slate-500">Loading treatment templates…</p> : null}
        {!loading && !templates.length ? <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm font-semibold text-slate-500">No treatment templates configured.</p> : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {templates.map((template) => {
            const billable = template.components.filter((component) => component.component_type === "billable");
            const included = template.components.filter((component) => component.component_type === "included");
            return (
              <article key={template.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black text-slate-900">{template.name}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${template.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{template.active ? "Active" : "Inactive"}</span>
                    </div>
                    <p className="mt-3 text-xs font-black uppercase tracking-wide text-slate-400">Charged to patient</p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">{billable.map((component) => `${component.quantity} × ${componentLabel(component)}`).join(" · ")}</p>
                    <p className="mt-3 text-xs font-black uppercase tracking-wide text-slate-400">Included consumables</p>
                    <p className="mt-1 text-sm font-semibold text-[#17666a]">{included.map((component) => {
                      const label = component.selection_role ? roleByKey.get(component.selection_role)?.label || component.selection_role : component.item_name;
                      return `${component.quantity} × ${label}`;
                    }).join(" · ")}</p>
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Delivered</p>
                        <p className="mt-1 font-black text-slate-800">{template.metrics?.treatment_count || 0}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Charged</p>
                        <p className="mt-1 font-black text-slate-800">{formatRupees(template.metrics?.charged_amount)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Medicine cost</p>
                        <p className="mt-1 font-black text-slate-800">{formatRupees(template.metrics?.charged_stock_cost_amount)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Included cost</p>
                        <p className="mt-1 font-black text-slate-800">{formatRupees(template.metrics?.included_consumable_cost_amount)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Total stock cost</p>
                        <p className="mt-1 font-black text-slate-800">{formatRupees(template.metrics?.total_stock_cost_amount)}</p>
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-2">
                        <p className="text-[10px] font-black uppercase tracking-wide text-emerald-600">Gross margin</p>
                        <p className="mt-1 font-black text-emerald-800">{formatRupees(template.metrics?.gross_margin_amount)}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-500">Stock cost includes charged medicines and uncharged consumables. Consultation fees are excluded.</p>
                  </div>
                  <button type="button" onClick={() => setEditor(editorState(template))} className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700" aria-label={`Edit ${template.name}`}>
                    <Pencil className="size-4" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </SectionCard>

      <Modal
        open={Boolean(editor)}
        onClose={() => !saving && setEditor(null)}
        title={editor?.id ? "Edit treatment template" : "New treatment template"}
        description="Charged items appear on the invoice. Included consumables are deducted and costed internally but never shown as patient charges."
        size="xl"
      >
        {editor ? (
          <form onSubmit={save} className="space-y-4">
            <label className="block">
              <span className="text-sm font-black text-slate-700">Template name</span>
              <input required minLength="3" maxLength="160" value={editor.name} onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))} className={`${FIELD} mt-1`} />
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3">
              <input type="checkbox" checked={editor.active} onChange={(event) => setEditor((current) => ({ ...current, active: event.target.checked }))} className="size-5 accent-[#2d8f98]" />
              <span className="text-sm font-black text-slate-700">Available to doctors in billing</span>
            </label>
            {renderRows("billable", "Charged to patient", "These stock items become itemised invoice lines and are deducted from the bag.")}
            {renderRows("included", "Included consumables", "These are deducted and costed but stay off the patient invoice.")}
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button type="button" disabled={saving} onClick={() => setEditor(null)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-700">Cancel</button>
              <button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-[#2d8f98] px-5 text-sm font-black text-white disabled:opacity-60">{saving ? "Saving…" : "Save template"}</button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
