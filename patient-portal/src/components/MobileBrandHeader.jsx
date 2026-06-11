import FamilyProfileSwitcher from "./FamilyProfileSwitcher.jsx";

function MobileBrandHeader({ className = "" }) {
  return (
    <header
      className={[
        "mobile-brand-header sticky top-0 z-40 -mx-4 border-b border-teal-500/10 bg-white/70 pt-safe shadow-[0_2px_10px_rgba(0,0,0,0.03)] backdrop-blur-md lg:hidden",
        className,
      ].join(" ")}
    >
      <div className="relative flex h-[54px] items-center justify-between px-4">
        <img
          src="/ocs-medecins-mark.png"
          alt="OCS Care"
          className="h-7 w-7 shrink-0 object-contain"
        />
        <p className="absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[2px] text-[#2d8f98]">
          OCS Care
        </p>
        <FamilyProfileSwitcher variant="avatar" />
      </div>
    </header>
  );
}

export default MobileBrandHeader;
