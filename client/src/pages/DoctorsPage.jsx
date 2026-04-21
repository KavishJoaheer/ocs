import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Plus, Power, RotateCcw, SquarePen, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { api } from "../lib/api.js";
import { cx } from "../lib/utils.js";

const roleTabs = [
  {
    role: "doctor",
    label: "Doctor tab",
    title: "Doctor accounts",
    description: "Create, edit, enable, disable, or move doctor logins to recently deleted while keeping clinic history intact.",
  },
  {
    role: "operator",
    label: "Operator tab",
    title: "Operator accounts",
    description: "Create, edit, enable, disable, or move operator logins to recently deleted for patient intake and coordination.",
  },
  {
    role: "accountant",
    label: "Accountant tab",
    title: "Accountant accounts",
    description: "Create, edit, enable, disable, or move accountant logins to recently deleted for billing and finance workflows.",
  },
];

const deletedTab = {
  role: "deleted",
  label: "Recently deleted",
  title: "Recently deleted",
  description: "Deleted team accounts remain here for 30 days so admin can restore them when needed.",
};

function getRoleTab(role) {
  return role === "deleted" ? deletedTab : roleTabs.find((tab) => tab.role === role) || roleTabs[0];
}

function getEmptyMember(role) {
  return {
    full_name: "",
    username: "",
    password: "",
    specialization: role === "doctor" ? "General Practitioner" : "",
  };
}

