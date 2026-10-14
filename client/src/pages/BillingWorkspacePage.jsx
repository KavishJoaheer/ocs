import { lazy, Suspense } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import LoadingState from "../components/LoadingState.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";

const BillingLitePage = lazy(() => import("./BillingLitePage.jsx"));
const BillingPage = lazy(() => import("./BillingPage.jsx"));
const InvoiceDetailPage = lazy(() => import("./InvoiceDetailPage.jsx"));
const IssuedInvoicesPage = lazy(() => import("./OperatorBillingStatusPage.jsx"));

function BillingWorkspacePage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [params] = useSearchParams();

  if (user?.role === "doctor" && isMobile) {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={<LoadingState label="Loading billing workspace" />}>
      {["doctor", "operator"].includes(user?.role)
        ? !isMobile && params.has("billId") ? <InvoiceDetailPage />
          : !isMobile && (["paid", "unpaid"].includes(params.get("status")) || params.get("view") === "invoices") ? <IssuedInvoicesPage />
            : <BillingLitePage />
        : <BillingPage />}
    </Suspense>
  );
}

export default BillingWorkspacePage;
