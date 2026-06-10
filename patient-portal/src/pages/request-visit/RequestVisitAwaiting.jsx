import { useEffect } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import dayjs from "dayjs";
import { Headphones } from "lucide-react";
import { api } from "../../lib/api.js";
import { URGENCY_META } from "./urgency.js";

function RequestVisitAwaiting() {
  const navigate = useNavigate();
  const { draft } = useOutletContext();

  const submittedAt = draft.submittedAt ? dayjs(draft.submittedAt) : dayjs();
  const urgencyLabel = (URGENCY_META[draft.urgency] || URGENCY_META.routine).label;

  useEffect(() => {
    if (!draft.submittedAt) {
      navigate("/request-visit", { replace: true });
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      try {
        const data = await api.get("/patient-portal/visit-requests/active");
        navigate(data.visit_request ? "/request-visit/tracking" : "/dashboard");
      } catch {
        navigate("/dashboard");
      }
    }, 6000);

    return () => window.clearTimeout(timer);
  }, [draft.submittedAt, navigate]);

  return (
    <div className="mx-auto flex min-h-[72vh] max-w-[460px] animate-fade-in-fast flex-col items-center justify-center text-center">
      <div className="relative flex size-28 items-center justify-center">
        <span className="animate-breathe absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(65,200,198,0.45),rgba(65,200,198,0.05)_70%)]" />
        <span className="relative flex size-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] shadow-[0_16px_40px_rgba(45,143,152,0.3)]">
          <Headphones className="size-6 text-white" />
        </span>
      </div>

      <h1 className="mt-10 font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
        Your request is with our team.
      </h1>
      <p className="mt-3 max-w-sm text-base font-light leading-relaxed text-[#5b7f8a]">
        Expect a call from us shortly to confirm your visit and assign your doctor.
      </p>

      <div className="mt-8 rounded-full bg-white/70 px-5 py-2.5">
        <p className="text-xs text-[#6e949b]">
          Request submitted at {submittedAt.format("h:mm A")} · Urgency: {urgencyLabel}
        </p>
      </div>

      <div className="mt-10 flex flex-col items-center gap-3">
        <Link
          to="/dashboard"
          className="text-sm font-medium text-[#94a9ad] transition hover:text-[#5b7f8a]"
        >
          ← Return to Dashboard
        </Link>
        <a
          href="tel:52522234"
          className="text-sm font-semibold text-[#2d8f98] transition hover:text-[#23767f]"
        >
          Need immediate help? Call 52 52 22 34
        </a>
      </div>
    </div>
  );
}

export default RequestVisitAwaiting;
