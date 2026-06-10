import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useFamilyProfile } from "../hooks/useFamilyProfile.jsx";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useScrollLock } from "../hooks/useScrollLock.js";
import { AVATAR_STYLES } from "../lib/familyProfiles.js";

function ProfileAvatar({ profile, size = "md" }) {
  const sizeClass =
    size === "header"
      ? "size-[34px] bg-[#1a5c52] text-[13px] font-semibold text-white shadow-none"
      : size === "sm"
        ? "size-9 text-sm"
        : "size-12 text-base";

  const colorClass = size === "header" ? "" : AVATAR_STYLES[profile.avatarVariant];

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-medium shadow-lg shadow-[rgba(45,143,152,0.12)] ${sizeClass} ${colorClass}`}
    >
      {profile.initials}
    </div>
  );
}

function ProfileBottomSheet({ open, onClose, activeProfileId, onSelect, profiles }) {
  const sheetRef = useRef(null);
  useScrollLock(open);
  useFocusTrap(open, sheetRef);

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={sheetRef}
      className="fixed inset-0 z-[var(--z-sheet)] lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Switch family profile"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="animate-sheet-overlay absolute inset-0 bg-[rgba(13,42,46,0.5)]"
      />

      <div className="animate-sheet-up absolute inset-x-0 bottom-0 flex max-h-[min(85dvh,100dvh-env(safe-area-inset-bottom,0px))] flex-col rounded-t-[24px] bg-white pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-8px_40px_rgba(13,42,46,0.18)]">
        <div className="flex justify-center pt-3">
          <span className="h-[5px] w-[40px] rounded-full bg-[rgba(13,42,46,0.18)]" aria-hidden="true" />
        </div>

        <p className="px-5 pt-3 text-center text-[13px] font-semibold uppercase tracking-[1.5px] text-[#6e949b]">
          Switch Profile
        </p>

        <div className="mt-2 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
          {profiles.map((profile) => {
            const isActive = profile.id === activeProfileId;
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => onSelect(profile.id)}
                className={`flex min-h-[64px] w-full items-center gap-4 rounded-2xl px-3 text-left transition active:bg-[rgba(26,160,140,0.08)] ${
                  isActive ? "bg-[rgba(26,160,140,0.06)]" : ""
                }`}
              >
                <ProfileAvatar profile={profile} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold text-[#1a5c52]">{profile.name}</p>
                  <p className="truncate text-[13px] font-light text-[#6e949b]">
                    {profile.relationship}
                  </p>
                </div>
                {isActive ? (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#2d8f98]">
                    <Check className="size-4 text-white" strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FamilyProfileSwitcher({ variant = "default" }) {
  const { activeProfile, activeProfileId, setActiveProfile, profiles } = useFamilyProfile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const isAvatar = variant === "avatar";
  const canSwitch = profiles.length > 1;

  useEffect(() => {
    if (!open || isAvatar || !canSwitch) return undefined;

    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, isAvatar, canSwitch]);

  function handleSelect(profileId) {
    setActiveProfile(profileId);
    setOpen(false);
  }

  if (!canSwitch) {
    if (isAvatar) {
      return (
        <div className="flex size-[34px] items-center justify-center" aria-hidden="true">
          <ProfileAvatar profile={activeProfile} size="header" />
        </div>
      );
    }

    return (
      <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 py-1">
        <ProfileAvatar profile={activeProfile} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-light text-[#6e949b]">{activeProfile.relationship}</p>
        </div>
      </div>
    );
  }

  if (isAvatar) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Switch family profile"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition active:scale-95"
        >
          <ProfileAvatar profile={activeProfile} size="header" />
        </button>
        <ProfileBottomSheet
          open={open}
          onClose={() => setOpen(false)}
          activeProfileId={activeProfileId}
          onSelect={handleSelect}
          profiles={profiles}
        />
      </>
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center gap-3 rounded-2xl px-1 py-1 text-left transition hover:bg-white/50"
      >
        <ProfileAvatar profile={activeProfile} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-light text-[#6e949b]">{activeProfile.relationship}</p>
        </div>
        <ChevronDown
          className={`size-4 shrink-0 text-[#6e949b] transition-transform duration-200 ease-out ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Family profiles"
          className="profile-dropdown absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-[rgba(26,160,140,0.15)] bg-[rgba(255,255,255,0.92)] shadow-[0_8px_32px_rgba(26,160,140,0.12)] backdrop-blur-[12px]"
        >
          {profiles.map((profile, index) => {
            const isActive = profile.id === activeProfileId;
            return (
              <div key={profile.id}>
                {index > 0 ? (
                  <div className="mx-4 border-t border-[rgba(26,160,140,0.08)]" />
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => handleSelect(profile.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[rgba(26,160,140,0.06)]"
                >
                  <ProfileAvatar profile={profile} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#1a5c52]">{profile.name}</p>
                    <p className="truncate text-xs font-light text-[#6e949b]">
                      {profile.relationship}
                    </p>
                  </div>
                  {isActive ? <Check className="size-4 shrink-0 text-[#2d8f98]" strokeWidth={2.5} /> : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default FamilyProfileSwitcher;
