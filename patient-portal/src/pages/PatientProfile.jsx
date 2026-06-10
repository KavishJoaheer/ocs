import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import {
  UserCircle,
  Mail,
  Phone,
  Calendar,
  MapPin,
  Users,
  Heart,
  Shield,
  FileText,
  LogOut,
  Save,
  X,
} from "lucide-react";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { formatDisplayName } from "../lib/formatDisplayName.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { api } from "../lib/api.js";
import ProfileHeader from "../components/profile/ProfileHeader.jsx";
import ProfileListCard from "../components/profile/ProfileListCard.jsx";
import ProfileListRow from "../components/profile/ProfileListRow.jsx";
import ProfileCardAction from "../components/profile/ProfileCardAction.jsx";
import ProfilePrimaryCareContent from "../components/profile/ProfilePrimaryCareCard.jsx";

function InlineInput({ value, onChange, placeholder, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="mt-1 w-full rounded-[10px] bg-[rgba(26,160,140,0.06)] px-3 py-2 text-[15px] font-medium text-[#1a5c52] outline-none focus:bg-white focus:shadow-[0_0_0_2px_rgba(65,200,198,0.3)]"
    />
  );
}

function EditActions({ onCancel, onSave, saving }) {
  return (
    <div className="flex gap-3">
      <button type="button" onClick={onCancel} className="flex items-center gap-1 text-[13px] text-[#8a9e9a]">
        <X className="size-3.5" />
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-1 text-[13px] font-semibold text-ocs-orange disabled:opacity-50"
      >
        {saving ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-[rgba(232,160,32,0.3)] border-t-[var(--ocs-orange)]" />
        ) : (
          <Save className="size-3.5" />
        )}
        Save
      </button>
    </div>
  );
}

