/** Small Edit / Add button for card headers. */
function ProfileCardAction({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[13px] font-semibold text-[#e8a020] transition hover:text-[#c88710] active:opacity-70"
    >
      {label}
    </button>
  );
}

export default ProfileCardAction;
