/** Unified white card with optional header action (Edit / Add). */
function ProfileListCard({ title, subtitle, action, children, variant = "default", bodyClassName = "" }) {
  return (
    <section
      className={[
        "profile-list-card profile-crafted-card",
        variant === "teal" ? "profile-list-card-tinted" : "bg-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="profile-section-title">{title}</h2>
          {subtitle ? <p className="profile-card-subtitle mt-1">{subtitle}</p> : null}
        </div>
        {action ? <div className="ml-auto shrink-0 text-right">{action}</div> : null}
      </div>
      <div className={["pb-1", subtitle || action ? "mt-3" : "mt-0", bodyClassName].join(" ")}>
        {children}
      </div>
    </section>
  );
}

export default ProfileListCard;
