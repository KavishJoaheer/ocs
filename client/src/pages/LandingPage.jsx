import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const AMBIENT_BLUR_CROSSES = [
  {
    color: "text-[#2bccc4]",
    position: "left-[5%] top-[10%] h-72 w-72",
    duration: "22s",
    delay: "0s",
  },
  {
    color: "text-[#f7ba24]",
    position: "right-[12%] top-[22%] h-64 w-64",
    duration: "26s",
    delay: "-4s",
  },
  {
    color: "text-[#3b595c]",
    position: "bottom-[15%] left-[20%] h-56 w-56",
    duration: "18s",
    delay: "-2s",
  },
  {
    color: "text-[#f7ba24]",
    position: "bottom-[5%] right-[5%] h-80 w-80",
    duration: "28s",
    delay: "-6s",
  },
  {
    color: "text-[#2bccc4]",
    position: "right-[8%] top-[48%] h-40 w-40",
    duration: "24s",
    delay: "-3s",
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
      ? "https://patient.ocsvp.com"
      : "http://localhost:5174";

  return (
    /* MOBILE: allow safe vertical scroll on short viewports | DESKTOP: lock single viewport */
    <div className="landing-page relative flex min-h-svh w-full min-w-0 max-w-[100vw] flex-col justify-between overflow-x-hidden overscroll-x-none md:min-h-screen md:overflow-hidden">
      <AmbientBlurCrossBackground />
      
      {/* 3D Hovering Robot Doctor at the back */}
      <div className="absolute right-[5%] top-[15%] z-0 h-[60%] w-auto max-w-[45%] opacity-60 pointer-events-none md:right-[10%] md:top-[20%] md:h-[70%] mix-blend-darken">
        <img 
          src="/robot-doctor.png" 
          alt="3D Hovering Robot Doctor" 
          className="robot-hover h-full w-full object-contain mix-blend-darken"
          aria-hidden="true"
        />
      </div>

      <header
        className={`relative z-10 mx-auto flex w-full max-w-7xl items-center justify-center px-6 py-5 transition-all duration-700 md:justify-between ${
          mounted ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
        }`}
      >
        <a
          href="/welcome"
          className="flex items-center justify-center transition-opacity hover:opacity-90"
        >
          <img
            src="/ocs-medecins-logo.png"
            alt="OCS Médecins"
            className="h-9 w-auto object-contain"
          />
        </a>
        <div className="hidden md:block" />
      </header>

      <main className="relative z-10 my-auto flex flex-1 flex-col items-center justify-center px-4 text-center">
        <div className="w-full">
          <FadeInSection>
            <span className="mb-3 block text-[10px] font-extrabold uppercase tracking-widest text-[#3e5c76] md:text-[11px]">
              OCS Médecins — Virtual Practice
            </span>
          </FadeInSection>

          <FadeInSection delay={150}>
            <h1 className="mx-auto max-w-2xl bg-gradient-to-r from-[#3b595c] via-[#2bccc4] to-[#065a60] bg-clip-text text-center text-4xl font-black leading-tight tracking-tight text-transparent sm:text-5xl md:text-6xl">
              <span className="block sm:inline">Step into a</span>{" "}
              <span className="block sm:inline">world of Care</span>
            </h1>
          </FadeInSection>

          <FadeInSection delay={300}>
            <div className="mx-auto mt-6 w-full max-w-2xl px-2">
              <p className="text-[11px] font-bold uppercase leading-relaxed tracking-wide text-[#3b595c] sm:text-xs">
                We are more than a healthcare service — We are a community of care.
              </p>

              <p className="mx-auto mt-3 max-w-md text-xs font-black leading-normal tracking-tight text-[#14213d] sm:max-w-none sm:text-sm md:text-base">
                <span className="block sm:inline">One Commitment</span>
                <span
                  className="mx-auto my-1.5 block h-px w-16 rounded-full bg-[#f7ba24] sm:hidden"
                  aria-hidden="true"
                />
                <span className="mx-1.5 hidden text-[#f7ba24] sm:inline">|</span>
                <span className="block sm:mt-0 sm:inline">One Promise</span>
                <span
                  className="mx-auto my-1.5 block h-px w-16 rounded-full bg-[#f7ba24] sm:hidden"
                  aria-hidden="true"
                />
                <span className="mx-1.5 hidden text-[#f7ba24] sm:inline">|</span>
                <span className="block text-[#065a60] sm:inline">
                  Bringing healthcare to every Mauritian doorstep
                </span>
              </p>
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
