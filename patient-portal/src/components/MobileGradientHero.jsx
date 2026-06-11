/** Full-width teal gradient hero band — mobile only (max-lg). */
function MobileGradientHero({
  headline,
  subline,
  icon: Icon,
  minHeightClass = "min-h-[130px]",
  outstandingAmount = null,
  formatOutstanding,
  footer = null,
}) {
  const showOutstanding =
    outstandingAmount != null && Number(outstandingAmount) > 0 && formatOutstanding;

  return (
    <header className={`mobile-gradient-hero relative box-border w-full lg:hidden ${minHeightClass}`}>
      <div className="mobile-gradient-hero__inner pb-7 pt-[calc(env(safe-area-inset-top,0px)+24px)]">
        <div className="flex items-center gap-2.5">
          {Icon ? (
            <Icon className="size-[18px] shrink-0 text-white/80" strokeWidth={2} aria-hidden="true" />
          ) : null}
          <h1 className="text-[26px] font-bold leading-[1.2] text-white">{headline}</h1>
        </div>
        <p className="mt-1.5 text-[13px] font-light text-white/75">{subline}</p>
        {showOutstanding ? (
          <span className="mt-3 inline-flex rounded-[20px] border border-[rgba(232,160,32,0.4)] bg-[rgba(232,160,32,0.2)] px-3.5 py-1.5 text-[13px] font-semibold text-[#E8A020]">
            {formatOutstanding(outstandingAmount)} outstanding
          </span>
        ) : null}
      </div>

      {footer ? (
        <div className="mobile-gradient-hero__footer relative z-10 -mt-4" style={{ marginBottom: "-16px" }}>
          {footer}
        </div>
      ) : null}
    </header>
  );
}

export default MobileGradientHero;
