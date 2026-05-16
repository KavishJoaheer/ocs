import { ArrowUpRight } from "lucide-react";
import { cx } from "../lib/utils.js";

export default function MetricNavAnchor({ accent = "teal" }) {
  const isAmber = accent === "amber";

  return (
    <span
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white transition",
        isAmber ? "group-hover:border-amber-200" : "group-hover:border-[#2d8f98]/30",
      )}
    >
      <ArrowUpRight
        className={cx(
          "size-4 text-gray-400 transition-colors",
          isAmber ? "group-hover:text-amber-600" : "group-hover:text-teal-600",
        )}
        strokeWidth={2.25}
      />
    </span>
  );
}
