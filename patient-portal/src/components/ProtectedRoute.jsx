import { Navigate, useLocation } from "react-router-dom";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";

function ProtectedRoute({ children }) {
  const { isAuthenticated, isBootstrapping } = usePatientAuth();
  const location = useLocation();

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[rgba(65,200,198,0.3)] border-t-[#2d8f98]" />
          <p className="text-sm font-medium text-[#5b7f8a]">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

export default ProtectedRoute;
