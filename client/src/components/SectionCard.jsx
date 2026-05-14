import { cx } from "../lib/utils.js";

function SectionCard({ title, subtitle, actions, className, children }) {
  return (
    <section
      className={cx(
        "rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(242,251,250,0.9))] p-5 shadow-[0_30px_80px_rgba(34,72,91,0.09)] backdrop-blur",
        className,
      )}
    >
      {title || subtitle || actions ? (
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            {title ? <h3 className="text-lg font-semibold text-slate-950">{title}</h3> : null}
            {subtitle ? <p className={`text-sm text-[#4f6f7a]${title ? " mt-1" : ""}`}>{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}

      {children}
    </section>
  );
}

export default SectionCard;
