import { useId, useState } from "react";
import { BookOpen, ChevronDown, FileClock, TriangleAlert } from "lucide-react";
import Modal from "../Modal.jsx";
import { clinicalGuideSourceUrl, clinicalGuidePopulations } from "../../lib/clinicalGuide.js";

const Text = ({ children }) => <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{children}</p>;

export default function ClinicalGuide({ item, onClose }) {
  return <Modal open={Boolean(item)} onClose={onClose} title={<span className="inline-flex items-center gap-2"><BookOpen className="size-4" aria-hidden="true" />Clinical guide</span>} placement="drawer">
    <ClinicalGuideBody key={item?.id ?? item?.item_name ?? "closed"} item={item} />
  </Modal>;
}

function ClinicalGuideBody({ item }) {
  const populations = clinicalGuidePopulations(item?.clinical_guide);
  const [selected, setSelected] = useState("primary");
  const panelId = useId();
  const { id: activeId, guide } = populations.find(population => population.id === selected) || populations[0];
  const hasContent = Object.values(guide).some(Boolean);
  const source = clinicalGuideSourceUrl(guide.source_url);
  const additionalSource = clinicalGuideSourceUrl(guide.additional_source_url);
  return <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-[#193943]">{item?.item_name}</h2>
        {item?.attributes ? <p className="mt-1 break-words text-xs text-slate-500">{item.attributes}</p> : null}
        {[guide.presentation, guide.population, guide.routes].some(Boolean) ? <div className="mt-3 flex flex-wrap gap-1.5">{[guide.presentation, populations.length === 1 ? guide.population : "", guide.routes].filter(Boolean).map((text, index) => <span key={index} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700">{text}</span>)}</div> : null}
        {populations.length > 1 ? <div role="group" aria-label="Patient group" className="mt-3 flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {populations.map(population => <button key={population.id} type="button" aria-pressed={activeId === population.id} aria-controls={panelId} onClick={() => setSelected(population.id)} className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${activeId === population.id ? "bg-white text-[#137b80] shadow-sm" : "text-slate-600 hover:bg-white/60"}`}>{population.label}</button>)}
        </div> : null}
      </div>
      <div id={panelId} key={activeId} className="space-y-3">
      {!hasContent ? <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">A clinical guide is not available for this item yet.</p> : <>
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900"><FileClock className="size-4 shrink-0" aria-hidden="true" />Draft · clinical review pending</p>
        {guide.critical_warning ? <section aria-label="Critical safety warnings" className="rounded-2xl border border-red-200 bg-red-50 p-4"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-900"><TriangleAlert className="size-4 shrink-0" aria-hidden="true" />Critical safety warnings</h3><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-red-950">{guide.critical_warning}</p></section> : null}
        {guide.dosing_unavailable ? <section aria-label="Dosing unavailable" className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><h3 className="mb-2 text-sm font-semibold text-amber-900">Dosing unavailable · reference notice</h3><Text>{guide.dosing_unavailable}</Text></section> : null}
        {[guide.dose, guide.dose_detail, guide.repeat, guide.maximum, guide.dose_sections, guide.dose_limits].some(Boolean) ? <section aria-label="Dosing reference" className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">Dose{guide.population ? ` · ${guide.population}` : ""}</h3>
          {guide.dose_sections ? <div className="mt-3 space-y-3">{guide.dose_sections.map((section, index) => <section key={index} aria-label={section.label} className="border-t border-slate-100 pt-3">
            <h4 className="text-xs font-medium text-slate-600">{section.label}</h4>
            <strong className="mt-1 block text-xl font-semibold tracking-tight text-[#193943]">{section.dose}</strong>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{section.detail}</p>
          </section>)}</div> : null}
          {guide.dose || guide.dose_detail ? <div className="mt-2 flex flex-wrap items-baseline gap-2">{guide.dose ? <strong className="text-2xl font-semibold tracking-tight text-[#193943]">{guide.dose}</strong> : null}{guide.dose_detail ? <span className="text-xs text-slate-500">{guide.dose_detail}</span> : null}</div> : null}
          {guide.repeat || guide.maximum ? <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">{[["Repeat if needed", guide.repeat], ["Maximum dose", guide.maximum]].filter(([, text]) => text).map(([label, text]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-800">{text}</dd></div>)}</dl> : null}
          {guide.dose_limits ? <div className="mt-3 border-t border-slate-200 pt-3"><h4 className="mb-2 text-xs font-semibold text-amber-900">Dose limits & adjustments</h4><Text>{guide.dose_limits}</Text></div> : null}
        </section> : null}
        {guide.administration ? <section className="border-l-2 border-amber-700 pl-3"><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900"><TriangleAlert className="size-4" aria-hidden="true" />Administration cautions</h3><Text>{guide.administration}</Text></section> : null}
        {guide.contraindications ? <section><h3 className="mb-2 text-sm font-semibold text-slate-800">Contraindications</h3><Text>{guide.contraindications}</Text></section> : null}
        {guide.precautions ? <section><h3 className="mb-2 text-sm font-semibold text-slate-800">Safety & precautions</h3><Text>{guide.precautions}</Text></section> : null}
        <div>{[["Indications", guide.indications], ["Side effects", guide.side_effects], ["Drug class & pharmacology", guide.pharmacology]].filter(([, text]) => text).map(([label, text]) => <details key={label} className="group border-t border-slate-200"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">{label}<ChevronDown className="size-4 shrink-0 transition group-open:rotate-180" aria-hidden="true" /></summary><div className="pb-3"><Text>{text}</Text></div></details>)}</div>
        {guide.notes ? <section><h3 className="mb-2 text-sm font-semibold text-slate-800">Clinical notes</h3><Text>{guide.notes}</Text></section> : null}
        <footer className="border-t border-slate-200 pt-3 text-xs text-slate-500">{source ? <a className="break-words text-[#137b80] underline underline-offset-2" href={source} target="_blank" rel="noopener noreferrer">{guide.source_title || "View source"} ↗</a> : <p>{guide.source_title || "Source not recorded"}</p>}{guide.source_updated ? <p className="mt-1">Source updated {guide.source_updated}.</p> : null}{additionalSource ? <p className="mt-2"><a className="break-words text-[#137b80] underline underline-offset-2" href={additionalSource} target="_blank" rel="noopener noreferrer">{guide.additional_source_title || "Additional reference"} ↗</a></p> : null}{guide.references?.map((reference, index) => <p key={index} className="mt-2"><a className="break-words text-[#137b80] underline underline-offset-2" href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title} ↗</a></p>)}<p className="mt-1">Local formulation and protocol review pending.</p></footer>
      </>}
      </div>
    </div>;
}
