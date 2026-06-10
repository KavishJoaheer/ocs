import { NavLink } from "react-router-dom";
import { PATIENT_NAV_ITEMS } from "../lib/navConfig.js";

function MobileBottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex w-full items-stretch border-t border-teal-500/20 bg-white/80 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(0,0,0,0.05)] backdrop-blur-xl lg:hidden"
      aria-label="Main navigation"
    >
      {PATIENT_NAV_ITEMS.map((item) => {
        const InactiveIcon = item.mobileIcon;
        const ActiveIcon = item.mobileIconActive ?? item.mobileIcon;

        return (
          <NavLink
            key={item.to}
            end={item.end}
            to={item.to}
            className="mobile-nav-item flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5"
          >
            {({ isActive }) => {
              const Icon = isActive ? ActiveIcon : InactiveIcon;

              return (
                <>
                  <span className="relative flex size-8 items-center justify-center">
                    {isActive ? (
                      <span
                        className="pointer-events-none absolute -bottom-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-teal-500 shadow-[0_0_10px_rgba(45,143,152,0.55)]"
                        aria-hidden="true"
                      />
                    ) : null}
                    <Icon
                      className={[
                        "size-6 transition-colors duration-200",
                        isActive ? "text-teal-700" : "text-gray-400",
                      ].join(" ")}
                      strokeWidth={isActive ? 2 : 1.75}
                      fill={isActive ? "currentColor" : "none"}
                    />
                  </span>
                  <span
                    className={[
                      "text-[10px] leading-none transition-colors duration-200",
                      isActive ? "font-bold text-teal-800" : "font-medium text-gray-400",
                    ].join(" ")}
                  >
                    {item.mobileLabel}
                  </span>
                </>
              );
            }}
          </NavLink>
        );
      })}
    </nav>
  );
}

export default MobileBottomNav;
