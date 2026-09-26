/** Desktop architectural hero — static, authoritative band with vertical spine. */
function PageHeroHeader({ primaryText, secondaryText, subtitle, className = "" }) {
  return (
      <header className={`relative hidden overflow-hidden border-b border-brand-teal/20 bg-white/72 py-12 backdrop-blur-xl lg:flex lg:flex-col lg:gap-2 lg:px-10 ${className}`.trim()}>
        <div className="pointer-events-none absolute -right-24 -top-36 size-80 rounded-full bg-brand-teal/16 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-28 right-1/4 size-56 rounded-full bg-brand-gold/10 blur-3xl" aria-hidden="true" />
        <div
          className="absolute left-10 top-1/2 h-12 w-1.5 -translate-y-1/2 rounded-full bg-brand-teal/20"
          aria-hidden="true"
        />
        <div className="relative pl-7">
          <h1 className="text-5xl font-extrabold tracking-tight">
            <span className="text-ocs-slate">{primaryText}</span>
            {secondaryText ? (
              <>
                {" "}
                <span className="text-ocs-yellow">{secondaryText}</span>
              </>
            ) : null}
          </h1>
          {subtitle ? (
            <p className="mt-2 max-w-2xl text-[16px] font-medium leading-relaxed text-brand-cool-grey">
              {subtitle}
            </p>
          ) : null}
        </div>
      </header>
  );
}

export default PageHeroHeader;
