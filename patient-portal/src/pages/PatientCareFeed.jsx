import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  Clock3,
  HeartPulse,
  Leaf,
  MailOpen,
  Newspaper,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";

const FILTERS = [
  { value: "all", label: "For you" },
  { value: "update", label: "Updates" },
  { value: "wellbeing", label: "Wellbeing" },
  { value: "guide", label: "Guides" },
  { value: "newsletter", label: "Newsletters" },
  { value: "saved", label: "Saved" },
];

const CATEGORY_META = {
  update: { label: "Care update", Icon: HeartPulse },
  wellbeing: { label: "Wellbeing", Icon: Leaf },
  guide: { label: "Health guide", Icon: ShieldCheck },
  newsletter: { label: "OCS newsletter", Icon: Newspaper },
};

const THEME_META = {
  teal: {
    surface: "from-[#174e50] via-[#1b7776] to-[#2bccc4]",
    soft: "from-[#d9f6f3] to-[#f4faf9]",
    ink: "text-[#174e50]",
    chip: "bg-[#d9f6f3] text-[#1d6f70]",
  },
  gold: {
    surface: "from-[#80600d] via-[#c28d12] to-[#f7ba24]",
    soft: "from-[#fff1c7] to-[#fffaf0]",
    ink: "text-[#71520a]",
    chip: "bg-[#fff0c2] text-[#80600d]",
  },
  coral: {
    surface: "from-[#803e42] via-[#c86767] to-[#f29a86]",
    soft: "from-[#ffe2db] to-[#fff7f4]",
    ink: "text-[#7b3d42]",
    chip: "bg-[#ffe2db] text-[#934b4b]",
  },
  indigo: {
    surface: "from-[#303a68] via-[#55649a] to-[#8a9bd8]",
    soft: "from-[#e4e9ff] to-[#f8f9ff]",
    ink: "text-[#37416f]",
    chip: "bg-[#e4e9ff] text-[#45517f]",
  },
};

function themeFor(post) {
  return THEME_META[post.visual_theme] || THEME_META.teal;
}

function CategoryIcon({ post, className = "size-5" }) {
  const Icon = CATEGORY_META[post.category]?.Icon || Sparkles;
  return <Icon className={className} strokeWidth={1.8} />;
}

function StoryArt({ post, featured = false }) {
  const theme = themeFor(post);
  return (
    <div className={`care-story-art relative overflow-hidden bg-gradient-to-br ${theme.surface} ${featured ? "h-full min-h-[260px]" : "h-44"}`}>
      <div className="absolute -right-10 -top-10 size-36 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm" />
      <div className="absolute -bottom-16 -left-10 size-48 rounded-full border-[26px] border-white/10" />
      <div className="absolute left-[58%] top-[52%] size-24 -translate-y-1/2 rotate-12 rounded-[30px] bg-white/10 shadow-[0_22px_50px_rgba(0,0,0,0.12)] backdrop-blur-md" />
      <div className="absolute inset-0 grid place-items-center">
        <span className={`${featured ? "size-24" : "size-16"} grid place-items-center rounded-[28px] border border-white/25 bg-white/16 text-white shadow-[0_20px_50px_rgba(0,0,0,0.16)] backdrop-blur-xl`}>
          <CategoryIcon post={post} className={featured ? "size-10" : "size-7"} />
        </span>
      </div>
    </div>
  );
}

function SaveButton({ post, onToggle, light = false }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(post);
      }}
      aria-label={post.is_saved ? "Remove from saved stories" : "Save this story"}
      className={`grid size-10 shrink-0 place-items-center rounded-full border transition active:scale-95 ${
        light
          ? "border-white/20 bg-white/12 text-white hover:bg-white/20"
          : post.is_saved
            ? "border-[#2bccc4]/30 bg-[#d9f6f3] text-[#1f7777]"
            : "border-slate-200 bg-white text-slate-500 hover:border-[#2bccc4]/50 hover:text-[#1f7777]"
      }`}
    >
      <Bookmark className="size-[18px]" fill={post.is_saved ? "currentColor" : "none"} strokeWidth={1.8} />
    </button>
  );
}

