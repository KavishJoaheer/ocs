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
                "cursor-pointer shrink-0 rounded-full border-0 px-4 py-2.5 text-[13px] transition-all duration-200 outline-none",
                isActive
                  ? "bg-[#e8a020] font-semibold text-white shadow-[0_2px_10px_rgba(232,160,32,0.35)]"
                  : "bg-white font-medium text-gray-600 shadow-sm ring-1 ring-black/[0.06] hover:bg-gray-50 hover:text-gray-800",
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
      className="mb-4 flex w-full items-center rounded-xl bg-gray-100 p-1"
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
              "flex-1 rounded-lg border-0 py-2.5 text-center text-[12px] transition-all duration-200 outline-none",
              isActive
                ? "bg-white font-semibold text-teal-900 shadow-sm"
                : "bg-transparent font-medium text-gray-500",
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
