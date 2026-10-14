import "./liveRequestAttention.css";

export default function OperatorLiveHeading({ count = null, title = "Live requests", countLabel, active = Number(count) > 0 }) {
  return (
    <div data-active={active} className="live-care-heading inline-flex max-w-full items-center gap-2.5 rounded-full bg-[#124f58] px-4 py-2.5 text-white">
      <span className="live-care-dot size-2.5 shrink-0 rounded-full bg-[#20c9c0]" aria-hidden="true" />
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {count != null ? (
        <span aria-label={countLabel || `${count} active requests`} aria-live="polite" aria-atomic="true" className="live-care-count min-w-7 shrink-0 rounded-full bg-[#20c9c0] px-2 py-0.5 text-center text-sm font-semibold tabular-nums text-[#123d46]">{count}</span>
      ) : null}
    </div>
  );
}
