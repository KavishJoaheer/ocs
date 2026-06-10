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
import { dispatchPatientDataChange } from "../lib/patientDataSync.js";
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
      <button
        type="button"
        onClick={onCancel}
        className="flex min-h-[44px] items-center gap-1 px-1 text-[13px] text-[#8a9e9a] transition hover:text-[#5b7f8a]"
      >
        <X className="size-3.5" />
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="flex min-h-[44px] items-center gap-1 px-1 text-[13px] font-semibold text-ocs-orange transition hover:text-[#c88710] disabled:opacity-50"
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
  const [loadError, setLoadError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
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
      setLoadError(null);
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
      } catch (error) {
        if (!ignore) {
          setProfile(null);
          setLoadError(error?.message || "Could not load your profile.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    setLoading(true);
    fetchProfile();
    return () => {
      ignore = true;
    };
  }, [refreshKey, retryToken]);

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
      dispatchPatientDataChange();
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

  const personalCard = (
    <ProfileListCard title="Personal Information">
      <ProfileListRow icon={UserCircle} label="Full Name" value={formatDisplayName(user?.full_name)} />
      <ProfileListRow icon={Mail} label="Email" value={user?.email} />
      <ProfileListRow
        icon={Calendar}
        label="Date of Birth"
        value={profile?.date_of_birth ? dayjs(profile.date_of_birth).format("MMMM D, YYYY") : null}
      />
      <ProfileListRow icon={Heart} label="Gender" value={genderLabel} isLast />
    </ProfileListCard>
  );

  const primaryCareCard = (
    <ProfileListCard
      title="Primary Care Provider"
      subtitle="Managed by OCS"
      subtitleLayout="stacked"
      variant="teal"
    >
      <ProfilePrimaryCareContent doctorName={profile?.assigned_doctor_name} />
    </ProfileListCard>
  );

  const contactCard = (
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
  );

  const billingCard = (
    <ProfileListCard
      title="Billing & Insurance"
      action={
        editingBilling ? (
          <EditActions onCancel={handleCancelBilling} onSave={handleSaveBilling} saving={saving} />
        ) : (
          <ProfileCardAction label={billingActionLabel} onClick={() => setEditingBilling(true)} />
        )
      }
    >
      <ProfileListRow icon={Shield} label="Insurance Provider" isLast={false}>
        {editingBilling ? (
          <InlineInput
            value={billingForm.insurance_provider}
            onChange={(e) => setBillingForm((c) => ({ ...c, insurance_provider: e.target.value }))}
            placeholder="Insurance provider"
          />
        ) : (
          <p
            className={[
              "mt-0.5 text-[15px] font-semibold",
              billingForm.insurance_provider ? "text-[#1a5c52]" : "text-[#8a9e9a]",
            ].join(" ")}
          >
            {billingForm.insurance_provider || "Add provider"}
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
            {billingForm.insurance_policy_number || "Add policy number"}
          </p>
        )}
      </ProfileListRow>
    </ProfileListCard>
  );

  const emergencyCard = (
    <ProfileListCard title="Emergency Contact">
      <ProfileListRow
        icon={UserCircle}
        label="Name"
        value={profile?.next_of_kin_name}
        emptyLabel="Not yet added"
      />
      <ProfileListRow
        icon={Phone}
        label="Phone"
        value={profile?.next_of_kin_phone}
        emptyLabel="Not yet added"
      />
      <ProfileListRow
        icon={Users}
        label="Relationship"
        value={profile?.next_of_kin_relationship}
        emptyLabel="Not yet added"
        isLast
      />
    </ProfileListCard>
  );

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

  if (loadError) {
    return (
      <div className="profile-screen native-screen w-full">
        <div className="profile-teal-band" aria-hidden="true" />
        <div className="profile-hub mx-auto flex w-full max-w-4xl flex-col items-center px-[var(--native-pad-screen)] py-16 text-center lg:px-6">
          <p className="native-display text-[20px] text-[#1a5c52]">Couldn&apos;t load your profile</p>
          <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-[#5b7f8a]">{loadError}</p>
          <button
            type="button"
            onClick={() => setRetryToken((token) => token + 1)}
            className="request-wizard-primary-btn mt-6 w-full max-w-[280px]"
          >
            Try Again
          </button>
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

        {/* Mobile — single column, interleaved order */}
        <div className="flex flex-col gap-5 lg:hidden">
          {personalCard}
          {primaryCareCard}
          {contactCard}
          {billingCard}
          {emergencyCard}
          <button
            type="button"
            onClick={() => logout()}
            className="profile-sign-out-btn mt-4 flex w-full items-center justify-center gap-2"
          >
            <LogOut className="size-4" strokeWidth={1.75} />
            Sign Out
          </button>
        </div>

        {/* Desktop — two independent column stacks for perfect top alignment */}
        <div className="profile-desktop-columns hidden lg:grid lg:grid-cols-12 lg:items-start lg:gap-8">
          <div className="profile-desktop-col-left col-span-7 flex flex-col gap-8">
            {personalCard}
            {contactCard}
            {emergencyCard}
          </div>
          <div className="profile-desktop-col-right col-span-5 flex flex-col gap-8">
            {primaryCareCard}
            {billingCard}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PatientProfile;
