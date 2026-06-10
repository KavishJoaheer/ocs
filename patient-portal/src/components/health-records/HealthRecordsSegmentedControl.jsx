const TABS = [
  { id: "consultations", label: "Consultations", mobileLabel: "Consultations" },
  { id: "reports", label: "Reports", mobileLabel: "Reports" },
  { id: "clinical", label: "Clinical History", mobileLabel: "Clinical" },
];

function HealthRecordsSegmentedControl({ activeTab, onChange }) {
  return (
    <div
      className="native-segment flex w-full gap-0 rounded-xl bg-gray-100 p-1 mb-5"
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
              "native-segment-btn flex-1 rounded-lg py-2 text-center text-[13px] whitespace-nowrap transition-all duration-150",
              isActive
                ? "bg-white font-semibold text-teal-900 shadow-sm"
                : "font-medium text-gray-500",
            ].join(" ")}
          >
            <span className="lg:hidden">{tab.mobileLabel}</span>
            <span className="hidden lg:inline">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export { TABS };
export default HealthRecordsSegmentedControl;
