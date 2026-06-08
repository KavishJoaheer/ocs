import { ArrowUpRight } from "lucide-react";
import { cx } from "../lib/utils.js";

const doctorThemeStyles = {
  "doctor-primary": {
    wrapper: "border-white/25 bg-white/10 group-hover:border-white/40",
    icon: "text-teal-200 group-hover:text-white",
  },
  "doctor-olive": {
    wrapper: "border-[#e6ebd9] bg-white/80 group-hover:border-[#d0d9c4]",
    icon: "text-[#8fa382] group-hover:text-[#6f8264]",
  },
  "doctor-terracotta": {
    wrapper: "border-[#f5e3d7] bg-white/80 group-hover:border-[#e8cfc0]",
    icon: "text-[#ba5a32] group-hover:text-[#9c4628]",
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
