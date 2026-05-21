import { useEffect } from "react";
import dayjs from "dayjs";
import { Outlet, useLocation } from "react-router-dom";
import BottomNav from "../components/BottomNav.jsx";
import PushNotificationBanner from "../components/PushNotificationBanner.jsx";
import Sidebar from "../components/Sidebar.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import {
  listenForPushSubscriptionChanges,
  syncPushSubscriptionIfGranted,
} from "../lib/pushNotifications.js";
import { useIsMobile } from "../hooks/useIsMobile.js";

const pageMeta = {
  "/": {
    label: "Dashboard",
    helper: "",
  },
  "/inventory": {
    label: "Inventory",
    helper: "",
  },
  "/patients/add": {
    label: "Add patient",
    helper: "Register a new patient record.",
  },
  "/patients": {
    label: "Patients",
    helper: "",
  },
  "/appointments": {
    label: "Appointments",
    helper: "Coordinate home visit schedules in calendar and list form without losing context.",
  },
  "/doctor/current-week-roster": {
    label: "Current week roster",
    helper: "Review this week's doctor visits and move directly into patient or consultation records.",
  },
  "/doctor/april-roster": {
    label: "April roster",
    helper: "See the full monthly roster for the doctor dashboard in one filtered workspace.",
  },
  "/doctor/hcm-updates": {
    label: "HCM updates",
    helper: "Track doctor activity, consultation saves, and payment-related movement from one feed.",
  },
  "/hcm-news": {
    label: "HCM news",
    helper: "",
  },
  "/doctor/scheduled-visits": {
    label: "Scheduled visits",
    helper: "Focus on all future scheduled visits still waiting on doctor completion.",
  },
  "/doctor/pending-payment": {
    label: "Pending payment",
    helper: "Review unpaid consultation-linked billing entries tied to the doctor workspace.",
  },
  "/doctor/patients-seen-april": {
    label: "Patients seen",
    helper: "Open every unique patient seen this month based on doctor consultation records.",
  },
  "/doctor/assigned-patients": {
    label: "Assigned patients",
    helper: "Review all patients currently assigned to this doctor account.",
  },
  "/doctor/long-term-review": {
    label: "Long term review",
    helper: "Review assigned patients flagged for long-term follow-up.",
  },
  "/operator/current-week-roster": {
    label: "SOS Planning",
    helper: "Emergency SOS shift planning (inactive for operators).",
  },
  "/operator/april-roster": {
    label: "Current month roster",
    helper: "See the full monthly doctor schedule from the operator coordination workspace.",
  },
  "/operator/scheduled-visits": {
    label: "Scheduled visits",
    helper: "Track all future visits across the doctor team without leaving the operator board.",
  },
  "/operator/billing-status": {
    label: "Billing status",
    helper: "Read-only billing visibility for operators to track payment status without editing finance records.",
  },
  "/operator/pending-payment": {
    label: "Pending payment",
    helper: "Review unpaid consultation billing across all doctors from the operator workspace.",
  },
  "/operator/long-term-review": {
    label: "Long term review",
    helper: "",
  },
  "/operator/review-appointments-april": {
    label: "Monthly review",
    helper: "Review the full current-month appointment board across all doctors.",
  },
  "/consultations": {
    label: "Consultations",
    helper: "Capture doctor notes and keep billing linked automatically.",
  },
  "/lab": {
    label: "Lab Workspace",
    helper: "Review recent consultations and coordinate the internal lab intake queue.",
  },
  "/billing": {
    label: "Billing",
    helper: "",
  },
  "/team-operations": {
    label: "Team operations",
    helper: "Maintain doctor, operator, and accountant accounts from one admin workspace.",
  },
  "/doctors": {
    label: "Team operations",
    helper: "Maintain doctor, operator, and accountant accounts from one admin workspace.",
  },
};

