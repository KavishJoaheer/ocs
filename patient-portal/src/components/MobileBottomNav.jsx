import { NavLink } from "react-router-dom";
import { PATIENT_NAV_ITEMS } from "../lib/navConfig.js";

function MobileBottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 m-0 flex w-full items-center justify-between rounded-none border-t border-gray-200 bg-white px-5 pt-1.5 pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="Main navigation"
    >
      {PATIENT_NAV_ITEMS.map((item) => {
        const Icon = item.mobileIcon;
        return (
          <NavLink
            key={item.to}
            end={item.end}
            to={item.to}
            className="flex min-h-[48px] min-w-[56px] flex-col items-center justify-center gap-0.5"
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={[
                    "size-[22px]",
                    isActive ? "text-[#0D9E8A]" : "text-gray-400",
                  ].join(" ")}
                  strokeWidth={isActive ? 2.25 : 1.75}
                  fill={isActive ? "currentColor" : "none"}
                />
                <span
                  className={[
                    "text-[10px] leading-none",
                    isActive ? "font-semibold text-[#0D9E8A]" : "font-medium text-gray-400",
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
