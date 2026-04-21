import { useEffect, useState } from "react";
import { CreditCard, DollarSign, ReceiptText } from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { api } from "../lib/api.js";
import {
  formatCurrency,
  formatDate,
  formatPaymentMethod,
} from "../lib/format.js";

function BillingStat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_25px_70px_rgba(15,23,42,0.08)]">
      <div className="flex items-center gap-4">
        <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
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

export default function OperatorBillingStatusPage() {
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);
  const [patientSummary, setPatientSummary] = useState([]);

  useEffect(() => {
    let ignore = false;

    async function loadData() {
      try {
        const query = new URLSearchParams();

        if (statusFilter) {
          query.set("status", statusFilter);
        }

        const queryString = query.toString();
        const [billingData, summaryData] = await Promise.all([
          api.get(`/billing${queryString ? `?${queryString}` : ""}`),
          api.get("/billing/patient-summary"),
        ]);

        if (!ignore) {
          setBills(billingData);
          setPatientSummary(summaryData);
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

    loadData();

    return () => {
      ignore = true;
    };
  }, [statusFilter]);

  const overallPaid = patientSummary.reduce(
    (sum, patient) => sum + Number(patient.paid_amount || 0),
    0,
  );
  const overallUnpaid = patientSummary.reduce(
    (sum, patient) => sum + Number(patient.unpaid_amount || 0),
    0,
  );
  const overallBilled = patientSummary.reduce(
    (sum, patient) => sum + Number(patient.total_billed || 0),
    0,
  );

  if (loading) {
    return <LoadingState label="Loading billing status" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operator workspace"
        title="Billing Status"
        description="Read-only billing visibility for operators so payment status can be tracked without editing finance records."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <BillingStat icon={DollarSign} label="Total billed" value={formatCurrency(overallBilled)} />
        <BillingStat icon={CreditCard} label="Collected" value={formatCurrency(overallPaid)} />
        <BillingStat
          icon={ReceiptText}
          label="Outstanding"
          value={formatCurrency(overallUnpaid)}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard
          title="Billing status"
          subtitle="Read-only consultation billing visibility across the clinic."
          actions={
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 outline-none transition focus:border-sky-400 focus:bg-white"
            >
              <option value="">All bills</option>
              <option value="unpaid">Unpaid only</option>
              <option value="paid">Paid only</option>
            </select>
          }
        >
          {bills.length ? (
            <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
              <div className="overflow-x-auto">
                <table className="min-w-full bg-white text-left">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                    <tr>
                      <th className="px-5 py-4">Patient</th>
                      <th className="px-5 py-4">Consultation</th>
                      <th className="px-5 py-4">Total</th>
                      <th className="px-5 py-4">Status</th>
                      <th className="px-5 py-4">Pay by</th>
                      <th className="px-5 py-4">Payment date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((bill) => (
                      <tr key={bill.id} className="border-t border-slate-200/70">
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-950">{bill.patient_name}</p>
                          <p className="mt-1 text-sm text-slate-500">{bill.doctor_name}</p>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          <p>{formatDate(bill.consultation_date)}</p>
                          <p className="mt-1 text-slate-500">Bill #{bill.id}</p>
                        </td>
                        <td className="px-5 py-4 font-semibold text-slate-950">
                          {formatCurrency(bill.total_amount)}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge value={bill.status} />
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {formatPaymentMethod(bill.payment_method)}
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {bill.payment_date ? formatDate(bill.payment_date) : "Not paid yet"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No billing records found"
              description="Billing status will appear here as soon as consultations generate bills."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Per-patient summary"
          subtitle="Collections and outstanding balances grouped by patient."
        >
          {patientSummary.length ? (
            <div className="space-y-3">
              {patientSummary.map((patient) => (
                <div
                  key={patient.patient_id}
                  className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{patient.patient_name}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {patient.bill_count} bill{patient.bill_count === 1 ? "" : "s"} total
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-slate-950">
                        {formatCurrency(patient.total_billed)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Paid {formatCurrency(patient.paid_amount)} - Due{" "}
                        {formatCurrency(patient.unpaid_amount)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No summary available"
              description="Patient billing totals will appear here once bills are created."
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
