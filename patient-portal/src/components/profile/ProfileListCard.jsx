/** Unified white card with optional header action (Edit / Add). */
function ProfileListCard({ title, action, children, variant = "default" }) {
  return (
    <section
      className={[
        "profile-list-card profile-card-elevate",
        variant === "teal" ? "profile-list-card-tinted" : "bg-white",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <h2 className="profile-section-title">{title}</h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-3 pb-1">{children}</div>
    </section>
  );
}

export default ProfileListCard;
