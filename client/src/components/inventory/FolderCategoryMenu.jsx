import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { folderTone } from "../../lib/folderTones.js";

function menuPosition(anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.max(256, rect.width);
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
  const top = rect.bottom + 6;
  const maxHeight = Math.max(160, Math.min(320, window.innerHeight - top - 12));
  return { top, left, width, maxHeight };
}

export default function FolderCategoryMenu({
  value = "all",
  folders = [],
  counts,
  totalCount = 0,
  onChange,
  variant = "compact",
  ariaLabel = "Stock category",
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  const selected = folders.find((folder) => String(folder.id) === String(value)) || null;
  const tone = selected ? folderTone(selected.name) : null;
  const selectedCount = selected ? counts?.get(String(selected.id)) || 0 : totalCount;
  const label = selected?.name || "All";

  useEffect(() => {
    if (!open) return undefined;
    function place() {
      if (!buttonRef.current) return;
      setPosition(menuPosition(buttonRef.current));
    }
    function onPointer(event) {
      const target = event.target;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    place();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function choose(nextValue, folder) {
    onChange(nextValue, folder || null);
    setOpen(false);
  }

  const buttonClass = variant === "field"
    ? "flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-left text-sm font-semibold text-slate-700 transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#17666a]/30"
    : "flex max-w-52 items-center gap-1.5 rounded-lg bg-transparent px-1.5 py-1 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#17666a]/30";

  const panel = open && position && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={panelRef}
        role="listbox"
        aria-label={ariaLabel}
        className="category-menu-scrollbar fixed z-[100] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.14)]"
        style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
      >
        <button
          type="button"
          role="option"
          aria-selected={!selected}
          onClick={() => choose("all")}
          className={`flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
            !selected ? "bg-teal-50 text-[#174f53]" : "text-slate-700 hover:bg-slate-50"
          }`}
        >
          {!selected ? <Check className="size-4 shrink-0 text-[#17666a]" /> : <span className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1">All categories</span>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{totalCount}</span>
        </button>
        {folders.map((folder) => {
          const rowTone = folderTone(folder.name);
          const active = String(folder.id) === String(value);
          return (
            <button
              key={folder.id}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => choose(String(folder.id), folder)}
              className={`flex min-h-10 w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${
                active ? "bg-teal-50 text-[#174f53]" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              {active ? <Check className="size-4 shrink-0 text-[#17666a]" /> : <span className="size-4 shrink-0" />}
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: rowTone.hex }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600">
                {counts?.get(String(folder.id)) || 0}
              </span>
            </button>
          );
        })}
      </div>,
      document.body,
    )
    : null;

  return (
    <div ref={rootRef} className={variant === "field" ? "relative min-w-0 flex-1" : "relative min-w-0"}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={buttonClass}
      >
        <span className="flex min-w-0 items-center gap-2">
          {tone ? (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: tone.hex }}
              aria-hidden="true"
            />
          ) : null}
          <span className="truncate">{label}</span>
          <span className="shrink-0 text-slate-500 tabular-nums">({selectedCount})</span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
      </button>
      {panel}
    </div>
  );
}
