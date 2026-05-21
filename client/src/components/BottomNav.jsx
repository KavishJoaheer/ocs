import { NavLink } from "react-router-dom";
import { useMemo } from "react";
import {
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Package,
  Stethoscope,
  UsersRound,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth.jsx";
import { cx } from "../lib/utils.js";

export const bottomNavItems = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true, roles: ["admin", "doctor", "operator", "lab_tech", "accountant"] },
  { to: "/patients", label: "Patients", icon: UsersRound, roles: ["admin", "doctor", "operator", "lab_tech"] },
  { to: "/billing", label: "Billing", icon: CreditCard, roles: ["admin", "accountant"] },
  { to: "/operator/billing-status", label: "Billing", icon: CreditCard, roles: ["operator"] },
  { to: "/lab", label: "Lab", icon: Stethoscope, roles: ["lab_tech"] },
  { to: "/consultations", label: "Consults", icon: ClipboardList, roles: ["lab_tech"] },
  { to: "/inventory", label: "Inventory", icon: Package, roles: ["admin", "doctor", "operator"] },
];

function BottomNav() {
  const { user } = useAuth();
  const items = useMemo(
    () => bottomNavItems.filter((item) => item.roles.includes(user.role)),
    [user.role],
  );

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-[rgba(65,200,198,0.14)] bg-white/95 backdrop-blur-lg md:hidden"
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
                  isActive ? "bg-[rgba(65,200,198,0.1)] text-[#2d8f98]" : "text-slate-400",
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
