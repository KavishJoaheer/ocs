import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  BookOpen,
  Clock3,
  FileEdit,
  Leaf,
  Mail,
  Newspaper,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";

const EMPTY_STORY = {
  id: null,
  title: "",
  eyebrow: "",
  summary: "",
  body: "",
  category: "update",
  visual_theme: "teal",
  is_featured: false,
  status: "draft",
};

const CATEGORIES = [
  { value: "update", label: "Care update", Icon: Mail },
  { value: "wellbeing", label: "Wellbeing", Icon: Leaf },
  { value: "guide", label: "Health guide", Icon: BookOpen },
  { value: "newsletter", label: "Newsletter", Icon: Newspaper },
];

const THEMES = [
  { value: "teal", label: "Ocean", swatch: "bg-[#2bccc4]" },
  { value: "gold", label: "Sunshine", swatch: "bg-[#f7ba24]" },
  { value: "coral", label: "Warmth", swatch: "bg-[#f29a86]" },
  { value: "indigo", label: "Calm", swatch: "bg-[#6877ad]" },
];

const THEME_GRADIENTS = {
  teal: "from-[#174e50] to-[#2bccc4]",
  gold: "from-[#80600d] to-[#f7ba24]",
  coral: "from-[#803e42] to-[#f29a86]",
  indigo: "from-[#303a68] to-[#8a9bd8]",
};

function readingMinutes(body) {
  const words = String(body || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 210));
}

