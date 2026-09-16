import { useAuth } from "../hooks/useAuth.jsx";
import BillingLitePage from "./BillingLitePage.jsx";
import BillingPage from "./BillingPage.jsx";

function BillingWorkspacePage() {
  const { user } = useAuth();

  if (["doctor", "operator"].includes(user?.role)) return <BillingLitePage />;

  return <BillingPage />;
}

export default BillingWorkspacePage;
