const EMPTY_HISTORY_FILTERS = {
  doctor_id: "",
  status: "",
  from: "",
  to: "",
  item: "",
  request_id: "",
  operator_id: "",
  folder_id: "",
};

const FIELD =
  "mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700";

export { EMPTY_HISTORY_FILTERS };

export default function SupplyRequestHistoryFilters({
  filters,
  onChange,
  doctors = [],
  operators = [],
  folders = [],
  role = "operator",
}) {
  function setField(key, value) {
    onChange({ ...filters, [key]: value });
  }

  const activeCount = Object.values(filters || {}).filter((value) => String(value || "").trim()).length;
  const outcomeCompleted = role === "operator" ? "Supply Dispatched" : "Completed";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Request #
          <input
            type="search"
            value={filters.request_id}
            onChange={(event) => setField("request_id", event.target.value)}
            placeholder="ID"
            className={FIELD}
          />
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Doctor
          <select
            value={filters.doctor_id}
            onChange={(event) => setField("doctor_id", event.target.value)}
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
            value={filters.operator_id}
            onChange={(event) => setField("operator_id", event.target.value)}
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
            value={filters.folder_id}
            onChange={(event) => setField("folder_id", event.target.value)}
            className={FIELD}
          >
            <option value="">All folders</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Item
          <input
            type="search"
            value={filters.item}
            onChange={(event) => setField("item", event.target.value)}
            placeholder="Item name"
            className={FIELD}
          />
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Outcome
          <select
            value={filters.status}
            onChange={(event) => setField("status", event.target.value)}
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
            value={filters.from}
            onChange={(event) => setField("from", event.target.value)}
            className={FIELD}
          />
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Date to
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setField("to", event.target.value)}
            className={FIELD}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {activeCount ? (
          <p className="text-xs font-semibold text-slate-600">{activeCount} filter{activeCount === 1 ? "" : "s"} active</p>
        ) : (
          <p className="text-xs text-slate-500">No history filters applied</p>
        )}
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_HISTORY_FILTERS })}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}
