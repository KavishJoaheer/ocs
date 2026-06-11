function StatCell({ label, amount, className = "" }) {
  return (
    <div className={`min-w-0 flex-1 text-center ${className}`.trim()}>
      <p className="text-[18px] font-bold leading-tight text-teal-900">{amount}</p>
      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
    </div>
  );
}

/** Compact horizontal billing summary — mobile only. */
function BillingMobileStatsStrip({ summary, formatCurrency }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3.5 lg:hidden">
      <div className="flex items-stretch">
        <StatCell label="Total Billed" amount={formatCurrency(summary?.total_billed)} />
        <div className="mx-3 w-px self-stretch bg-gray-200" aria-hidden="true" />
        <StatCell label="Total Paid" amount={formatCurrency(summary?.total_paid)} />
        <div className="mx-3 w-px self-stretch bg-gray-200" aria-hidden="true" />
        <StatCell label="Outstanding" amount={formatCurrency(summary?.outstanding)} />
      </div>
    </div>
  );
}

export default BillingMobileStatsStrip;
