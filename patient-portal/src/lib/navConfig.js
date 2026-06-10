import {
  LayoutDashboard,
  HeartPulse,
  CalendarCheck,
  ReceiptText,
  CircleUserRound,
  Home,
  FileText,
  Calendar,
} from "lucide-react";

export const PATIENT_NAV_ITEMS = [
  {
    to: "/dashboard",
    label: "Dashboard",
    mobileLabel: "Home",
    icon: LayoutDashboard,
    mobileIcon: Home,
    end: true,
  },
  {
    to: "/health-records",
    label: "Health Records",
    mobileLabel: "Records",
    icon: HeartPulse,
    mobileIcon: FileText,
  },
  {
    to: "/appointments",
    label: "Appointments",
    mobileLabel: "Visits",
    icon: CalendarCheck,
    mobileIcon: Calendar,
  },
  {
    to: "/billing",
    label: "Billing",
    mobileLabel: "Billing",
    icon: ReceiptText,
    mobileIcon: ReceiptText,
  },
  {
    to: "/profile",
    label: "Profile",
    mobileLabel: "Profile",
    icon: CircleUserRound,
    mobileIcon: CircleUserRound,
  },
];
