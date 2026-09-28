import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { folderTone } from "../../lib/folderTones.js";

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
  const rootRef = useRef(null);
  const selected = folders.find((folder) => String(folder.id) === String(value)) || null;
  const tone = selected ? folderTone(selected.name) : null;
  const label = selected
    ? `${selected.name} (${counts?.get(String(selected.id)) || 0})`
    : `All (${totalCount})`;

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(nextValue, folder) {
    onChange(nextValue, folder || null);
    setOpen(false);
  }

  const buttonClass = variant === "field"
    ? "flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-left text-sm font-semibold"
    : "flex max-w-52 items-center gap-1 bg-transparent text-left text-xs font-semibold outline-none";

  return (
    <div ref={rootRef} className={variant === "field" ? "relative min-w-0 flex-1" : "relative min-w-0"}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={buttonClass}
        style={{ color: tone?.hex || "#334155" }}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute left-0 z-40 mt-1 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg ${variant === "field" ? "w-full min-w-56" : "w-64"}`}
        >
          <button
            type="button"
            role="option"
            aria-selected={!selected}
            onClick={() => choose("all")}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {!selected ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
            <span>All ({totalCount})</span>
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
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-slate-50"
                style={{ color: rowTone.hex, backgroundColor: active ? rowTone.washHex : undefined }}
              >
                {active ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                <span className="shrink-0 tabular-nums text-slate-400">({counts?.get(String(folder.id)) || 0})</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
