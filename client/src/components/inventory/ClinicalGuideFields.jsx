import { CLINICAL_GUIDE_FIELDS } from "../../lib/clinicalGuide.js";

export default function ClinicalGuideFields({ value, onChange, readOnly = false }) {
  return <div className="space-y-3">
    <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">Draft reference · clinical review pending. Enter guidance for this exact formulation and patient group, with its source.</p>
    {readOnly ? <p className="text-sm text-slate-600">Update the Clinical guide on the OCS warehouse item to keep all bags consistent.</p> : null}
    <div className="grid gap-3 sm:grid-cols-2">
      {CLINICAL_GUIDE_FIELDS.map(({ key, label, multiline, placeholder, type }) => {
        const props = {
          name: key, value: value[key], readOnly, placeholder,
          maxLength: multiline ? 4000 : key === "source_url" ? 2048 : 300,
          onChange: event => onChange({ ...value, [key]: event.target.value }),
          className: "w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-ocs-teal focus:bg-white read-only:bg-slate-100",
        };
        return <label key={key} className={`block space-y-1.5 ${multiline || key === "source_url" ? "sm:col-span-2" : ""}`}>
          <span className="text-sm font-semibold text-slate-700">{label}</span>
          {multiline ? <textarea {...props} rows={3} /> : <input {...props} type={type || "text"} {...(type === "url" ? { pattern: "https://.*" } : {})} />}
        </label>;
      })}
    </div>
  </div>;
}
