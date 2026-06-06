import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";

const BRAND_CROSS_ORBS = [
  {
    color: "text-[#f7ba24]",
    position: "left-[8%] top-[12%] h-36 w-36",
    duration: "30s, 18s",
    delay: "0s, 1s",
  },
  {
    color: "text-[#2bccc4]",
    position: "right-[22%] top-[6%] h-48 w-48",
    duration: "25s, 14s",
    delay: "-4s, 0s",
  },
  {
    color: "text-[#3b595c]",
    position: "bottom-[30%] left-[25%] h-24 w-24",
    duration: "20s, 12s",
    delay: "-2s, -3s",
  },
  {
    color: "text-[#f7ba24]",
    position: "bottom-[15%] right-[10%] h-28 w-28",
    duration: "34s, 20s",
    delay: "-6s, 2s",
  },
  {
    color: "text-[#2bccc4]",
    position: "right-[5%] top-[48%] h-16 w-16",
    duration: "22s, 10s",
    delay: "-1s, -5s",
  },
];

/* OCS brand cross bokeh matrix — z-0 layer behind hero typography and CTAs */
function BrandCrossBokehBackground() {
  return (
    <div className="bokeh-cross-layer" aria-hidden="true">
      <svg className="absolute h-0 w-0" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <symbol id="ocs-brand-cross" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M9.5,2h5c1.38,0,2.5,1.12,2.5,2.5v5c0,0.66,0.26,1.3,0.73,1.77l3.54,3.54c0.98,0.98,0.98,2.56,0,3.54l0,0c-0.98,0.98-2.56,0.98-3.54,0l-3.54-3.54C13.71,14.34,13.07,14.08,12.41,14.08h-0.82c-0.66,0-1.3,0.26-1.77,0.73l-3.54,3.54c-0.98,0.98-2.56,0.98-3.54,0l0,0c-0.98-0.98-0.98-2.56,0-3.54l3.54-3.54C4.76,10.8,5.02,10.16,5.02,9.5v-5C5.02,3.12,6.14,2,7.5,2H9.5z"
              transform="rotate(45 12 12)"
            />
          </symbol>
        </defs>
      </svg>

      {BRAND_CROSS_ORBS.map((orb) => (
        <svg
          key={orb.position}
          className={`brand-cross-orb ${orb.color} ${orb.position}`}
          style={{ animationDuration: orb.duration, animationDelay: orb.delay }}
          aria-hidden="true"
        >
          <use href="#ocs-brand-cross" width="100%" height="100%" />
        </svg>
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
      <BrandCrossBokehBackground />

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
