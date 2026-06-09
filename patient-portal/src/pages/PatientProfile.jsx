import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import {
  UserCircle,
  Mail,
  Phone,
  Calendar,
  Shield,
  Edit3,
  Save,
  X,
  MapPin,
  Users,
  Heart,
  Hash,
  LogOut,
} from "lucide-react";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { formatDisplayName } from "../lib/formatDisplayName.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { api } from "../lib/api.js";

function ReadOnlyField({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[rgba(65,200,198,0.1)] bg-white/60 px-4 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-[#6e949b]" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6e949b]">{label}</p>
        <p className="mt-1 text-sm font-medium text-[#22485b]">{value || "—"}</p>
      </div>
    </div>
  );
}

function PatientProfile() {
  const { user, updateUser, logout } = usePatientAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    phone: "",
    address: "",
    next_of_kin_name: "",
    next_of_kin_phone: "",
    next_of_kin_relationship: "",
  });
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function fetchProfile() {
      try {
        const data = await api.get("/patient-portal/profile");
        if (!ignore) {
          setProfile(data.profile || data);
          setEditForm({
            phone: data.profile?.phone || data.phone || "",
            address: data.profile?.address || data.address || "",
            next_of_kin_name: data.profile?.next_of_kin_name || data.next_of_kin_name || "",
            next_of_kin_phone: data.profile?.next_of_kin_phone || data.next_of_kin_phone || "",
            next_of_kin_relationship: data.profile?.next_of_kin_relationship || data.next_of_kin_relationship || "",
          });
        }
      } catch {
        if (!ignore) setProfile(null);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchProfile();
    return () => { ignore = true; };
  }, [refreshKey]);

  const initials = user?.full_name
    ? user.full_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  function handleStartEdit() {
    setEditing(true);
  }

  function handleCancelEdit() {
    setEditing(false);
    if (profile) {
      setEditForm({
        phone: profile.phone || "",
        address: profile.address || "",
        next_of_kin_name: profile.next_of_kin_name || "",
        next_of_kin_phone: profile.next_of_kin_phone || "",
        next_of_kin_relationship: profile.next_of_kin_relationship || "",
      });
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const data = await api.patch("/patient-portal/profile", editForm);
      setProfile((prev) => ({ ...prev, ...editForm }));
      setEditing(false);
      toast.success("Profile updated successfully.");
      if (data.user) updateUser(data.user);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-48 animate-pulse rounded-[30px] bg-[rgba(65,200,198,0.08)]" />
        <div className="h-64 animate-pulse rounded-[30px] bg-[rgba(65,200,198,0.06)]" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Profile header */}
      <div className="animate-fade-in-up rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-6 shadow-[0_18px_52px_rgba(34,72,91,0.08)] sm:p-8">
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-2xl font-bold text-white shadow-xl shadow-[rgba(45,143,152,0.25)]">
            {initials}
          </div>
          <div className="text-center sm:text-left">
            <h1 className="font-display text-2xl tracking-tight text-slate-950 sm:text-3xl">
              {formatDisplayName(user?.full_name)}
            </h1>
            <p className="mt-1 text-sm text-[#5b7f8a]">{user?.email}</p>
            {profile?.ocs_care_number && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[rgba(242,193,77,0.12)] px-3 py-1">
                <Hash className="size-3 text-[#f2c14d]" />
                <span className="text-xs font-bold text-[#a8841a]">
                  OCS Care #{profile.ocs_care_number}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Read-only information */}
      <div className="animate-fade-in-up stagger-1 rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-6 shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
        <div className="flex items-center gap-2">
          <Shield className="size-4 text-[#2d8f98]" />
          <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            Personal Information
          </h2>
        </div>
        <p className="mt-1 text-xs text-[#6e949b]">
          These details are managed by your care team.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <ReadOnlyField icon={UserCircle} label="Full Name" value={formatDisplayName(user?.full_name)} />
          <ReadOnlyField icon={Mail} label="Email" value={user?.email} />
          <ReadOnlyField
            icon={Calendar}
            label="Date of Birth"
            value={profile?.date_of_birth ? dayjs(profile.date_of_birth).format("MMMM D, YYYY") : null}
          />
          <ReadOnlyField
            icon={Heart}
            label="Gender"
            value={profile?.gender === "M" ? "Male" : profile?.gender === "F" ? "Female" : null}
          />
        </div>
      </div>

      {/* Editable information */}
      <div className="animate-fade-in-up stagger-2 rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-6 shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Edit3 className="size-4 text-[#2d8f98]" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
              Contact &amp; Emergency
            </h2>
          </div>
          {!editing ? (
            <button
              type="button"
              onClick={handleStartEdit}
              className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-[rgba(65,200,198,0.08)] px-3 py-2 text-sm font-semibold text-[#2d8f98] transition hover:bg-[rgba(65,200,198,0.14)]"
            >
              <Edit3 className="size-3.5" />
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleCancelEdit}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <X className="size-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-2xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 active:scale-95 disabled:opacity-60 disabled:active:scale-100"
              >
                {saving ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save
              </button>
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {/* Phone */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Phone</label>
            {editing ? (
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
                <input
                  value={editForm.phone}
                  onChange={(e) => setEditForm((c) => ({ ...c, phone: e.target.value }))}
                  className="w-full rounded-xl border border-transparent bg-[rgba(65,200,198,0.08)] py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                  placeholder="Phone number"
                />
              </div>
            ) : (
              <ReadOnlyField icon={Phone} label="Phone" value={editForm.phone} />
            )}
          </div>

          {/* Address */}
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-semibold text-slate-700">Address</label>
            {editing ? (
              <div className="relative">
                <MapPin className="absolute left-4 top-3.5 size-4 text-[#6e949b]" />
                <textarea
                  value={editForm.address}
                  onChange={(e) => setEditForm((c) => ({ ...c, address: e.target.value }))}
                  rows={2}
                  className="w-full rounded-xl border border-transparent bg-[rgba(65,200,198,0.08)] py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                  placeholder="Your address"
                />
              </div>
            ) : (
              <ReadOnlyField icon={MapPin} label="Address" value={editForm.address} />
            )}
          </div>
        </div>

        {/* Next of Kin */}
        <div className="mt-6">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-[#f2c14d]" />
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6e949b]">
              Next of Kin
            </h3>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Name</label>
              {editing ? (
                <input
                  value={editForm.next_of_kin_name}
                  onChange={(e) => setEditForm((c) => ({ ...c, next_of_kin_name: e.target.value }))}
                  className="w-full rounded-xl border border-transparent bg-[rgba(65,200,198,0.08)] px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
                  placeholder="Name"
                />
              ) : (
                <ReadOnlyField icon={UserCircle} label="Name" value={editForm.next_of_kin_name} />
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Phone</label>
              {editing ? (
                <input
                  value={editForm.next_of_kin_phone}
                  onChange={(e) => setEditForm((c) => ({ ...c, next_of_kin_phone: e.target.value }))}
                  className="w-full rounded-xl border border-transparent bg-[rgba(65,200,198,0.08)] px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
                  placeholder="Phone number"
                />
              ) : (
                <ReadOnlyField icon={Phone} label="Phone" value={editForm.next_of_kin_phone} />
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Relationship</label>
              {editing ? (
                <input
                  value={editForm.next_of_kin_relationship}
                  onChange={(e) => setEditForm((c) => ({ ...c, next_of_kin_relationship: e.target.value }))}
                  className="w-full rounded-xl border border-transparent bg-[rgba(65,200,198,0.08)] px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
                  placeholder="e.g. Spouse, Parent"
                />
              ) : (
                <ReadOnlyField icon={Heart} label="Relationship" value={editForm.next_of_kin_relationship} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sign out — mobile only (desktop keeps it in the sidebar) */}
      <button
        type="button"
        onClick={() => logout()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(207,91,80,0.3)] bg-white px-4 py-3.5 text-sm font-semibold text-[#cf5b50] transition active:bg-[rgba(207,91,80,0.06)] lg:hidden"
      >
        <LogOut className="size-4" />
        Sign Out
      </button>
    </div>
  );
}

export default PatientProfile;
