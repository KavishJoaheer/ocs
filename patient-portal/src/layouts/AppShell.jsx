import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";

function AppShell() {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default AppShell;
