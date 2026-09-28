import { cx } from "../lib/utils.js";

function readableText(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function resolveHeaderTone(eyebrow, title, tone) {
  if (tone && tone !== "auto") return tone;

  const text = `${readableText(eyebrow)} ${readableText(title)}`;
  if (/billing|finance|payment|account/.test(text)) return "amber";
  if (/consult|clinical|lab|medical/.test(text)) return "violet";
  if (/inventory|stock|supply/.test(text)) return "cobalt";
  if (/visit|roster|appointment|schedule/.test(text)) return "coral";
  if (/patient|team|doctor/.test(text)) return "lime";
  return "teal";
}

function PageHeader({ eyebrow, title, description, actions, align = "end", className = "", tone = "auto" }) {
  const resolvedTone = resolveHeaderTone(eyebrow, title, tone);

  return (
    <div
      className={cx(
        "ocs-page-header flex w-full min-w-0 max-w-full flex-col gap-4 md:flex-row md:justify-between",
        `ocs-page-header--${resolvedTone}`,
        align === "center" ? "md:items-center" : "md:items-end",
        className,
      )}
    >
      <div className="ocs-page-header__orb ocs-page-header__orb--one" aria-hidden="true" />
      <div className="ocs-page-header__orb ocs-page-header__orb--two" aria-hidden="true" />

      <div className="ocs-page-header__copy min-w-0">
        {eyebrow ? (
          <p className="ocs-page-header__eyebrow text-[11px] font-bold uppercase tracking-[0.2em]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className={`${eyebrow ? "mt-2 " : ""}ocs-page-header__title flex flex-wrap items-center gap-y-2 break-words font-display text-2xl font-bold leading-tight tracking-[-0.035em] text-ocs-slate md:text-[2rem]`}>
          {title}
        </h1>
        {description ? (
          <p className="ocs-page-header__description mt-2 max-w-3xl break-words text-sm leading-6 text-slate-700">{description}</p>
        ) : null}
      </div>

      {actions ? <div className="ocs-page-header__actions flex min-w-0 flex-wrap gap-2.5">{actions}</div> : null}
    </div>
  );
}

export default PageHeader;
