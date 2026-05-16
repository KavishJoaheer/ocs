import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import LoadingState from "./LoadingState.jsx";
import { api } from "../lib/api.js";
import { formatCurrency } from "../lib/format.js";

const PREVIEW_LIMIT = 12;

function AdminPendingPaymentsLedger() {
  const [patientSummary, setPatientSummary] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadSummary() {
      setLoading(true);

      try {
        const payload = await api.get("/billing/patient-summary");
        if (!ignore) {
          setPatientSummary(Array.isArray(payload) ? payload : []);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
          setPatientSummary([]);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadSummary();

    return () => {
      ignore = true;
    };
  }, []);

  const pendingPayments = useMemo(
    () =>
      patientSummary
        .filter((patient) => Number(patient.unpaid_amount || 0) > 0)
        .sort((a, b) => Number(b.unpaid_amount || 0) - Number(a.unpaid_amount || 0)),
    [patientSummary],
  );

  const previewRows = pendingPayments.slice(0, PREVIEW_LIMIT);

  return (
    <div className="flex h-full min-h-[360px] flex-col rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 md:px-6">
        <h3 className="text-lg font-semibold tracking-tight text-slate-950">Pending payments</h3>
        <Link
          to="/billing"
          className="shrink-0 text-xs font-semibold text-teal-700 transition hover:text-teal-800"
        >
          View invoices ➔
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-5">
        {loading ? (
          <LoadingState label="Loading pending payments" />
        ) : previewRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No unpaid patient balances right now.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {previewRows.map((patient) => (
              <li key={patient.patient_id} className="py-3 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{patient.patient_name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {patient.bill_count} unpaid bill{patient.bill_count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-rose-700">
                    {formatCurrency(patient.unpaid_amount)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!loading && pendingPayments.length > previewRows.length ? (
          <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-slate-500">
            Showing {previewRows.length} of {pendingPayments.length} patients with outstanding balances.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default AdminPendingPaymentsLedger;
