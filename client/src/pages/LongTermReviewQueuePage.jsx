import { useState } from "react";
import PageHeader from "../components/PageHeader.jsx";
import LoadingState from "../components/LoadingState.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LongTermReviewOperatorPanel from "../components/LongTermReviewOperatorPanel.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { useLongTermReviewQueue } from "../hooks/useLongTermReviewQueue.js";

export default function LongTermReviewQueuePage() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [scope, setScope] = useState(user?.role === "doctor" ? "mine" : "all");
  const { patients, loading, error, reload, applyPatient } = useLongTermReviewQueue({ scope });

  async function handlePatientsChange(updated) {
    applyPatient(updated);
    await reload();
  }

  if (loading) {
    return <LoadingState label="Loading review appointment queue" />;
  }

  if (error) {
    return (
      <EmptyState
        title="Review appointment unavailable"
        description={error}
      />
    );
  }

  const queue = (
    <LongTermReviewOperatorPanel
      patients={patients}
      scope={scope}
      onScopeChange={setScope}
      onPatientsChange={handlePatientsChange}
    />
  );

  if (isMobile) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 pb-8">
        <header>
          <h1 className="text-xl font-bold tracking-tight text-ocs-slate">Review appointment</h1>
        </header>
        {queue}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Review appointment" />
      {queue}
    </div>
  );
}
