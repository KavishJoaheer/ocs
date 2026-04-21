function LoadingState({ label = "Loading" }) {
  return (
    <div className="flex min-h-60 flex-col items-center justify-center gap-4 text-center">
      <div className="size-10 animate-spin rounded-full border-4 border-sky-100 border-t-[#2d8f98]" />
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="mt-1 text-sm text-[#496874]">
          Preparing the latest OCS Medecins records.
        </p>
      </div>
    </div>
  );
}

export default LoadingState;