function StoryPreview({ story, compact = false }) {
  const category = CATEGORIES.find((item) => item.value === story.category) || CATEGORIES[0];
  const Icon = category.Icon;
  return (
    <article className={`overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_12px_36px_rgba(59,89,92,0.08)] ${compact ? "" : "sticky top-5"}`}>
      <div className={`relative grid ${compact ? "h-32" : "h-48"} place-items-center overflow-hidden bg-gradient-to-br ${THEME_GRADIENTS[story.visual_theme] || THEME_GRADIENTS.teal}`}>
        <span className="absolute -right-8 -top-8 size-28 rounded-full border border-white/20 bg-white/10" />
        <span className="absolute -bottom-16 -left-10 size-40 rounded-full border-[22px] border-white/10" />
        <span className="grid size-16 place-items-center rounded-[24px] border border-white/25 bg-white/15 text-white backdrop-blur-sm"><Icon className="size-7" /></span>
      </div>
      <div className={compact ? "p-5" : "p-6"}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#287f86]">{story.eyebrow || category.label}</span>
          {story.is_featured ? <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold uppercase text-amber-700">Featured</span> : null}
        </div>
        <h3 className={`mt-2 font-display font-bold leading-tight text-[#3b595c] ${compact ? "text-lg" : "text-2xl"}`}>{story.title || "Your story title"}</h3>
        <p className={`mt-2 text-slate-500 ${compact ? "line-clamp-2 text-xs leading-5" : "text-sm leading-6"}`}>{story.summary || "A warm, helpful preview will appear here."}</p>
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-[10px] font-semibold text-slate-400">
          <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" /> {readingMinutes(story.body)} min read</span>
          <span className={story.status === "published" ? "text-emerald-600" : "text-amber-600"}>{story.status === "published" ? "Live" : "Draft"}</span>
        </div>
      </div>
    </article>
  );
}

export default function PatientCareContentPage() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.get("/patient-care-content")
      .then((data) => setPosts(data.posts || []))
      .catch((error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => ({
    live: posts.filter((post) => post.status === "published").length,
    drafts: posts.filter((post) => post.status === "draft").length,
  }), [posts]);

  async function saveStory(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const data = editor.id
        ? await api.put(`/patient-care-content/${editor.id}`, editor)
        : await api.post("/patient-care-content", editor);
      setPosts(data.posts || []);
      toast.success(editor.status === "published" ? "Story published to the patient app." : "Draft saved.");
      setEditor(null);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteStory() {
    setDeleting(true);
    try {
      await api.delete(`/patient-care-content/${deleteTarget.id}`);
      setPosts((current) => current.filter((post) => post.id !== deleteTarget.id));
      toast.success("Story removed.");
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient stories"
        description="Turn clinic updates and health advice into stories patients will want to read."
        actions={<button type="button" onClick={() => setEditor({ ...EMPTY_STORY })} className="inline-flex items-center gap-2 rounded-2xl bg-[#2d8f98] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#26717c]"><Plus className="size-4" /> New story</button>}
      />

      <section className="relative overflow-hidden rounded-[28px] bg-[#3b595c] px-6 py-7 text-white shadow-[0_20px_55px_rgba(59,89,92,0.18)] sm:px-8">
        <span className="absolute -right-20 -top-24 size-72 rounded-full bg-[#2bccc4]/25 blur-3xl" />
        <span className="absolute bottom-[-70%] left-[35%] size-72 rounded-full bg-[#f7ba24]/12 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div className="max-w-xl">
            <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#83ddd7]"><Sparkles className="size-3.5" /> OCS Care editorial</p>
            <h2 className="mt-3 font-display text-2xl font-bold tracking-tight">Small stories. Meaningful care.</h2>
            <p className="mt-2 text-sm leading-6 text-white/68">Use a clear headline, one useful idea, and a warm human voice. The patient app handles the visual storytelling.</p>
          </div>
          <div className="flex gap-3">
            <div className="min-w-24 rounded-2xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm"><p className="text-2xl font-bold">{counts.live}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-white/55">Published</p></div>
            <div className="min-w-24 rounded-2xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm"><p className="text-2xl font-bold">{counts.drafts}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-white/55">Drafts</p></div>
          </div>
        </div>
      </section>

      {loading ? <div className="h-64 animate-pulse rounded-[24px] bg-white/70" /> : posts.length ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {posts.map((post) => (
            <div key={post.id} className="group relative">
              <StoryPreview story={post} compact />
              <div className="absolute right-3 top-3 flex gap-1.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                <button type="button" onClick={() => setEditor({ ...post })} aria-label={`Edit ${post.title}`} className="grid size-9 place-items-center rounded-full border border-white/40 bg-white/90 text-slate-600 shadow-sm backdrop-blur hover:text-[#287f86]"><Pencil className="size-4" /></button>
                <button type="button" onClick={() => setDeleteTarget(post)} aria-label={`Delete ${post.title}`} className="grid size-9 place-items-center rounded-full border border-white/40 bg-white/90 text-rose-500 shadow-sm backdrop-blur hover:bg-rose-50"><Trash2 className="size-4" /></button>
              </div>
              <p className="mt-2 px-1 text-[10px] font-medium text-slate-400">Updated {dayjs(post.updated_at).format("D MMM YYYY, HH:mm")}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[28px] border border-dashed border-[#2bccc4]/30 bg-white/80 px-6 py-16 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-[22px] bg-[#d9f6f3] text-[#287f86]"><FileEdit className="size-7" /></span>
          <h2 className="mt-5 font-display text-xl font-bold text-[#3b595c]">Create your first patient story</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Share a welcome note, seasonal health advice, or a short clinic newsletter. You can preview it before publishing.</p>
          <button type="button" onClick={() => setEditor({ ...EMPTY_STORY })} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#2d8f98] px-5 py-3 text-sm font-bold text-white"><Plus className="size-4" /> Start writing</button>
        </div>
      )}

      <Modal open={Boolean(editor)} onClose={() => !saving && setEditor(null)} title={editor?.id ? "Edit patient story" : "Create patient story"} description="Write once; the patient app turns it into a beautiful reading experience." size="xl" innerScroll={false}>
        {editor ? (
          <form onSubmit={saveStory} className="grid max-h-[min(78vh,760px)] gap-6 overflow-y-auto pr-1 lg:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <label className="block"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Headline</span><input required maxLength={140} value={editor.title} onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))} placeholder="A clear, inviting title" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-[#2d8f98]" /></label>
              <label className="block"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Small label <span className="font-medium normal-case tracking-normal text-slate-400">(optional)</span></span><input maxLength={60} value={editor.eyebrow} onChange={(event) => setEditor((current) => ({ ...current, eyebrow: event.target.value }))} placeholder="e.g. A note for this season" className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-[#2d8f98]" /></label>
              <label className="block"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Preview</span><textarea required maxLength={280} rows={3} value={editor.summary} onChange={(event) => setEditor((current) => ({ ...current, summary: event.target.value }))} placeholder="One or two sentences that make patients want to keep reading." className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 leading-6 outline-none focus:border-[#2d8f98]" /><span className="mt-1 block text-right text-[10px] text-slate-400">{editor.summary.length}/280</span></label>
              <label className="block"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Story</span><textarea required rows={10} value={editor.body} onChange={(event) => setEditor((current) => ({ ...current, body: event.target.value }))} placeholder={"Write in short, friendly paragraphs.\n\nLeave a blank line between paragraphs for a calm reading rhythm."} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 leading-7 outline-none focus:border-[#2d8f98]" /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Format</span><select value={editor.category} onChange={(event) => setEditor((current) => ({ ...current, category: event.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-[#2d8f98]">{CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label className="block"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Status</span><select value={editor.status} onChange={(event) => setEditor((current) => ({ ...current, status: event.target.value }))} className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-[#2d8f98]"><option value="draft">Save as draft</option><option value="published">Publish now</option></select></label>
              </div>
              <div><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Visual mood</span><div className="mt-2 flex flex-wrap gap-2">{THEMES.map((theme) => <button key={theme.value} type="button" onClick={() => setEditor((current) => ({ ...current, visual_theme: theme.value }))} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${editor.visual_theme === theme.value ? "border-[#2d8f98] bg-[#2d8f98]/8 text-[#2d8f98]" : "border-slate-200 text-slate-500"}`}><span className={`size-3 rounded-full ${theme.swatch}`} />{theme.label}</button>)}</div></div>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"><input type="checkbox" checked={editor.is_featured} onChange={(event) => setEditor((current) => ({ ...current, is_featured: event.target.checked }))} className="mt-0.5 size-4 accent-[#2d8f98]" /><span><span className="block text-sm font-bold text-slate-700">Feature this story</span><span className="mt-1 block text-xs leading-5 text-slate-500">Place it in the large lead card. Publishing a new featured story replaces the previous one.</span></span></label>
              <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={() => setEditor(null)} disabled={saving} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600">Cancel</button><button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-[#2d8f98] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">{editor.status === "published" ? <Send className="size-4" /> : <FileEdit className="size-4" />}{saving ? "Saving..." : editor.status === "published" ? "Publish story" : "Save draft"}</button></div>
            </div>
            <div><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Live preview</p><StoryPreview story={editor} /></div>
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} onConfirm={deleteStory} title="Delete this patient story?" description="It will disappear from the patient app immediately and cannot be recovered." confirmLabel={deleting ? "Deleting..." : "Delete story"} />
    </div>
  );
}
