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
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-ocs-slate shadow-md md:hidden"
      style={{ paddingBottom: `max(0.5rem, var(--sab))`, paddingLeft: "var(--sal)", paddingRight: "var(--sar)" }}
    >
      <div className="flex items-stretch justify-around px-2 pt-2 pb-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              end={item.end}
              to={item.to}
              className={({ isActive }) =>
                cx(
                  "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold transition",
                  isActive ? "text-ocs-teal" : "text-white/70",
                )
              }
            >
              <Icon className="size-6 transition" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

export default BottomNav;
