import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";

function FloatingParticles() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="landing-particle absolute rounded-full"
          style={{
            width: `${8 + i * 6}px`,
            height: `${8 + i * 6}px`,
            left: `${10 + i * 15}%`,
            top: `${20 + (i % 3) * 25}%`,
            background:
              i % 2 === 0
                ? "rgba(65, 200, 198, 0.12)"
                : "rgba(242, 193, 77, 0.1)",
            animationDelay: `${i * 1.2}s`,
            animationDuration: `${6 + i * 2}s`,
          }}
        />
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
    <div className="landing-page relative flex min-h-screen flex-col justify-between overflow-hidden bg-gradient-to-tr from-slate-50 to-white text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,_rgba(65,200,198,0.12),_transparent_40%),radial-gradient(circle_at_80%_80%,_rgba(242,193,77,0.08),_transparent_30%)]" />
      <FloatingParticles />

      {/* Minimalist logo header */}
      <header
        className={`relative z-10 mx-auto flex w-full max-w-7xl items-center px-6 py-6 transition-all duration-700 ${
          mounted ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
        }`}
      >
        <a
          href="/welcome"
          className="flex items-center gap-2 transition-opacity hover:opacity-90"
        >
          <BrandMark maxWidth={200} size={40} />
        </a>
      </header>

      {/* Centered hero gateway */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 -mt-12 text-center">
        <FadeInSection>
          <span className="mb-3 block text-[11px] font-extrabold uppercase tracking-widest text-[#3e5c76]">
            OCS Médecins — Virtual Practice
          </span>
        </FadeInSection>

        <FadeInSection delay={150}>
          <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl md:text-6xl">
            <span className="text-[#3b595c]">Step into a</span>{" "}
            <span className="bg-gradient-to-r from-[#2bccc4] to-[#065a60] bg-clip-text text-transparent">
              world of Care
            </span>
          </h1>
        </FadeInSection>

        <FadeInSection delay={300}>
          <div className="mx-auto mt-6 w-full max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-[#3b595c] sm:text-sm">
              We are more than a healthcare service, We are a community of care.
            </p>
            <p className="mt-2 text-sm font-black tracking-tight text-[#14213d] sm:text-base">
              One Commitment <span className="mx-1 text-[#f7ba24]">|</span>
              One Promise <span className="mx-1 text-[#f7ba24]">|</span>
              <span className="text-[#065a60]">
                Bringing healthcare to every Mauritian doorstep
              </span>
            </p>
          </div>
        </FadeInSection>

        <FadeInSection delay={450}>
          <div className="mt-10 flex flex-row flex-wrap items-center justify-center gap-5">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="glow-teal-capsule rounded-full bg-gradient-to-r from-[#1c4e52] to-[#123638] px-8 py-3.5 text-xs font-bold tracking-wide text-white transition-all duration-300 active:scale-[0.98]"
            >
              Staff Portal →
            </button>
            <a
              href={PATIENT_PORTAL_URL}
              className="glow-amber-capsule rounded-full bg-gradient-to-r from-[#f7ba24] to-[#e0a112] px-8 py-3.5 text-xs font-black tracking-wide text-[#14213d] transition-all duration-300 active:scale-[0.98]"
            >
              Patient Portal →
            </a>
          </div>
        </FadeInSection>
      </main>

      {/* Silent minimalist footer */}
      <footer className="relative z-10 w-full py-6 text-center text-[10px] font-medium tracking-wide text-gray-400">
        © {new Date().getFullYear()} OCS Médecins. All rights reserved.
      </footer>
    </div>
  );
}

export default LandingPage;
