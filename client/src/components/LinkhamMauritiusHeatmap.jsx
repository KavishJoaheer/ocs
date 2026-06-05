const DEFAULT_INSIGHT =
  "Regional visit density is stable across monitored districts. No acute localized surges detected in the last 14 days.";

function Hotspot({ cluster, size = "md", tone = "primary" }) {
  const sizeClass = size === "lg" ? "h-3 w-3" : "h-2 w-2";
  const pingClass =
    tone === "primary"
      ? "bg-[#557373] opacity-75"
      : "bg-teal-400 opacity-60";
  const dotClass =
    tone === "primary"
      ? "bg-[#557373] shadow-md"
      : "bg-teal-500";

  return (
    <div
      className={`absolute flex ${sizeClass}`}
      style={{
        top: `${cluster.y}%`,
        left: `${cluster.x}%`,
        transform: "translate(-50%, -50%)",
      }}
      title={`${cluster.name}: ${cluster.recent_count} recent visits`}
    >
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${pingClass}`} />
      <span className={`relative inline-flex rounded-full ${sizeClass} ${dotClass}`} />
    </div>
  );
}

export default function LinkhamMauritiusHeatmap({ clusters = [], predictiveInsight = null }) {
  const activeClusters = clusters.length
    ? clusters
    : [
        { id: "flacq", name: "Flacq", x: 72, y: 48, recent_count: 0, intensity: 1 },
        { id: "port-louis", name: "Port Louis", x: 42, y: 38, recent_count: 0, intensity: 0.6 },
      ];

  const [primaryCluster, secondaryCluster] = activeClusters;

  return (
    <div className="flex h-full flex-col">
      <div className="relative mt-2 flex min-h-[220px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-gray-50/40">
        <svg
          className="h-40 w-auto fill-none stroke-2 stroke-[#557373] opacity-20"
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          <path d="M18 24 C28 12, 48 8, 62 14 C78 20, 88 34, 84 50 C80 66, 58 74, 40 72 C24 70, 12 58, 14 40 C15 32, 16 28, 18 24 Z" />
          <path d="M24 30 C34 22, 52 20, 66 26 C74 34, 72 48, 62 58 C50 66, 34 64, 26 52 C20 42, 20 36, 24 30 Z" />
        </svg>

        {primaryCluster ? (
          <Hotspot
            cluster={primaryCluster}
            size={primaryCluster.intensity >= 0.5 ? "lg" : "md"}
            tone="primary"
          />
        ) : null}
        {secondaryCluster ? (
          <Hotspot
            cluster={secondaryCluster}
            size="md"
            tone={secondaryCluster.intensity >= 0.5 ? "primary" : "secondary"}
          />
        ) : null}
        {activeClusters.slice(2).map((cluster) => (
          <Hotspot
            key={cluster.id}
            cluster={cluster}
            size="md"
            tone={cluster.intensity >= 0.75 ? "primary" : "secondary"}
          />
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-teal-100/70 bg-teal-50/40 p-3.5 text-xs font-medium text-teal-900">
        <span className="mb-0.5 flex items-center gap-1.5 font-extrabold text-teal-950">
          <svg
            className="size-3.5 fill-none stroke-2 stroke-teal-800"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
          Predictive Data Insight
        </span>
        {predictiveInsight?.message || DEFAULT_INSIGHT}
      </div>
    </div>
  );
}
