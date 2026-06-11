/** Page task title below the identity strip — teal + orange split. Mobile only. */
function MobilePageTitle({ primaryText, secondaryText, subtitle, children, className = "" }) {
  return (
    <div className={["px-4 pb-4 pt-4 lg:hidden", className].filter(Boolean).join(" ")}>
      <h1 className="text-[26px] font-bold leading-[1.2] tracking-tight">
        <span className="text-teal-900">{primaryText}</span>
        {secondaryText ? (
          <>
            {" "}
            <span className="text-brand-gold">{secondaryText}</span>
          </>
        ) : null}
      </h1>
      {subtitle ? <p className="mt-1.5 text-[13px] text-gray-500">{subtitle}</p> : null}
      {children}
    </div>
  );
}

export default MobilePageTitle;
