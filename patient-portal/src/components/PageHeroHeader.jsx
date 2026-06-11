function PageHeroHeader({ primaryText, secondaryText, subtitle, className = "" }) {
  return (
    <header className={`page-hero-header pb-8 pt-6 ${className}`.trim()}>
      <h1 className="native-display text-3xl font-bold leading-tight tracking-tight">
        <span className="text-teal-900">{primaryText}</span>
        {secondaryText ? (
          <>
            {" "}
            <span className="text-brand-orange">{secondaryText}</span>
          </>
        ) : null}
      </h1>
      {subtitle ? <p className="mt-1 text-[14px] text-gray-500">{subtitle}</p> : null}
    </header>
  );
}

export default PageHeroHeader;
