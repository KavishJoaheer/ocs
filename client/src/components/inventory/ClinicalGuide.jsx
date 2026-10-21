import { BookOpen, ChevronDown, FileClock, TriangleAlert } from "lucide-react";
import Modal from "../Modal.jsx";
import { clinicalGuideSourceUrl, clinicalGuideValues } from "../../lib/clinicalGuide.js";

const Text = ({ children }) => <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{children}</p>;

export default function ClinicalGuide({ item, onClose }) {
  const guide = clinicalGuideValues(item?.moa_notes);
  const hasContent = Object.values(guide).some(Boolean);
  const source = clinicalGuideSourceUrl(guide.source_url);
  return <Modal open={Boolean(item)} onClose={onClose} title={<span className="inline-flex items-center gap-2"><BookOpen className="size-4" aria-hidden="true" />Clinical guide</span>} placement="drawer">
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-[#193943]">{item?.item_name}</h2>
        {item?.attributes ? <p className="mt-1 break-words text-xs text-slate-500">{item.attributes}</p> : null}
        {[guide.presentation, guide.population, guide.routes].some(Boolean) ? <div className="mt-3 flex flex-wrap gap-1.5">{[guide.presentation, guide.population, guide.routes].filter(Boolean).map((text, index) => <span key={index} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700">{text}</span>)}</div> : null}
      </div>
      {!hasContent ? <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No clinical guide has been added yet. Catalogue editors can add it under Edit item → Clinical guide on the OCS warehouse item.</p> : <>
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900"><FileClock className="size-4 shrink-0" aria-hidden="true" />Draft · clinical review pending</p>
        {[guide.dose, guide.dose_detail, guide.repeat, guide.maximum].some(Boolean) ? <section aria-label="Dosing reference" className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">Dose{guide.population ? ` · ${guide.population}` : ""}</h3>
          <div className="mt-2 flex flex-wrap items-baseline gap-2">{guide.dose ? <strong className="text-2xl font-semibold tracking-tight text-[#193943]">{guide.dose}</strong> : null}{guide.dose_detail ? <span className="text-xs text-slate-500">{guide.dose_detail}</span> : null}</div>
          {guide.repeat || guide.maximum ? <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">{[["Repeat if needed", guide.repeat], ["Maximum dose", guide.maximum]].filter(([, text]) => text).map(([label, text]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-800">{text}</dd></div>)}</dl> : null}
        </section> : null}
        {guide.administration ? <section className="border-l-2 border-amber-700 pl-3"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900"><TriangleAlert className="size-4" aria-hidden="true" />Administration cautions</h3><Text>{guide.administration}</Text></section> : null}
        {guide.contraindications ? <section><h3 className="mb-2 text-sm font-semibold text-slate-800">Contraindications</h3><Text>{guide.contraindications}</Text></section> : null}
        <div>{[["Indications", guide.indications], ["Side effects", guide.side_effects], ["Drug class & pharmacology", guide.pharmacology]].filter(([, text]) => text).map(([label, text]) => <details key={label} className="group border-t border-slate-200"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">{label}<ChevronDown className="size-4 shrink-0 transition group-open:rotate-180" aria-hidden="true" /></summary><div className="pb-3"><Text>{text}</Text></div></details>)}</div>
        {guide.notes ? <section><h3 className="mb-2 text-sm font-semibold text-slate-800">Clinical notes</h3><Text>{guide.notes}</Text></section> : null}
        <footer className="border-t border-slate-200 pt-3 text-xs text-slate-500">{source ? <a className="break-words text-[#137b80] underline underline-offset-2" href={source} target="_blank" rel="noopener noreferrer">{guide.source_title || "View source"} ↗</a> : <p>{guide.source_title || "Source not recorded"}</p>}<p className="mt-1">Local formulation and protocol review pending.</p></footer>
      </>}
    </div>
  </Modal>;
}
