import { useEffect, useMemo, useState } from "react";
import { FlaskConical, Microscope, UserRound } from "lucide-react";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { api } from "../lib/api.js";
import { formatDate, truncate } from "../lib/format.js";

function SummaryTile({ icon: Icon, label, value, accentClass }) {
  return (
    <div className="rounded-[26px] border border-[rgba(65,200,198,0.14)] bg-white/88 p-5">
      <div className="flex items-center gap-4">
        <div className={`rounded-2xl p-3 text-white ${accentClass}`}>
          <Icon className="size-5" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
        </div>
      </div>
    </div>
  );
}

function LabWorkspacePage() {
  const [consultations, setConsultations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadLabQueue() {
      try {
        const response = await api.get("/consultations");
        if (!ignore) {
          setConsultations(response);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadLabQueue();

    return () => {
      ignore = true;
    };
  }, []);

  const recentConsultations = useMemo(() => consultations.slice(0, 8), [consultations]);
  const unpaidLinkedCount = useMemo(
    () => consultations.filter((item) => item.bill_status === "unpaid").length,
    [consultations],
  );

  if (loading) {
    return <LoadingState label="Loading lab workspace" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Lab workspace"
        title="Lab intake queue"
        description="Review recent consultations and coordinate follow-up work that may require lab handling or specimen tracking."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryTile
          icon={FlaskConical}
          label="Recent consultations"
          value={recentConsultations.length}
          accentClass="bg-[linear-gradient(135deg,#41c8c6,#2d8f98)]"
        />
        <SummaryTile
          icon={Microscope}
          label="Linked unpaid bills"
          value={unpaidLinkedCount}
          accentClass="bg-[linear-gradient(135deg,#f2c14d,#d7a32d)]"
        />
        <SummaryTile
          icon={UserRound}
          label="Patients in queue"
          value={new Set(recentConsultations.map((item) => item.patient_name)).size}
          accentClass="bg-[linear-gradient(135deg,#5fb0b6,#357a86)]"
        />
      </div>

      <SectionCard
        title="Recent consultation queue"
        subtitle="A role-specific view for lab staff based on the latest recorded consultations."
      >
        {recentConsultations.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {recentConsultations.map((consultation) => (
              <article
                key={consultation.id}
                className="rounded-[28px] border border-slate-200/80 bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-slate-950">
                      {consultation.patient_name}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {consultation.doctor_name} - {consultation.specialization}
                    </p>
                    <p className="mt-2 text-sm font-medium text-[#2d8f98]">
                      {formatDate(consultation.consultation_date)}
                    </p>
                  </div>
                  {consultation.bill_status ? <StatusBadge value={consultation.bill_status} /> : null}
                </div>

                <div className="mt-4 rounded-[22px] bg-slate-50/80 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Doctor notes
                  </p>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    {truncate(consultation.doctor_notes, 180)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No consultations available"
            description="Recent consultations will appear here for lab review as soon as doctors begin saving notes."
          />
        )}
      </SectionCard>
    </div>
  );
}

export default LabWorkspacePage;
