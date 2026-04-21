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

function OperationStatusSelector({
  value,
  options = ["available", "active", "offline"],
  onChange,
  disabled = false,
  align = "right",
  className,
}) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-1.5",
        align === "right" ? "justify-end" : "justify-start",
        className,
      )}
    >
      <span className="text-[#f1bc35]">STATUS:</span>

      {options.map((status, index) => {
        const meta = STATUS_META[status];
        const isActive = value === status;

        return (
          <div key={status} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChange?.(status)}
              disabled={disabled || isActive}
              className={cx(
                "rounded-full px-3 py-1 text-[0.92em] font-semibold normal-case transition disabled:cursor-default",
                meta?.textClassName,
                isActive
                  ? meta?.activeClassName
                  : "bg-transparent opacity-90 hover:bg-white/55 hover:opacity-100",
              )}
            >
              {meta?.label || status}
            </button>
            {index < options.length - 1 ? <span className="text-[#2d5f69]">/</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export default OperationStatusSelector;
