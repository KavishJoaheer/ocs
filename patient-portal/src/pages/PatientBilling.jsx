import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import {
  CreditCard,
  Receipt,
  CheckCircle2,
  AlertCircle,
  Banknote,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api.js";

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-MU", {
    style: "currency",
    currency: "MUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function PatientBilling() {
  const [bills, setBills] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function fetchBilling() {
      try {
        const data = await api.get("/patient-portal/billing");
        if (!ignore) {
          setBills(data.bills || []);
          setSummary(data.summary || { total_billed: 0, total_paid: 0, outstanding: 0 });
        }
      } catch {
        if (!ignore) {
          setBills([]);
          setSummary({ total_billed: 0, total_paid: 0, outstanding: 0 });
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchBilling();
    return () => { ignore = true; };
  }, [refreshKey]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="animate-fade-in-up">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] p-2.5 shadow-lg shadow-[rgba(45,143,152,0.22)]">
            <CreditCard className="size-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-2xl tracking-tight text-slate-950 sm:text-3xl">
              Billing &amp; Payments
            </h1>
            <p className="mt-1 text-sm text-[#5b7f8a]">
              Review your bills, payments, and outstanding balances.
            </p>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-[24px] bg-[rgba(65,200,198,0.08)]" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="animate-fade-in-up stagger-1 rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-5 shadow-[0_16px_48px_rgba(34,72,91,0.08)]">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] p-2.5">
                <Banknote className="size-5 text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6e949b]">Total Billed</p>
                <p className="mt-1 font-display text-xl font-bold tracking-tight text-[#22485b]">
                  {formatCurrency(summary?.total_billed)}
                </p>
              </div>
            </div>
          </div>

          <div className="animate-fade-in-up stagger-2 rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-5 shadow-[0_16px_48px_rgba(34,72,91,0.08)]">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-[linear-gradient(135deg,#34d399,#10b981)] p-2.5">
                <TrendingUp className="size-5 text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6e949b]">Total Paid</p>
                <p className="mt-1 font-display text-xl font-bold tracking-tight text-emerald-700">
                  {formatCurrency(summary?.total_paid)}
                </p>
              </div>
            </div>
          </div>

          <div className="animate-fade-in-up stagger-3 rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-5 shadow-[0_16px_48px_rgba(34,72,91,0.08)]">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-[linear-gradient(135deg,#f2c14d,#e6a817)] p-2.5">
                <Wallet className="size-5 text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6e949b]">Outstanding</p>
                <p className="mt-1 font-display text-xl font-bold tracking-tight text-[#22485b]">
                  {formatCurrency(summary?.outstanding)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bills list */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-[24px] bg-[rgba(65,200,198,0.06)]" />
          ))}
        </div>
      ) : bills.length === 0 ? (
        <div className="animate-fade-in-up stagger-4 rounded-[30px] border border-dashed border-[rgba(65,200,198,0.25)] bg-[rgba(65,200,198,0.04)] p-12 text-center">
          <Receipt className="mx-auto size-14 text-[rgba(65,200,198,0.3)]" />
          <h3 className="mt-4 font-display text-xl font-semibold text-[#22485b]">
            No bills found
          </h3>
          <p className="mt-2 text-sm text-[#6e949b]">
            Your billing records will appear here after your appointments.
          </p>
        </div>
      ) : (
        <div className="animate-fade-in-up stagger-4 rounded-[30px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Receipt className="size-4 text-[#2d8f98]" />
              <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
                Bill History
              </h2>
            </div>
          </div>

          <div className="divide-y divide-[rgba(65,200,198,0.1)]">
            {bills.map((bill, idx) => (
              <div
                key={bill.id || idx}
                className="flex flex-col gap-3 px-5 py-4 transition hover:bg-[rgba(65,200,198,0.04)] sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-[rgba(65,200,198,0.1)] p-2.5">
                    <CreditCard className="size-4 text-[#2d8f98]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#22485b]">
                      {bill.items_summary || bill.description || "Medical service"}
                    </p>
                    <p className="mt-0.5 text-xs text-[#6e949b]">
                      {dayjs(bill.date).format("MMM D, YYYY")}
                      {bill.payment_method && ` · ${bill.payment_method}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <p className="font-display text-lg font-bold text-[#22485b]">
                    {formatCurrency(bill.amount)}
                  </p>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
                      bill.status === "paid"
                        ? "border-emerald-200 bg-[rgba(34,197,94,0.1)] text-emerald-700"
                        : "border-amber-200 bg-[rgba(242,193,77,0.12)] text-amber-700"
                    }`}
                  >
                    {bill.status === "paid" ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <AlertCircle className="size-3" />
                    )}
                    {bill.status === "paid" ? "Paid" : "Unpaid"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default PatientBilling;
