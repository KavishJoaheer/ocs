import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, FlaskConical, Microscope, UserRound } from "lucide-react";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
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
  const refreshKey = useLiveRefreshKey();
  const [consultations, setConsultations] = useState([]);
  const [patientUploads, setPatientUploads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadLabQueue() {
      try {
        const [consultationResponse, uploadResponse] = await Promise.all([
          api.get("/consultations"),
          api.get("/lab-reports/patient-uploads?limit=12"),
        ]);
        if (!ignore) {
          setConsultations(consultationResponse);
          setPatientUploads(Array.isArray(uploadResponse) ? uploadResponse : []);
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
  }, [refreshKey]);

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
        title="Patient-uploaded reports"
        subtitle="Reports submitted from the patient portal appear here for lab review."
      >
        {patientUploads.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {patientUploads.map((report) => (
              <article
                key={report.id}
                className="rounded-[28px] border border-[rgba(242,193,77,0.35)] bg-white p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-slate-950">{report.report_title}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      <Link
                        to={`/patients/${report.patient_id}`}
                        className="font-medium text-[#2d8f98] transition hover:underline"
                      >
                        {report.patient_name}
                      </Link>
                      {report.patient_identifier ? ` · ${report.patient_identifier}` : ""}
                    </p>
                    <p className="mt-2 text-sm font-medium text-[#2d8f98]">
                      {formatDate(report.report_date)}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(242,193,77,0.18)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#8a6a1f]">
                    <FileUp className="size-3.5" />
                    Patient upload
                  </span>
                </div>

                {report.attachments?.length ? (
                  <div className="mt-4 rounded-[22px] bg-slate-50/80 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Attachments
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-600">
                      {report.attachments.map((attachment) => (
                        <li key={attachment.id}>{attachment.original_name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No patient uploads yet"
            description="When patients upload lab reports from their portal, they will appear here automatically."
          />
        )}
      </SectionCard>

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