function TeamMemberFormModal({ open, role, member, onClose, onSubmit, isSaving }) {
  const [form, setForm] = useState(getEmptyMember(role));
  const isEditing = Boolean(member?.id);
  const activeTab = getRoleTab(role);

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm(
      member
        ? {
            full_name: member.full_name ?? "",
            username: member.username ?? "",
            password: "",
            specialization: member.specialization ?? (role === "doctor" ? "General Practitioner" : ""),
          }
        : getEmptyMember(role),
    );
  }, [member, open, role]);

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(form);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? `Edit ${activeTab.title}` : `Add ${activeTab.title}`}
      description="Only the admin can manage these clinic accounts."
      size="lg"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Full name</span>
          <input
            required
            value={form.full_name}
            onChange={(event) =>
              setForm((current) => ({ ...current, full_name: event.target.value }))
            }
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Username</span>
            <input
              required
              value={form.username}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  username: event.target.value.toLowerCase(),
                }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          {role === "doctor" ? (
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Specialization</span>
              <input
                required
                value={form.specialization}
                onChange={(event) =>
                  setForm((current) => ({ ...current, specialization: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
              />
            </label>
          ) : (
            <div className="rounded-2xl border border-sky-100 bg-sky-50/75 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                Role
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{activeTab.title}</p>
            </div>
          )}
        </div>

        <div className="rounded-[24px] border border-sky-100 bg-sky-50/75 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white p-3 text-sky-700">
              <KeyRound className="size-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                Password control
              </p>
              <p className="mt-1 text-sm leading-7 text-slate-600">
                {isEditing
                  ? "Leave the password blank to keep the current one, or set a new one to reset access."
                  : "Set the password that admin will share with this team member."}
              </p>
            </div>
          </div>
        </div>

        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">
            {isEditing ? "New password" : "Password"}
          </span>
          <input
            required={!isEditing}
            type="password"
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({ ...current, password: event.target.value }))
            }
            placeholder={isEditing ? "Optional reset" : "Set a secure password"}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
          />
        </label>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : isEditing ? "Update account" : "Add account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TeamOperationsPage() {
  const [activeRole, setActiveRole] = useState("doctor");
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [memberAction, setMemberAction] = useState(null);
  const [memberToDelete, setMemberToDelete] = useState(null);
  const [isRestoringId, setIsRestoringId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeTab = getRoleTab(activeRole);

  useEffect(() => {
    let ignore = false;

    async function loadMembers() {
      setLoading(true);

      try {
        const data =
          activeRole === "deleted"
            ? await api.get("/team-operations/deleted/recent")
            : await api.get(`/team-operations/${activeRole}`);
        if (!ignore) {
          setMembers(data);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadMembers();

    return () => {
      ignore = true;
    };
  }, [activeRole]);

  async function reloadMembers() {
    const data =
      activeRole === "deleted"
        ? await api.get("/team-operations/deleted/recent")
        : await api.get(`/team-operations/${activeRole}`);
    setMembers(data);
  }

  async function handleSave(payload) {
    setIsSaving(true);

    try {
      if (editor?.member) {
        await api.put(`/team-operations/${activeRole}/${editor.member.id}`, payload);
        toast.success(`${activeTab.title} updated.`);
      } else {
        await api.post(`/team-operations/${activeRole}`, payload);
        toast.success(`${activeTab.title} created.`);
      }

      setEditor(null);
      await reloadMembers();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleActivationChange() {
    if (!memberAction?.member) return;

    try {
      await api.patch(`/team-operations/${activeRole}/${memberAction.member.id}/activation`, {
        is_active: memberAction.nextIsActive,
      });
      toast.success(
        memberAction.nextIsActive ? `${activeTab.title} enabled.` : `${activeTab.title} disabled.`,
      );
      setMemberAction(null);
      await reloadMembers();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function handlePermanentDelete() {
    if (!memberToDelete) {
      return;
    }

    try {
      await api.delete(`/team-operations/${activeRole}/${memberToDelete.id}`);
      toast.success(`${activeTab.title.replace("accounts", "account")} deleted.`);
      setMemberToDelete(null);
      await reloadMembers();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function handleRestore(member) {
    setIsRestoringId(member.id);

    try {
      await api.post(`/team-operations/${member.role}/${member.id}/restore`);
      toast.success(`${member.full_name} restored.`);
      await reloadMembers();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsRestoringId(null);
    }
  }

  if (loading) {
    return <LoadingState label={`Loading ${activeTab.title.toLowerCase()}`} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Team operations"
        description="Create, edit, enable, disable, delete, and restore doctor, operator, and accountant accounts from one admin workspace."
        actions={
          activeRole !== "deleted" ? (
            <button
              type="button"
              onClick={() => setEditor({ member: null })}
              className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700"
            >
              <Plus className="size-4" />
              Add account
            </button>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-3 rounded-[28px] border border-slate-200/80 bg-white/80 p-3 shadow-[0_20px_60px_rgba(34,72,91,0.08)]">
        {[...roleTabs, deletedTab].map((tab) => (
          <button
            key={tab.role}
            type="button"
            onClick={() => setActiveRole(tab.role)}
            className={cx(
              "rounded-2xl px-4 py-3 text-sm font-semibold transition",
              activeRole === tab.role
                ? "bg-sky-600 text-white shadow-lg shadow-sky-200"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <SectionCard title={activeTab.title} subtitle={activeTab.description}>
        {members.length ? (
          <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white text-left">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Name</th>
                    <th className="px-5 py-4">{activeRole === "deleted" ? "Role" : "Username"}</th>
                    <th className="px-5 py-4">Details</th>
                    <th className="px-5 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id} className="border-t border-slate-200/70">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-950">{member.full_name}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {activeRole === "deleted"
                            ? `Deleted ${new Date(member.deleted_at).toLocaleString()}`
                            : member.is_active
                              ? "Active account"
                              : "Disabled account"}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600">
                        {activeRole === "deleted"
                          ? member.role.charAt(0).toUpperCase() + member.role.slice(1).replace("_", " ")
                          : `@${member.username}`}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-500">
                        {member.role === "doctor" ? (
                          <div className="space-y-1">
                            <p>{member.specialization || "General practice"}</p>
                            <p>
                              {member.assigned_patient_count} assigned patients,{" "}
                              {member.appointment_count} appointments,{" "}
                              {member.consultation_count} consultations
                            </p>
                          </div>
                        ) : (
                          <p>
                            {activeRole === "deleted"
                              ? `Username: @${member.username}`
                              : member.is_active
                                ? "Login enabled"
                                : "Login disabled"}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          {activeRole === "deleted" ? (
                            <button
                              type="button"
                              onClick={() => handleRestore(member)}
                              disabled={isRestoringId === member.id}
                              className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <RotateCcw className="size-4" />
                              {isRestoringId === member.id ? "Restoring..." : "Restore"}
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditor({ member })}
                                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                              >
                                <SquarePen className="size-4" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setMemberAction({
                                    member,
                                    nextIsActive: !member.is_active,
                                  })
                                }
                                className={cx(
                                  "inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold transition",
                                  member.is_active
                                    ? "border border-amber-200 text-amber-700 hover:bg-amber-50"
                                    : "border border-emerald-200 text-emerald-700 hover:bg-emerald-50",
                                )}
                              >
                                {member.is_active ? (
                                  <>
                                    <Power className="size-4" />
                                    Disable
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="size-4" />
                                    Enable
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => setMemberToDelete(member)}
                                className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                              >
                                <Trash2 className="size-4" />
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            title={`No ${activeTab.title.toLowerCase()} yet`}
            description={
              activeRole === "deleted"
                ? "Deleted team members from the last 30 days will appear here."
                : "Add the first account from the admin toolbar above."
            }
          />
        )}
      </SectionCard>

      <TeamMemberFormModal
        open={Boolean(editor)}
        role={activeRole}
        member={editor?.member}
        onClose={() => setEditor(null)}
        onSubmit={handleSave}
        isSaving={isSaving}
      />

      <ConfirmDialog
        open={Boolean(memberAction)}
        onClose={() => setMemberAction(null)}
        onConfirm={handleActivationChange}
        title={`${memberAction?.nextIsActive ? "Enable" : "Disable"} ${activeTab.title.replace("accounts", "account")}?`}
        description={
          memberAction?.member
            ? memberAction.nextIsActive
              ? `${memberAction.member.full_name} will be able to sign in again with their existing username and password.`
              : `${memberAction.member.full_name} will be disabled from signing in, but historical records will stay intact.`
            : ""
        }
        confirmLabel={memberAction?.nextIsActive ? "Enable account" : "Disable account"}
      />

      <ConfirmDialog
        open={Boolean(memberToDelete)}
        onClose={() => setMemberToDelete(null)}
        onConfirm={handlePermanentDelete}
        title={`Delete ${activeTab.title.replace("accounts", "account")}?`}
        description={
          memberToDelete
            ? `${memberToDelete.full_name} will move to Recently deleted for 30 days. Historical clinic records stay attached.`
            : ""
        }
        confirmLabel="Move to recently deleted"
      />
    </div>
  );
}

export default TeamOperationsPage;
