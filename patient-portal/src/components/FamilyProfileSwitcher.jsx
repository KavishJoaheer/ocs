import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown } from "lucide-react";
import { useFamilyProfile } from "../hooks/useFamilyProfile.jsx";
import { AVATAR_STYLES, FAMILY_PROFILES } from "../lib/familyProfiles.js";

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

function FamilyProfileSwitcher({ variant = "default" }) {
  const { activeProfile, activeProfileId, setActiveProfile } = useFamilyProfile();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

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
  }, [open]);

  function handleSelect(profileId) {
    setActiveProfile(profileId);
    setOpen(false);
  }

  const isAvatar = variant === "avatar";

  return (
    <div
      ref={rootRef}
      className={isAvatar ? "relative shrink-0" : "relative min-w-0 flex-1"}
    >
      {isAvatar ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Switch family profile"
          className="rounded-full transition active:scale-95"
        >
          <ProfileAvatar profile={activeProfile} size="header" />
        </button>
      ) : (
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
      )}

      {open ? (
        <div
          role="listbox"
          aria-label="Family profiles"
          className={`profile-dropdown absolute top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-[rgba(26,160,140,0.15)] bg-[rgba(255,255,255,0.92)] shadow-[0_8px_32px_rgba(26,160,140,0.12)] backdrop-blur-[12px] ${
            isAvatar ? "right-0 w-64" : "left-0 right-0"
          }`}
        >
          {FAMILY_PROFILES.map((profile, index) => {
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
