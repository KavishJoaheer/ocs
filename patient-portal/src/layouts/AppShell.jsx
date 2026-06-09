import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import PushNotificationBanner from "../components/PushNotificationBanner.jsx";
import { FamilyProfileProvider } from "../hooks/useFamilyProfile.jsx";

function AppShellContent() {
  const { pathname } = useLocation();
  const isNativeDashboard = pathname === "/dashboard";
  const isVisitSummary = pathname.startsWith("/health-records/visits/");
  const isFullBleedMobile = isNativeDashboard || isVisitSummary;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div
          className={[
            "mx-auto max-w-6xl sm:px-10 lg:px-12 lg:pb-10 lg:pt-10",
            isFullBleedMobile
              ? "max-md:px-0 max-md:pb-0 max-md:pt-0"
              : "px-6 pb-36 pt-6 max-md:px-4 max-md:pt-0",
          ].join(" ")}
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
