const TABS = [
  { id: "consultations", label: "Consultations", mobileLabel: "Consultations" },
  { id: "reports", label: "Reports", mobileLabel: "Reports" },
  { id: "clinical", label: "Clinical History", mobileLabel: "Clinical" },
];

function HealthRecordsSegmentedControl({ activeTab, onChange, layout = "mobile" }) {
  const isDesktop = layout === "desktop";

  return (
    <div
      className={[
        "native-segment flex gap-0 rounded-xl p-1",
        isDesktop
          ? "inline-flex w-auto bg-gray-100/80"
          : "native-segment mb-5 w-full bg-gray-100",
      ].join(" ")}
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
              "native-segment-btn rounded-lg py-2 text-center text-[13px] whitespace-nowrap transition-all duration-150",
              isDesktop ? "px-4" : "flex-1",
              isActive
                ? "bg-ocs-orange font-semibold text-white shadow-[0_2px_8px_rgba(232,160,32,0.3)]"
                : "font-medium text-gray-500",
            ].join(" ")}
          >
            {isDesktop ? tab.label : tab.mobileLabel}
          </button>
        );
      })}
    </div>
  );
}

export { TABS };
export default HealthRecordsSegmentedControl;
