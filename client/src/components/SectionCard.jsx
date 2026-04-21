import { cx } from "../lib/utils.js";

function SectionCard({ title, subtitle, actions, className, children }) {
  return (
    <section
      className={cx(
        "rounded-[32px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(242,251,250,0.9))] p-6 shadow-[0_30px_80px_rgba(34,72,91,0.09)] backdrop-blur",
        className,
      )}
    >
      {title || actions ? (
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            {title ? <h3 className="text-lg font-semibold text-slate-950">{title}</h3> : null}
            {subtitle ? <p className="mt-1 text-sm text-[#4f6f7a]">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}

      {children}
    </section>
  );
}

export default SectionCard;
