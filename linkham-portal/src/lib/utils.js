export function cx(...values) {
  return values.filter(Boolean).join(" ");
}

/** Width-safe page root — pair with AppShell horizontal padding (do not add extra px-* on pages). */
export const pageContainerClass = "ocs-page w-full min-w-0 max-w-full";

/** Inputs/selects that must stay inside the viewport on narrow screens. */
export const formControlClass = "ocs-form-control";
