import { useState } from "react";
import EmptyState from "../../components/EmptyState.jsx";
import LinkhamPatientDetailsSheet from "../../components/LinkhamPatientDetailsSheet.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { useLinkhamPatients } from "../../hooks/useLinkhamPatients.js";
import { formatDate } from "../../lib/format.js";

function formatClientAddress(client) {
  return [client.address, client.village].filter(Boolean).join(", ") || "Address not recorded";
}

export default function LinkhamPatientsPage() {
  const { patients, loading, error } = useLinkhamPatients();
  const [selectedPatientId, setSelectedPatientId] = useState(null);

  if (loading) {
    return <LoadingState label="Loading insured clients" />;
  }

  if (error) {
    return (
      <EmptyState
        title="Insured clients unavailable"
        description={error}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Linkham insurer portal"
        title="Insured clients"
        description="Read-only directory of clients tagged under Linkham coverage. Internal clinical notes are not shown."
      />

      {patients.length ? (
        <div className="mt-4 grid w-full grid-cols-1 gap-3.5">
          {patients.map((client) => (
            <div
              key={client.id}
              className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all hover:border-gray-200"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-sm font-extrabold text-gray-800">{client.full_name}</span>
                  <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[10px] font-bold text-gray-500">
                    {client.case_number}
                  </span>
                </div>
                <span className="text-xs font-medium text-gray-400">
                  {formatClientAddress(client)} · DOB:{" "}
                  {client.date_of_birth ? formatDate(client.date_of_birth) : "Not recorded"}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setSelectedPatientId(client.id)}
                className="shrink-0 rounded-xl border border-[#557373]/20 bg-[#557373]/10 px-4 py-2 text-xs font-bold text-[#557373] transition-all hover:bg-[#557373]/20"
              >
                View Patient Details
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No Linkham clients yet"
          description="Patients tagged with Linkham insurance will appear here for coverage audit."
        />
      )}

      <LinkhamPatientDetailsSheet
        open={Boolean(selectedPatientId)}
        patientId={selectedPatientId}
        onClose={() => setSelectedPatientId(null)}
      />
    </div>
  );
}
