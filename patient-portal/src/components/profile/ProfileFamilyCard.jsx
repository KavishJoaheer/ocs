import { useState } from "react";
import toast from "react-hot-toast";
import { useFamilyProfile } from "../../hooks/useFamilyProfile.jsx";
import { api } from "../../lib/api.js";
import { PRIMARY_PROFILE_ID } from "../../lib/familyProfiles.js";
import ProfileListCard from "./ProfileListCard.jsx";

const RELATIONSHIPS = ["Son", "Daughter", "Spouse", "Parent", "Sibling", "Other"];

function emptyForm() {
  return {
    full_name: "",
    relationship: "Son",
    date_of_birth: "",
    gender: "M",
  };
}

function ProfileFamilyCard() {
  const { dependents, reloadDependents, activeProfile, activeProfileId, setActiveProfile } = useFamilyProfile();
  const [form, setForm] = useState(emptyForm);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  if (!activeProfile?.isPrimary) {
    return (
      <ProfileListCard title="Family" subtitle="Switch back to your profile to add family members.">
        <p className="px-5 py-4 text-sm text-[#5b7f8a]">Family members are managed from the primary account.</p>
      </ProfileListCard>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post("/patient-portal/dependents", form);
      setForm(emptyForm());
      setAdding(false);
      await reloadDependents();
      toast.success("Family member added. Use the profile switcher to request care for them.");
    } catch (error) {
      toast.error(error.message || "Could not add this family member.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(row) {
    if (removingId) return;
    setRemovingId(row.id);
    try {
      await api.delete(`/patient-portal/dependents/${row.id}`);
      if (String(activeProfileId) === String(row.id)) {
        setActiveProfile(PRIMARY_PROFILE_ID);
      }
      await reloadDependents();
      setConfirmId(null);
      toast.success(`${row.full_name} was removed from your family list.`);
    } catch (error) {
      toast.error(error.message || "Could not remove this family member.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <ProfileListCard title="Family members" subtitle="Add people you request home visits for.">
      {dependents.length ? (
        <ul className="space-y-2 px-5 pb-3">
          {dependents.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 text-sm font-medium text-[#1a5c52]">
              <span>
                {row.full_name}
                <span className="ml-2 text-xs font-normal text-[#8a9e9a]">{row.relationship}</span>
              </span>
              {confirmId === row.id ? (
                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    disabled={Boolean(removingId)}
                    onClick={() => handleRemove(row)}
                    className="inline-flex min-h-[44px] items-center rounded-xl bg-[#c23a2f] px-3 text-[13px] font-semibold text-white disabled:opacity-50"
                  >
                    {removingId === row.id ? "Removing..." : "Confirm"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(removingId)}
                    onClick={() => setConfirmId(null)}
                    className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 px-3 text-[13px] font-medium text-[#5b7f8a]"
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmId(row.id)}
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl border border-[#c23a2f]/30 px-3 text-[13px] font-semibold text-[#c23a2f] transition hover:bg-[#c23a2f]/8"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-3 text-sm text-[#8a9e9a]">No family members yet.</p>
      )}
      {adding ? (
        <form className="space-y-3 border-t border-[rgba(65,200,198,0.12)] px-5 py-4" onSubmit={handleSubmit}>
          <input
            required
            value={form.full_name}
            onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))}
            placeholder="Full name"
            className="w-full rounded-[10px] bg-[rgba(26,160,140,0.06)] px-3 py-2 text-[15px] font-medium text-[#1a5c52] outline-none"
          />
          <select
            value={form.relationship}
            onChange={(event) => setForm((current) => ({ ...current, relationship: event.target.value }))}
            className="w-full rounded-[10px] bg-[rgba(26,160,140,0.06)] px-3 py-2 text-[15px] font-medium text-[#1a5c52] outline-none"
          >
            {RELATIONSHIPS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <input
            required
            type="date"
            value={form.date_of_birth}
            onChange={(event) => setForm((current) => ({ ...current, date_of_birth: event.target.value }))}
            className="w-full rounded-[10px] bg-[rgba(26,160,140,0.06)] px-3 py-2 text-[15px] font-medium text-[#1a5c52] outline-none"
          />
          <select
            value={form.gender}
            onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value }))}
            className="w-full rounded-[10px] bg-[rgba(26,160,140,0.06)] px-3 py-2 text-[15px] font-medium text-[#1a5c52] outline-none"
          >
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-[#2d8f98] py-3 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Adding..." : "Add family member"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setForm(emptyForm());
            }}
            className="w-full py-2 text-center text-[13px] font-semibold text-[#8a9e9a]"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="border-t border-[rgba(65,200,198,0.12)] px-5 py-4">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-[#2d8f98]/30 px-4 text-[13px] font-semibold text-[#2d8f98]"
          >
            Add someone
          </button>
        </div>
      )}
    </ProfileListCard>
  );
}

export default ProfileFamilyCard;
