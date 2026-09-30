import {
  Activity,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Package,
  PieChart,
  Stethoscope,
  UserPlus,
  UsersRound,
} from "lucide-react";

export const bottomNavItems = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true, roles: ["admin", "doctor", "lab_tech", "accountant"] },
  { to: "/patients", label: "Patients", icon: UsersRound, roles: ["admin", "doctor", "lab_tech"] },
  { to: "/billing", label: "Billing", icon: CreditCard, roles: ["doctor"] },
  { to: "/admin/finance", label: "Finance", icon: CreditCard, roles: ["admin", "accountant"] },
  { to: "/lab", label: "Lab", icon: Stethoscope, roles: ["lab_tech"] },
  { to: "/consultations", label: "Consults", icon: ClipboardList, roles: ["lab_tech"] },
  { to: "/inventory", label: "Inventory", icon: Package, roles: ["admin", "doctor"] },
];

export const operatorBottomNavItems = [
  {
    to: "/patients",
    label: "Patients",
    icon: UsersRound,
    roles: ["operator"],
    isActiveWhen: (location) =>
      location.pathname.startsWith("/patients") && location.pathname !== "/patients/add",
  },
  { to: "/patients/add", label: "Add patient", icon: UserPlus, roles: ["operator"] },
  { to: "/visit-requests", label: "Visits", icon: ClipboardList, roles: ["operator"] },
  { to: "/operator/long-term-review", label: "Reviews", icon: Activity, roles: ["operator"] },
];

export const linkhamBottomNavItems = [
  { to: "/linkham/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true, roles: ["linkham_admin"] },
  { to: "/linkham/patients", label: "Patients", icon: UsersRound, roles: ["linkham_admin"] },
  { to: "/linkham/claims-clearance", label: "Claims", icon: ClipboardList, roles: ["linkham_admin"] },
  { to: "/linkham/reports", label: "Reports", icon: PieChart, roles: ["linkham_admin"] },
];

export function getBottomNavItemsForRole(role) {
  if (role === "linkham_admin") return linkhamBottomNavItems;
  if (role === "operator") return operatorBottomNavItems;
  return bottomNavItems;
}