function FeaturedStory({ post, onOpen, onToggleSave }) {
  const theme = themeFor(post);
  return (
    <article
      onClick={() => onOpen(post)}
      className="group grid cursor-pointer overflow-hidden rounded-[30px] border border-white/80 bg-white shadow-[0_20px_55px_rgba(59,89,92,0.12)] transition hover:-translate-y-1 hover:shadow-[0_24px_64px_rgba(59,89,92,0.17)] lg:grid-cols-[1.08fr_0.92fr]"
    >
      <div className="order-2 flex flex-col justify-center p-6 sm:p-9 lg:order-1 lg:p-11">
        <div className="flex items-center justify-between gap-4">
          <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${theme.chip}`}>
            <Sparkles className="size-3.5" /> Featured for you
          </span>
          <SaveButton post={post} onToggle={onToggleSave} />
        </div>
        <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
          {post.eyebrow || CATEGORY_META[post.category]?.label}
        </p>
        <h2 className="mt-2 font-display text-[1.8rem] font-bold leading-[1.08] tracking-tight text-[#304d50] sm:text-[2.35rem]">
          {post.title}
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-7 text-slate-600">{post.summary}</p>
        <div className="mt-7 flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-400">
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-4" /> {post.read_minutes} min read</span>
          <span>{dayjs(post.published_at).format("D MMMM")}</span>
          {!post.is_read ? <span className="rounded-full bg-[#f7ba24]/20 px-2.5 py-1 text-[#80600d]">New</span> : null}
        </div>
        <button type="button" className={`mt-7 inline-flex w-fit items-center gap-2 text-sm font-bold ${theme.ink}`}>
          Read the story <ArrowUpRight className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </button>
      </div>
      <div className="order-1 min-h-[240px] lg:order-2">
        <StoryArt post={post} featured />
      </div>
    </article>
  );
}

function StoryCard({ post, onOpen, onToggleSave }) {
  const theme = themeFor(post);
  return (
    <article
      onClick={() => onOpen(post)}
      className="group cursor-pointer overflow-hidden rounded-[26px] border border-white/90 bg-white shadow-[0_12px_38px_rgba(59,89,92,0.08)] transition hover:-translate-y-1 hover:shadow-[0_18px_48px_rgba(59,89,92,0.14)]"
    >
      <StoryArt post={post} />
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${theme.chip}`}>
            <CategoryIcon post={post} className="size-3.5" />
            {CATEGORY_META[post.category]?.label}
          </span>
          <SaveButton post={post} onToggle={onToggleSave} />
        </div>
        <h3 className="mt-5 font-display text-xl font-bold leading-tight tracking-tight text-[#304d50] transition group-hover:text-[#1f7777]">{post.title}</h3>
        <p className="mt-3 line-clamp-3 text-[13px] leading-6 text-slate-500">{post.summary}</p>
        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-[11px] font-semibold text-slate-400">
          <span>{post.read_minutes} min read</span>
          <span className="inline-flex items-center gap-1.5">
            {post.is_read ? <><Check className="size-3.5 text-[#2bccc4]" /> Read</> : dayjs(post.published_at).format("D MMM")}
          </span>
        </div>
      </div>
    </article>
  );
}

