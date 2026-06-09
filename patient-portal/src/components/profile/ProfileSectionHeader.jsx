/** Section label above a profile card, with optional muted subtitle. */
function ProfileSectionHeader({ title, subtitle }) {
  return (
    <div className="profile-section-header">
      <h2 className="profile-section-title">{title}</h2>
      {subtitle ? <span className="profile-section-subtitle">{subtitle}</span> : null}
    </div>
  );
}

export default ProfileSectionHeader;
