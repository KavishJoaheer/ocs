import { useState } from "react";
import { KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import { usePatientAuth } from "../../hooks/usePatientAuth.jsx";
import ProfileListCard from "./ProfileListCard.jsx";

function ProfilePasswordCard() {
  const { changePassword } = usePatientAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [changing, setChanging] = useState(false);

  function closeForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setChanging(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      await changePassword({ current_password: currentPassword, new_password: newPassword });
      closeForm();
      toast.success("Password updated. Other devices will need to sign in again.");
    } catch (error) {
      toast.error(error.message || "Could not update password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfileListCard
      title="Account security"
      action={!changing ? (
        <button type="button" onClick={() => setChanging(true)} className="inline-flex min-h-9 items-center rounded-full border border-[#2d8f98]/25 px-3 text-[12px] font-semibold text-[#2d8f98]">
          Change password
        </button>
      ) : null}
    >
      {!changing ? (
        <div className="flex items-center gap-3 px-5 pb-5 pt-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(26,160,140,0.08)] text-[#2d8f98]">
            <KeyRound className="size-5" />
          </span>
          <p className="text-[13px] leading-relaxed text-[#6e8587]">Your password protects access to your private OCS care information.</p>
        </div>
      ) : (
        <form className="space-y-3 px-5 py-4" onSubmit={handleSubmit}>
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          placeholder="Current password"
          className="w-full rounded-[10px] bg-[rgba(26,160,140,0.06)] px-3 py-2 text-[15px] font-medium text-[#1a5c52] outline-none focus:bg-white focus:shadow-[0_0_0_2px_rgba(65,200,198,0.3)]"
        />
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="New password"
          className="w-full rounded-[10px] bg-[rgba(26,160,140,0.06)] px-3 py-2 text-[15px] font-medium text-[#1a5c52] outline-none focus:bg-white focus:shadow-[0_0_0_2px_rgba(65,200,198,0.3)]"
        />
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Confirm new password"
          className="w-full rounded-[10px] bg-[rgba(26,160,140,0.06)] px-3 py-2 text-[15px] font-medium text-[#1a5c52] outline-none focus:bg-white focus:shadow-[0_0_0_2px_rgba(65,200,198,0.3)]"
        />
        <button
          type="submit"
          disabled={saving || !currentPassword || !newPassword || !confirmPassword}
          className="w-full rounded-xl bg-[#2d8f98] py-3 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Updating..." : "Update password"}
        </button>
        <button type="button" onClick={closeForm} disabled={saving} className="w-full py-2 text-center text-[13px] font-semibold text-[#8a9e9a] disabled:opacity-50">
          Cancel
        </button>
        </form>
      )}
    </ProfileListCard>
  );
}

export default ProfilePasswordCard;
