import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  MapPin,
  Phone,
  Stethoscope,
  ShieldCheck,
  FileText,
} from "lucide-react";

const VISIT_PREP = [
  "Have your national ID or passport ready for verification.",
  "Keep any previous medical records or prescriptions on hand.",
  "Ensure a clear, well-lit space for the consultation.",
];

function PatientActiveVisit() {
  const navigate = useNavigate();

  function handleCall() {
    window.location.href = "tel:52522234";
  }

  function handleCancel() {
    toast.success("Visit request cancelled. Our team will be in touch.");
    navigate("/", { replace: true });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in-up">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34c759] opacity-70" />
            <span className="relative inline-flex size-2.5 rounded-full bg-[#34c759]" />
          </span>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            Active Visit
          </p>
        </div>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
          Your doctor is on the way
        </h1>
        <p className="mt-2 text-sm text-[#5b7f8a]">
          Track your home visit in real time, concierge style.
        </p>
      </div>

      {/* Map placeholder */}
      <div className="animate-fade-in-up stagger-1 relative h-[40vh] min-h-[280px] overflow-hidden rounded-3xl border border-[rgba(65,200,198,0.16)] bg-[radial-gradient(circle_at_30%_25%,rgba(112,221,210,0.28),transparent_45%),radial-gradient(circle_at_75%_70%,rgba(65,200,198,0.18),transparent_40%),linear-gradient(160deg,#eef9f8_0%,#dcefee_100%)] shadow-[0_24px_70px_rgba(34,72,91,0.16)]">
        {/* Subtle route lines */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.5] [background-image:linear-gradient(rgba(45,143,152,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(45,143,152,0.06)_1px,transparent_1px)] [background-size:46px_46px]" />

        {/* Floating status pill */}
        <div className="absolute left-1/2 top-5 z-10 -translate-x-1/2">
          <div className="flex items-center gap-2.5 rounded-full bg-white/95 px-5 py-2.5 shadow-[0_16px_40px_rgba(34,72,91,0.18)] backdrop-blur">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#f7ba24] opacity-70" />
              <span className="relative inline-flex size-2.5 rounded-full bg-[#f7ba24]" />
            </span>
            <span className="text-sm font-bold tracking-tight text-[#14213d]">
              Dr. Smith is on the way
            </span>
          </div>
        </div>

        {/* Destination marker */}
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
          <div className="rounded-2xl bg-[linear-gradient(135deg,#1c4e52,#123638)] p-3 shadow-[0_16px_40px_rgba(28,78,82,0.4)]">
            <MapPin className="size-6 text-white" />
          </div>
          <span className="mt-2 rounded-full bg-white/90 px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[#2d8f98] shadow-sm">
            Your home
          </span>
        </div>
      </div>

      {/* Doctor + ETA floating card (overlaps map) */}
      <div className="relative z-20 -mt-16 px-2 sm:px-6">
        <div className="animate-fade-in-up stagger-2 flex flex-col gap-5 rounded-[30px] bg-white p-6 shadow-[0_30px_80px_rgba(34,72,91,0.18)] sm:flex-row sm:items-center sm:justify-between">
          {/* Doctor identity */}
          <div className="flex items-center gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] shadow-lg shadow-[rgba(45,143,152,0.28)]">
              <Stethoscope className="size-7 text-white" />
            </div>
            <div>
              <p className="font-display text-lg font-bold tracking-tight text-[#14213d]">
                Dr. Jonathan Smith
              </p>
              <p className="mt-0.5 text-sm text-[#5b7f8a]">General Practitioner</p>
            </div>
          </div>

          {/* ETA */}
          <div className="flex items-baseline gap-2 sm:flex-col sm:items-end sm:gap-0">
            <span className="font-display text-4xl font-black leading-none tracking-tight text-[#f7ba24]">
              15
            </span>
            <span className="text-sm font-semibold text-[#3b595c]">Mins away</span>
          </div>
        </div>
      </div>

      {/* Visit preparation */}
      <div className="animate-fade-in-up stagger-3 rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-6 shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-[#2d8f98]" />
          <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            Visit Preparation
          </h2>
        </div>
        <p className="mt-3 text-sm font-medium text-[#22485b]">
          Please have your ID and any previous medical records ready.
        </p>
        <ul className="mt-4 space-y-3">
          {VISIT_PREP.map((item) => (
            <li key={item} className="flex items-start gap-3">
              <FileText className="mt-0.5 size-4 shrink-0 text-[#66d7d0]" />
              <span className="text-sm leading-6 text-[#5b7f8a]">{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Action bar */}
      <div className="animate-fade-in-up stagger-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={handleCall}
          className="glow-teal-capsule inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#1c4e52] to-[#123638] px-6 py-4 text-sm font-black tracking-wide text-white transition-all duration-300 hover:scale-[1.01] active:scale-[0.99]"
        >
          <Phone className="size-4" />
          Call Doctor
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="inline-flex items-center justify-center rounded-full px-6 py-4 text-sm font-semibold text-slate-400 transition-colors hover:text-[#3b595c] sm:flex-none"
        >
          Cancel Request
        </button>
      </div>
    </div>
  );
}

export default PatientActiveVisit;
