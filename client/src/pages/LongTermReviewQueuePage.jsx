import PageHeader from "../components/PageHeader.jsx";
import LoadingState from "../components/LoadingState.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LongTermReviewOperatorPanel from "../components/LongTermReviewOperatorPanel.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { useLongTermReviewQueue } from "../hooks/useLongTermReviewQueue.js";

export default function LongTermReviewQueuePage() {
  const isMobile = useIsMobile();
  const { patients, loading, error, reload } = useLongTermReviewQueue();

  if (loading) {
    return <LoadingState label="Loading long term review queue" />;
  }

  if (error) {
    return (
      <EmptyState
        title="Long term review unavailable"
        description={error}
      />
    );
  }

  const queue = (
    <LongTermReviewOperatorPanel patients={patients} onPatientsChange={reload} />
  );

  if (isMobile) {
    return (
      <div className="mx-auto w-full max-w-md space-y-4 pb-8">
        <header>
          <h1 className="text-xl font-bold tracking-tight text-ocs-slate">Long term review</h1>
        </header>
        {queue}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clinical follow-up"
        title="Long term review"
        description="Practice-wide queue of patients flagged for chronic care follow-up."
      />
      {queue}
    </div>
  );
}
