function EmptyState({ title, description, action, compact = false }) {
  return (
    <div
      className={`rounded-[28px] border border-dashed border-[rgba(65,200,198,0.24)] bg-[rgba(255,255,255,0.76)] text-center ${
        compact ? "px-5 py-6" : "px-6 py-10"
      }`}
    >
      <h4 className="text-lg font-semibold text-slate-900">{title}</h4>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#496874]">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
