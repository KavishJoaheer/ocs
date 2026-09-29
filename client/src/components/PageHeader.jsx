import { cx } from "../lib/utils.js";
import ocsCxIcon from "../assets/ocs-cx-icon.png";

function readableText(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function resolveHeaderTone(eyebrow, title, tone) {
  if (tone && tone !== "auto") return tone;

  const text = `${readableText(eyebrow)} ${readableText(title)}`;
  if (/billing|finance|payment|account/.test(text)) return "gold";
  if (/consult|clinical|lab|medical/.test(text)) return "aqua";
  if (/inventory|stock|supply/.test(text)) return "teal";
  if (/visit|roster|appointment|schedule/.test(text)) return "gold";
  if (/patient|team|doctor/.test(text)) return "teal";
  return "teal";
}

function PageHeader({ eyebrow, title, description, actions, align = "end", className = "", tone = "auto" }) {
  const resolvedTone = resolveHeaderTone(eyebrow, title, tone);

  return (
    <div
      className={cx(
        "ocs-page-header flex w-full min-w-0 max-w-full flex-col gap-3 md:flex-row md:justify-between md:gap-4",
        `ocs-page-header--${resolvedTone}`,
        align === "center" ? "md:items-center" : "md:items-end",
        className,
      )}
    >
      <img className="ocs-page-header__brandmark" src={ocsCxIcon} alt="" aria-hidden="true" />

      <div className="ocs-page-header__copy min-w-0">
        {eyebrow ? (
          <p className="ocs-page-header__eyebrow text-[11px] font-bold uppercase tracking-[0.2em]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className={`${eyebrow ? "mt-1 md:mt-2 " : ""}ocs-page-header__title flex flex-wrap items-center gap-y-2 break-words font-display text-2xl font-bold leading-tight tracking-[-0.02em] text-ocs-slate md:text-[2rem] md:tracking-[-0.035em]`}>
          {title}
        </h1>
        {description ? (
          <p className="ocs-page-header__description mt-1.5 max-w-3xl break-words text-sm leading-6 text-slate-700 md:mt-2">{description}</p>
        ) : null}
      </div>

      {actions ? <div className="ocs-page-header__actions flex min-w-0 flex-wrap gap-3 md:gap-2.5">{actions}</div> : null}
    </div>
  );
}

export default PageHeader;
