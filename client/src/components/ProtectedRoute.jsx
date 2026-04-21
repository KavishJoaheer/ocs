import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getDefaultPathForRole } from "../lib/access.js";
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
    return <Navigate to={getDefaultPathForRole(user.role)} replace />;
  }

  return <Outlet />;
}

export default ProtectedRoute;
