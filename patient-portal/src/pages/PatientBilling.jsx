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
import PageHeroHeader from "../components/PageHeroHeader.jsx";
import MobilePageTitle from "../components/MobilePageTitle.jsx";
import { DesktopPageBody, DesktopPageFrame } from "../components/DesktopPageFrame.jsx";
import BillingMobileStatsStrip from "../components/billing/BillingMobileStatsStrip.jsx";

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
  const [loadError, setLoadError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setLoadError(null);

    async function fetchBilling() {
      try {
        const data = await api.get("/patient-portal/billing");
        if (!ignore) {
          setBills(data.bills || []);
          setSummary(data.summary || { total_billed: 0, total_paid: 0, outstanding: 0 });
        }
      } catch (error) {
        if (!ignore) {
          setLoadError(
            error?.message || "We couldn't load your billing records. Check your connection and try again.",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchBilling();
    return () => { ignore = true; };
  }, [refreshKey, retryToken]);

  return (
    <DesktopPageFrame className="mobile-hero-page font-sans">
      <MobilePageTitle
        primaryText="Billing"
        secondaryText="& Payments"
        subtitle="Your invoices and payment history."
      >
        {!loading && summary?.outstanding > 0 ? (
          <span className="mt-3 inline-flex rounded-[20px] border border-brand-gold/40 bg-brand-gold/20 px-3.5 py-1.5 text-[13px] font-semibold text-brand-gold">
            {formatCurrency(summary.outstanding)} outstanding
          </span>
        ) : null}
      </MobilePageTitle>

      <PageHeroHeader
        primaryText="Billing"
        secondaryText="& Payments"
        subtitle="Review your bills, payments, and outstanding balances."
      />

      <DesktopPageBody className="mt-5 space-y-8 lg:mt-6">
      {loadError && !loading ? (
        <div className="flex flex-col items-center rounded-[24px] border border-teal-500/10 bg-white px-6 py-16 text-center lg:border-brand-teal/20">
          <p className="text-[20px] font-bold text-teal-900 lg:text-brand-dark-grey">Couldn&apos;t load billing</p>
          <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-gray-500 lg:text-brand-cool-grey">{loadError}</p>
          <button
            type="button"
            onClick={() => setRetryToken((token) => token + 1)}
            className="request-wizard-primary-btn mt-6 w-full max-w-[280px]"
          >
            Try Again
          </button>
        </div>
      ) : null}

      {/* Summary — compact strip on mobile, cards on desktop */}
      {!loadError && loading ? (
        <>
          <div className="h-[72px] animate-pulse rounded-xl bg-white/80 lg:hidden" />
          <div className="hidden gap-4 sm:grid-cols-3 lg:grid">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-[24px] bg-[rgba(65,200,198,0.08)]" />
            ))}
          </div>
        </>
      ) : !loadError ? (
        <>
          <BillingMobileStatsStrip summary={summary} formatCurrency={formatCurrency} />
          <div className="hidden gap-4 sm:grid-cols-3 lg:grid">
          <div className="animate-fade-in-up stagger-1 rounded-[24px] border border-brand-teal/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-5 shadow-[0_16px_48px_rgba(34,72,91,0.08)]">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-[linear-gradient(135deg,#5ed9d2,var(--brand-teal))] p-2.5">
                <Banknote className="size-5 text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-cool-grey">Total Billed</p>
                <p className="mt-1 font-display text-xl font-bold tracking-tight text-brand-dark-grey">
                  {formatCurrency(summary?.total_billed)}
                </p>
              </div>
            </div>
          </div>

          <div className="animate-fade-in-up stagger-2 rounded-[24px] border border-brand-teal/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-5 shadow-[0_16px_48px_rgba(34,72,91,0.08)]">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-[linear-gradient(135deg,#5ed9d2,var(--brand-teal))] p-2.5">
                <TrendingUp className="size-5 text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-cool-grey">Total Paid</p>
                <p className="mt-1 font-display text-xl font-bold tracking-tight text-brand-dark-grey">
                  {formatCurrency(summary?.total_paid)}
                </p>
              </div>
            </div>
          </div>

          <div className="animate-fade-in-up stagger-3 rounded-[24px] border border-brand-teal/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-5 shadow-[0_16px_48px_rgba(34,72,91,0.08)]">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-brand-gold p-2.5">
                <Wallet className="size-5 text-brand-dark-grey" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-cool-grey">Outstanding</p>
                <p className="mt-1 font-display text-xl font-bold tracking-tight text-brand-dark-grey">
                  {formatCurrency(summary?.outstanding)}
                </p>
              </div>
            </div>
          </div>
        </div>
        </>
      ) : null}

      {/* Bills list */}
      {!loadError && loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-[24px] bg-[rgba(65,200,198,0.06)]" />
          ))}
        </div>
      ) : !loadError && bills.length === 0 ? (
        <div className="animate-fade-in-up stagger-4 rounded-[30px] border border-dashed border-brand-teal/20 bg-brand-teal/5 p-12 text-center">
          <Receipt className="mx-auto size-14 text-brand-teal/30" />
          <h3 className="mt-4 font-display text-xl font-semibold text-brand-dark-grey">
            No bills found
          </h3>
          <p className="mt-2 text-sm text-brand-cool-grey">
            Your billing records will appear here after your appointments.
          </p>
        </div>
      ) : !loadError ? (
        <div className="animate-fade-in-up stagger-4 rounded-[30px] border border-brand-teal/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Receipt className="size-4 text-brand-teal" />
              <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-brand-dark-grey">
                Bill History
              </h2>
            </div>
          </div>

          <div className="divide-y divide-brand-teal/20">
            {bills.map((bill, idx) => (
              <div
                key={bill.id || idx}
                className="flex flex-col gap-3 px-5 py-4 transition hover:bg-brand-teal/5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-brand-teal/10 p-2.5">
                    <CreditCard className="size-4 text-brand-teal" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-brand-dark-grey">
                      {bill.items_summary || bill.description || "Medical service"}
                    </p>
                    <p className="mt-0.5 text-xs text-brand-cool-grey">
                      {dayjs(bill.date).format("MMM D, YYYY")}
                      {bill.payment_method && ` · ${bill.payment_method}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <p className="font-display text-lg font-bold text-brand-dark-grey">
                    {formatCurrency(bill.amount)}
                  </p>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand-teal/20 bg-brand-teal/10 px-3 py-1 text-xs font-bold text-brand-dark-grey"
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
      ) : null}
      </DesktopPageBody>
    </DesktopPageFrame>
  );
}

export default PatientBilling;
