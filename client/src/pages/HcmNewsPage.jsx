import { useCallback, useEffect, useState } from "react";
import dayjs from "dayjs";
import { History, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";

const EMPTY_EDITOR = {
  id: null,
  title: "",
  body: "",
};

function formatTimestamp(value) {
  if (!value) {
    return "Not updated yet";
  }

  return dayjs(value).format("MMM D, YYYY [at] h:mm A");
}

function HcmNewsPage() {
  const { user, hcmUnreadCount, refreshHcmUnreadCount } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(EMPTY_EDITOR);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isSavingPost, setIsSavingPost] = useState(false);
  const [isDeletingPost, setIsDeletingPost] = useState(false);
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

    async function markBoardRead() {
      if (user.role === "admin") {
        return;
      }

      try {
        await api.post("/hcm-news/mark-read");
        if (!ignore) {
          await refreshHcmUnreadCount({ silent: true });
        }
      } catch {
        // Keep the page usable even if the read marker update fails.
      }
    }

    if (data) {
      markBoardRead();
    }

    return () => {
      ignore = true;
    };
  }, [data, refreshHcmUnreadCount, user.role]);

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

  function openCreateModal() { setEditor(EMPTY_EDITOR); }
  function openEditModal(post) { setEditor({ id: post.id, title: post.title, body: post.body }); }

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
                Publish a News
              </button>
            ) : null}
          </>
        }
      />
      {user.role !== "admin" ? (
        <SectionCard title="Published News" subtitle="Latest HCM posts for all care coordination staff.">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-2xl bg-[#2d8f98] px-4 py-2.5 text-sm font-semibold text-white"
          >
            <History className="size-4" />
            Read Published News
          </button>
        </SectionCard>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
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
          title={user.role === "admin" ? "Publish workspace" : "Published History"}
          subtitle={
            user.role === "admin"
              ? "Draft and edit current HCM update before publishing."
              : "Archived HCM posts older than 7 days."
          }
        >
          {user.role === "admin" ? (
            <form className="space-y-3" onSubmit={handleSavePost}>
              <input
                required
                placeholder="News title"
                value={editor.title}
                onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none"
              />
              <textarea
                required
                rows={10}
                placeholder="Write and edit current published news..."
                value={editor.body}
                onChange={(event) => setEditor((current) => ({ ...current, body: event.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingPost}
                  className="rounded-2xl bg-[#2d8f98] px-4 py-2.5 text-sm font-semibold text-white"
                >
                  {isSavingPost ? "Saving..." : "Publish a News"}
                </button>
              </div>
            </form>
          ) : null}

          {(data.history || []).length ? (
            <div className="space-y-3">
              {(data.history || []).map((post) => (
                <article key={`history-${post.id}`} className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="font-semibold text-slate-900">{post.title}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{post.body}</p>
                  <p className="mt-2 text-xs text-slate-500">Archived {formatTimestamp(post.updated_at)}</p>
                  {user.role === "admin" ? (
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => openEditModal(post)} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">Edit</button>
                      <button type="button" onClick={() => setDeleteTarget(post)} className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600">Delete</button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </SectionCard>
      </div>

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
