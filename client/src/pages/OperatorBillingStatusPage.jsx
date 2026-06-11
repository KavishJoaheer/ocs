import { useEffect, useMemo, useState } from "react";
import { CreditCard, DollarSign, ReceiptText } from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import { cx } from "../lib/utils.js";
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
  const isMobile = useIsMobile();
  const [statusFilter, setStatusFilter] = useState("");
  const [mobileBillTab, setMobileBillTab] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState([]);
  const [patientSummary, setPatientSummary] = useState([]);

  useEffect(() => {
    let ignore = false;

    async function loadData() {
      try {
        const query = new URLSearchParams();

        if (statusFilter && !isMobile) {
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
  }, [statusFilter, isMobile]);

  const billsForDisplay = useMemo(() => {
    if (!isMobile) {
      return bills;
    }
    return bills.filter((bill) =>
      mobileBillTab === "pending" ? bill.status === "unpaid" : bill.status === "paid",
    );
  }, [bills, isMobile, mobileBillTab]);

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

  const pendingPatients = patientSummary.filter(
    (patient) => Number(patient.unpaid_amount || 0) > 0,
  );

  if (loading) {
    return <LoadingState label="Loading billing status" />;
  }

  return (
    <div className={cx("space-y-6", isMobile && "mx-auto max-w-md")}>
      <PageHeader
        eyebrow="Operator workspace"
        title="Billing Status"
        description="Read-only billing visibility for operators so payment status can be tracked without editing finance records."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <BillingStat icon={DollarSign} label="Total billed" value={formatCurrency(overallBilled)} />
        <BillingStat icon={CreditCard} label="Collected" value={formatCurrency(overallPaid)} />
        <BillingStat
          icon={ReceiptText}
          label="Outstanding"
          value={formatCurrency(overallUnpaid)}
        />
      </div>

      <div
        className={cx(
          "grid gap-6",
          !isMobile && "xl:grid-cols-[1.1fr_0.9fr] xl:items-start",
        )}
      >
        <SectionCard
          title="Billing status"
          subtitle="Read-only consultation billing visibility across the clinic."
          actions={
            isMobile ? null : (
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 outline-none transition focus:border-sky-400 focus:bg-white"
              >
                <option value="">All bills</option>
                <option value="unpaid">Unpaid only</option>
                <option value="paid">Paid only</option>
              </select>
            )
          }
        >
          {isMobile ? (
            <div className="mb-4 flex rounded-2xl border border-slate-200 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setMobileBillTab("pending")}
                className={cx(
                  "min-h-12 flex-1 rounded-xl py-2.5 text-sm font-bold transition",
                  mobileBillTab === "pending"
                    ? "bg-white text-ocs-teal shadow-sm"
                    : "text-slate-500",
                )}
              >
                Pending
              </button>
              <button
                type="button"
                onClick={() => setMobileBillTab("paid")}
                className={cx(
                  "min-h-12 flex-1 rounded-xl py-2.5 text-sm font-bold transition",
                  mobileBillTab === "paid"
                    ? "bg-white text-ocs-teal shadow-sm"
                    : "text-slate-500",
                )}
              >
                Paid
              </button>
            </div>
          ) : null}

          {billsForDisplay.length ? (
            <>
              <div className="hidden overflow-hidden rounded-[24px] border border-slate-200/80 md:block">
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
                      {billsForDisplay.map((bill) => (
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

              <div className="space-y-3 md:hidden">
                {billsForDisplay.map((bill) => (
                  <div
                    key={`card-${bill.id}`}
                    className="rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-lg font-bold text-ocs-slate">
                          {bill.patient_name}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">{bill.doctor_name}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatDate(bill.consultation_date)} · Bill #{bill.id}
                        </p>
                      </div>
                      <StatusBadge value={bill.status} />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xl font-bold text-[#1f7f7b]">
                        {formatCurrency(bill.total_amount)}
                      </p>
                      <p className="text-sm text-slate-500">
                        {bill.status === "paid"
                          ? `${formatPaymentMethod(bill.payment_method)} · ${formatDate(bill.payment_date)}`
                          : "Awaiting payment"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
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
          {(isMobile ? pendingPatients : patientSummary).length ? (
            <div className="space-y-3">
              {(isMobile ? pendingPatients : patientSummary).map((patient) => (
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
                        Paid {formatCurrency(patient.paid_amount)} · Due{" "}
                        {formatCurrency(patient.unpaid_amount)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title={isMobile ? "No pending payments" : "No summary available"}
              description={
                isMobile
                  ? "All tracked bills are currently paid."
                  : "Patient billing totals will appear here once bills are created."
              }
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
