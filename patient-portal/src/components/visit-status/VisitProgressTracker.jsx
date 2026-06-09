import { Check, Stethoscope, Car, Home } from "lucide-react";

const TRACKER_STEPS = [
  { key: "requested", label: "Requested", icon: Check },
  { key: "assigned", label: "Assigned", icon: Stethoscope },
  { key: "en_route", label: "On the Way", icon: Car },
  { key: "arrived", label: "Arrived", icon: Home },
];

/** Map backend visit status onto the 4-step hero tracker index. */
export function visitStatusToStepIndex(status) {
  if (status === "assigned") return 1;
  if (status === "en_route") return 2;
  if (status === "arrived" || status === "in_consultation") return 3;
  return 0;
}

function StepNode({ step, state }) {
  const Icon = step.icon;
  const isActive = state === "active";
  const isComplete = state === "complete";

  return (
    <div className="visit-tracker-step flex flex-col items-center">
      <div className="visit-tracker-node-wrap flex h-14 w-full items-center justify-center">
        <div
          className={[
            "visit-tracker-node relative flex items-center justify-center rounded-full transition-all",
            isActive ? "visit-tracker-node-active" : "",
            isComplete ? "visit-tracker-node-complete" : "",
            state === "upcoming" ? "visit-tracker-node-upcoming" : "",
          ].join(" ")}
        >
        {isActive ? (
          <span className="visit-tracker-pulse absolute inset-0 rounded-full" aria-hidden="true" />
        ) : null}
        <Icon
          className={[
            "relative z-[1]",
            isActive ? "size-[22px]" : "size-[18px]",
            isComplete || isActive ? "text-white" : "text-[#b0bdb9]",
          ].join(" ")}
          strokeWidth={2.25}
        />
        </div>
      </div>
      <p
        className={[
          "visit-tracker-label mt-3 text-center",
          isActive ? "visit-tracker-label-active" : "",
          isComplete ? "visit-tracker-label-complete" : "",
          state === "upcoming" ? "visit-tracker-label-upcoming" : "",
        ].join(" ")}
      >
        {step.label}
      </p>
    </div>
  );
}

function VisitProgressTracker({ activeStepIndex = 0 }) {
  const steps = TRACKER_STEPS.map((step, index) => {
    let state = "upcoming";
    if (index < activeStepIndex) state = "complete";
    else if (index === activeStepIndex) state = "active";
    return { ...step, state };
  });

  const progressRatio = activeStepIndex / (TRACKER_STEPS.length - 1);

  return (
    <div className="visit-tracker" aria-label="Visit progress">
      <div className="visit-tracker-rail" aria-hidden="true">
        <div className="visit-tracker-rail-track" />
        <div className="visit-tracker-rail-fill" style={{ width: `${progressRatio * 100}%` }} />
      </div>

      <div className="visit-tracker-steps">
        {steps.map((step) => (
          <StepNode key={step.key} step={step} state={step.state} />
        ))}
      </div>
    </div>
  );
}

export default VisitProgressTracker;
