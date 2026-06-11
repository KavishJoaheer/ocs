const TABS = [
  { id: "consultations", label: "Consultations" },
  { id: "reports", label: "Reports" },
  { id: "clinical", label: "Clinical" },
];

/** Tab row embedded in the Health Records mobile gradient hero — overlaps content below. */
function HealthRecordsHeroTabs({ activeTab, onChange }) {
  return (
    <div
      className="relative z-10 rounded-xl bg-white p-1"
      role="tablist"
      aria-label="Health records sections"
    >
      <div className="flex">
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
              "hero-segment-btn flex-1 rounded-lg py-2 text-center text-[13px] whitespace-nowrap transition-colors",
              isActive
                ? "bg-[#1a5c52] font-semibold text-white"
                : "bg-transparent font-medium text-gray-500",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
      </div>
    </div>
  );
}

export default HealthRecordsHeroTabs;
