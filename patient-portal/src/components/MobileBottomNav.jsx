import { NavLink } from "react-router-dom";
import { PATIENT_NAV_ITEMS } from "../lib/navConfig.js";

function MobileBottomNav() {
  return (
    <nav
      className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 w-full px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
      aria-label="Main navigation"
    >
      <div className="pointer-events-auto mx-auto flex min-h-[68px] max-w-md items-center justify-between rounded-[26px] border border-white/80 bg-white/88 p-1.5 shadow-[0_18px_48px_rgba(59,89,92,0.2)] backdrop-blur-2xl">
        {PATIENT_NAV_ITEMS.map((item) => {
          const InactiveIcon = item.mobileIcon;
          const ActiveIcon = item.mobileIconActive ?? item.mobileIcon;

          return (
            <NavLink
              key={item.to}
              end={item.end}
              to={item.to}
              className={({ isActive }) => [
                "mobile-nav-item flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[20px] px-1.5 py-2 transition-all duration-200",
                isActive ? "bg-brand-dark-grey text-white shadow-[0_8px_18px_rgba(59,89,92,0.2)]" : "text-brand-cool-grey",
              ].join(" ")}
            >
              {({ isActive }) => {
                const Icon = isActive ? ActiveIcon : InactiveIcon;

                return (
                  <>
                    <span className="relative flex size-[24px] items-center justify-center">
                      <Icon
                        className={[
                          "relative size-[22px] transition-colors duration-200",
                          isActive ? "text-white" : "text-brand-cool-grey",
                        ].join(" ")}
                        strokeWidth={isActive ? 2.25 : 1.75}
                      />
                    </span>
                    <span className="relative max-w-full">
                      <span
                        className={[
                          "relative block max-w-full truncate whitespace-nowrap text-[10px] font-semibold leading-none tracking-tight transition-colors duration-200",
                          isActive ? "text-white" : "text-brand-cool-grey",
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