function PatientProfile() {
  const { user, updateUser, logout } = usePatientAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
  const [editingBilling, setEditingBilling] = useState(false);
  const [contactForm, setContactForm] = useState({ phone: "", address: "" });
  const [billingForm, setBillingForm] = useState({
    insurance_provider: "",
    insurance_policy_number: "",
  });
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function fetchProfile() {
      try {
        const data = await api.get("/patient-portal/profile");
        if (ignore) return;
        const p = data.profile || data;
        setProfile(p);
        setContactForm({
          phone: p.phone || "",
          address: p.address || "",
        });
        setBillingForm({
          insurance_provider: p.insurance_provider || data.patient?.insurance_provider || "",
          insurance_policy_number:
            p.insurance_policy_number || data.patient?.insurance_policy_number || "",
        });
      } catch {
        if (!ignore) setProfile(null);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchProfile();
    return () => {
      ignore = true;
    };
  }, [refreshKey]);

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  const genderLabel =
    profile?.gender === "M" ? "Male" : profile?.gender === "F" ? "Female" : profile?.gender || null;

  async function saveProfileFields(fields, onSuccess) {
    setSaving(true);
    try {
      const data = await api.patch("/patient-portal/profile", fields);
      setProfile((prev) => ({ ...prev, ...fields }));
      onSuccess?.();
      toast.success("Profile updated successfully.");
      if (data.user) updateUser(data.user);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSaveContact() {
    saveProfileFields(contactForm, () => setEditingContact(false));
  }

  function handleSaveBilling() {
    saveProfileFields(billingForm, () => setEditingBilling(false));
  }

  function handleCancelContact() {
    setContactForm({ phone: profile?.phone || "", address: profile?.address || "" });
    setEditingContact(false);
  }

  function handleCancelBilling() {
    setBillingForm({
      insurance_provider: profile?.insurance_provider || "",
      insurance_policy_number: profile?.insurance_policy_number || "",
    });
    setEditingBilling(false);
  }

  const billingActionLabel =
    billingForm.insurance_provider || billingForm.insurance_policy_number ? "Edit" : "Add";

  if (loading) {
    return (
      <div className="profile-screen native-screen w-full">
        <div className="profile-teal-band animate-pulse" aria-hidden="true" />
        <div className="profile-hub mx-auto w-full max-w-4xl space-y-4 px-[var(--native-pad-screen)] lg:px-6">
          <div className="profile-concierge-avatar mx-auto animate-pulse bg-white/80" />
          <div className="profile-crafted-card h-48 animate-pulse bg-white/70" />
        </div>
      </div>
    );
  }

  return (
    <div className="profile-screen native-screen w-full">
      <div className="profile-teal-band" aria-hidden="true" />

      <div className="profile-hub mx-auto w-full max-w-4xl px-[var(--native-pad-screen)] pb-8 lg:px-6 lg:pb-12">
        <div className="profile-identity-zone">
          <ProfileHeader
            fullName={user?.full_name}
            initials={initials}
            ocsCareNumber={profile?.ocs_care_number}
          />
        </div>

        <div className="profile-desktop-grid grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start lg:gap-8">
        {/* Personal Information — left col on desktop */}
        <div className="order-1 self-start lg:col-span-7 lg:col-start-1 lg:row-start-1">
          <ProfileListCard title="Personal Information">
            <ProfileListRow icon={UserCircle} label="Full Name" value={formatDisplayName(user?.full_name)} />
            <ProfileListRow icon={Mail} label="Email" value={user?.email} />
            <ProfileListRow
              icon={Calendar}
              label="Date of Birth"
              value={
                profile?.date_of_birth ? dayjs(profile.date_of_birth).format("MMMM D, YYYY") : null
              }
            />
            <ProfileListRow icon={Heart} label="Gender" value={genderLabel} isLast />
          </ProfileListCard>
        </div>

        {/* Primary Care Provider — right col on desktop */}
        <div className="order-2 self-start lg:col-span-5 lg:col-start-8 lg:row-start-1">
          <ProfileListCard
            title="Primary Care Provider"
            subtitle="Managed by OCS"
            subtitleLayout="stacked"
            variant="teal"
          >
            <ProfilePrimaryCareContent doctorName={profile?.assigned_doctor_name} />
          </ProfileListCard>
        </div>

        {/* Contact Details — left col */}
        <div className="order-3 self-start lg:col-span-7 lg:col-start-1 lg:row-start-2">
          <ProfileListCard
            title="Contact Details"
            action={
              editingContact ? (
                <EditActions onCancel={handleCancelContact} onSave={handleSaveContact} saving={saving} />
              ) : (
                <ProfileCardAction label="Edit" onClick={() => setEditingContact(true)} />
              )
            }
          >
            <ProfileListRow
              icon={Phone}
              label="Phone"
              value={editingContact ? undefined : contactForm.phone}
              isLast={false}
            >
              {editingContact ? (
                <InlineInput
                  value={contactForm.phone}
                  onChange={(e) => setContactForm((c) => ({ ...c, phone: e.target.value }))}
                  placeholder="Phone number"
                />
              ) : null}
            </ProfileListRow>
            <ProfileListRow
              icon={MapPin}
              label="Address"
              value={editingContact ? undefined : contactForm.address}
              isLast
            >
              {editingContact ? (
                <InlineInput
                  value={contactForm.address}
                  onChange={(e) => setContactForm((c) => ({ ...c, address: e.target.value }))}
                  placeholder="Your address"
                />
              ) : null}
            </ProfileListRow>
          </ProfileListCard>
        </div>

        {/* Billing & Insurance — right col */}
        <div className="order-4 self-start lg:col-span-5 lg:col-start-8 lg:row-start-2">
          <ProfileListCard
            title="Billing & Insurance"
            action={
              editingBilling ? (
                <EditActions onCancel={handleCancelBilling} onSave={handleSaveBilling} saving={saving} />
              ) : (
                <ProfileCardAction
                  label={billingActionLabel}
                  onClick={() => setEditingBilling(true)}
                />
              )
            }
          >
            <ProfileListRow icon={Shield} label="Insurance Provider" isLast={false}>
              {editingBilling ? (
                <InlineInput
                  value={billingForm.insurance_provider}
                  onChange={(e) =>
                    setBillingForm((c) => ({ ...c, insurance_provider: e.target.value }))
                  }
                  placeholder="Insurance provider"
                />
              ) : (
                <p
                  className={[
                    "mt-0.5 text-[15px] font-semibold",
                    billingForm.insurance_provider ? "text-[#1a5c52]" : "text-[#8a9e9a]",
                  ].join(" ")}
                >
                  {billingForm.insurance_provider || "Tap to add provider"}
                </p>
              )}
            </ProfileListRow>
            <ProfileListRow icon={FileText} label="Policy Number" isLast>
              {editingBilling ? (
                <InlineInput
                  value={billingForm.insurance_policy_number}
                  onChange={(e) =>
                    setBillingForm((c) => ({ ...c, insurance_policy_number: e.target.value }))
                  }
                  placeholder="Policy number"
                />
              ) : (
                <p
                  className={[
                    "mt-0.5 text-[15px] font-semibold",
                    billingForm.insurance_policy_number ? "text-[#1a5c52]" : "text-[#8a9e9a]",
                  ].join(" ")}
                >
                  {billingForm.insurance_policy_number || "Tap to add policy number"}
                </p>
              )}
            </ProfileListRow>
          </ProfileListCard>
        </div>

        {/* Emergency Contact — left col */}
        <div className="order-5 self-start lg:col-span-7 lg:col-start-1 lg:row-start-3">
          <ProfileListCard title="Emergency Contact">
            <ProfileListRow icon={UserCircle} label="Name" value={profile?.next_of_kin_name} />
            <ProfileListRow icon={Phone} label="Phone" value={profile?.next_of_kin_phone} />
            <ProfileListRow
              icon={Users}
              label="Relationship"
              value={profile?.next_of_kin_relationship}
              isLast
            />
          </ProfileListCard>
        </div>

        {/* Sign out — mobile only */}
        <button
          type="button"
          onClick={() => logout()}
          className="profile-sign-out-btn order-6 mt-4 flex w-full items-center justify-center gap-2 lg:hidden"
        >
          <LogOut className="size-4" strokeWidth={1.75} />
          Sign Out
        </button>
        </div>
      </div>
    </div>
  );
}

export default PatientProfile;
