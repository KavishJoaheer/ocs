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
          ? "rounded-2xl border border-[#e6ebd9] bg-[#f4f6f0] p-6 shadow-sm"
          : "rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(242,251,250,0.9))] p-5 shadow-[0_30px_80px_rgba(34,72,91,0.09)] backdrop-blur lg:border-transparent lg:bg-white lg:shadow-md",
        className,
      )}
    >
      {title || subtitle || actions ? (
        <div className="mb-3 flex min-w-0 flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            {title ? (
              <h3 className={cx("break-words font-semibold text-slate-950 lg:text-ocs-slate", titleClassName || "text-base")}>
                {title}
              </h3>
            ) : null}
            {subtitle ? (
              <p className={`break-words text-sm text-[#4f6f7a] lg:text-ocs-grey${title ? " mt-1" : ""}`}>{subtitle}</p>
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
