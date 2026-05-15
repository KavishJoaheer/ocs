import { useCallback, useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { cx } from "../lib/utils.js";

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

function toExcerpt(text, maxLength = 180) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function mergePostsChronologically(posts = [], history = []) {
  const byId = new Map();

  [...posts, ...history].forEach((post) => {
    byId.set(String(post.id), post);
  });

  return Array.from(byId.values()).sort(
    (first, second) => new Date(second.updated_at || 0) - new Date(first.updated_at || 0),
  );
}

function isRecentHighlight(post, index) {
  if (index !== 0 || !post?.updated_at) {
    return false;
  }

  return dayjs().diff(dayjs(post.updated_at), "hour") < 24;
}

function NewsPostCard({ post, index, user, onView, onEdit, onDelete }) {
  const highlighted = isRecentHighlight(post, index);
  const isArchived = post.status === "archived";

  return (
    <article
      className={cx(
        "rounded-[24px] border bg-white/90 p-5 transition",
        highlighted
          ? "border-l-4 border-l-[#2d8f98] border-slate-200/80 shadow-[0_12px_30px_rgba(45,143,152,0.08)]"
          : "border-slate-200/80",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-950">{post.title}</h3>
            {highlighted ? (
              <span className="rounded-full bg-[#2d8f98]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#2d8f98]">
                New
              </span>
            ) : null}
            {isArchived ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Archived
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-7 text-[#3f6270]">{toExcerpt(post.body)}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#6e949b]">
            {post.updated_by_name || post.created_by_name || "Admin"}
            <span className="mx-2 text-slate-300">·</span>
            {formatTimestamp(post.updated_at)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onView(post)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:text-sky-700"
        >
          <Eye className="size-3.5" />
          View
        </button>
        {user.role === "admin" ? (
          <>
            <button
              type="button"
              onClick={() => onEdit(post)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300"
            >
              <Pencil className="size-3.5" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(post)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function HcmNewsPage() {
  const { user, refreshHcmUnreadCount } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isSavingPost, setIsSavingPost] = useState(false);
  const [isDeletingPost, setIsDeletingPost] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewPost, setViewPost] = useState(null);

  const feedPosts = useMemo(
    () => (data ? mergePostsChronologically(data.posts, data.history) : []),
    [data],
  );

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

  function openCreateModal() {
    setEditor(EMPTY_EDITOR);
  }

  function openEditModal(post) {
    setEditor({ id: post.id, title: post.title, body: post.body });
  }

  function closeEditorModal() {
    if (!isSavingPost) {
      setEditor(null);
    }
  }

  async function handleSavePost(event) {
    event.preventDefault();
    if (!editor) {
      return;
    }

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
      setEditor(null);
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

  const isEditing = Boolean(editor?.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Health care manager"
        title="HCM news board"
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
                + New Update
              </button>
            ) : null}
          </>
        }
      />

      {feedPosts.length ? (
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {feedPosts.map((post, index) => (
            <NewsPostCard
              key={post.id}
              post={post}
              index={index}
              user={user}
              onView={setViewPost}
              onEdit={openEditModal}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No HCM updates yet"
          description="Once admin publishes the first update, it will appear here for the whole team."
        />
      )}

      <Modal
        open={Boolean(editor)}
        onClose={closeEditorModal}
        title={isEditing ? "Edit HCM update" : "New HCM update"}
        description={
          isEditing
            ? "Update the announcement shown on the team news board."
            : "Publish a team-wide announcement for all care coordination staff."
        }
        size="lg"
        innerScroll={false}
      >
        <form className="flex max-h-[min(72vh,640px)] flex-col" onSubmit={handleSavePost}>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <input
              required
              placeholder="News title"
              value={editor?.title ?? ""}
              onChange={(event) =>
                setEditor((current) => ({ ...current, title: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-[#2d8f98]"
            />
            <textarea
              required
              rows={12}
              placeholder="Write the announcement..."
              value={editor?.body ?? ""}
              onChange={(event) =>
                setEditor((current) => ({ ...current, body: event.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-[#2d8f98]"
            />
          </div>
          <div className="mt-4 flex shrink-0 justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={closeEditorModal}
              disabled={isSavingPost}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingPost}
              className="rounded-2xl bg-[#2d8f98] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#26717c] disabled:opacity-60"
            >
              {isSavingPost ? "Saving..." : isEditing ? "Save changes" : "Publish update"}
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

      <Modal
        open={Boolean(viewPost)}
        onClose={() => setViewPost(null)}
        title={viewPost?.title || "HCM Update"}
        description={viewPost ? `Published ${formatTimestamp(viewPost.updated_at)}` : ""}
        size="lg"
      >
        <div className="space-y-4">
          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{viewPost?.body}</p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setViewPost(null)}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default HcmNewsPage;
