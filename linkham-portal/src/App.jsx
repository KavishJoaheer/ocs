import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AppShell from "./layouts/AppShell.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import LinkhamDashboardPage from "./pages/linkham/LinkhamDashboardPage.jsx";
import LinkhamPatientsPage from "./pages/linkham/LinkhamPatientsPage.jsx";
import LinkhamClaimsClearancePage from "./pages/linkham/LinkhamClaimsClearancePage.jsx";
import LinkhamReportsPage from "./pages/linkham/LinkhamReportsPage.jsx";

function App() {
  return (
    <div className="min-h-svh w-full min-w-0 max-w-[100vw] overflow-x-hidden overscroll-x-none">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route element={<ProtectedRoute roles={["linkham_admin"]} />}>
              <Route path="/linkham/dashboard" element={<LinkhamDashboardPage />} />
              <Route path="/linkham/patients" element={<LinkhamPatientsPage />} />
              <Route path="/linkham/claims-clearance" element={<LinkhamClaimsClearancePage />} />
              <Route path="/linkham/reports" element={<LinkhamReportsPage />} />
              <Route path="/" element={<Navigate to="/linkham/dashboard" replace />} />
            </Route>

            <Route path="*" element={<Navigate to="/linkham/dashboard" replace />} />
          </Route>
        </Route>
      </Routes>
    </div>
  );
}

export default App;
