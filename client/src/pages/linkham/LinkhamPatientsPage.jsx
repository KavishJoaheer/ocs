import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import EmptyState from "../../components/EmptyState.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { api } from "../../lib/api.js";
import { formatDate } from "../../lib/format.js";

export default function LinkhamPatientsPage() {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadPatients() {
      setLoading(true);
      try {
        const data = await api.get("/linkham/patients");
        if (!ignore) {
          setPatients(Array.isArray(data?.patients) ? data.patients : []);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadPatients();
    return () => {
      ignore = true;
    };
  }, []);

  if (loading) {
    return <LoadingState label="Loading insured clients" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Linkham insurer portal"
        title="Insured clients"
        description="Read-only directory of clients tagged under Linkham coverage. Internal clinical notes are not shown."
      />

      {patients.length ? (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-semibold text-gray-600">
              <thead>
                <tr className="border-b border-gray-50 bg-gray-50/70 text-[10px] uppercase tracking-wider text-gray-400">
                  <th className="px-5 py-3">Client name</th>
                  <th className="px-5 py-3">OCS ID</th>
                  <th className="px-5 py-3">Contact</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Last visit</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={patient.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-5 py-3.5 font-bold text-gray-800">{patient.full_name}</td>
                    <td className="px-5 py-3.5 font-mono text-gray-500">
                      {patient.patient_identifier || `PT-${patient.id}`}
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">
                      {patient.patient_contact_number || "Not recorded"}
                    </td>
                    <td className="px-5 py-3.5 capitalize text-gray-500">{patient.status}</td>
                    <td className="px-5 py-3.5 text-gray-500">
                      {patient.last_visit_date ? formatDate(patient.last_visit_date) : "No visits"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          title="No Linkham clients yet"
          description="Patients tagged with Linkham insurance will appear here for coverage audit."
        />
      )}
    </div>
  );
}
