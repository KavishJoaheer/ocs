import {
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Package,
  PieChart,
  Stethoscope,
  UsersRound,
} from "lucide-react";

export const bottomNavItems = [
  { to: "/", label: "Home", icon: LayoutDashboard, end: true, roles: ["admin", "doctor", "operator", "lab_tech", "accountant"] },
  { to: "/patients", label: "Patients", icon: UsersRound, roles: ["admin", "doctor", "operator", "lab_tech"] },
  { to: "/billing", label: "Billing", icon: CreditCard, roles: ["admin", "accountant"] },
  { to: "/operator/billing-status", label: "Billing", icon: CreditCard, roles: ["operator"] },
  { to: "/lab", label: "Lab", icon: Stethoscope, roles: ["lab_tech"] },
  { to: "/consultations", label: "Consults", icon: ClipboardList, roles: ["lab_tech"] },
  { to: "/inventory", label: "Inventory", icon: Package, roles: ["admin", "doctor", "operator"] },
];

export const linkhamBottomNavItems = [
  { to: "/linkham/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true, roles: ["linkham_admin"] },
  { to: "/linkham/patients", label: "Patients", icon: UsersRound, roles: ["linkham_admin"] },
  { to: "/linkham/claims-clearance", label: "Claims", icon: ClipboardList, roles: ["linkham_admin"] },
  { to: "/linkham/reports", label: "Reports", icon: PieChart, roles: ["linkham_admin"] },
];
