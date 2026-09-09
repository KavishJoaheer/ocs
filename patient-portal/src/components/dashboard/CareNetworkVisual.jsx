import { useEffect, useRef, useState } from "react";

const CARE_NETWORK_C_NODES = [
  [51, 8],
  [22, 17],
  [6, 45],
  [12, 76],
  [39, 93],
  [68, 84],
  [83, 60],
];

const CARE_NETWORK_X_NODES = [
  [66.5, 7.5],
  [90.5, 7.5],
  [67.5, 31.5],
  [91.5, 31.5],
];

export function CareNetworkMap({ className = "" }) {
  const ref = useRef(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setActive(Boolean(entry?.isIntersecting)),
      { threshold: 0.15 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`patient-network-art ${className} ${active ? "" : "care-network-paused"}`}
      role="img"
      aria-label="OCS care network across Mauritius"
    >
      <div className="patient-network-scene">
        <img
          alt=""
          className="patient-network-island"
          decoding="async"
          src="/ocs-mauritius-cinematic-v1.webp"
        />
        <div className="patient-network-mark">
          <span className="patient-network-mark-texture patient-network-mark-texture--c" />
          <svg className="patient-network-routes patient-network-routes--c" viewBox="0 0 100 100" aria-hidden="true">
            <path
              className="patient-network-route patient-network-route--c"
              d="M 51 8 C 24 8, 6 25, 6 51 C 6 78, 25 94, 48 93 C 68 92, 80 79, 83 60"
            />
          </svg>
          {CARE_NETWORK_C_NODES.map(([left, top], index) => (
            <span
              className="patient-network-node patient-network-node--c"
              key={`c-node-${left}-${top}`}
              style={{ "--node-delay": `${0.64 + index * 0.08}s`, left: `${left}%`, top: `${top}%` }}
            />
          ))}
          <div className="patient-network-x">
            <span className="patient-network-mark-texture patient-network-mark-texture--x" />
            <svg className="patient-network-routes patient-network-routes--x" viewBox="0 0 100 100" aria-hidden="true">
              <path className="patient-network-route patient-network-route--x" d="M 66.5 7.5 L 91.5 31.5" />
              <path className="patient-network-route patient-network-route--x" d="M 90.5 7.5 L 67.5 31.5" />
            </svg>
            {CARE_NETWORK_X_NODES.map(([left, top], index) => (
              <span
                className="patient-network-node patient-network-node--x"
                key={`x-node-${left}-${top}`}
                style={{ "--node-delay": `${1.48 + index * 0.07}s`, left: `${left}%`, top: `${top}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CareNetworkVisual() {
  return (
    <figure className="care-network-visual">
      <CareNetworkMap className="care-network-desktop-map" />
      <figcaption className="care-network-caption">
        Connecting homes<br />through care
      </figcaption>
    </figure>
  );
}
