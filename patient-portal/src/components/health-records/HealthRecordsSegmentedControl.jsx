const TABS = [
  { id: "consultations", label: "Consultations" },
  { id: "reports", label: "Reports" },
  { id: "clinical", label: "Clinical History" },
];

/** iOS-style segmented control — muted gray track, white pill active state. */
function HealthRecordsSegmentedControl({ activeTab, onChange }) {
  return (
    <div
      className="health-records-segment flex gap-0.5 rounded-[10px] bg-[#F0F1F3] p-[3px]"
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
              "relative flex-1 rounded-[8px] px-2 py-2.5 text-[13px] leading-tight transition-all duration-200",
              isActive
                ? "health-records-tab-active font-bold text-[#1a5c52]"
                : "font-medium text-[#8a9e9a]",
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
