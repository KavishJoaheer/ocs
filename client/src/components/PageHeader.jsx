function PageHeader({ eyebrow, title, description, actions, className = "" }) {
  return (
    <div
      className={`flex w-full min-w-0 max-w-full flex-col gap-3 md:flex-row md:items-end md:justify-between ${className}`.trim()}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 flex flex-wrap items-center gap-y-2 break-words font-display text-2xl font-semibold leading-tight tracking-tight text-slate-950 md:text-3xl lg:text-ocs-slate">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-3xl break-words text-sm leading-6 text-gray-500 lg:text-ocs-grey">{description}</p>
        ) : null}
      </div>

      {actions ? <div className="flex min-w-0 flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

export default PageHeader;
