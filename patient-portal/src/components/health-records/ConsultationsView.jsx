import { Link } from "react-router-dom";
import { FolderHeart } from "lucide-react";
import ConsultationCard from "./ConsultationCard.jsx";

function ConsultationsEmptyState() {
  return (
    <div className="flex flex-col items-center px-4 py-16 text-center">
      <FolderHeart className="size-11 text-[rgba(26,160,140,0.35)]" strokeWidth={1.5} />
      <h2 className="native-display mt-5 text-[20px] text-[#1a5c52]">
        Your health story starts here
      </h2>
      <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-[#8a9e9a]">
        After your first home visit, consultation history will appear here.
      </p>
      <Link
        to="/request-visit"
        className="squircle-inner mt-6 bg-[#e8a020] px-6 py-3.5 text-[14px] font-bold text-white shadow-[0_4px_16px_rgba(232,160,32,0.25)] transition active:scale-[0.98]"
      >
        Request a Home Visit
      </Link>
    </div>
  );
}

/** Chronological consultation list — newest first. */
function ConsultationsView({ consultations }) {
  const sorted = [...consultations].sort(
    (a, b) => new Date(b.date) - new Date(a.date),
  );

  if (sorted.length === 0) {
    return <ConsultationsEmptyState />;
  }

  return (
    <ul className="space-y-4" aria-label="Consultation history">
      {sorted.map((consultation, idx) => (
        <li key={consultation.id} className={`animate-fade-in-up stagger-${Math.min(idx + 1, 6)}`}>
          <ConsultationCard consultation={consultation} />
        </li>
      ))}
    </ul>
  );
}

export default ConsultationsView;
