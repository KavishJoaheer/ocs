import { Home, FileText, Calendar, CircleUserRound } from "lucide-react";
import { NavLink } from "react-router-dom";

/** Premium floating pill bottom navigation for the native mobile experience. */
const navItems = [
  { to: "/dashboard", label: "Home", icon: Home, end: true },
  { to: "/health-records", label: "Records", icon: FileText },
  { to: "/appointments", label: "Visits", icon: Calendar },
  { to: "/profile", label: "Profile", icon: CircleUserRound },
];

function MobileBottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 px-[var(--native-pad-screen)] pb-[max(env(safe-area-inset-bottom,0px),12px)] pt-2 lg:hidden"
      aria-label="Main navigation"
    >
      <div className="mobile-nav-pill mx-auto flex max-w-md items-center justify-around rounded-full bg-white/80 px-2 py-2 backdrop-blur-xl">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              end={item.end}
              to={item.to}
              className="flex min-h-[44px] min-w-[64px] flex-1 flex-col items-center justify-center gap-1 rounded-full transition-all"
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
                    {item.label}
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
