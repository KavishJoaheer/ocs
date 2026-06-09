import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, ClipboardList, Phone } from "lucide-react";
import { api } from "../../lib/api.js";
import { useLiveRefreshKey } from "../../hooks/useLiveRefreshKey.js";

// Ordered milestones a live request moves through. The patient tracker derives
// each step's state from the request's current backend status.
const STEP_FLOW = [
  { key: "pending", label: "Request received" },
  { key: "acknowledged", label: "Care team reviewing" },
  { key: "assigned", label: "Doctor assigned" },
  { key: "en_route", label: "Doctor en route" },
  { key: "arrived", label: "Doctor arrived" },
];

const PREP = [
  "Please have any previous medical records or prescriptions handy",
  "Ensure someone is available to open the door",
  "Secure any pets if needed",
];

function initialsFromName(name) {
  const parts = String(name || "")
    .replace(/^dr\.?\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "OCS";
  return parts
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function StepMarker({ state }) {
  if (state === "complete") {
    return (
      <span className="flex size-7 items-center justify-center rounded-full bg-[#2d8f98] text-white">
        <Check className="size-4" strokeWidth={3} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative flex size-7 items-center justify-center">
        <span className="absolute inline-flex size-7 animate-ping rounded-full bg-[rgba(65,200,198,0.5)]" />
        <span className="relative size-3.5 rounded-full bg-[#2d8f98]" />
      </span>
    );
  }
  return (
    <span className="flex size-7 items-center justify-center">
      <span className="size-3.5 rounded-full border-2 border-[rgba(100,116,139,0.3)]" />
    </span>
  );
}

function formatCountdown(ms) {
  if (ms <= 0) return "Arriving now";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function RequestVisitTracking() {
  const [visit, setVisit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Live: re-fetch whenever the patient stream reports a change (staff assigning
  // a doctor, moving the status, updating the ETA, etc.).
  const refreshKey = useLiveRefreshKey();
  const etaDeadlineRef = useRef(null);
  const etaKeyRef = useRef(null);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const data = await api.get("/patient-portal/visit-requests/active");
        if (!ignore) {
          setVisit(data.visit_request || null);
        }
      } catch {
        if (!ignore) {
          setVisit(null);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [refreshKey]);

  // Anchor an ETA countdown each time staff set/changes the ETA.
  useEffect(() => {
    if (!visit || visit.eta_minutes == null || visit.status === "arrived") {
      etaDeadlineRef.current = null;
      etaKeyRef.current = null;
      return;
    }
    const key = `${visit.id}:${visit.updated_at}:${visit.eta_minutes}`;
    if (etaKeyRef.current !== key) {
      etaKeyRef.current = key;
      etaDeadlineRef.current = Date.now() + visit.eta_minutes * 60000;
    }
  }, [visit]);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-[560px] py-20 text-center text-sm text-[#5b7f8a]">
        Loading your visit…
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="mx-auto max-w-[560px] animate-fade-in-fast py-16 text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950">
          No active visit right now.
        </h1>
        <p className="mt-3 text-sm text-[#5b7f8a]">
          When you request a home visit, you'll be able to track your doctor here.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            to="/request-visit"
            className="flex h-[52px] w-full max-w-[320px] items-center justify-center gap-2 rounded-full bg-[#e8a020] text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-95"
          >
            Request a visit
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#94a9ad] transition hover:text-[#5b7f8a]"
          >
            <ArrowLeft className="size-4" /> Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const currentIndex = STEP_FLOW.findIndex((step) => step.key === visit.status);
  const steps = STEP_FLOW.map((step, idx) => {
    let state = "upcoming";
    if (currentIndex >= 0 && idx < currentIndex) state = "complete";
    else if (idx === currentIndex) state = "active";
    return { ...step, state };
  });

  const doctorName = visit.doctor_name || "Awaiting assignment";
  const countdown =
    etaDeadlineRef.current != null
      ? formatCountdown(etaDeadlineRef.current - nowTick)
      : null;
  const etaText =
    visit.eta_minutes != null ? `Estimated arrival: ${visit.eta_minutes} minutes` : visit.status_label;

  return (
    <div className="mx-auto max-w-[560px] animate-fade-in-fast">
      {/* Header */}
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
        <span className="bg-[linear-gradient(90deg,#1a5c52_0%,#0d9e8a_60%,#12bfa8_100%)] bg-clip-text text-transparent">
          {visit.status === "arrived" ? "Your doctor has arrived." : "Your doctor is on the way."}
        </span>
      </h1>
      <p className="mt-3 text-sm text-[#5b7f8a]">
        {doctorName} · {etaText}
      </p>

      {/* Live ETA countdown */}
      {countdown && visit.status !== "arrived" && (
        <div className="mt-6 flex items-center gap-4 rounded-2xl border border-[rgba(45,143,152,0.18)] bg-[linear-gradient(135deg,rgba(65,200,198,0.12),rgba(45,143,152,0.06))] p-5">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#2d8f98]">
              Arriving in
            </span>
            <span className="font-display text-4xl font-black leading-none tracking-tight text-[#1a5c52] tabular-nums">
              {countdown}
            </span>
          </div>
          <span className="relative ml-auto flex size-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34c759] opacity-70" />
            <span className="relative inline-flex size-3 rounded-full bg-[#34c759]" />
          </span>
        </div>
      )}

      {/* Doctor card */}
      <div className="mt-8 flex items-center gap-4 rounded-2xl border border-[rgba(65,200,198,0.16)] bg-white/85 p-6">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-lg font-bold text-white">
          {initialsFromName(visit.doctor_name)}
        </div>
        <div className="flex-1">
          <p className="font-display text-lg font-bold tracking-tight text-[#22485b]">
            {doctorName}
          </p>
          <p className="mt-0.5 text-sm text-[#5b7f8a]">Home visit</p>
        </div>
        <span className="rounded-full bg-[rgba(45,143,152,0.12)] px-3 py-1 text-xs font-bold text-[#23767f]">
          {visit.status_label}
        </span>
      </div>

      {/* Progress tracker */}
      <div className="mt-8 rounded-2xl border border-[rgba(65,200,198,0.16)] bg-white/85 p-6">
        <ol>
          {steps.map((step, idx) => {
            const isLast = idx === steps.length - 1;
            const muted = step.state === "upcoming";
            return (
              <li key={step.key} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <StepMarker state={step.state} />
                  {!isLast && (
                    <span
                      className={`my-1 w-px flex-1 ${
                        step.state === "complete"
                          ? "bg-[rgba(45,143,152,0.4)]"
                          : "bg-[rgba(100,116,139,0.2)]"
                      }`}
                    />
                  )}
                </div>
                <span
                  className={`pb-6 text-sm font-semibold ${
                    muted ? "text-[#94a9ad]" : "text-[#22485b]"
                  } ${step.state === "active" ? "text-[#2d8f98]" : ""}`}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Pre-visit preparation */}
      <div className="mt-6 rounded-2xl border border-[rgba(232,160,32,0.18)] bg-[rgba(232,160,32,0.07)] p-6">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4 text-[#b5760a]" />
          <h2 className="text-xs font-semibold uppercase tracking-[0.24em] text-[#a86c08]">
            Before your doctor arrives
          </h2>
        </div>
        <ul className="mt-4 space-y-3">
          {PREP.map((item) => (
            <li key={item} className="flex items-start gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#e8a020]" />
              <span className="text-sm leading-6 text-[#5b6b6b]">{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom actions */}
      <div className="mt-8">
        <a
          href="tel:52522234"
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#e8a020] text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-95"
        >
          <Phone className="size-4" /> Call the care team
        </a>
        <div className="mt-4 text-center">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#94a9ad] transition hover:text-[#5b7f8a]"
          >
            <ArrowLeft className="size-4" /> Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export default RequestVisitTracking;
