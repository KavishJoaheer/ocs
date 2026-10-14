import { useState } from "react";
import LongTermReviewOperatorPanel from "../components/LongTermReviewOperatorPanel.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useLongTermReviewQueue } from "../hooks/useLongTermReviewQueue.js";

export default function LongTermReviewQueuePage() {
  const { user } = useAuth();
  const [scope, setScope] = useState(user?.role === "doctor" ? "mine" : "all");
  const { patients, loading, refreshing, error, reload, applyPatient } = useLongTermReviewQueue({ scope });

  async function handlePatientsChange(updated) {
    applyPatient(updated);
    await reload();
  }

  return <div className="w-full pb-8">
    <LongTermReviewOperatorPanel patients={patients} scope={scope} onScopeChange={setScope}
      onPatientsChange={handlePatientsChange} loading={loading} refreshing={refreshing}
      error={error} onRefresh={reload} />
  </div>;
}
