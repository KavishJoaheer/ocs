import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  HeartPulse,
  Home,
  Lock,
  MapPin,
  ShieldCheck,
  Stethoscope,
  UserPlus,
} from "lucide-react";

const BRAND_CROSS_PATH = "M9 20h6v-5h5V9h-5V4H9v5H4v6h5v5z";

const AMBIENT_BLUR_CROSSES = [
  { color: "text-[#2bccc4]", position: "left-[2%] top-[8%] h-72 w-72", duration: "22s" },
  { color: "text-[#f7ba24]", position: "right-[7%] top-[18%] h-64 w-64", duration: "26s" },
  { color: "text-[#2bccc4]", position: "bottom-[5%] left-[32%] h-56 w-56", duration: "24s" },
];

const TRUST_SIGNALS = [
  {
    icon: MapPin,
    title: "Across Mauritius",
    detail: "Care designed to reach every doorstep",
  },
  {
    icon: Lock,
    title: "One secure record",
    detail: "Your care journey stays connected",
  },
  {
    icon: Stethoscope,
    title: "Clinician-led care",
    detail: "A care team around your needs",
  },
];

const CARE_STEPS = [
  {
    number: "01",
    icon: UserPlus,
    title: "Tell us what you need",
    detail: "Create your account and make a care request in a few simple steps.",
  },
  {
    number: "02",
    icon: Stethoscope,
    title: "Connect with your care team",
    detail: "OCS Médecins coordinates the right next step for your situation.",
  },
  {
    number: "03",
    icon: Check,
    title: "Keep your care together",
    detail: "Follow visits, appointments, records and billing from one secure portal.",
  },
];

