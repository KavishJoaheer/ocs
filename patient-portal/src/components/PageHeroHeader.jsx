function PageHeroHeader({ accent, title, subtitle, className = "" }) {
  return (
    <header className={`pb-8 pt-6 ${className}`.trim()}>
      <h1 className="text-3xl font-bold leading-tight">
        {accent ? <span className="text-brand-orange">{accent}</span> : null}
        {accent && title ? " " : null}
        <span className="text-teal-900">{title}</span>
      </h1>
      {subtitle ? <p className="mt-1 text-[14px] text-gray-500">{subtitle}</p> : null}
    </header>
  );
}

export default PageHeroHeader;
