import { ArrowUpRight } from "lucide-react";
import { cx } from "../lib/utils.js";

const doctorThemeStyles = {
  "doctor-primary": {
    wrapper: "border-white/25 bg-white/10 group-hover:border-white/40",
    icon: "text-teal-200 group-hover:text-white",
  },
  "doctor-slate": {
    wrapper: "border-slate-200 bg-white group-hover:border-slate-300",
    icon: "text-slate-400 group-hover:text-slate-600",
  },
  "doctor-amber": {
    wrapper: "border-amber-200 bg-white group-hover:border-amber-300",
    icon: "text-amber-600 group-hover:text-amber-700",
  },
};

export default function MetricNavAnchor({ accent = "teal", theme }) {
  const isAmber = accent === "amber";
  const doctorTheme = theme ? doctorThemeStyles[theme] : null;

  return (
    <span
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full border transition-all duration-200 ease-in-out",
        doctorTheme?.wrapper ||
          cx(
            "border-gray-200 bg-white",
            isAmber ? "group-hover:border-amber-200" : "group-hover:border-[#2d8f98]/30",
          ),
      )}
    >
      <ArrowUpRight
        className={cx(
          "size-4 transition-all duration-200 ease-in-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5",
          doctorTheme?.icon ||
            cx(
              "text-gray-400",
              isAmber ? "group-hover:text-amber-600" : "group-hover:text-teal-600",
            ),
        )}
        strokeWidth={2.25}
      />
    </span>
  );
}
