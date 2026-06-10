const TABS = [
  { id: "consultations", label: "Consultations" },
  { id: "reports", label: "Reports" },
  { id: "clinical", label: "Clinical History" },
];

function HealthRecordsSegmentedControl({ activeTab, onChange }) {
  return (
    <div
      className="flex p-1 bg-gray-100 rounded-xl w-full max-w-sm mx-auto mb-6"
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
            className={
              isActive
                ? "flex-1 py-1.5 bg-white rounded-lg shadow-sm text-[13px] font-semibold text-center text-teal-900 whitespace-nowrap"
                : "flex-1 py-1.5 text-[13px] font-medium text-center text-gray-500 whitespace-nowrap"
            }
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
