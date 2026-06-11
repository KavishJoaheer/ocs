import { FolderHeart } from "lucide-react";
import RequestVisitCta from "../request-visit/RequestVisitCta.jsx";
import ConsultationCard from "./ConsultationCard.jsx";

function ConsultationsEmptyState() {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <div className="squircle-inner flex size-14 items-center justify-center bg-teal-100 text-[#2d8f98]">
        <FolderHeart className="size-7" strokeWidth={1.75} />
      </div>
      <h2 className="native-display mt-4 text-[18px] text-[#1a5c52] lg:text-brand-dark-grey">No consultations yet</h2>
      <p className="mt-1 max-w-xs text-[15px] leading-relaxed text-[#5b7f8a] lg:text-brand-cool-grey">
        After your first home visit, your consultation history will appear here.
      </p>
      <RequestVisitCta className="squircle-inner mt-6 bg-brand-gold px-6 py-3 text-[15px] font-bold text-white shadow-[0_4px_16px_rgba(var(--ocs-brand-gold-rgb),0.25)] transition active:scale-[0.98] lg:text-brand-dark-grey">
        Request a Home Visit
      </RequestVisitCta>
    </div>
  );
}

function ConsultationsView({ consultations }) {
  const sorted = [...consultations].sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  );

  if (sorted.length === 0) {
    return <ConsultationsEmptyState />;
  }

  return (
    <div className="flex flex-col gap-4 font-sans" aria-label="Consultation history">
      {sorted.map((consultation) => (
        <ConsultationCard key={consultation.id} consultation={consultation} />
      ))}
    </div>
  );
}

export default ConsultationsView;
