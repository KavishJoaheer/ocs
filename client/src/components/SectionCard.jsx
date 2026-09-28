import { cx } from "../lib/utils.js";

function resolveSectionTone(title, variant, tone) {
  if (tone && tone !== "auto") return tone;
  if (variant === "demographic") return "gold";
  if (typeof title !== "string") return "teal";

  const text = title.toLowerCase();
  if (/billing|finance|payment|receipt|invoice|expense|payroll|tax/.test(text)) return "gold";
  if (/consult|clinical|lab|medical|note|history/.test(text)) return "aqua";
  if (/inventory|stock|supply|item|shipment|batch/.test(text)) return "teal";
  if (/review|alert|particular|exception|correction/.test(text)) return "gold";
  if (/patient|doctor|kin|profile|detail/.test(text)) return "sage";
  return "teal";
}

function SectionCard({
  title,
  subtitle,
  actions,
  className,
  children,
  id,
  titleClassName,
  variant = "default",
  compact = false,
  tone = "auto",
}) {
  const resolvedTone = resolveSectionTone(title, variant, tone);

  return (
    <section
      id={id}
      className={cx(
        "ocs-section-card max-w-full min-w-0",
        `ocs-section-card--${resolvedTone}`,
        variant === "demographic"
          ? "rounded-2xl border border-[#e6ebd9] bg-[#f4f6f0] shadow-sm"
          : "border border-ocs-teal/15 bg-white/92 shadow-[0_14px_38px_rgba(59,89,92,0.07)] backdrop-blur-sm",
        variant === "demographic"
          ? compact
            ? "p-4"
            : "p-6"
          : compact
            ? "rounded-[18px] p-4"
            : "rounded-[26px] p-5",
        className,
      )}
    >
      {title || subtitle || actions ? (
        <div
          className={cx(
            "ocs-section-card__header flex min-w-0 flex-col gap-2 md:flex-row md:justify-between",
            compact ? "mb-2 md:items-center" : "mb-3 md:items-start",
          )}
        >
          <div className="min-w-0">
            {title ? (
              <h3 className={cx("ocs-section-card__title break-words font-semibold text-ocs-slate", titleClassName || "text-base lg:text-lg")}>
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p className={`ocs-section-card__subtitle break-words text-sm text-slate-700${title ? " mt-1" : ""}`}>{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="ocs-section-card__actions flex min-w-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}

      {children}
    </section>
  );
}

export default SectionCard;
