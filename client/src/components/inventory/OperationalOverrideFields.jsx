import { requiresOperationalOverride } from "../../lib/inventoryAccess.js";

export default function OperationalOverrideFields({ user, reason, onChange }) {
  if (!requiresOperationalOverride(user)) return null;
  return (
    <label className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <span className="text-sm font-semibold text-amber-900">Operational override reason</span>
      <p className="text-xs text-amber-800">
        Administrators do not perform routine warehouse actions. Record why this exception is required (at least 10 characters).
      </p>
      <textarea
        required
        minLength={10}
        rows={3}
        value={reason}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Operational override reason"
        className="w-full min-h-11 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-slate-800"
      />
    </label>
  );
}
