import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import PushNotificationBanner from "../components/PushNotificationBanner.jsx";
import { FamilyProfileProvider } from "../hooks/useFamilyProfile.jsx";

function AppShellContent() {
  const { pathname } = useLocation();
  const isNativeDashboard = pathname === "/dashboard";
  const isVisitSummary = pathname.startsWith("/health-records/visits/");
  const isVisitStatus = pathname === "/request-visit/tracking";
  const isProfile = pathname === "/profile";
  const isFullBleedMobile = isNativeDashboard || isVisitSummary || isVisitStatus || isProfile;
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar />
      <main
        id="app-main-scroll"
        className="flex-1 overflow-y-auto max-md:bg-transparent lg:bg-[var(--desktop-canvas)]"
      >
        <div
          className={
            isProfile
              ? "w-full max-md:px-0 max-md:pb-0 max-md:pt-0 lg:pb-10 lg:pt-0"
              : [
                  "mx-auto max-w-6xl sm:px-10 lg:px-12 lg:pb-10 lg:pt-8",
                  isFullBleedMobile
                    ? "max-md:px-0 max-md:pb-0 max-md:pt-0"
                    : "px-6 pt-6 max-md:px-[var(--native-pad-screen)] max-md:pb-0 max-md:pt-0",
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
      <AppShellContent />
    </FamilyProfileProvider>
  );
}

export default AppShell;
