/** Centers desktop pages on max-w-7xl and enforces the px-10 content spine below the hero. */
function DesktopPageFrame({ children, className = "" }) {
  return (
    <div className={["mx-auto w-full max-w-7xl", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

function DesktopPageBody({ children, className = "" }) {
  return (
    <div className={["px-4 pb-10 lg:px-10", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export { DesktopPageFrame, DesktopPageBody };
