import { cx } from "../lib/utils.js";

const STATUS_META = {
  available: {
    label: "Available",
    textClassName: "text-[#57c563]",
    activeClassName:
      "bg-[rgba(87,197,99,0.12)] ring-1 ring-[rgba(87,197,99,0.24)] shadow-[0_10px_24px_rgba(87,197,99,0.14)]",
  },
  active: {
    label: "Active",
    textClassName: "text-[#2d5f69]",
    activeClassName:
      "bg-[rgba(45,143,152,0.12)] ring-1 ring-[rgba(45,143,152,0.24)] shadow-[0_10px_24px_rgba(45,143,152,0.14)]",
  },
  offline: {
    label: "Offline",
    textClassName: "text-[#ff5f4a]",
    activeClassName:
      "bg-[rgba(255,95,74,0.12)] ring-1 ring-[rgba(255,95,74,0.22)] shadow-[0_10px_24px_rgba(255,95,74,0.12)]",
  },
};

const DARK_STATUS_META = {
  available: {
    label: "Available",
    textClassName: "text-[#8be0a0]",
    activeClassName:
      "bg-[rgba(87,197,99,0.18)] ring-1 ring-[rgba(139,224,160,0.45)] text-[#c8f5d2]",
  },
  active: {
    label: "Active",
    textClassName: "text-[#9aeee8]",
    activeClassName:
      "bg-[rgba(43,204,196,0.2)] ring-1 ring-[rgba(43,204,196,0.55)] text-[#d9f7f5]",
  },
  offline: {
    label: "Offline",
    textClassName: "text-[#ff9a8c]",
    activeClassName:
      "bg-[rgba(255,95,74,0.18)] ring-1 ring-[rgba(255,154,140,0.5)] text-[#ffc4ba]",
  },
};

function OperationStatusSelector({
  value,
  options = ["available", "active", "offline"],
  onChange,
  disabled = false,
  align = "right",
  className,
  tone = "light",
  showLabel = true,
}) {
  const onDark = tone === "onDark";

  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-2 text-sm",
        align === "right" ? "justify-end" : "justify-start",
        className,
      )}
    >
      {showLabel ? (
        <span className={cx("shrink-0 text-xs font-bold uppercase tracking-wider", onDark ? "text-white/55" : "text-slate-400")}>
          Status
        </span>
      ) : null}

      <div className={cx("flex items-center gap-1 rounded-xl p-1", onDark ? "bg-white/10" : "bg-slate-100")}>
        {options.map((status) => {
          const meta = onDark ? DARK_STATUS_META[status] : STATUS_META[status];
          const isActive = value === status;

          return (
            <button
              key={status}
              type="button"
              onClick={() => onChange?.(status)}
              disabled={disabled || isActive}
              className={cx(
                "rounded-lg px-3 py-1.5 text-xs font-bold normal-case transition disabled:cursor-default",
                isActive
                  ? cx(meta?.textClassName, meta?.activeClassName)
                  : onDark
                    ? "bg-transparent text-white/70 hover:bg-white/10 hover:text-white"
                    : "bg-transparent text-slate-500 hover:bg-white hover:text-slate-800",
              )}
            >
              {meta?.label || STATUS_META[status]?.label || status}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default OperationStatusSelector;
