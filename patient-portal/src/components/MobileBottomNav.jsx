import { NavLink } from "react-router-dom";
import { PATIENT_NAV_ITEMS } from "../lib/navConfig.js";

function MobileBottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 w-full bg-white/90 backdrop-blur-md border-t border-gray-200 pb-[env(safe-area-inset-bottom)] pt-2 px-6 flex justify-between items-center z-50 rounded-none m-0 lg:hidden"
      aria-label="Main navigation"
    >
      {PATIENT_NAV_ITEMS.map((item) => {
        const Icon = item.mobileIcon;
        return (
          <NavLink
            key={item.to}
            end={item.end}
            to={item.to}
            className="flex min-h-[44px] min-w-[52px] flex-col items-center justify-center gap-1"
          >
            {({ isActive }) => (
              <>
                <span
                  className={[
                    "flex size-9 items-center justify-center",
                    isActive
                      ? "squircle-inner-active rounded-[14px] bg-gradient-to-br from-[#2d8f98] to-[#41c8c6] text-white"
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
                    isActive ? "native-label font-semibold text-[#1a5c52]" : "font-medium text-[#8a9e9a]",
                  ].join(" ")}
                >
                  {item.mobileLabel}
                </span>
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

export default MobileBottomNav;
