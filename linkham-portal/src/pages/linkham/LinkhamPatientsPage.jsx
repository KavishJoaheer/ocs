import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import EmptyState from "../../components/EmptyState.jsx";
import LinkhamPatientDetailsSheet from "../../components/LinkhamPatientDetailsSheet.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { useLinkhamPatients } from "../../hooks/useLinkhamPatients.js";
import { formatDate } from "../../lib/format.js";

function formatClientAddress(client) {
  return [client.address, client.village].filter(Boolean).join(", ") || "Address not recorded";
}

function matchesSearch(client, query) {
  const needle = String(query || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase();
  if (!needle) return true;
  return [client.full_name, client.national_id, client.insurance_policy_number, client.case_number]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(needle));
}

export default function LinkhamPatientsPage() {
  const { patients, loading, error } = useLinkhamPatients();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(searchParams.get("search") || "");
  const missingPolicy = searchParams.get("missingPolicy") === "1";
  const openId = searchParams.get("open");
  const [selectedPatientId, setSelectedPatientId] = useState(openId || null);

  useEffect(() => {
    setSelectedPatientId(openId || null);
  }, [openId]);

  const visiblePatients = useMemo(() => {
    return patients.filter((client) => {
      if (missingPolicy && client.has_policy_number) {
        return false;
      }
      return matchesSearch(client, searchDraft);
    });
  }, [patients, missingPolicy, searchDraft]);

  function updateParams(next) {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value == null || value === "" || value === false) {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    });
    setSearchParams(params);
  }

  if (loading) {
    return <LoadingState label="Loading insured clients" />;
  }

  if (error) {
    return <EmptyState title="Insured clients unavailable" description={error} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Linkham insurer portal"
        title="Insured clients"
        description="Read-only directory. Search by name, National ID, policy number, or OCS number. Clinical notes, vitals, labs, booking and inventory are not shown."
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          type="search"
          value={searchDraft}
          onChange={(event) => {
            setSearchDraft(event.target.value);
            updateParams({ search: event.target.value.trim() || null });
          }}
          placeholder="Search name, NIC, policy, or OCS number"
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-800 md:max-w-md"
        />
        <button
          type="button"
          onClick={() => updateParams({ missingPolicy: missingPolicy ? null : "1" })}
          className={`rounded-xl border px-4 py-2.5 text-xs font-bold ${
            missingPolicy
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-gray-200 bg-white text-gray-600"
          }`}
        >
          Missing policy number
        </button>
      </div>

      {visiblePatients.length ? (
        <div className="mt-4 grid w-full grid-cols-1 gap-3.5">
          {visiblePatients.map((client) => (
            <div
              key={client.id}
              className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-200 hover:border-gray-200/80"
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-center gap-2.5">
                  <h3 className="truncate text-sm font-extrabold text-gray-800">{client.full_name}</h3>
                  <span className="shrink-0 rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[10px] font-bold text-gray-500">
                    {client.case_number}
                  </span>
                  {client.has_policy_number ? (
                    <span className="shrink-0 rounded-md border border-amber-100 bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-extrabold text-amber-800">
                      Policy: {client.insurance_policy_number}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">
                      Needs policy number
                    </span>
                  )}
                </div>
                <p className="text-xs font-medium text-gray-400">
                  {formatClientAddress(client)}
                  <span className="mx-1 text-gray-200">·</span>
                  DOB: {client.date_of_birth ? formatDate(client.date_of_birth) : "Not recorded"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedPatientId(client.id);
                  updateParams({ open: client.id });
                }}
                className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-[#3e5c76] shadow-sm transition-all duration-200 hover:border-[#065a60] hover:bg-[#065a60]/5 hover:text-[#065a60]"
              >
                View Patient Details
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No matching Linkham clients"
          description="Try another search, or clear the missing-policy filter."
        />
      )}

      <LinkhamPatientDetailsSheet
        open={Boolean(selectedPatientId)}
        patientId={selectedPatientId}
        onClose={() => {
          setSelectedPatientId(null);
          updateParams({ open: null });
        }}
      />
    </div>
  );
}
