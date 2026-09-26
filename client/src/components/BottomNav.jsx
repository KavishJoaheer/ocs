import { NavLink } from "react-router-dom";
import { useMemo } from "react";
import { useAuth } from "../hooks/useAuth.jsx";
import { cx } from "../lib/utils.js";
import { bottomNavItems, linkhamBottomNavItems } from "../lib/bottomNavItems.js";

function BottomNav() {
  const { user } = useAuth();
  const items = useMemo(() => {
    const source = user.role === "linkham_admin" ? linkhamBottomNavItems : bottomNavItems;
    return source.filter((item) => item.roles.includes(user.role));
  }, [user.role]);

  return (
    <nav
      id="ocs-bottom-nav"
      className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 px-3 md:hidden"
      style={{ paddingBottom: `max(0.75rem, var(--sab))`, paddingLeft: `max(0.75rem, var(--sal))`, paddingRight: `max(0.75rem, var(--sar))` }}
      aria-label="Primary navigation"
    >
      <div className="pointer-events-auto mx-auto flex max-w-md items-stretch justify-around rounded-[26px] border border-white/80 bg-white/88 p-1.5 shadow-[0_18px_48px_rgba(59,89,92,0.2)] backdrop-blur-2xl">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              end={item.end}
              to={item.to}
              className={({ isActive }) =>
                cx(
                  "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[20px] px-1.5 py-2 text-[10px] font-semibold transition-all duration-200",
                  isActive
                    ? "bg-ocs-slate text-white shadow-[0_8px_18px_rgba(59,89,92,0.2)]"
                    : "text-ocs-grey hover:bg-ocs-teal/8 hover:text-ocs-slate",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="size-[22px] transition" strokeWidth={isActive ? 2.25 : 1.8} />
                  <span className="max-w-full truncate">{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
