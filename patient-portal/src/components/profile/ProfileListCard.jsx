/** Unified white card with optional header action (Edit / Add). */
function ProfileListCard({
  title,
  subtitle,
  subtitleLayout = "inline",
  action,
  children,
  variant = "default",
  bodyClassName = "",
}) {
  const stackedSubtitle = subtitle && subtitleLayout === "stacked";

  const isEmergency = variant === "emergency";
  const isTeal = variant === "teal";

  return (
    <section
      className={[
        "profile-list-card",
        isEmergency
          ? "bg-gradient-to-br from-teal-500 to-teal-800 shadow-lg lg:bg-ocs-slate lg:from-ocs-slate lg:to-ocs-slate"
          : ["profile-crafted-card", isTeal ? "profile-list-card-tinted" : "bg-white"].join(" "),
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2
            className={[
              "profile-section-title tracking-wider",
              isEmergency ? "text-white/80" : "",
            ].join(" ")}
          >
            {title}
          </h2>
          {stackedSubtitle ? (
            <p className="profile-card-subtitle-stacked mt-1.5">{subtitle}</p>
          ) : null}
          {subtitle && !stackedSubtitle ? (
            <p className="profile-card-subtitle mt-1">{subtitle}</p>
          ) : null}
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
