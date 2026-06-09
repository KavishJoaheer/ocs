import { formatDisplayName } from "../../lib/formatDisplayName.js";

function formatOcsId(number) {
  if (!number) return null;
  const raw = String(number).trim();
  if (raw.startsWith("#")) return raw;
  if (/^ocs[- ]?/i.test(raw)) return `#${raw.replace(/^#/, "")}`;
  return `#OCS-${raw}`;
}

function ProfileHeader({ fullName, initials, ocsCareNumber }) {
  const idLabel = formatOcsId(ocsCareNumber);

  return (
    <header className="flex flex-col items-center pb-2 pt-2 text-center">
      <div className="native-avatar-btn flex size-20 items-center justify-center rounded-full text-[22px] shadow-[var(--native-shadow-ambient)]">
        {initials}
      </div>
      <h1 className="native-display mt-4 text-[24px] leading-tight text-[#1a5c52]">
        {formatDisplayName(fullName)}
      </h1>
      {idLabel ? (
        <span className="profile-id-badge mt-3">{idLabel}</span>
      ) : null}
    </header>
  );
}

export default ProfileHeader;
