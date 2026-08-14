import { useState } from "react";
import toast from "react-hot-toast";
import { useFamilyProfile } from "../../hooks/useFamilyProfile.jsx";
import { api } from "../../lib/api.js";
import ProfileListCard from "./ProfileListCard.jsx";

const RELATIONSHIPS = ["Son", "Daughter", "Spouse", "Parent", "Sibling", "Other"];

function ProfileFamilyCard() {
  const { dependents, reloadDependents, activeProfile } = useFamilyProfile();
  const [form, setForm] = useState({
    full_name: "",
    relationship: "Son",
    date_of_birth: "",
    gender: "M",
  });
  const [saving, setSaving] = useState(false);

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
      setForm({ full_name: "", relationship: "Son", date_of_birth: "", gender: "M" });
      await reloadDependents();
      toast.success("Family member added. Use the profile switcher to request care for them.");
    } catch (error) {
      toast.error(error.message || "Could not add this family member.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ProfileListCard title="Family members" subtitle="Add people you request home visits for.">
      {dependents.length ? (
        <ul className="space-y-2 px-5 pb-3">
          {dependents.map((row) => (
            <li key={row.id} className="text-sm font-medium text-[#1a5c52]">
              {row.full_name}
              <span className="ml-2 text-xs font-normal text-[#8a9e9a]">{row.relationship}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-3 text-sm text-[#8a9e9a]">No family members yet.</p>
      )}
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
      </form>
    </ProfileListCard>
  );
}

export default ProfileFamilyCard;
