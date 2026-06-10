import { Lock, Pill, Scissors, ShieldAlert, Stethoscope } from "lucide-react";
import {
  filterClinicalItems,
  formatIsoDatesInText,
  formatMedicalConditionName,
  getClinicalEmptyMessage,
  isNilAllergyValue,
} from "../../lib/healthRecordsDisplay.js";

const SECTIONS = [
  {
    key: "medical_history",
    title: "Past Medical History",
    icon: Stethoscope,
    tint: "bg-teal-100 text-[#2d8f98]",
  },
  {
    key: "surgical_history",
    title: "Past Surgical History",
    icon: Scissors,
    tint: "bg-teal-100 text-[#2d8f98]",
  },
  {
    key: "drug_history",
    title: "Drug History",
    icon: Pill,
    tint: "bg-teal-100 text-[#2d8f98]",
  },
  {
    key: "allergy_history",
    title: "Allergy History",
    icon: ShieldAlert,
    tint: "bg-orange-100 text-brand-orange",
    isAllergy: true,
  },
];

function formatSectionValue(section, items) {
  const visibleItems = filterClinicalItems(items);

  if (visibleItems.length === 0) {
    return {
      primary: getClinicalEmptyMessage(section.key),
      details: [],
      isEmpty: true,
      hasAllergyWarning: false,
    };
  }

  const hasAllergyWarning =
    section.isAllergy && visibleItems.some((item) => !isNilAllergyValue(item.name));

  return {
    primary: visibleItems.map((item) => formatMedicalConditionName(item.name)).join(" · "),
    details: visibleItems
      .map((item) => (item.detail ? formatIsoDatesInText(item.detail) : null))
      .filter(Boolean),
    isEmpty: false,
    hasAllergyWarning,
  };
}

function ClinicalHistoryTile({ section, value }) {
  const Icon = section.icon;

  return (
    <article
      className="ocs-surface-card ocs-card-press mb-4 overflow-hidden bg-white last:mb-0 lg:mb-0"
      style={{ padding: "var(--native-pad-card)" }}
    >
      <div className="flex items-start gap-4">
        <div
          className={`squircle-inner flex size-11 shrink-0 items-center justify-center ${section.tint}`}
        >
          <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="native-label text-[13px] leading-snug text-[#1a5c52]">{section.title}</p>
          <p
            className={[
              "mt-2 text-[15px] font-medium leading-relaxed lg:mt-2.5 lg:text-[16px]",
              value.isEmpty
                ? "font-normal italic text-[#8a9e9a]"
                : "text-[#22485b]",
              !value.isEmpty && value.hasAllergyWarning ? "text-[#c45c3e]" : "",
            ].join(" ")}
          >
            {value.primary}
          </p>
          {value.details.length > 0 ? (
            <p className="mt-2 text-[13px] leading-relaxed text-[#5b7f8a]">
              {value.details.join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ClinicalHistoryView({ clinicalHistory }) {
  return (
    <div className="font-sans" aria-label="Clinical history">
      <div className="mb-4 flex justify-start lg:mb-6 lg:justify-end">
        <p className="flex items-center gap-1.5 text-[11px] italic text-[#8a9e9a] lg:not-italic lg:font-medium lg:text-[12px]">
          <Lock className="size-3 shrink-0 translate-y-px" strokeWidth={1.75} aria-hidden="true" />
          Read only · Maintained by your OCS doctor
        </p>
      </div>

      <div className="flex flex-col lg:grid lg:grid-cols-2 lg:gap-6">
        {SECTIONS.map((section) => (
          <ClinicalHistoryTile
            key={section.key}
            section={section}
            value={formatSectionValue(section, clinicalHistory[section.key] ?? [])}
          />
        ))}
      </div>
    </div>
  );
}

export default ClinicalHistoryView;
