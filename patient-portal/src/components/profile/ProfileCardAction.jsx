/** Small Edit / Add button for card headers. */
function ProfileCardAction({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="profile-card-action -mr-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 text-[13px] font-semibold text-[#0D9E8A] transition hover:bg-[rgba(13,158,138,0.08)] hover:text-[#0a7d6d] active:opacity-70 lg:text-brand-teal lg:hover:bg-brand-teal/10 lg:hover:text-brand-teal"
    >
      {label}
    </button>
  );
}

export default ProfileCardAction;
