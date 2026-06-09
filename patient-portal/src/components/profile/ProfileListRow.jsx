/** Single row inside a native-style list card. */
function ProfileListRow({ icon: Icon, label, value, isLast = false, children }) {
  return (
    <>
      <div className="flex items-center gap-3 px-5 py-3.5">
        <Icon className="size-[18px] shrink-0 text-[#8a9e9a]" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8a9e9a]">
            {label}
          </p>
          {children ?? (
            <p className="mt-0.5 text-[15px] font-medium leading-snug text-[#1a5c52]">
              {value || "—"}
            </p>
          )}
        </div>
      </div>
      {!isLast ? <div className="profile-list-divider" aria-hidden="true" /> : null}
    </>
  );
}

export default ProfileListRow;
