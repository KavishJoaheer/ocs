import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { BellRing, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import OperationStatusSelector from "../components/OperationStatusSelector.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { getRoleLabel } from "../lib/access.js";

const EMPTY_EDITOR = {
  id: null,
  title: "",
  body: "",
};

const ROLE_ORDER = ["admin", "doctor", "operator", "lab_tech", "accountant"];

function formatTimestamp(value) {
  if (!value) {
    return "Not updated yet";
  }

  return dayjs(value).format("MMM D, YYYY [at] h:mm A");
}

function HcmNewsPage() {
  const { user, updateUser } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(EMPTY_EDITOR);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isSavingPost, setIsSavingPost] = useState(false);
  const [isDeletingPost, setIsDeletingPost] = useState(false);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadPage = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setIsRefreshing(true);
    }

    try {
      const payload = await api.get("/hcm-news");
      setData(payload);
    } catch (error) {
      if (!silent) {
        toast.error(error.message);
      }
    } finally {
      if (!silent) {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function bootstrap() {
      try {
        const payload = await api.get("/hcm-news");
        if (!ignore) {
          setData(payload);
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

    bootstrap();

    const intervalId = window.setInterval(() => {
      if (!ignore) {
        loadPage({ silent: true });
      }
    }, 30000);

    return () => {
      ignore = true;
      window.clearInterval(intervalId);
    };
  }, [loadPage]);

  const groupedStatuses = useMemo(() => {
    const grouped = new Map();

    ROLE_ORDER.forEach((role) => {
      grouped.set(role, []);
    });

    for (const member of data?.team_statuses || []) {
      if (!grouped.has(member.role)) {
        grouped.set(member.role, []);
      }
      grouped.get(member.role).push(member);
    }

    return grouped;
  }, [data?.team_statuses]);

  const statusOptions = user.role === "doctor" ? ["available", "active", "offline"] : ["active", "offline"];

  function openCreateModal() {
    setEditor(EMPTY_EDITOR);
    setEditorOpen(true);
  }

  function openEditModal(post) {
    setEditor({
      id: post.id,
      title: post.title,
      body: post.body,
    });
    setEditorOpen(true);
  }

  function closeEditorModal() {
    if (isSavingPost) {
      return;
    }

    setEditorOpen(false);
    setEditor(EMPTY_EDITOR);
  }

  async function handleSavePost(event) {
    event.preventDefault();
    setIsSavingPost(true);

    try {
      const payload = editor.id
        ? await api.put(`/hcm-news/${editor.id}`, {
            title: editor.title,
            body: editor.body,
          })
        : await api.post("/hcm-news", {
            title: editor.title,
            body: editor.body,
          });

      setData(payload);
      setEditorOpen(false);
      setEditor(EMPTY_EDITOR);
      toast.success(editor.id ? "HCM update saved." : "HCM update published.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSavingPost(false);
    }
  }

  async function handleDeletePost() {
    if (!deleteTarget) {
      return;
    }

    setIsDeletingPost(true);

    try {
      await api.delete(`/hcm-news/${deleteTarget.id}`);
      await loadPage();
      setDeleteTarget(null);
      toast.success("HCM update removed.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsDeletingPost(false);
    }
  }

  async function handleStatusChange(nextStatus) {
    if (isSavingStatus || user.operation_status === nextStatus) {
      return;
    }

    setIsSavingStatus(true);

    try {
      const payload = await api.put("/dashboard/my-status", { status: nextStatus });
      updateUser(payload.user);
      setData((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          team_statuses: current.team_statuses.map((member) =>
            member.id === payload.user.id
              ? {
                  ...member,
                  ...payload.user,
                }
              : member,
          ),
        };
      });
      toast.success(`Status updated to ${payload.user.operation_status}.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSavingStatus(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading HCM news" />;
  }

  if (!data) {
    return (
      <EmptyState
        title="HCM news unavailable"
        description="The HCM news board could not be loaded right now. Please refresh and try again."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Health care manager"
        title="HCM news board"
        description="Admin can publish team-wide updates here, while every user can keep their live operation status visible to the rest of OCS Medecins."
        actions={
          <>
            <button
              type="button"
              onClick={() => loadPage()}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>

            {user.role === "admin" ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#2d8f98] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#26717c]"
              >
                <Plus className="size-4" />
                Publish update
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <SectionCard
          title="Your live status"
          subtitle="Choose the status you want the rest of the team to see right now."
        >
          <div className="rounded-[26px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,251,250,0.92))] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6e949b]">
              Signed in
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{user.full_name}</p>
            <p className="mt-1 text-sm text-[#4f6f7a]">
              {getRoleLabel(user.role)} - @{user.username}
            </p>

            <OperationStatusSelector
              align="left"
              className="mt-5"
              disabled={isSavingStatus}
              onChange={handleStatusChange}
              options={statusOptions}
              value={user.operation_status}
            />

            <p className="mt-4 text-sm text-[#4f6f7a]">
              Last changed {formatTimestamp(user.operation_status_updated_at)}.
            </p>
          </div>
        </SectionCard>

        <SectionCard
          title="HCM broadcast"
          subtitle="Every update posted by admin appears here for doctors, operators, lab, and finance."
        >
          <div className="rounded-[26px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(145deg,#184f57_0%,#256f78_46%,#359ea7_100%)] px-5 py-5 text-white shadow-[0_24px_70px_rgba(34,72,91,0.18)]">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-white/14 p-3 text-[#ffe189]">
                <BellRing className="size-5" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/88">
                  HCM bulletin
                </p>
                <p className="mt-2 text-lg leading-7 text-white/96">
                  This page is the shared operations newsroom for OCS Medecins. Admin can publish
                  care desk updates here, and every team member can see who is available, active,
                  or offline.
                </p>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          title="Published updates"
          subtitle="Latest HCM posts for the whole operations team."
        >
          {data.posts.length ? (
            <div className="space-y-4">
              {data.posts.map((post) => (
                <article
                  key={post.id}
                  className="rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-slate-50/80 p-5 shadow-[0_12px_30px_rgba(34,72,91,0.05)]"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-xl font-semibold text-slate-950">{post.title}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[#3f6270]">
                        {post.body}
                      </p>
                      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-[#6e949b]">
                        Published by {post.updated_by_name || post.created_by_name || "Admin"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        Updated {formatTimestamp(post.updated_at)}
                      </p>
                    </div>

                    {user.role === "admin" ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(post)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                        >
                          <Pencil className="size-4" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(post)}
                          className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No HCM updates yet"
              description="Once admin publishes the first newsroom update, it will appear here for the whole team."
            />
          )}
        </SectionCard>

        <SectionCard
          title="Team status board"
          subtitle="Live operation status across the active OCS Medecins team."
        >
          <div className="space-y-5">
            {ROLE_ORDER.map((role) => {
              const members = groupedStatuses.get(role) || [];

              if (!members.length) {
                return null;
              }

              return (
                <div key={role}>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6e949b]">
                    {getRoleLabel(role)}
                    {members.length > 1 ? "s" : ""}
                  </p>

                  <div className="mt-3 space-y-3">
                    {members.map((member) => (
                      <div
                        key={member.id}
                        className="rounded-[24px] border border-[rgba(65,200,198,0.14)] bg-slate-50/80 px-4 py-4"
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <p className="font-semibold text-slate-950">{member.full_name}</p>
                            <p className="mt-1 text-sm text-[#4f6f7a]">
                              @{member.username}
                              {member.role === "doctor" && member.doctor_name
                                ? ` - ${member.doctor_name}`
                                : ""}
                            </p>
                            <p className="mt-2 text-sm text-slate-500">
                              Updated {formatTimestamp(member.operation_status_updated_at)}
                            </p>
                          </div>

                          <StatusBadge value={member.operation_status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      <Modal
        open={editorOpen}
        onClose={closeEditorModal}
        title={editor.id ? "Edit HCM update" : "Publish HCM update"}
        description="Write the news bulletin that the whole OCS Medecins team should see."
      >
        <form className="space-y-4" onSubmit={handleSavePost}>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Title</span>
            <input
              required
              type="text"
              value={editor.title}
              onChange={(event) =>
                setEditor((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">Message</span>
            <textarea
              required
              rows={8}
              value={editor.body}
              onChange={(event) =>
                setEditor((current) => ({
                  ...current,
                  body: event.target.value,
                }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
            />
          </label>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeEditorModal}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingPost}
              className="rounded-2xl bg-[#2d8f98] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#26717c] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingPost ? "Saving..." : editor.id ? "Save update" : "Publish update"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          if (!isDeletingPost) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={handleDeletePost}
        title="Delete HCM update?"
        description="This will remove the news post from the shared HCM board for every user."
        confirmLabel={isDeletingPost ? "Deleting..." : "Delete update"}
      />
    </div>
  );
}

export default HcmNewsPage;
