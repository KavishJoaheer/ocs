import { NavLink } from "react-router-dom";
import { PATIENT_NAV_ITEMS } from "../lib/navConfig.js";

/** Edge-to-edge native tab bar for the mobile web experience. */
function MobileBottomNav() {
  return (
    <nav
      className="mobile-nav-bar fixed bottom-0 left-0 right-0 z-[var(--z-nav)] w-full border-t border-gray-200 bg-white/90 backdrop-blur-md lg:hidden"
      aria-label="Main navigation"
    >
      <div className="flex w-full items-stretch justify-around px-1 pt-2 pb-[max(env(safe-area-inset-bottom,0px),12px)]">
        {PATIENT_NAV_ITEMS.map((item) => {
          const Icon = item.mobileIcon;
          return (
            <NavLink
              key={item.to}
              end={item.end}
              to={item.to}
              className="flex min-h-[44px] min-w-[52px] flex-1 flex-col items-center justify-center gap-1 transition-all"
            >
              {({ isActive }) => (
                <>
                  <span
                    className={[
                      "flex size-9 items-center justify-center transition-all",
                      isActive
                        ? "squircle-inner-active bg-gradient-to-br from-[#2d8f98] to-[#41c8c6] text-white"
                        : "text-[#8a9e9a]",
                    ].join(" ")}
                  >
                    <Icon
                      className="size-[18px]"
                      strokeWidth={isActive ? 2.25 : 1.75}
                      fill={isActive ? "currentColor" : "none"}
                    />
                  </span>
                  <span
                    className={[
                      "text-[10px] leading-none tracking-wide",
                      isActive ? "native-label text-[#1a5c52]" : "font-medium text-[#8a9e9a]",
                    ].join(" ")}
                  >
                    {item.mobileLabel}
                  </span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export default MobileBottomNav;
