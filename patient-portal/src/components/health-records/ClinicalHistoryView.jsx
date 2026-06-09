import { formatIsoDatesInText, isNilAllergyValue } from "../../lib/healthRecordsDisplay.js";

const SECTIONS = [
  {
    key: "medical_history",
    title: "Past Medical History",
    empty: "No medical history recorded.",
  },
  {
    key: "surgical_history",
    title: "Past Surgical History",
    empty: "No surgical history recorded.",
  },
  {
    key: "drug_history",
    title: "Drug History",
    empty: "No drug history recorded.",
  },
  {
    key: "allergy_history",
    title: "Allergy History",
    empty: "No known allergies.",
    isAllergy: true,
  },
];

function ClinicalBlock({ section, items }) {
  const isAllergy = section.isAllergy;

  return (
    <article
      className="squircle-outer ocs-elevate bg-white"
      style={{ padding: "var(--native-pad-card)" }}
    >
      <h3 className="native-label text-[13px] uppercase tracking-[0.06em] text-[#8a9e9a]">
        {section.title}
      </h3>

      {items.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {items.map((item) => {
            const isWarning = isAllergy && !isNilAllergyValue(item.name);
            return (
              <li key={item.id} className="flex flex-col gap-0.5">
                <p
                  className={[
                    "text-[15px] font-semibold leading-snug",
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
                  <p className="text-[14px] leading-relaxed text-[#5b7f8a]">
                    {formatIsoDatesInText(item.detail)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-[14px] italic text-[#8a9e9a]">{section.empty}</p>
      )}
    </article>
  );
}

/** Static four-block clinical background summary. */
function ClinicalHistoryView({ clinicalHistory }) {
  return (
    <div className="space-y-4" aria-label="Clinical history">
      <p className="text-right text-[12px] italic text-[#8a9e9a]">
        Read only · Maintained by your OCS doctor
      </p>
      {SECTIONS.map((section, idx) => (
        <div key={section.key} className={`animate-fade-in-up stagger-${Math.min(idx + 1, 6)}`}>
          <ClinicalBlock section={section} items={clinicalHistory[section.key] ?? []} />
        </div>
      ))}
    </div>
  );
}

export default ClinicalHistoryView;
