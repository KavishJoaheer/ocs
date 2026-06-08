import { Navigate } from "react-router-dom";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import LandingPage from "../pages/LandingPage.jsx";

/**
 * Root route gate. Logged-out visitors see the public welcome/landing page;
 * authenticated patients are sent to their dashboard. Keeping `/` resolved by a
 * single component avoids the ambiguous match between the public landing page
 * and the protected dashboard index route.
 */
function HomeGate() {
  const { isAuthenticated, isBootstrapping } = usePatientAuth();

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[rgba(65,200,198,0.3)] border-t-[#2d8f98]" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <LandingPage />;
}

export default HomeGate;
