function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-1 font-display text-3xl leading-none tracking-tight text-slate-950">
          {title}
        </h2>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[#3f6270]">{description}</p>
        ) : null}
      </div>

      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

export default PageHeader;
