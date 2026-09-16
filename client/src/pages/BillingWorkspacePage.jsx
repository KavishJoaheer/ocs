import { lazy, Suspense } from "react";
import LoadingState from "../components/LoadingState.jsx";
import { useAuth } from "../hooks/useAuth.jsx";

const BillingLitePage = lazy(() => import("./BillingLitePage.jsx"));
const BillingPage = lazy(() => import("./BillingPage.jsx"));

function BillingWorkspacePage() {
  const { user } = useAuth();

  return (
    <Suspense fallback={<LoadingState label="Loading billing workspace" />}>
      {["doctor", "operator"].includes(user?.role) ? <BillingLitePage /> : <BillingPage />}
    </Suspense>
  );
}

export default BillingWorkspacePage;
