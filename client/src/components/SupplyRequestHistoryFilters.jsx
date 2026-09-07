import { useId, useMemo, useRef, useState } from "react";
import { EMPTY_HISTORY_FILTERS } from "./SupplyRequestHistoryFilters.constants.js";
import { useIsMobile } from "../hooks/useIsMobile.js";

const FIELD =
  "mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700";

const FILTER_LABELS = {
  request_id: "Request #",
  doctor_id: "Doctor",
  operator_id: "Operator",
  folder_id: "Category",
  item: "Item",
  status: "Outcome",
  from: "Date from",
  to: "Date to",
};

export { EMPTY_HISTORY_FILTERS };

function folderOptionLabel(folder) {
  return folder?.label || folder?.name || `Folder ${folder?.id}`;
}

function chipLabel(key, value, { doctors, operators, folders, role }) {
  if (key === "doctor_id") {
    const doctor = doctors.find((row) => String(row.id) === String(value));
    return doctor?.full_name || value;
  }
  if (key === "operator_id") {
    const operator = operators.find((row) => String(row.id) === String(value));
    return operator?.full_name || operator?.username || value;
  }
  if (key === "folder_id") {
    const folder = folders.find((row) => String(row.id) === String(value));
    return folderOptionLabel(folder);
  }
  if (key === "status") {
    if (value === "completed") return role === "operator" ? "Supply Dispatched" : "Completed";
    if (value === "cancelled") return "Cancelled";
  }
  return String(value);
}

export default function SupplyRequestHistoryFilters({
  filters,
  onChange,
  doctors = [],
  operators = [],
  folders = [],
  role = "operator",
  resultCount = null,
  exportControl = null,
  summaryId = "supply-history-summary",
}) {
  const formId = useId();
  const isMobileLayout = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const summaryRef = useRef(null);
  const showFilterForm = !isMobileLayout || mobileOpen;
  const editingDraft = isMobileLayout && mobileOpen;

  function setField(key, value) {
    const next = { ...filters, [key]: value };
    onChange(next);
  }

  function setDraftField(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const activeEntries = useMemo(
    () => Object.entries(filters || {}).filter(([, value]) => String(value || "").trim()),
    [filters],
  );
  const activeCount = activeEntries.length;
  const outcomeCompleted = role === "operator" ? "Supply Dispatched" : "Completed";
  const resultText = resultCount == null ? "" : `${Number(resultCount).toLocaleString()} result${Number(resultCount) === 1 ? "" : "s"}`;

  function applyDraft() {
    onChange(draft);
    setMobileOpen(false);
    window.setTimeout(() => {
      const node = document.getElementById(summaryId) || summaryRef.current;
      node?.focus?.();
    }, 0);
  }

  function clearAll() {
    const empty = { ...EMPTY_HISTORY_FILTERS };
    setDraft(empty);
    onChange(empty);
  }

  function removeChip(key) {
    const next = { ...filters, [key]: "" };
    onChange(next);
    setDraft(next);
  }

  const fields = (
    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Request #
        <input
          type="search"
          value={editingDraft ? draft.request_id : filters.request_id}
          onChange={(event) => (editingDraft ? setDraftField("request_id", event.target.value) : setField("request_id", event.target.value))}
          placeholder="ID"
          className={FIELD}
        />
      </label>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Doctor
        <select
          value={editingDraft ? draft.doctor_id : filters.doctor_id}
          onChange={(event) => (editingDraft ? setDraftField("doctor_id", event.target.value) : setField("doctor_id", event.target.value))}
          className={FIELD}
        >
          <option value="">All doctors</option>
          {doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.full_name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Operator
        <select
          value={editingDraft ? draft.operator_id : filters.operator_id}
          onChange={(event) => (editingDraft ? setDraftField("operator_id", event.target.value) : setField("operator_id", event.target.value))}
          className={FIELD}
        >
          <option value="">All operators</option>
          {operators.map((operator) => (
            <option key={operator.id} value={operator.id}>
              {operator.full_name || operator.username}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Folder / category
        <select
          value={editingDraft ? draft.folder_id : filters.folder_id}
          onChange={(event) => (editingDraft ? setDraftField("folder_id", event.target.value) : setField("folder_id", event.target.value))}
          className={FIELD}
        >
          <option value="">All folders</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folderOptionLabel(folder)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Item
        <input
          type="search"
          value={editingDraft ? draft.item : filters.item}
          onChange={(event) => (editingDraft ? setDraftField("item", event.target.value) : setField("item", event.target.value))}
          placeholder="Item name"
          className={FIELD}
        />
      </label>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Outcome
        <select
          value={editingDraft ? draft.status : filters.status}
          onChange={(event) => (editingDraft ? setDraftField("status", event.target.value) : setField("status", event.target.value))}
          className={FIELD}
        >
          <option value="">Completed & cancelled</option>
          <option value="completed">{outcomeCompleted}</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Date from
        <input
          type="date"
          value={editingDraft ? draft.from : filters.from}
          onChange={(event) => (editingDraft ? setDraftField("from", event.target.value) : setField("from", event.target.value))}
          className={FIELD}
        />
      </label>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Date to
        <input
          type="date"
          value={editingDraft ? draft.to : filters.to}
          onChange={(event) => (editingDraft ? setDraftField("to", event.target.value) : setField("to", event.target.value))}
          className={FIELD}
        />
      </label>
    </div>
  );

  const chips = activeCount ? (
    <div className="flex flex-wrap items-center gap-2">
      {activeEntries.map(([key, value]) => (
        <span
          key={key}
          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
        >
          {FILTER_LABELS[key] || key}: {chipLabel(key, value, { doctors, operators, folders, role })}
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:text-slate-800"
            aria-label={`Remove ${FILTER_LABELS[key] || key} filter`}
            onClick={() => removeChip(key)}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={clearAll}
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"
      >
        Clear all
      </button>
    </div>
  ) : null;

  const summary = (
    <div
      id={summaryId}
      ref={summaryRef}
      tabIndex={-1}
      className="flex flex-wrap items-center gap-2 outline-none"
    >
      {resultText ? <p className="text-xs font-semibold text-slate-600">{resultText}</p> : null}
      {activeCount ? (
        <p className="text-xs font-semibold text-slate-600">{activeCount} filter{activeCount === 1 ? "" : "s"} active</p>
      ) : (
        <p className="text-xs text-slate-500">No history filters applied</p>
      )}
      {exportControl}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800"
          aria-expanded={mobileOpen}
          aria-controls={formId}
          onClick={() => setMobileOpen((open) => !open)}
        >
          Filters{resultText ? ` · ${resultText}` : activeCount ? ` · ${activeCount} active` : ""}
        </button>
      </div>
      {chips}
      {showFilterForm ? (
      <div id={formId}>
        {fields}
        <div className="mt-3 flex flex-wrap items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={applyDraft}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2d8f98] px-4 text-sm font-semibold text-white"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"
          >
            Close
          </button>
        </div>
        <div className="mt-3 hidden md:block">
          {activeCount ? (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>
      ) : (
        <div id={formId} hidden />
      )}
      {summary}
    </div>
  );
}
