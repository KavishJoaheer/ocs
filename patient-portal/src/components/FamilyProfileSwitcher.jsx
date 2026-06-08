import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Plus } from "lucide-react";
import { useFamilyProfile } from "../hooks/useFamilyProfile.jsx";
import { AVATAR_STYLES } from "../lib/familyProfiles.js";

function ProfileAvatar({ profile, size = "md" }) {
  const sizeClass =
    size === "header"
      ? "size-8 text-xs"
      : size === "sm"
        ? "size-9 text-sm"
        : "size-12 text-base";

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-medium shadow-lg shadow-[rgba(45,143,152,0.12)] ${sizeClass} ${AVATAR_STYLES[profile.avatarVariant]}`}
    >
      {profile.initials}
    </div>
  );
}

/* Native bottom sheet used on mobile when the header avatar is tapped. */
function ProfileBottomSheet({ open, onClose, activeProfileId, onSelect, profiles }) {
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Switch family profile">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="animate-sheet-overlay absolute inset-0 bg-[rgba(13,42,46,0.5)]"
      />

      <div className="animate-sheet-up absolute inset-x-0 bottom-0 rounded-t-[24px] bg-white pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-8px_40px_rgba(13,42,46,0.18)]">
        {/* Drag handle */}
        <div className="flex justify-center pt-3">
          <span className="h-[5px] w-[40px] rounded-full bg-[rgba(13,42,46,0.18)]" aria-hidden="true" />
        </div>

        <p className="px-5 pt-3 text-center text-[13px] font-semibold uppercase tracking-[1.5px] text-[#6e949b]">
          Switch Profile
        </p>

        <div className="mt-2 px-3 pb-2">
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

        <div className="mx-5 border-t border-[rgba(26,160,140,0.1)]" />

        <Link
          to="/profile/add-dependent"
          onClick={onClose}
          className="mx-3 flex min-h-[56px] items-center gap-4 rounded-2xl px-3 text-[#2d8f98] transition active:bg-[rgba(26,160,140,0.08)]"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full border border-dashed border-[rgba(45,143,152,0.4)]">
            <Plus className="size-5" strokeWidth={2} />
          </span>
          <span className="text-[16px] font-medium">Add Family Member</span>
        </Link>
      </div>
    </div>
  );
}

function FamilyProfileSwitcher({ variant = "default" }) {
  const { activeProfile, activeProfileId, setActiveProfile, profiles } = useFamilyProfile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const isAvatar = variant === "avatar";

  useEffect(() => {
    if (!open || isAvatar) return undefined;

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
  }, [open, isAvatar]);

  function handleSelect(profileId) {
    setActiveProfile(profileId);
    setOpen(false);
  }

  // ─── Mobile: avatar trigger + native bottom sheet ───
  if (isAvatar) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Switch family profile"
          className="flex size-11 items-center justify-center rounded-full transition active:scale-95"
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

  // ─── Desktop: inline dropdown ───
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

          <div className="mx-4 border-t border-[rgba(26,160,140,0.08)]" />
          <Link
            to="/profile/add-dependent"
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-[13px] font-normal text-[#5f9aa0] transition hover:text-[#2d8f98]"
          >
            + Add Family Member
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export default FamilyProfileSwitcher;
