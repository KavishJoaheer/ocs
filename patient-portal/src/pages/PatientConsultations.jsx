import { useState } from "react";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import { ClipboardList, ChevronRight, FileText } from "lucide-react";

const SAMPLE_CONSULTATIONS = [
  {
    id: 1,
    date: "2026-06-07",
    doctor_name: "Dr. Avinash Sharma",
    diagnosis: "URTI",
    reports: [
      {
        id: 1,
        name: "Throat Swab Results — 7 June 2026",
        url: "#",
      },
    ],
  },
  {
    id: 2,
    date: "2026-04-15",
    doctor_name: "Dr. Priya Nair",
    diagnosis: "Viral Fever",
    reports: [
      {
        id: 2,
        name: "Blood Panel — 15 April 2026",
        url: "#",
      },
    ],
  },
  {
    id: 3,
    date: "2026-01-02",
    doctor_name: "Dr. Avinash Sharma",
    diagnosis: "Hypertension Review",
    reports: [],
  },
];

function SectionLabel({ children }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[1.5px] text-[#6e949b]">
      {children}
    </p>
  );
}

function TimelineNode({ consultation, expanded, onToggle }) {
  const hasReports = consultation.reports?.length > 0;

  return (
    <div className="relative flex gap-5">
      <div className="relative z-10 mt-7 shrink-0">
        <div className="h-[10px] w-[10px] rounded-full bg-[#1aa08c]" />
      </div>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          className="group w-full rounded-xl border border-[rgba(26,160,140,0.12)] bg-white px-6 py-5 text-left transition-colors duration-200 ease-in-out hover:bg-[rgba(26,160,140,0.04)]"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[15px] font-bold text-[#1a5c52]">
                {dayjs(consultation.date).format("D MMMM YYYY")}
              </p>
              <p className="mt-0.5 text-sm font-light text-[#5b7f8a]">
                {consultation.doctor_name}
              </p>
            </div>
            <ChevronRight
              className={`size-4 shrink-0 text-[#6e949b] transition-all duration-250 ease-in-out group-hover:text-[#2d8f98] ${
                expanded ? "rotate-180" : ""
              }`}
              strokeWidth={2}
            />
          </div>

          <div
            className="grid transition-[grid-template-rows] duration-250 ease-in-out"
            style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <div className="pt-5">
                <SectionLabel>Diagnosis</SectionLabel>
                <span className="mt-2 inline-flex rounded-[20px] bg-[rgba(26,160,140,0.1)] px-4 py-1 text-[13px] text-[#2d8f98]">
                  {consultation.diagnosis}
                </span>

                <div className="mt-5">
                  <SectionLabel>Medical &amp; Lab Reports</SectionLabel>
                  {hasReports ? (
                    <div className="mt-2">
                      {consultation.reports.map((report, idx) => (
                        <div key={report.id}>
                          {idx > 0 ? (
                            <div className="my-3 border-t border-[rgba(26,160,140,0.1)]" />
                          ) : null}
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <FileText
                                className="size-4 shrink-0 text-[#2d8f98]"
                                strokeWidth={1.75}
                              />
                              <span className="truncate text-sm font-normal text-[#1a5c52]">
                                {report.name}
                              </span>
                            </div>
                            <a
                              href={report.url}
                              className="shrink-0 text-[13px] text-[#2d8f98] transition-colors duration-200 hover:text-[#23767f]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Download →
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-[13px] font-light italic text-[#6e949b]">
                      No reports uploaded for this visit.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="animate-fade-in-up stagger-1 flex flex-col items-center px-6 py-20 text-center">
      <ClipboardList
        className="size-12 text-[rgba(26,160,140,0.35)]"
        strokeWidth={1.5}
      />
      <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight text-[#22485b]">
        Your health story starts here.
      </h2>
      <p className="mt-3 max-w-md text-sm font-light leading-relaxed text-[#6e949b]">
        Once your first home visit is complete, your consultation history will
        appear here — beautifully organised.
      </p>
      <Link
        to="/request-visit"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#e8a020] px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_40px_rgba(232,160,32,0.38)] transition hover:brightness-105"
      >
        Request a Home Visit →
      </Link>
    </div>
  );
}

function PatientConsultations() {
  const [expandedIds, setExpandedIds] = useState(new Set());
  const consultations = SAMPLE_CONSULTATIONS;

  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-8">
      <div className="animate-fade-in-up">
        <div className="flex items-center gap-2">
          <ClipboardList
            className="size-[18px] shrink-0 text-[#6B9E95]"
            strokeWidth={1.5}
          />
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            Consultation History
          </p>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Your Health Timeline.
        </h1>
        <p className="mt-2 text-sm font-light text-[#5b7f8a]">
          Every visit, beautifully kept.
        </p>
      </div>

      {consultations.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="animate-fade-in-up stagger-1 relative">
          <div
            className="absolute bottom-0 left-[4px] top-0 w-[2px] bg-[rgba(26,160,140,0.2)]"
            aria-hidden="true"
          />
          <div className="space-y-6">
            {consultations.map((consultation, idx) => (
              <div
                key={consultation.id}
                className={`animate-fade-in-up stagger-${Math.min(idx + 2, 6)}`}
              >
                <TimelineNode
                  consultation={consultation}
                  expanded={expandedIds.has(consultation.id)}
                  onToggle={() => toggleExpanded(consultation.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default PatientConsultations;
