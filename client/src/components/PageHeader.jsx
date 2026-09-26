function PageHeader({ eyebrow, title, description, actions, align = "end", className = "" }) {
  return (
    <div
      className={`flex w-full min-w-0 max-w-full flex-col gap-3 md:flex-row md:justify-between ${
        align === "center" ? "md:items-center" : "md:items-end"
      } ${className}`.trim()}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ocs-slate">
            {eyebrow}
          </p>
        ) : null}
        <h1 className={`${eyebrow ? "mt-1 " : ""}flex flex-wrap items-center gap-y-2 break-words font-display text-2xl font-bold leading-tight tracking-[-0.02em] text-ocs-slate md:text-3xl`}>
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-3xl break-words text-sm leading-6 text-slate-700 lg:text-ocs-grey">{description}</p>
        ) : null}
      </div>

      {actions ? <div className="flex min-w-0 flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

export default PageHeader;
