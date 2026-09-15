import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.jsx";
import BillingLitePage from "./BillingLitePage.jsx";
import BillingPage from "./BillingPage.jsx";

function BillingWorkspacePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const doctorHistory = user?.role === "doctor" && searchParams.get("view") === "history";

  if (user?.role === "doctor" && !doctorHistory) {
    return (
      <BillingLitePage
        onOpenHistory={() => {
          const next = new URLSearchParams(searchParams);
          next.set("view", "history");
          setSearchParams(next);
        }}
      />
    );
  }

  if (doctorHistory) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete("view");
            setSearchParams(next);
          }}
          className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-[#17666a] px-4 text-sm font-black text-white shadow-sm transition active:scale-95"
        >
          <ArrowLeft className="size-5" />
          Back to quick billing
        </button>
        <BillingPage />
      </div>
    );
  }

  return <BillingPage />;
}

export default BillingWorkspacePage;
