import FamilyProfileSwitcher from "./FamilyProfileSwitcher.jsx";

/** Slim brand identity strip — logo left, avatar right. Mobile only. */
function MobileIdentityHeader({ centerLabel = null }) {
  return (
    <header className="mobile-identity-header relative sticky top-0 z-40 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3 pt-safe shadow-sm lg:hidden">
      <img
        src="/ocs-medecins-mark.png"
        alt="OCS Care"
        className="h-8 w-8 shrink-0 object-contain"
      />

      {centerLabel ? (
        <p className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider text-brand-teal">
          {centerLabel}
        </p>
      ) : null}

      <FamilyProfileSwitcher variant="avatar" />
    </header>
  );
}

export default MobileIdentityHeader;
