import { useId } from "react";

export default function StructuredConsultationFields({ form, setForm }) {
  const formId = useId();
  const fields = [
    ["clinical_note", "Consultation note (not visible to patient)", true],
    ["patient_diagnosis", "Patient-facing diagnosis / assessment", true],
    ["patient_prescription", "Prescription (optional)", false],
    ...(Object.hasOwn(form, "patient_summary") ? [["patient_summary", "Patient care summary (optional)", false]] : []),
  ];
  return <div className="space-y-4">
    {fields.map(([key, label, required]) => <div key={key} className="block space-y-2">
      <label htmlFor={`${formId}-${key}`} className="block text-sm font-semibold text-slate-700">{label}</label>
      <textarea id={`${formId}-${key}`} required={required} maxLength={10000} rows={key === "clinical_note" ? 6 : 3} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 leading-7 outline-none transition focus:border-sky-400 focus:bg-white" />
    </div>)}
  </div>;
}
