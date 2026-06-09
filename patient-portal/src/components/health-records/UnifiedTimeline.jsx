import dayjs from "dayjs";
import { ChevronRight, FileText, Stethoscope } from "lucide-react";

function TimelineEventCard({ event, reportUrlBuilder }) {
  const isConsultation = event.kind === "consultation";

  return (
    <div className="relative flex gap-5 max-md:gap-3">
      <div className="relative z-10 mt-7 shrink-0 max-md:mt-6">
        <div className="flex h-[10px] w-[10px] items-center justify-center rounded-full bg-[#1aa08c]" />
      </div>

      <article className="min-w-0 flex-1 rounded-xl border border-[rgba(26,160,140,0.12)] bg-white px-6 py-5 max-md:px-[14px] max-md:py-[14px]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-[#1a5c52] max-md:text-[14px]">
              {dayjs(event.date).format("D MMMM YYYY")}
            </p>
            <div className="mt-1 flex items-center gap-2">
              {isConsultation ? (
                <Stethoscope className="size-3.5 shrink-0 text-[#2d8f98]" strokeWidth={1.75} />
              ) : (
                <FileText className="size-3.5 shrink-0 text-[#2d8f98]" strokeWidth={1.75} />
              )}
              <p className="truncate text-sm font-medium text-[#5b7f8a]">{event.subtitle}</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-[rgba(26,160,140,0.08)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2d8f98]">
            {isConsultation ? "Visit" : "Report"}
          </span>
        </div>

        <h3 className="mt-3 text-base font-semibold text-[#22485b]">{event.title}</h3>

        {event.detail ? (
          <p className="mt-2 text-[13px] font-light leading-relaxed text-[#5b7f8a]">
            {event.detail}
          </p>
        ) : null}

        {isConsultation && event.reports?.length ? (
          <div className="mt-4 space-y-2">
            {event.reports.map((report) => (
              <div key={report.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-[#1a5c52]">{report.name}</span>
                <a
                  href={reportUrlBuilder(report.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-[13px] text-[#2d8f98] hover:text-[#23767f]"
                >
                  View
                  <ChevronRight className="size-3.5" />
                </a>
              </div>
            ))}
          </div>
        ) : null}

        {!isConsultation && event.attachment_id ? (
          <a
            href={reportUrlBuilder(event.attachment_id)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium text-[#2d8f98] hover:text-[#23767f]"
          >
            Open {event.file_type || "document"}
            <ChevronRight className="size-3.5" />
          </a>
        ) : null}
      </article>
    </div>
  );
}

export function UnifiedTimeline({ timeline, reportUrlBuilder }) {
  if (!timeline?.length) {
    return (
      <p className="text-[13px] font-light italic text-[#8a9ea3]">
        Your care timeline will appear here after your first visit.
      </p>
    );
  }

  return (
    <div className="relative">
      <div
        className="absolute bottom-0 left-[4px] top-0 w-[2px] bg-[rgba(26,160,140,0.2)]"
        aria-hidden="true"
      />
      <div className="space-y-3">
        {timeline.map((event, idx) => (
          <div key={event.id} className={`animate-fade-in-up stagger-${Math.min(idx + 1, 8)}`}>
            <TimelineEventCard event={event} reportUrlBuilder={reportUrlBuilder} />
          </div>
        ))}
      </div>
    </div>
  );
}
