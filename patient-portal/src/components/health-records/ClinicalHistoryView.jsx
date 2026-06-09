import {
  filterClinicalItems,
  formatIsoDatesInText,
  getClinicalEmptyMessage,
  isNilAllergyValue,
} from "../../lib/healthRecordsDisplay.js";

const SECTIONS = [
  { key: "medical_history", title: "Past Medical History" },
  { key: "surgical_history", title: "Past Surgical History" },
  { key: "drug_history", title: "Drug History" },
  { key: "allergy_history", title: "Allergy History", isAllergy: true },
];

const CELL_BORDERS = [
  "border-b border-[rgba(0,0,0,0.03)] lg:border-b lg:border-r lg:border-[rgba(0,0,0,0.03)]",
  "border-b border-[rgba(0,0,0,0.03)] lg:border-b lg:border-[rgba(0,0,0,0.03)]",
  "border-b border-[rgba(0,0,0,0.03)] lg:border-b-0 lg:border-r lg:border-[rgba(0,0,0,0.03)]",
  "",
];

function DossierSection({ section, items, borderClass }) {
  const isAllergy = section.isAllergy;
  const visibleItems = filterClinicalItems(items);

  return (
    <section className={["clinical-dossier-cell px-6 py-6 lg:px-7 lg:py-7", borderClass].join(" ")}>
      <h3 className="clinical-dossier-label text-[11px] font-semibold uppercase tracking-wider text-[#a8b5b2]">
        {section.title}
      </h3>

      {visibleItems.length > 0 ? (
        <ul className="mt-3.5 space-y-3.5">
          {visibleItems.map((item) => {
            const isWarning = isAllergy && !isNilAllergyValue(item.name);
            return (
              <li key={item.id} className="flex flex-col gap-1">
                <p
                  className={[
                    "text-[16px] font-medium leading-relaxed",
                    isWarning ? "text-[#c45c3e]" : "text-[#1a5c52]",
                  ].join(" ")}
                >
                  {item.name}
                  {isWarning ? (
                    <span className="squircle-inner ml-2 inline-flex bg-[rgba(196,92,62,0.12)] px-2 py-0.5 text-[11px] font-semibold text-[#c45c3e]">
                      Allergy
                    </span>
                  ) : null}
                </p>
                {item.detail ? (
                  <p className="text-[15px] leading-relaxed text-[#5b7f8a]">
                    {formatIsoDatesInText(item.detail)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-[15px] italic leading-relaxed text-[#a8b5b2]">
          {getClinicalEmptyMessage(section.key)}
        </p>
      )}
    </section>
  );
}

/** Unified clinical dossier — four history sections in one premium card. */
function ClinicalHistoryView({ clinicalHistory }) {
  return (
    <div aria-label="Clinical history">
      <p className="mb-4 text-right text-[12px] italic text-[#8a9e9a]">
        Read only · Maintained by your OCS doctor
      </p>

      <article className="health-records-crafted-card animate-fade-in-up overflow-hidden bg-white max-lg:squircle-outer max-lg:ocs-elevate">
        <header className="border-b border-[rgba(0,0,0,0.03)] px-6 py-5 lg:px-7">
          <h2 className="native-display text-[17px] text-[#1a5c52]">Clinical Dossier</h2>
          <p className="mt-1 text-[13px] text-[#8a9e9a]">Your medical background at a glance</p>
        </header>

        <div className="clinical-dossier-grid grid grid-cols-1 lg:grid-cols-2">
          {SECTIONS.map((section, idx) => (
            <DossierSection
              key={section.key}
              section={section}
              items={clinicalHistory[section.key] ?? []}
              borderClass={CELL_BORDERS[idx]}
            />
          ))}
        </div>
      </article>
    </div>
  );
}

export default ClinicalHistoryView;