function ArticleReader({ post, onClose, onToggleSave }) {
  if (!post) return null;
  const theme = themeFor(post);
  const paragraphs = String(post.body || "").split(/\n\s*\n/).filter(Boolean);
  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-[#f4faf9]" role="dialog" aria-modal="true" aria-label={post.title}>
      <div className="sticky top-0 z-20 border-b border-white/70 bg-white/85 px-4 py-3 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-bold text-[#3b595c] hover:bg-slate-100">
            <ArrowLeft className="size-5" /> Back
          </button>
          <SaveButton post={post} onToggle={onToggleSave} />
          <button type="button" onClick={onClose} aria-label="Close story" className="hidden size-11 place-items-center rounded-full text-slate-500 hover:bg-slate-100 sm:grid">
            <X className="size-5" />
          </button>
        </div>
      </div>
      <article className="mx-auto max-w-3xl px-5 pb-24 pt-7 sm:px-8 sm:pt-12">
        <div className={`overflow-hidden rounded-[30px] bg-gradient-to-br ${theme.surface} p-7 text-white shadow-[0_22px_60px_rgba(59,89,92,0.18)] sm:p-11`}>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/12 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] backdrop-blur-sm">
            <CategoryIcon post={post} className="size-3.5" /> {CATEGORY_META[post.category]?.label}
          </span>
          <p className="mt-8 text-[11px] font-bold uppercase tracking-[0.2em] text-white/65">{post.eyebrow || "From your OCS care team"}</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-[1.08] tracking-tight sm:text-5xl">{post.title}</h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-7 text-white/78">{post.summary}</p>
          <div className="mt-8 flex items-center gap-4 text-xs font-semibold text-white/65">
            <span>{post.read_minutes} min read</span><span>•</span><span>{dayjs(post.published_at).format("D MMMM YYYY")}</span>
          </div>
        </div>
        <div className="mx-auto max-w-2xl py-10 sm:py-14">
          {paragraphs.map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 20)}`} className={`${index === 0 ? "first-letter:float-left first-letter:mr-2 first-letter:font-display first-letter:text-6xl first-letter:font-bold first-letter:leading-[0.85] first-letter:text-[#2bccc4]" : "mt-6"} text-[16px] leading-8 text-slate-600 sm:text-[17px]`}>
              {paragraph}
            </p>
          ))}
          <div className="mt-12 rounded-[24px] border border-[#2bccc4]/20 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#d9f6f3] text-[#1d7777]"><HeartPulse className="size-5" /></span>
              <div>
                <h2 className="font-display text-base font-bold text-[#3b595c]">A note from your care team</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">This article is for general education and does not replace advice from your doctor. Contact OCS if something about your health is worrying you.</p>
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

function EmptyFeed({ filter }) {
  return (
    <div className="rounded-[28px] border border-dashed border-[#2bccc4]/35 bg-white/75 px-6 py-16 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-[22px] bg-[#d9f6f3] text-[#1f7777]"><MailOpen className="size-7" /></span>
      <h2 className="mt-5 font-display text-xl font-bold text-[#3b595c]">{filter === "saved" ? "Your reading list is ready" : "Fresh stories are on the way"}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{filter === "saved" ? "Tap the bookmark on any article to keep it here for later." : "Your OCS care team will share useful health notes, clinic news, and practical guides here."}</p>
    </div>
  );
}

export default function PatientCareFeed() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [activePost, setActivePost] = useState(null);

  useEffect(() => {
    let ignore = false;
    api.get("/patient-portal/care-feed")
      .then((data) => { if (!ignore) setPosts(data.posts || []); })
      .catch((error) => { if (!ignore) toast.error(error.message); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, []);

  useEffect(() => () => {
    document.body.style.overflow = "";
  }, []);

  const visiblePosts = useMemo(() => {
    if (filter === "all") return posts;
    if (filter === "saved") return posts.filter((post) => post.is_saved);
    return posts.filter((post) => post.category === filter);
  }, [filter, posts]);

  const featured = visiblePosts.find((post) => post.is_featured) || (filter === "all" ? visiblePosts[0] : null);
  const remaining = visiblePosts.filter((post) => post.id !== featured?.id);

  async function openStory(post) {
    setActivePost({ ...post, is_read: true });
    setPosts((current) => current.map((item) => item.id === post.id ? { ...item, is_read: true } : item));
    document.body.style.overflow = "hidden";
    try { await api.post(`/patient-portal/care-feed/${post.id}/read`); } catch { /* Keep reading available offline. */ }
  }

  function closeStory() {
    setActivePost(null);
    document.body.style.overflow = "";
  }

  async function toggleSave(post) {
    const nextSaved = !post.is_saved;
    setPosts((current) => current.map((item) => item.id === post.id ? { ...item, is_saved: nextSaved } : item));
    setActivePost((current) => current?.id === post.id ? { ...current, is_saved: nextSaved } : current);
    try {
      const result = await api.post(`/patient-portal/care-feed/${post.id}/save`);
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, is_saved: result.saved } : item));
      setActivePost((current) => current?.id === post.id ? { ...current, is_saved: result.saved } : current);
      toast.success(result.saved ? "Saved for later" : "Removed from saved stories");
    } catch (error) {
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, is_saved: post.is_saved } : item));
      toast.error(error.message);
    }
  }

  return (
    <div className="min-h-[calc(100dvh-6rem)] px-[var(--native-pad-screen)] pb-8 pt-5 lg:px-12 lg:pb-14 lg:pt-10">
      <div className="mx-auto max-w-6xl">
        <header className="animate-fade-in-up">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#2b8f91]"><Sparkles className="size-3.5" /> From your care team</div>
          <div className="mt-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h1 className="font-display text-[2.15rem] font-bold leading-none tracking-tight text-[#304d50] sm:text-5xl">Better health, one story at a time.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">Thoughtful notes, practical advice, and clinic updates—curated by the people who care for you.</p>
            </div>
            {posts.some((post) => !post.is_read) ? <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#f7ba24]/16 px-3 py-1.5 text-[11px] font-bold text-[#80600d]"><span className="size-2 rounded-full bg-[#f7ba24]" /> {posts.filter((post) => !post.is_read).length} new</span> : null}
          </div>
        </header>

        <div className="-mx-[var(--native-pad-screen)] mt-7 overflow-x-auto px-[var(--native-pad-screen)] pb-2 lg:mx-0 lg:px-0">
          <div className="flex min-w-max gap-2">
            {FILTERS.map((item) => (
              <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`rounded-full px-4 py-2.5 text-xs font-bold transition ${filter === item.value ? "bg-[#3b595c] text-white shadow-[0_8px_20px_rgba(59,89,92,0.2)]" : "border border-[#2bccc4]/16 bg-white/80 text-slate-500 hover:bg-white"}`}>
                {item.label}{item.value === "saved" && posts.some((post) => post.is_saved) ? ` · ${posts.filter((post) => post.is_saved).length}` : ""}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="mt-7 grid gap-5 lg:grid-cols-3"><div className="h-[430px] animate-pulse rounded-[30px] bg-white/70 lg:col-span-3" /></div>
        ) : visiblePosts.length ? (
          <div className="mt-6">
            {featured ? <FeaturedStory post={featured} onOpen={openStory} onToggleSave={toggleSave} /> : null}
            {remaining.length ? <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{remaining.map((post) => <StoryCard key={post.id} post={post} onOpen={openStory} onToggleSave={toggleSave} />)}</div> : null}
          </div>
        ) : <div className="mt-6"><EmptyFeed filter={filter} /></div>}
      </div>
      <ArticleReader post={activePost} onClose={closeStory} onToggleSave={toggleSave} />
    </div>
  );
}
