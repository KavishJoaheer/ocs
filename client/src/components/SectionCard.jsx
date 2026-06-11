import { cx } from "../lib/utils.js";

function SectionCard({
  title,
  subtitle,
  actions,
  className,
  children,
  id,
  titleClassName,
  variant = "default",
}) {
  return (
    <section
      id={id}
      className={cx(
        "max-w-full min-w-0",
        variant === "demographic"
          ? "rounded-2xl border border-[#e6ebd9] bg-[#f4f6f0] p-6 shadow-sm md:border-transparent md:bg-white md:shadow-md"
          : "rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm lg:border-transparent lg:bg-white lg:shadow-md",
        className,
      )}
    >
      {title || subtitle || actions ? (
        <div className="mb-3 flex min-w-0 flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            {title ? (
              <h3 className={cx("break-words font-semibold text-ocs-slate", titleClassName || "text-base")}>
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p className={`break-words text-sm text-slate-700 lg:text-ocs-grey${title ? " mt-1" : ""}`}>{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex min-w-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}

      {children}
    </section>
  );
}

export default SectionCard;
