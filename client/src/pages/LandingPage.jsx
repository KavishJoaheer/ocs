import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";

/* ── Lucide-style inline SVG icons (to avoid extra bundle) ── */
const Icon = ({ children, size = 24, className = "" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);

const StethoscopeIcon = (props) => (
  <Icon {...props}>
    <path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3" />
    <path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4" />
    <circle cx="20" cy="10" r="2" />
  </Icon>
);

const ShieldIcon = (props) => (
  <Icon {...props}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  </Icon>
);

const DollarIcon = (props) => (
  <Icon {...props}>
    <line x1="12" x2="12" y1="2" y2="22" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </Icon>
);

const SettingsIcon = (props) => (
  <Icon {...props}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

const HeadsetIcon = (props) => (
  <Icon {...props}>
    <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" />
    <path d="M21 16v2a4 4 0 0 1-4 4h-5" />
  </Icon>
);

const UserIcon = (props) => (
  <Icon {...props}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Icon>
);

const CalendarIcon = (props) => (
  <Icon {...props}>
    <path d="M8 2v4m8-4v4" />
    <rect width="18" height="18" x="3" y="4" rx="2" />
    <path d="M3 10h18" />
  </Icon>
);

const ClipboardIcon = (props) => (
  <Icon {...props}>
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="M12 11h4m-4 4h4m-8-4h.01M8 15h.01" />
  </Icon>
);

const FlaskIcon = (props) => (
  <Icon {...props}>
    <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
    <path d="M8.5 2h7M7 16.5h10" />
  </Icon>
);

const ArrowRightIcon = (props) => (
  <Icon {...props}>
    <path d="M5 12h14m-7-7 7 7-7 7" />
  </Icon>
);

const HeartPulseIcon = (props) => (
  <Icon {...props}>
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    <path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />
  </Icon>
);

const BuildingIcon = (props) => (
  <Icon {...props}>
    <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
    <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
  </Icon>
);

/* ── Animated floating particles ── */
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
            background: i % 2 === 0
              ? "rgba(65, 200, 198, 0.15)"
              : "rgba(242, 193, 77, 0.12)",
            animationDelay: `${i * 1.2}s`,
            animationDuration: `${6 + i * 2}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ── Animated entrance wrapper ── */
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
        isVisible
          ? "translate-y-0 opacity-100"
          : "translate-y-8 opacity-0"
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ── Portal Card ── */
function PortalCard({
  title,
  subtitle,
  description,
  icon: IconComponent,
  roles,
  gradient,
  onClick,
  isPrimary = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex w-full flex-col overflow-hidden rounded-[34px] border text-left transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_40px_100px_rgba(34,72,91,0.2)] ${
        isPrimary
          ? "border-[rgba(65,200,198,0.22)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,251,250,0.9))] shadow-[0_28px_70px_rgba(34,72,91,0.14)]"
          : "border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(241,251,250,0.86))] shadow-[0_20px_55px_rgba(34,72,91,0.1)]"
      }`}
    >
      {/* Gradient accent bar */}
      <div
        className={`h-2 w-full ${gradient}`}
      />

      <div className="flex flex-1 flex-col p-7 sm:p-8">
        {/* Icon */}
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-[20px] transition-transform duration-500 group-hover:scale-110 ${
            isPrimary
              ? "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white shadow-[0_10px_30px_rgba(45,143,152,0.3)]"
              : "bg-[linear-gradient(135deg,#f2c14d,#e8b030)] text-white shadow-[0_10px_30px_rgba(242,193,77,0.3)]"
          }`}
        >
          <IconComponent size={28} />
        </div>

        {/* Title */}
        <h3 className="mt-5 font-display text-2xl font-bold tracking-tight text-slate-950">
          {title}
        </h3>
        <p className="mt-1 text-sm font-semibold uppercase tracking-[0.2em] text-[#2d8f98]">
          {subtitle}
        </p>

        {/* Description */}
        <p className="mt-3 flex-1 text-sm leading-7 text-[#3f6270]">
          {description}
        </p>

        {/* Role pills */}
        {roles && roles.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {roles.map((role) => (
              <span
                key={role}
                className="rounded-full border border-[rgba(65,200,198,0.2)] bg-[rgba(65,200,198,0.08)] px-3 py-1 text-xs font-semibold text-[#2d8f98] transition-colors group-hover:bg-[rgba(65,200,198,0.14)]"
              >
                {role}
              </span>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-6 flex items-center gap-2 text-sm font-bold text-[#2d8f98] transition-all duration-300 group-hover:gap-3">
          Enter Portal
          <ArrowRightIcon size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
        </div>
      </div>
    </button>
  );
}

/* ── Feature Card ── */
function FeatureCard({ title, description, icon: IconComponent, delay }) {
  return (
    <FadeInSection delay={delay}>
      <div className="group rounded-[26px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(241,251,250,0.84))] p-6 shadow-[0_16px_40px_rgba(34,72,91,0.08)] transition-all duration-400 hover:-translate-y-1 hover:border-[rgba(65,200,198,0.28)] hover:shadow-[0_24px_60px_rgba(34,72,91,0.14)]">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(65,200,198,0.1)] text-[#2d8f98] transition-all duration-300 group-hover:bg-[rgba(65,200,198,0.18)] group-hover:scale-110">
          <IconComponent size={22} />
        </div>
        <h4 className="mt-4 font-display text-lg font-bold text-slate-950">
          {title}
        </h4>
        <p className="mt-2 text-sm leading-6 text-[#4a6b78]">
          {description}
        </p>
      </div>
    </FadeInSection>
  );
}

/* ── Main Landing Page ── */
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
    <div className="landing-page min-h-screen overflow-x-hidden text-slate-900">
      {/* ── Hero Section ── */}
      <header className="relative overflow-hidden">
        {/* Background layers */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,_rgba(65,200,198,0.2),_transparent_40%),radial-gradient(circle_at_80%_80%,_rgba(242,193,77,0.1),_transparent_30%),linear-gradient(180deg,_#f8fdfd_0%,_#edf8f8_100%)]" />
        <div className="ocs-pattern absolute inset-0 opacity-30" />
        <FloatingParticles />

        <div className="relative mx-auto max-w-7xl px-5 py-6 lg:px-8">
          {/* Nav bar */}
          <nav
            className={`flex items-center justify-between transition-all duration-700 ${
              mounted ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
            }`}
          >
            <BrandMark maxWidth={200} size={44} />
            <div className="flex flex-row items-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="rounded-full border border-[#3b595c]/30 px-5 py-2 text-xs font-bold text-[#3b595c] transition-all duration-200 hover:border-[#065a60] hover:bg-gray-50 hover:text-[#065a60]"
              >
                Staff Login
              </button>
              <a
                href={PATIENT_PORTAL_URL}
                className="glow-amber-capsule rounded-full bg-gradient-to-r from-[#f7ba24] to-[#e0a112] px-5 py-2 text-xs font-black text-[#14213d] shadow-[0_4px_12px_rgba(247,186,36,0.35)] transition-all duration-200 active:scale-[0.98]"
              >
                Patient Portal
              </a>
            </div>
          </nav>

          {/* Hero Content */}
          <div className="mt-16 pb-20 text-center lg:mt-24 lg:pb-28">
            <FadeInSection>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--color-text-hero-muted)]">
                OCS Médecins — Virtual Practice
              </p>
            </FadeInSection>

            <FadeInSection delay={150}>
              <h1 className="mx-auto mt-5 max-w-4xl text-center text-4xl font-black leading-tight tracking-tight sm:text-5xl md:text-6xl">
                <span className="text-[#3b595c]">Step into a</span>{" "}
                <span className="block bg-gradient-to-r from-[var(--gradient-hero-excellence-start)] to-[var(--gradient-hero-excellence-end)] bg-clip-text text-transparent sm:inline">
                  world of Care
                </span>
              </h1>
            </FadeInSection>

            <FadeInSection delay={300}>
              <div className="mx-auto mt-6 w-full max-w-3xl px-4 text-center">
                <p className="text-xs font-bold tracking-wide text-[#3b595c]">
                  We are more than a healthcare service — We are a community of care.
                </p>

                <p className="mt-2.5 text-sm font-black leading-snug tracking-tight text-[#14213d] sm:text-base md:text-lg">
                  One Commitment
                  <span className="mx-1.5 font-bold text-[#f7ba24] sm:mx-2">|</span>
                  One Promise
                  <span className="mx-1.5 font-bold text-[#f7ba24] sm:mx-2">|</span>
                  <span className="bg-gradient-to-r from-[#065a60] to-[#3b595c] bg-clip-text text-transparent">
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
                  className="glow-teal-capsule group relative flex items-center gap-2 rounded-full bg-gradient-to-r from-[#1c4e52] to-[#123638] px-8 py-3.5 text-xs font-bold tracking-wide text-white transition-all duration-300 active:scale-[0.98]"
                >
                  <span>Staff Portal</span>
                  <span className="transform text-[10px] transition-transform duration-200 group-hover:translate-x-0.5">
                    →
                  </span>
                </button>
                <a
                  href={PATIENT_PORTAL_URL}
                  className="glow-amber-capsule group relative flex items-center gap-2 rounded-full bg-gradient-to-r from-[#f7ba24] to-[#e0a112] px-8 py-3.5 text-xs font-black tracking-wide text-[#14213d] transition-all duration-300 active:scale-[0.98]"
                >
                  <span>Patient Portal</span>
                  <span className="transform text-[10px] transition-transform duration-200 group-hover:translate-x-0.5">
                    →
                  </span>
                </a>
              </div>
            </FadeInSection>
          </div>
        </div>

        {/* Curved divider */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 80" fill="none" className="w-full">
            <path
              d="M0 80V30C240 70 480 0 720 30S1200 80 1440 40V80H0Z"
              fill="rgba(241, 251, 250, 0.6)"
            />
          </svg>
        </div>
      </header>

      {/* ── Portal Cards Section ── */}
      <section className="relative bg-[linear-gradient(180deg,rgba(241,251,250,0.6),#f5fbfb_20%,#f5fbfb)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <FadeInSection>
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#2d8f98]">
                Choose Your Portal
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                Access your workspace
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[#4a6b78]">
                Select the portal that matches your role. Each workspace is
                tailored for its specific operations and workflows.
              </p>
            </div>
          </FadeInSection>

          <div className="mt-14 grid gap-8 lg:grid-cols-2">
            <FadeInSection delay={100}>
              <PortalCard
                title="Operations Portal"
                subtitle="Clinical Staff & Administration"
                description="Full operational workspace for managing patients, appointments, consultations, billing, and team coordination. Role-based access ensures everyone sees what they need."
                icon={StethoscopeIcon}
                isPrimary
                gradient="bg-[linear-gradient(90deg,#41c8c6,#2d8f98)]"
                roles={["Doctor", "Operator", "Accountant", "Admin", "Linkham Insurance"]}
                onClick={() => navigate("/login")}
              />
            </FadeInSection>
            <FadeInSection delay={250}>
              <PortalCard
                title="Patient Portal"
                subtitle="Patient Self-Service"
                description="Create your account and access your personal health dashboard. View upcoming appointments, billing history, consultation records, and manage your profile — all in one place."
                icon={UserIcon}
                gradient="bg-[linear-gradient(90deg,#f2c14d,#e8b030)]"
                roles={["Register", "Sign In", "View Records"]}
                onClick={() => {
                  window.location.href = PATIENT_PORTAL_URL;
                }}
              />
            </FadeInSection>
          </div>
        </div>
      </section>

      {/* ── Features Section ── */}
      <section className="bg-[radial-gradient(circle_at_60%_40%,_rgba(65,200,198,0.08),_transparent_50%),linear-gradient(180deg,#f5fbfb,#eef8f8)]">
        <div className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
          <FadeInSection>
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#f1bc35]">
                Capabilities
              </p>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                Everything your practice needs
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[#4a6b78]">
                A comprehensive digital platform powering home visit operations,
                from scheduling to billing and beyond.
              </p>
            </div>
          </FadeInSection>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              title="Appointments"
              description="Calendar and list views for home visit scheduling with real-time status updates."
              icon={CalendarIcon}
              delay={100}
            />
            <FeatureCard
              title="Consultations"
              description="Clinical notes linked to appointments with automatic billing record creation."
              icon={ClipboardIcon}
              delay={200}
            />
            <FeatureCard
              title="Billing"
              description="Complete invoice management with payment tracking and per-patient summaries."
              icon={DollarIcon}
              delay={300}
            />
            <FeatureCard
              title="Lab Reports"
              description="Lab workspace integration with file attachments and doctor-linked reporting."
              icon={FlaskIcon}
              delay={400}
            />
            <FeatureCard
              title="Patient Records"
              description="Comprehensive patient profiles with medical history, treatments, and care timelines."
              icon={HeartPulseIcon}
              delay={500}
            />
            <FeatureCard
              title="Team Operations"
              description="Doctor coordination, operator access control, and role-based team management."
              icon={HeadsetIcon}
              delay={600}
            />
            <FeatureCard
              title="Linkham Insurance"
              description="Integrated insurance workflows for claim management and coverage verification."
              icon={BuildingIcon}
              delay={700}
            />
            <FeatureCard
              title="Security"
              description="Role-based access control with session management and audit capabilities."
              icon={ShieldIcon}
              delay={800}
            />
          </div>
        </div>
      </section>

      {/* ── Stats Banner ── */}
      <section className="bg-[linear-gradient(135deg,#41c8c6,#2d8f98)]">
        <div className="ocs-pattern mx-auto max-w-7xl px-5 py-14 lg:px-8 lg:py-20">
          <FadeInSection>
            <div className="grid gap-10 text-center sm:grid-cols-3">
              <div>
                <p className="font-display text-4xl font-extrabold text-white lg:text-5xl">
                  15+
                </p>
                <p className="mt-2 text-sm font-semibold text-white/80">
                  Medical Professionals
                </p>
              </div>
              <div>
                <p className="font-display text-4xl font-extrabold text-white lg:text-5xl">
                  24/7
                </p>
                <p className="mt-2 text-sm font-semibold text-white/80">
                  Digital Access
                </p>
              </div>
              <div>
                <p className="font-display text-4xl font-extrabold text-[#f2c14d] lg:text-5xl">
                  OCS
                </p>
                <p className="mt-2 text-sm font-semibold text-white/80">
                  Médecins Excellence
                </p>
              </div>
            </div>
          </FadeInSection>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-[linear-gradient(180deg,#eef8f8,#e8f4f4)]">
        <div className="mx-auto max-w-7xl px-5 py-12 lg:px-8 lg:py-16">
          <div className="flex flex-col items-center gap-6 text-center">
            <BrandMark maxWidth={180} size={40} />
            <p className="max-w-md text-sm leading-6 text-[#4a6b78]">
              Virtual Practice — Home visit coordination and clinical operations
              platform for OCS Médecins.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="text-sm font-semibold text-[#2d8f98] transition-colors hover:text-[#22485b]"
              >
                Staff Login
              </button>
              <span className="text-slate-300">|</span>
              <a
                href={PATIENT_PORTAL_URL}
                className="text-sm font-semibold text-[#2d8f98] transition-colors hover:text-[#22485b]"
              >
                Patient Portal
              </a>
            </div>
            <div className="mt-4 border-t border-[rgba(65,200,198,0.14)] pt-6">
              <p className="text-xs text-[#7a9ba6]">
                © {new Date().getFullYear()} OCS Médecins. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
