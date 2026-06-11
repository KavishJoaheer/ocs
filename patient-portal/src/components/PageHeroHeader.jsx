/** Desktop architectural hero — static, authoritative band with vertical spine. */
function PageHeroHeader({ primaryText, secondaryText, subtitle, className = "" }) {
  return (
      <header className={`relative hidden border-b border-gray-100 bg-white py-12 lg:flex lg:flex-col lg:gap-2 lg:px-10 ${className}`.trim()}>
        <div
          className="absolute left-10 top-1/2 h-12 w-1.5 -translate-y-1/2 rounded-full bg-teal-500"
          aria-hidden="true"
        />
        <div className="relative pl-7">
          <h1 className="text-5xl font-extrabold tracking-tight">
            <span className="text-teal-900">{primaryText}</span>
            {secondaryText ? (
              <>
                {" "}
                <span className="text-brand-gold">{secondaryText}</span>
              </>
            ) : null}
          </h1>
          {subtitle ? (
            <p className="mt-2 max-w-2xl text-[16px] font-medium leading-relaxed text-gray-500">
              {subtitle}
            </p>
          ) : null}
        </div>
      </header>
  );
}

export default PageHeroHeader;
