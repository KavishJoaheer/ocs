import dayjs from "dayjs";

const CHART_HEIGHT = 140;
const CHART_PADDING = { top: 16, right: 12, bottom: 28, left: 36 };

function buildScale(values, minFloor, maxCeil) {
  if (!values.length) {
    return { min: minFloor, max: maxCeil };
  }

  const min = Math.min(...values, minFloor);
  const max = Math.max(...values, maxCeil);
  const spread = max - min || 1;
  return {
    min: min - spread * 0.08,
    max: max + spread * 0.08,
  };
}

function toPoint(value, index, count, scale, innerWidth, innerHeight) {
  const x = CHART_PADDING.left + (index / Math.max(count - 1, 1)) * innerWidth;
  const ratio = (value - scale.min) / (scale.max - scale.min);
  const y = CHART_PADDING.top + innerHeight - ratio * innerHeight;
  return { x, y };
}

function formatDateLabel(date) {
  return dayjs(date).format("D MMMM YYYY");
}

function EmptyTrendState({ label }) {
  return (
    <div className="flex h-[140px] items-center justify-center rounded-xl border border-dashed border-[rgba(26,160,140,0.2)] bg-[rgba(65,200,198,0.04)] px-4 text-center">
      <p className="text-[13px] font-light text-[#6e949b]">
        {label}
      </p>
    </div>
  );
}

function LinePath({ points, color }) {
  if (points.length < 2) {
    return null;
  }

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <path
      d={path}
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function Dot({ point, color, label }) {
  return (
    <g>
      <circle cx={point.x} cy={point.y} r="4" fill={color} />
      <title>{label}</title>
    </g>
  );
}

export function BloodPressureTrendChart({ readings = [] }) {
  if (readings.length === 0) {
    return (
      <EmptyTrendState label="Blood pressure readings will appear here once your doctor records them." />
    );
  }

  const width = 320;
  const innerWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const scale = buildScale(
    readings.flatMap((item) => [item.systolic, item.diastolic]),
    90,
    160,
  );

  const systolicPoints = readings.map((item, index) =>
    toPoint(item.systolic, index, readings.length, scale, innerWidth, innerHeight),
  );
  const diastolicPoints = readings.map((item, index) =>
    toPoint(item.diastolic, index, readings.length, scale, innerWidth, innerHeight),
  );

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${CHART_HEIGHT}`} className="w-full max-w-full" role="img" aria-label="Blood pressure trend chart">
        {[0, 0.5, 1].map((ratio) => {
          const y = CHART_PADDING.top + innerHeight * (1 - ratio);
          const value = Math.round(scale.min + (scale.max - scale.min) * ratio);
          return (
            <g key={ratio}>
              <line
                x1={CHART_PADDING.left}
                x2={width - CHART_PADDING.right}
                y1={y}
                y2={y}
                stroke="rgba(26,160,140,0.12)"
              />
              <text x="4" y={y + 4} fill="#8a9ea3" fontSize="10">
                {value}
              </text>
            </g>
          );
        })}

        <LinePath points={systolicPoints} color="#2d8f98" />
        <LinePath points={diastolicPoints} color="var(--ocs-brand-gold)" />

        {readings.map((item, index) => (
          <g key={`${item.date}-${index}`}>
            <Dot
              point={systolicPoints[index]}
              color="#2d8f98"
              label={`${formatDateLabel(item.date)}: ${item.systolic}/${item.diastolic} mmHg`}
            />
            <Dot
              point={diastolicPoints[index]}
              color="var(--ocs-brand-gold)"
              label={`${formatDateLabel(item.date)}: ${item.systolic}/${item.diastolic} mmHg`}
            />
            <text
              x={systolicPoints[index].x}
              y={CHART_HEIGHT - 6}
              textAnchor="middle"
              fill="#8a9ea3"
              fontSize="10"
            >
              {formatDateLabel(item.date)}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-[#6e949b]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#2d8f98]" />
          Systolic
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand-gold" />
          Diastolic
        </span>
      </div>
    </div>
  );
}

export function SingleMetricTrendChart({
  readings = [],
  color = "#2d8f98",
  unit = "",
  emptyLabel,
  formatValue = (value) => value,
}) {
  if (readings.length === 0) {
    return <EmptyTrendState label={emptyLabel} />;
  }

  const width = 320;
  const innerWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const scale = buildScale(
    readings.map((item) => item.value),
    0,
    readings.some((item) => item.unit === "mg/dL") ? 200 : 12,
  );

  const points = readings.map((item, index) =>
    toPoint(item.value, index, readings.length, scale, innerWidth, innerHeight),
  );

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${CHART_HEIGHT}`} className="w-full max-w-full" role="img">
        {[0, 0.5, 1].map((ratio) => {
          const y = CHART_PADDING.top + innerHeight * (1 - ratio);
          const value = (scale.min + (scale.max - scale.min) * ratio).toFixed(1);
          return (
            <g key={ratio}>
              <line
                x1={CHART_PADDING.left}
                x2={width - CHART_PADDING.right}
                y1={y}
                y2={y}
                stroke="rgba(26,160,140,0.12)"
              />
              <text x="4" y={y + 4} fill="#8a9ea3" fontSize="10">
                {value}
              </text>
            </g>
          );
        })}

        <LinePath points={points} color={color} />

        {readings.map((item, index) => (
          <g key={`${item.date}-${index}`}>
            <Dot
              point={points[index]}
              color={color}
              label={`${formatDateLabel(item.date)}: ${formatValue(item.value)} ${item.unit || unit}`}
            />
            <text
              x={points[index].x}
              y={CHART_HEIGHT - 6}
              textAnchor="middle"
              fill="#8a9ea3"
              fontSize="10"
            >
              {formatDateLabel(item.date)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
