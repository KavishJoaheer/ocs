const TABS = [
  { id: "consultations", label: "Consultation History", mobileLabel: "Consultations" },
  { id: "reports", label: "Medical & Lab Reports", mobileLabel: "Reports" },
  { id: "clinical", label: "Clinical History", mobileLabel: "Clinical" },
];

function HealthRecordsSegmentedControl({ activeTab, onChange, layout = "mobile" }) {
  const isDesktop = layout === "desktop";

  if (isDesktop) {
    return (
      <div
        className="inline-flex w-auto flex-wrap gap-2"
        role="tablist"
        aria-label="Health records sections"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={[
                "cursor-pointer shrink-0 rounded-full border-2 px-4 py-2.5 text-[13px] transition-all duration-200 outline-none",
                isActive
                  ? "border-teal-500 bg-teal-500/10 font-bold text-teal-800 shadow-sm"
                  : "border-transparent bg-white font-medium text-gray-600 shadow-sm ring-1 ring-black/[0.06] hover:bg-teal-50/40 hover:text-teal-900",
              ].join(" ")}
            >
              <span className="whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="mb-4 flex w-full items-center rounded-xl border border-teal-500/10 bg-white/80 p-1 shadow-sm backdrop-blur-sm"
      role="tablist"
      aria-label="Health records sections"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={[
              "flex-1 rounded-lg border-2 py-2.5 text-center text-[12px] transition-all duration-200 outline-none",
              isActive
                ? "border-teal-500 bg-teal-500/10 font-bold text-teal-800"
                : "border-transparent bg-transparent font-medium text-gray-500",
            ].join(" ")}
          >
            <span className="whitespace-nowrap">{tab.mobileLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

export { TABS };
export default HealthRecordsSegmentedControl;
