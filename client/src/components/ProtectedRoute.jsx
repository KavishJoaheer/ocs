import { Navigate, Outlet, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { getDefaultPathForRole, isFinancialBillingPath } from "../lib/access.js";
import { useAuth } from "../hooks/useAuth.jsx";
import LoadingState from "./LoadingState.jsx";

function ProtectedRoute({ roles }) {
  const location = useLocation();
  const { isAuthenticated, isBootstrapping, user } = useAuth();

  if (isBootstrapping) {
    return <LoadingState label="Restoring session" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (roles?.length && !roles.includes(user.role)) {
    if (user.role === "operator" && isFinancialBillingPath(location.pathname)) {
      toast.error("Unauthorized: Financial access restricted to Admins and Billing staff.");
    }

    return <Navigate to={getDefaultPathForRole(user.role)} replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;