function AmbientBlurCrossBackground() {
  return (
    <div className="ambient-cross-layer" aria-hidden="true">
      {AMBIENT_BLUR_CROSSES.map((cross) => (
        <div
          key={cross.position}
          className={`ambient-blur-cross ${cross.color} ${cross.position}`}
          style={{ animationDuration: cross.duration }}
        >
          <svg viewBox="0 0 24 24" className="h-full w-full">
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
      { threshold: 0.12 },
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

function ProfessionalPortals({ staffUrl, insuranceUrl }) {
  return (
    <>
      <nav className="landing-professional-links" aria-label="Professional portals">
        <a href={staffUrl}>Staff login</a>
        <span aria-hidden="true" />
        <a href={insuranceUrl}>Insurance portal</a>
      </nav>

      <details className="landing-professional-menu">
        <summary aria-label="Professional portals">
          Portals
          <ChevronDown size={14} strokeWidth={2.2} aria-hidden="true" />
        </summary>
        <div className="landing-professional-menu-panel">
          <a href={staffUrl}>Staff login</a>
          <a href={insuranceUrl}>Insurance portal</a>
        </div>
      </details>
    </>
  );
}

function CareNetworkVisual() {
  return (
    <div className="landing-network-card" aria-label="OCS Médecins care across Mauritius">
      <div className="landing-network-copy">
        <span className="landing-network-live">
          <span aria-hidden="true" /> Care, connected
        </span>
        <strong>From your doorstep to your care team.</strong>
      </div>

      <div className="landing-island-wrap" aria-hidden="true">
        <div className="landing-island-orbit landing-island-orbit--outer" />
        <div className="landing-island-orbit landing-island-orbit--inner" />
        <img src="/ocs-mauritius-cinematic-v1.webp" alt="" />
        <span className="landing-care-node landing-care-node--one" />
        <span className="landing-care-node landing-care-node--two" />
        <span className="landing-care-node landing-care-node--three" />
      </div>

      <div className="landing-journey-card">
        <div className="landing-journey-icon">
          <Home size={19} strokeWidth={2.1} aria-hidden="true" />
        </div>
        <div>
          <span>Your care journey</span>
          <strong>Request · Consult · Follow up</strong>
        </div>
      </div>
    </div>
  );
}

function LandingPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  const isProdHost =
    typeof window !== "undefined" && window.location.hostname !== "localhost";
  const staffPortalUrl = isProdHost
    ? "https://staff.ocsvp.com/login"
    : "http://localhost:5173/login";
  const insurancePortalUrl = isProdHost
    ? "https://ins.ocsvp.com/login"
    : "http://localhost:5175/login";

  return (
    <div className="landing-page-v3">
      <AmbientBlurCrossBackground />

      <header
        className={`landing-header ${
          mounted ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"
        }`}
      >
        <a href="/" className="landing-logo-link" aria-label="OCS Médecins home">
          <img src="/ocs-medecins-logo.png" alt="OCS Médecins" />
        </a>
        <ProfessionalPortals
          staffUrl={staffPortalUrl}
          insuranceUrl={insurancePortalUrl}
        />
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <FadeInSection>
              <span className="landing-eyebrow">
                <span aria-hidden="true" /> OCS Médecins · Virtual Practice
              </span>
            </FadeInSection>

            <FadeInSection delay={100}>
              <h1 id="landing-title">
                Step into a
                <span>world of Care</span>
              </h1>
            </FadeInSection>

            <FadeInSection delay={180}>
              <p className="landing-community-line">
                We are more than a healthcare service — we are a community of care.
              </p>
            </FadeInSection>

            <FadeInSection delay={260}>
              <div className="landing-actions">
                <Link to="/register" className="landing-primary-cta">
                  Get care
                  <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
                </Link>
                <Link to="/login" className="landing-secondary-cta">
                  Patient login
                </Link>
              </div>
              <p className="landing-action-note">
                New to OCS? <Link to="/register">Create your patient account</Link>
              </p>
            </FadeInSection>
          </div>

          <FadeInSection delay={160} className="landing-visual-column">
            <CareNetworkVisual />
          </FadeInSection>
        </section>

        <FadeInSection delay={120}>
          <section className="landing-trust-strip" aria-label="Why patients choose OCS Médecins">
            {TRUST_SIGNALS.map(({ icon: Icon, title, detail }) => (
              <div className="landing-trust-item" key={title}>
                <div className="landing-trust-icon">
                  <Icon size={20} strokeWidth={2} aria-hidden="true" />
                </div>
                <div>
                  <strong>{title}</strong>
                  <span>{detail}</span>
                </div>
              </div>
            ))}
          </section>
        </FadeInSection>

        <section className="landing-difference" aria-labelledby="landing-difference-title">
          <FadeInSection className="landing-difference-heading">
            <span className="landing-section-kicker">Care, thoughtfully connected</span>
            <h2 id="landing-difference-title">
              <span>Your Health.</span>
              <span>Experienced</span>
              <span>differently.</span>
            </h2>
          </FadeInSection>

          <FadeInSection delay={120} className="landing-difference-copy">
            <div className="landing-difference-icon" aria-hidden="true">
              <HeartPulse size={25} strokeWidth={1.9} />
            </div>
            <p>
              Every visit, every record, every moment of care — safely organised with
              the same heart we bring to your door.
            </p>
            <div className="landing-difference-points">
              <span><ShieldCheck size={17} aria-hidden="true" /> Private by design</span>
              <span><Check size={17} aria-hidden="true" /> One continuous journey</span>
            </div>
          </FadeInSection>
        </section>

        <section className="landing-excellence" aria-labelledby="landing-excellence-title">
          <FadeInSection className="landing-excellence-heading">
            <span className="landing-section-kicker">The OCS standard</span>
            <h2 id="landing-excellence-title">
              <span>Step into a</span>
              <span>Practice of</span>
              <span>Excellence</span>
            </h2>
            <p>Together, let&apos;s make a difference in healthcare</p>
          </FadeInSection>

          <div className="landing-step-grid">
            {CARE_STEPS.map(({ number, icon: Icon, title, detail }, index) => (
              <FadeInSection key={number} delay={index * 90}>
                <article className="landing-step-card">
                  <div className="landing-step-card-top">
                    <span>{number}</span>
                    <Icon size={22} strokeWidth={2} aria-hidden="true" />
                  </div>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </article>
              </FadeInSection>
            ))}
          </div>

          <FadeInSection className="landing-ready-card">
            <div>
              <span>One Commitment · One Promise</span>
              <h2>Bringing healthcare to every Mauritian doorstep</h2>
            </div>
            <Link to="/register">
              Create my account
              <ArrowRight size={18} strokeWidth={2.3} aria-hidden="true" />
            </Link>
          </FadeInSection>
        </section>
      </main>

      <footer className="landing-footer">
        <div>
          <img src="/ocs-medecins-logo.png" alt="OCS Médecins" />
          <p>Care that feels closer.</p>
        </div>
        <p>© {new Date().getFullYear()} OCS Médecins. All rights reserved.</p>
        <span>
          <Clock size={14} strokeWidth={2} aria-hidden="true" /> Patient portal available online
        </span>
      </footer>
    </div>
  );
}

export default LandingPage;
