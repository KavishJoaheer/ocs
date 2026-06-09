const TABS = [
  { id: "consultations", label: "Consultations" },
  { id: "reports", label: "Reports" },
  { id: "clinical", label: "Clinical History" },
];

/**
 * Three-option segmented control — deep teal active state, squircle inner wells.
 */
function HealthRecordsSegmentedControl({ activeTab, onChange }) {
  return (
    <div
      className="squircle-inner flex gap-1 bg-[rgba(26,160,140,0.08)] p-1"
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
              "native-label flex-1 rounded-[12px] px-2 py-2.5 text-[13px] leading-tight transition-all duration-200",
              isActive
                ? "bg-[#2d8f98] text-white shadow-[0_2px_8px_rgba(45,143,152,0.25)]"
                : "text-[#5b7f8a]",
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
