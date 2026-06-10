import { FolderHeart } from "lucide-react";
import RequestVisitCta from "../request-visit/RequestVisitCta.jsx";
import { NativeGroupedList } from "../native/NativeGroupedList.jsx";
import ConsultationCard from "./ConsultationCard.jsx";

function ConsultationsEmptyState() {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <FolderHeart className="size-10 text-gray-300" strokeWidth={1.5} />
      <h2 className="mt-4 text-[17px] font-semibold text-gray-900">No consultations yet</h2>
      <p className="mt-1 max-w-xs text-[15px] leading-relaxed text-gray-500">
        After your first home visit, your consultation history will appear here.
      </p>
      <RequestVisitCta className="mt-6 rounded-xl bg-[#e8a020] px-6 py-3 text-[15px] font-semibold text-white transition active:opacity-90">
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
    <div aria-label="Consultation history">
      <NativeGroupedList className="lg:hidden">
        {sorted.map((consultation, idx) => (
          <ConsultationCard
            key={consultation.id}
            consultation={consultation}
            isLast={idx === sorted.length - 1}
          />
        ))}
      </NativeGroupedList>

      <div className="hidden lg:block">
        {sorted.map((consultation, idx) => (
          <ConsultationCard
            key={consultation.id}
            consultation={consultation}
            isLast={idx === sorted.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

export default ConsultationsView;
