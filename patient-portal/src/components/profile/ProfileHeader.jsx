import { formatDisplayName } from "../../lib/formatDisplayName.js";

function formatOcsId(number) {
  if (!number) return null;
  const raw = String(number).trim();
  if (raw.startsWith("#")) return raw;
  if (/^ocs[- ]?/i.test(raw)) return `#${raw.replace(/^#/, "")}`;
  return `#OCS-${raw}`;
}

/** Avatar, name, and ID — sits inside the centered profile hub below the teal band. */
function ProfileHeader({ fullName, initials, ocsCareNumber }) {
  const idLabel = formatOcsId(ocsCareNumber);

  return (
    <header className="profile-identity-header">
      <div className="profile-concierge-avatar">{initials}</div>
      <h1 className="native-display mt-4 text-[24px] leading-tight text-[#1a5c52]">
        {formatDisplayName(fullName)}
      </h1>
      {idLabel ? <span className="profile-id-badge mt-3">{idLabel}</span> : null}
    </header>
  );
}

export default ProfileHeader;
