import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import PushNotificationBanner from "../components/PushNotificationBanner.jsx";
import { FamilyProfileProvider } from "../hooks/useFamilyProfile.jsx";
import { RequestVisitProvider } from "../hooks/useRequestVisit.jsx";

function AppShellContent() {
  const { pathname } = useLocation();
  const isNativeDashboard = pathname === "/dashboard";
  const isVisitSummary = pathname.startsWith("/health-records/visits/");
  const isVisitStatus = pathname === "/request-visit/tracking";
  const isProfile = pathname === "/profile";
  const isHealthRecords = pathname === "/health-records";
  const isAppointments = pathname === "/appointments";
  const isBilling = pathname === "/billing";
  const isFullBleedMobile =
    isNativeDashboard ||
    isVisitSummary ||
    isVisitStatus ||
    isProfile ||
    isHealthRecords ||
    isAppointments ||
    isBilling;
  return (
    <div className="flex h-dvh min-h-0 flex-col lg:h-auto lg:min-h-screen lg:flex-row">
      <Sidebar />
      <main
        id="app-main-scroll"
        className="min-h-0 flex-1 overflow-y-auto max-lg:bg-[#F2F2F7] max-lg:pb-[var(--native-nav-clearance)] lg:bg-[var(--desktop-canvas)]"
      >
        <div
          className={
            isProfile || isHealthRecords
              ? "w-full max-lg:px-0 max-lg:pt-0 lg:pb-10 lg:pt-0"
              : [
                  "mx-auto max-w-6xl sm:px-10 lg:px-12 lg:pb-10 lg:pt-8",
                  isFullBleedMobile
                    ? "max-lg:px-0 max-lg:pt-0"
                    : "px-6 pt-6 max-md:px-[var(--native-pad-screen)] max-md:pt-0",
                ].join(" ")
          }
        >
          {!isFullBleedMobile ? <PushNotificationBanner className="mb-5" /> : null}
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function AppShell() {
  return (
    <FamilyProfileProvider>
      <RequestVisitProvider>
        <AppShellContent />
      </RequestVisitProvider>
    </FamilyProfileProvider>
  );
}

export default AppShell;
