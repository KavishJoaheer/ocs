const TABS = [
  { id: "consultations", label: "Consultation History", mobileLabel: "Consultations" },
  { id: "reports", label: "Medical & Lab Reports", mobileLabel: "Reports" },
  { id: "clinical", label: "Clinical History", mobileLabel: "Clinical" },
];

const PILL_BASE =
  "cursor-pointer shrink-0 rounded-2xl border-2 px-5 py-2.5 text-[13px] transition-all duration-200 outline-none max-lg:min-w-0 max-lg:flex-1 max-lg:px-3 max-lg:text-[12px]";

function pillClass(isActive) {
  return [
    PILL_BASE,
    isActive
      ? "border-brand-teal/20 bg-brand-teal/10 font-bold text-brand-dark-grey"
      : "border-transparent bg-gray-100/50 font-medium text-brand-cool-grey",
  ].join(" ");
}

function HealthRecordsSegmentedControl({ activeTab, onChange, layout = "mobile" }) {
  const isDesktop = layout === "desktop";

  return (
    <div
      className={isDesktop ? "flex flex-wrap gap-2" : "flex w-full gap-2"}
      role="tablist"
      aria-label="Health records sections"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const label = isDesktop ? tab.label : tab.mobileLabel;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={pillClass(isActive)}
          >
            <span className="whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export { TABS };
export default HealthRecordsSegmentedControl;
