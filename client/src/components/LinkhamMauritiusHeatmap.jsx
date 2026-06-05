export default function LinkhamMauritiusHeatmap({ clusters = [], predictiveInsight = null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4">
        <svg viewBox="0 0 100 80" className="mx-auto h-64 w-full max-w-xl">
          <path
            d="M18 24 C28 12, 48 8, 62 14 C78 20, 88 34, 84 50 C80 66, 58 74, 40 72 C24 70, 12 58, 14 40 C15 32, 16 28, 18 24 Z"
            fill="#eef2f2"
            stroke="#d1d5db"
            strokeWidth="0.8"
          />
          <path
            d="M24 30 C34 22, 52 20, 66 26 C74 34, 72 48, 62 58 C50 66, 34 64, 26 52 C20 42, 20 36, 24 30 Z"
            fill="#f8fafb"
            stroke="#e5e7eb"
            strokeWidth="0.6"
          />

          {clusters.map((cluster) => {
            const radius = 2.4 + cluster.intensity * 4.8;
            return (
              <g key={cluster.id}>
                <circle
                  cx={cluster.x}
                  cy={cluster.y}
                  r={radius + 1.8}
                  fill="#557373"
                  opacity={0.12 + cluster.intensity * 0.2}
                  className="animate-pulse"
                />
                <circle
                  cx={cluster.x}
                  cy={cluster.y}
                  r={radius}
                  fill="#557373"
                  opacity={0.35 + cluster.intensity * 0.45}
                />
                <text
                  x={cluster.x}
                  y={cluster.y - radius - 1.5}
                  textAnchor="middle"
                  fontSize="2.6"
                  fill="#374151"
                  fontWeight="700"
                >
                  {cluster.name}
                </text>
                <text
                  x={cluster.x}
                  y={cluster.y + 1}
                  textAnchor="middle"
                  fontSize="2.4"
                  fill="#ffffff"
                  fontWeight="800"
                >
                  {cluster.recent_count}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {predictiveInsight ? (
        <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-4">
          <span className="block text-xs font-bold text-teal-900">Predictive Data Insight</span>
          <p className="mt-1 text-[11px] font-medium text-teal-800">{predictiveInsight.message}</p>
        </div>
      ) : null}
    </div>
  );
}
