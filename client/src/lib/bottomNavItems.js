import {
  House,
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
  { to: "/visit-requests", label: "Visits", icon: ClipboardList, roles: ["doctor"] },
  { to: "/admin/finance", label: "Finance", icon: CreditCard, roles: ["admin", "accountant"] },
  { to: "/lab", label: "Lab", icon: Stethoscope, roles: ["lab_tech"] },
  { to: "/consultations", label: "Consults", icon: ClipboardList, roles: ["lab_tech"] },
  { to: "/inventory", label: "Inventory", icon: Package, roles: ["admin", "doctor"] },
];

export const operatorBottomNavItems = [
  { to: "/", label: "Home", icon: House, end: true, roles: ["operator"] },
  { to: "/patients/add", label: "Add patient", icon: UserPlus, roles: ["operator"] },
  { to: "/operator/long-term-review", label: "Reviews", icon: ClipboardList, roles: ["operator"] },
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
