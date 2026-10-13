import { lazy, Suspense } from "react";
import { Navigate } from "react-router-dom";
import LoadingState from "../components/LoadingState.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";

const BillingLitePage = lazy(() => import("./BillingLitePage.jsx"));
const BillingPage = lazy(() => import("./BillingPage.jsx"));

function BillingWorkspacePage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();

  if (user?.role === "doctor" && isMobile) {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={<LoadingState label="Loading billing workspace" />}>
      {["doctor", "operator"].includes(user?.role) ? <BillingLitePage /> : <BillingPage />}
    </Suspense>
  );
}

export default BillingWorkspacePage;
