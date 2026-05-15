function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-1 break-words font-display text-3xl leading-none tracking-tight text-slate-950">
          {title}
        </h2>
        {description ? (
          <p className="mt-1.5 max-w-3xl break-words text-sm leading-6 text-[#3f6270]">{description}</p>
        ) : null}
      </div>

      {actions ? <div className="flex min-w-0 flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

export default PageHeader;
