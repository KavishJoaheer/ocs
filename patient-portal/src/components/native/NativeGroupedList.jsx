import { Link } from "react-router-dom";

/** iOS inset grouped list container — white block on gray canvas, no floating cards. */
function NativeGroupedList({ children, className = "" }) {
  return (
    <div className={["native-grouped-list overflow-hidden rounded-2xl bg-white", className].join(" ")}>
      {children}
    </div>
  );
}

/** Single tappable row inside a grouped list. */
function NativeGroupedRow({
  children,
  to,
  href,
  onClick,
  isLast = false,
  className = "",
  ariaLabel,
}) {
  const classes = [
    "native-grouped-row flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-gray-100/80",
    isLast ? "" : "border-b border-gray-100",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (to) {
    return (
      <Link to={to} className={classes} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        aria-label={ariaLabel}
      >
        {children}
      </a>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes} aria-label={ariaLabel}>
        {children}
      </button>
    );
  }

  return <div className={classes}>{children}</div>;
}

/** Muted footnote below a grouped section — iOS Settings footer style. */
function NativeGroupedFooter({ children }) {
  return (
    <p className="native-grouped-footer px-1 pt-2 text-[13px] leading-relaxed text-gray-500">
      {children}
    </p>
  );
}

export { NativeGroupedList, NativeGroupedRow, NativeGroupedFooter };
