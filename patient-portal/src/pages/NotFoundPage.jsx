import { Link } from "react-router-dom";
import { Home } from "lucide-react";

function NotFoundPage() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-display text-6xl font-bold text-brand-teal/20">404</p>
      <h1 className="mt-4 font-display text-2xl font-bold text-brand-dark-grey">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-brand-cool-grey">
        This page doesn&apos;t exist or may have moved. Head back to your dashboard to continue.
      </p>
      <Link
        to="/dashboard"
        className="ocs-primary-action-btn mt-8 inline-flex items-center gap-2 rounded-full bg-brand-gold px-6 py-3 text-sm font-bold text-brand-dark-grey"
      >
        <Home className="size-4" strokeWidth={2.25} aria-hidden="true" />
        Go to Dashboard
      </Link>
    </div>
  );
}

export default NotFoundPage;
