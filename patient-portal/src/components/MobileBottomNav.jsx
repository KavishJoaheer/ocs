import { NavLink } from "react-router-dom";
import { PATIENT_NAV_ITEMS } from "../lib/navConfig.js";

function MobileBottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 w-full border-t-2 border-brand-teal/20 bg-white/90 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl lg:hidden"
      aria-label="Main navigation"
    >
      <div className="flex h-[80px] items-center justify-between px-6">
        {PATIENT_NAV_ITEMS.map((item) => {
          const InactiveIcon = item.mobileIcon;
          const ActiveIcon = item.mobileIconActive ?? item.mobileIcon;

          return (
            <NavLink
              key={item.to}
              end={item.end}
              to={item.to}
              className="mobile-nav-item flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1.5"
            >
              {({ isActive }) => {
                const Icon = isActive ? ActiveIcon : InactiveIcon;

                return (
                  <>
                    <span className="relative flex size-[28px] items-center justify-center">
                      {isActive ? (
                        <span
                          className="pointer-events-none absolute inset-0 rounded-full bg-brand-teal/15 blur-md"
                          aria-hidden="true"
                        />
                      ) : null}
                      <Icon
                        className={[
                          "relative size-[28px] transition-colors duration-200",
                          isActive ? "text-brand-teal" : "text-gray-400",
                        ].join(" ")}
                        strokeWidth={isActive ? 2.25 : 1.75}
                        fill={isActive ? "currentColor" : "none"}
                      />
                    </span>
                    <span className="relative">
                      {isActive ? (
                        <span
                          className="pointer-events-none absolute -bottom-1 left-1/2 h-1.5 w-8 -translate-x-1/2 rounded-full bg-brand-teal/35 blur-[3px]"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span
                        className={[
                          "relative block text-[12px] leading-none transition-colors duration-200",
                          isActive ? "font-semibold text-brand-teal" : "font-semibold text-gray-400",
                        ].join(" ")}
                      >
                        {item.mobileLabel}
                      </span>
                    </span>
                  </>
                );
              }}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export default MobileBottomNav;
