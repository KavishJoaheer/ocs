import { statusLabel, statusTone } from "../lib/format.js";

function StatusBadge({ value }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${statusTone(
        value,
      )}`}
    >
      {statusLabel(value)}
    </span>
  );
}

export default StatusBadge;