function AppShell() {
  const location = useLocation();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const isPatientProfile =
    /^\/patients\/[^/]+$/.test(location.pathname) && location.pathname !== "/patients/add";
  const isDashboard = location.pathname === "/";
  const isPatientsDirectory = location.pathname === "/patients";
  const isInventory = location.pathname === "/inventory";
  const hideBottomNav = isMobile;
  const userRole = user?.role;
  const alwaysHideTopHeader =
    (isDashboard && (userRole === "doctor" || userRole === "operator")) ||
    (isMobile && isPatientsDirectory && userRole === "doctor") ||
    (isMobile && isInventory && userRole === "doctor");

  const dashboardMetaByRole = {
    doctor: {
      label: "Doctor dashboard",
      helper: "",
    },
    operator: {
      label: "Operator dashboard",
      helper: "",
    },
    lab_tech: {
      label: "Lab dashboard",
      helper: "",
    },
    admin: {
      label: "Admin dashboard",
      helper: "",
    },
    accountant: {
      label: "Finance dashboard",
      helper: "",
    },
  };

  const activeMeta = isPatientProfile
    ? {
        label: "Patient profile",
        helper: "",
      }
    : isDashboard
      ? dashboardMetaByRole[userRole] || pageMeta["/"]
      : pageMeta[location.pathname] || pageMeta["/"];

  useEffect(() => {
    if (!user?.role) {
      return undefined;
    }

    void syncPushSubscriptionIfGranted();
    return listenForPushSubscriptionChanges(() => {
      void syncPushSubscriptionIfGranted();
    });
  }, [user?.id, user?.role]);

  return (
    <div className="min-h-svh w-full min-w-0 max-w-[100vw] overflow-x-hidden overscroll-x-none bg-[radial-gradient(circle_at_top_left,_rgba(65,200,198,0.24),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(242,193,77,0.12),_transparent_20%),linear-gradient(180deg,_#f9fdfd_0%,_#eef8f8_100%)] text-slate-900">
      <div className="mx-auto flex min-h-svh w-full min-w-0 max-w-[1600px] flex-col overflow-x-hidden lg:flex-row">
        <Sidebar />

        <main className="min-h-0 min-w-0 w-full max-w-full flex-1 overflow-x-hidden overscroll-x-none">
          {!alwaysHideTopHeader ? (
            <div
              className="hidden border-b border-white/70 bg-white/65 px-5 py-3 backdrop-blur md:block lg:px-8"
              style={{ paddingRight: `max(1.25rem, var(--sar))` }}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    OCS Medecins Operations
                  </p>
                  <p className="mt-0.5 text-sm font-semibold leading-snug text-slate-900">{activeMeta.label}</p>
                  {activeMeta.helper ? (
                    <p className="mt-1 max-w-3xl text-sm leading-relaxed text-gray-500">{activeMeta.helper}</p>
                  ) : null}
                </div>

                {!isPatientProfile ? (
                  <p className="shrink-0 whitespace-nowrap text-sm font-medium text-slate-500 md:text-right">
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Dispatch desk
                    </span>
                    <span className="mx-2 text-slate-300" aria-hidden="true">
                      ·
                    </span>
                    {dayjs().format("dddd, MMMM D")}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div
            className={`ocs-page w-full min-w-0 max-w-full overflow-x-hidden overscroll-x-none px-4 py-3 sm:px-6 md:px-5 md:py-6 lg:px-8 ${alwaysHideTopHeader ? "lg:py-6" : "lg:py-8"}`}
            style={{
              paddingBottom: `max(1.5rem, var(--sab))`,
              paddingLeft: `max(1rem, var(--sal))`,
              paddingRight: `max(1.25rem, var(--sar))`,
            }}
          >
            {user?.role ? (
              <PushNotificationBanner role={user.role} className="mb-4 max-w-3xl" />
            ) : null}
            <Outlet />
            {!hideBottomNav && (
              <div
                className="md:hidden"
                style={{ height: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
                aria-hidden="true"
              />
            )}
          </div>
        </main>
      </div>

      {!hideBottomNav && <BottomNav />}
    </div>
  );
}

export default AppShell;
