import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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

function mergePostsChronologically(posts = [], history = []) {
  const byId = new Map();

  [...posts, ...history].forEach((post) => {
    byId.set(String(post.id), post);
  });

  return Array.from(byId.values()).sort(
    (first, second) => new Date(second.updated_at || 0) - new Date(first.updated_at || 0),
  );
}

function isPostNew(post) {
  if (!post?.created_at) {
    return false;
  }
  return dayjs().diff(dayjs(post.created_at), "hour") < 48;
}

function toDisplayAuthorName(name) {
  const raw = String(name || "").trim();
  if (!raw) {
    return "Admin";
  }
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

function NewsPostCard({ post, user, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const [prevExpanded, setPrevExpanded] = useState(expanded);
  const bodyRef = useRef(null);
  const isNew = isPostNew(post);

  if (expanded !== prevExpanded) {
    setPrevExpanded(expanded);
    if (expanded) {
      setIsTruncated(false);
    }
  }

  useLayoutEffect(() => {
    if (expanded) {
      return undefined;
    }
    const el = bodyRef.current;
    if (!el) {
      return undefined;
    }
    const id = requestAnimationFrame(() => {
      const node = bodyRef.current;
      if (!node) {
        return;
      }
      setIsTruncated(node.scrollHeight > node.clientHeight + 1);
    });
    return () => cancelAnimationFrame(id);
  }, [post.body, expanded]);

  const authorLabel = toDisplayAuthorName(post.updated_by_name || post.created_by_name);

  return (
    <article className="rounded-[24px] border border-slate-200/80 bg-white/90 p-5 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-950">{post.title}</h3>
          {isNew ? (
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-800">
              NEW
            </span>
          ) : null}
        </div>
        <time
          className="shrink-0 text-xs font-medium text-gray-500"
          dateTime={post.updated_at || post.created_at}
        >
          {formatTimestamp(post.updated_at)}
        </time>
      </div>

      <div className="mt-3">
        <p
          ref={bodyRef}
          className={cx(
            "whitespace-pre-wrap break-words text-[15px] leading-[1.65] text-slate-700",
            !expanded && "line-clamp-4",
          )}
        >
          {post.body || ""}
        </p>
        {isTruncated || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-2 text-xs font-medium text-teal-700 underline-offset-2 hover:text-teal-900 hover:underline"
          >
            {expanded ? "Show less" : "Read more..."}
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-xs font-medium text-gray-500">{authorLabel}</p>

      <div className="mt-4 flex flex-wrap gap-2">
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
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {feedPosts.map((post) => (
            <NewsPostCard
              key={post.id}
              post={post}
              user={user}
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

    </div>
  );
}

export default HcmNewsPage;
