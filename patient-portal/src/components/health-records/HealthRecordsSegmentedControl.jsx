const TABS = [
  { id: "consultations", label: "Consultations" },
  { id: "reports", label: "Reports" },
  { id: "clinical", label: "Clinical History" },
];

/** iOS-style segmented control — muted gray track, white pill active state. */
function HealthRecordsSegmentedControl({ activeTab, onChange }) {
  return (
    <div
      className="health-records-segment flex gap-1 overflow-hidden rounded-full bg-[#F0F1F3] p-1"
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
              "health-records-tab relative flex min-h-[44px] flex-1 items-center justify-center rounded-full border-none px-2 py-2 text-[13px] leading-none whitespace-nowrap outline-none ring-0 transition-all duration-200 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 max-sm:px-1.5 max-sm:text-xs",
              isActive
                ? "health-records-tab-active w-full font-semibold text-[#1a5c52]"
                : "w-full cursor-pointer bg-transparent font-medium text-[#8a9e9a] hover:text-[#6e7f7c]",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export { TABS };
export default HealthRecordsSegmentedControl;
