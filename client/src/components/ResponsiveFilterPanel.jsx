import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useIsMobile } from "../hooks/useIsMobile.js";

export default function ResponsiveFilterPanel({ children, active = false, label = "Filters" }) {
  const mobile = useIsMobile();
  return <details className="workspace-filter-panel" open={!mobile ? true : undefined}>
    <summary><SlidersHorizontal size={16} aria-hidden="true" />{label}{active ? " · Applied" : ""}<ChevronDown size={14} aria-hidden="true" /></summary>
    <div>{children}</div>
  </details>;
}
