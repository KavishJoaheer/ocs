import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";
import { FamilyProfileProvider } from "../hooks/useFamilyProfile.jsx";

function AppShell() {
  return (
    <FamilyProfileProvider>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 pb-36 pt-6 max-md:px-4 sm:px-10 lg:px-12 lg:pb-10 lg:pt-10">
            <Outlet />
          </div>
        </main>
      </div>
    </FamilyProfileProvider>
  );
}

export default AppShell;
