/** Single row inside a native-style list card. */
function ProfileListRow({
  icon: Icon,
  label,
  value,
  isLast = false,
  children,
  valueClassName = "",
  emptyLabel = "—",
  emptyValueClassName = "",
  tone = "default",
}) {
  const isEmpty = value == null || String(value).trim() === "";
  const onDark = tone === "onDark";

  return (
    <>
      <div className="flex items-center gap-3 px-5 py-3.5">
        <Icon
          className={[
            "size-[18px] shrink-0",
            onDark ? "text-white/80" : "profile-row-icon",
          ].join(" ")}
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p
            className={[
              "text-[11px] font-medium uppercase tracking-[0.08em]",
              onDark ? "text-white/80" : "text-[#8a9e9a]",
            ].join(" ")}
          >
            {label}
          </p>
          {children ?? (
            <p
              className={[
                "mt-0.5 text-[15px] leading-snug",
                isEmpty
                  ? [
                      onDark
                        ? "font-light italic text-white/60"
                        : "font-light italic text-[#9ab0ab]",
                      emptyValueClassName,
                    ].join(" ")
                  : [
                      onDark ? "font-semibold text-white" : "font-semibold text-[#1a5c52]",
                      valueClassName,
                    ].join(" "),
              ].join(" ")}
            >
              {isEmpty ? emptyLabel : value}
            </p>
          )}
        </div>
      </div>
      {!isLast ? (
        <div
          className={
            onDark
              ? "mx-5 h-px bg-white/20"
              : "profile-list-divider"
          }
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}

export default ProfileListRow;
