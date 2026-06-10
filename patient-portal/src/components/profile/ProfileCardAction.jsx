/** Small Edit / Add button for card headers. */
function ProfileCardAction({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="profile-card-action -mr-2 rounded-md px-2 py-1 text-[13px] font-semibold text-[#e8a020] transition hover:bg-[rgba(232,160,32,0.08)] hover:text-[#c88710] active:opacity-70"
    >
      {label}
    </button>
  );
}

export default ProfileCardAction;
