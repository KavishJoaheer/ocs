import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";

const AMBIENT_BLUR_CROSSES = [
  {
    color: "text-[#2bccc4]",
    position: "left-[5%] top-[10%] h-64 w-64",
    duration: "22s",
    delay: "0s",
  },
  {
    color: "text-[#f7ba24]",
    position: "right-[12%] top-[22%] h-56 w-56",
    duration: "26s",
    delay: "-4s",
  },
  {
    color: "text-[#3b595c]",
    position: "bottom-[15%] left-[20%] h-48 w-48",
    duration: "18s",
    delay: "-2s",
  },
  {
    color: "text-[#f7ba24]",
    position: "bottom-[5%] right-[5%] h-72 w-72",
    duration: "28s",
    delay: "-6s",
  },
];

const BRAND_CROSS_PATH = "M9 20h6v-5h5V9h-5V4H9v5H4v6h5v5z";

/* High-blur, low-opacity breathing crosses — z-0 behind hero content */
function AmbientBlurCrossBackground() {
  return (
    <div
      className="ambient-cross-layer bg-gradient-to-tr from-slate-50 to-white"
      aria-hidden="true"
    >
      {AMBIENT_BLUR_CROSSES.map((cross) => (
        <div
          key={cross.position}
          className={`ambient-blur-cross ${cross.color} ${cross.position}`}
          style={{ animationDuration: cross.duration, animationDelay: cross.delay }}
        >
          <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden="true">
            <path d={BRAND_CROSS_PATH} fill="currentColor" />
          </svg>
        </div>
      ))}
    </div>
  );
}

function FadeInSection({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function LandingPage() {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const PATIENT_PORTAL_URL =
    typeof window !== "undefined" && window.location.hostname !== "localhost"
      ? `${window.location.protocol}//${window.location.hostname}:5174`
      : "http://localhost:5174";

  return (
    /* MOBILE: allow safe vertical scroll on short viewports | DESKTOP: lock single viewport */
    <div className="landing-page relative flex min-h-svh w-full min-w-0 max-w-[100vw] flex-col justify-between overflow-x-hidden overscroll-x-none md:min-h-screen md:overflow-hidden">
      <AmbientBlurCrossBackground />

      {/* DESKTOP: max-w-7xl shell | MOBILE: px-5 breathing room */}
      <header
        className={`relative z-10 mx-auto flex w-full max-w-7xl items-center px-5 py-5 transition-all duration-700 sm:px-6 sm:py-6 ${
          mounted ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
        }`}
      >
        <a
          href="/welcome"
          className="flex items-center gap-2 transition-opacity hover:opacity-90"
        >
          <BrandMark maxWidth={200} size={36} className="sm:hidden" />
          <BrandMark maxWidth={200} size={40} className="hidden sm:inline-flex" />
        </a>
      </header>

      {/* Hero gateway — centered module capped at max-w-md (mobile) → max-w-7xl (desktop) */}
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-5 py-4 sm:px-6 md:-mt-10 md:py-6 lg:py-8">
        <div className="w-full max-w-md text-center sm:max-w-xl md:max-w-2xl lg:max-w-4xl">
          <FadeInSection>
            <span className="mb-3 block text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#3e5c76] sm:text-[11px] sm:tracking-widest">
              OCS Médecins — Virtual Practice
            </span>
          </FadeInSection>

          <FadeInSection delay={150}>
            {/*
              MOBILE (<lg): force exactly 2 lines — "Step into a" / "world of Care"
              DESKTOP (lg+): collapse to single bold inline headline
              Scale: text-3xl → sm:text-4xl → md:text-5xl → lg:text-6xl
            */}
            <h1 className="mx-auto font-black leading-[1.12] tracking-tight text-[#3b595c] text-3xl sm:text-4xl md:text-5xl lg:text-6xl lg:leading-tight">
              <span className="block lg:inline">Step into a</span>{" "}
              <span className="block bg-gradient-to-r from-[#2bccc4] to-[#065a60] bg-clip-text text-transparent lg:inline">
                world of Care
              </span>
            </h1>
          </FadeInSection>

          <FadeInSection delay={300}>
            <div className="mx-auto mt-5 w-full sm:mt-6">
              <p className="text-[11px] font-bold uppercase leading-relaxed tracking-wide text-[#3b595c] sm:text-xs md:text-sm">
                We are more than a healthcare service, We are a community of care.
              </p>

              {/*
                MOBILE: stack three phrases vertically (no pipe separators)
                TABLET+ (sm): inline row with amber dividers
              */}
              <div className="mt-3 flex flex-col items-center gap-1.5 sm:mt-2.5 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-2 md:gap-x-3">
                <span className="text-sm font-black tracking-tight text-[#14213d] sm:text-base">
                  One Commitment
                </span>
                <span aria-hidden="true" className="hidden font-bold text-[#f7ba24] sm:inline">
                  |
                </span>
                <span className="text-sm font-black tracking-tight text-[#14213d] sm:text-base">
                  One Promise
                </span>
                <span aria-hidden="true" className="hidden font-bold text-[#f7ba24] sm:inline">
                  |
                </span>
                <span className="max-w-[18rem] text-sm font-black leading-snug tracking-tight text-[#065a60] sm:max-w-none sm:text-base">
                  Bringing healthcare to every Mauritian doorstep
                </span>
              </div>
            </div>
          </FadeInSection>

          <FadeInSection delay={450}>
            {/*
              MOBILE: full-width vertical stack for thumb reach
              TABLET+ (md): side-by-side capsule row
            */}
            <div className="mx-auto mt-8 flex w-full max-w-md flex-col gap-3 sm:mt-10 md:max-w-none md:flex-row md:items-center md:justify-center md:gap-5">
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="glow-teal-capsule w-full touch-manipulation rounded-full bg-gradient-to-r from-[#1c4e52] to-[#123638] px-8 py-3.5 text-xs font-bold tracking-wide text-white transition-all duration-300 active:scale-[0.98] md:w-auto"
              >
                Staff Portal →
              </button>
              <a
                href={PATIENT_PORTAL_URL}
                className="glow-amber-capsule w-full touch-manipulation rounded-full bg-gradient-to-r from-[#f7ba24] to-[#e0a112] px-8 py-3.5 text-center text-xs font-black tracking-wide text-[#14213d] transition-all duration-300 active:scale-[0.98] md:w-auto"
              >
                Patient Portal →
              </a>
            </div>
          </FadeInSection>
        </div>
      </main>

      <footer className="relative z-10 w-full max-w-7xl self-center px-5 py-4 text-center text-[10px] font-medium tracking-wide text-gray-400 sm:py-6">
        © {new Date().getFullYear()} OCS Médecins. All rights reserved.
      </footer>
    </div>
  );
}

export default LandingPage;
