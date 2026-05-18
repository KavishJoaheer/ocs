import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cx } from "../lib/utils.js";

function getDismissKey(postId) {
  return `ocs_hcm_bulletin_dismissed_${postId}`;
}

function isBulletinDismissed(postId) {
  return window.localStorage.getItem(getDismissKey(postId)) === "1";
}

function HcmBulletinBanner({ post }) {
  const [visible, setVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!post?.id) {
      setVisible(false);
      return;
    }

    setVisible(!isBulletinDismissed(post.id));
  }, [post?.id]);

  if (!visible || !post) {
    return null;
  }

  function handleDismiss() {
    setIsClosing(true);
    window.setTimeout(() => {
      window.localStorage.setItem(getDismissKey(post.id), "1");
      setVisible(false);
      setIsClosing(false);
    }, 280);
  }

  const preview =
    String(post.body || "")
      .trim()
      .split(/\n+/)
      .find((line) => line.trim()) || "Tap to read the full management update.";

  return (
    <div
      className={cx(
        "relative mb-4 flex items-start gap-3 overflow-hidden rounded-2xl border border-amber-100/70 bg-amber-50 p-4 transition-all duration-300 ease-in-out",
        isClosing ? "hcm-banner-slide-out pointer-events-none" : "hcm-banner-fade-in",
      )}
      role="status"
    >
      <span className="mt-0.5 shrink-0 text-base" aria-hidden>
        📢
      </span>
      <div className="min-w-0 flex-1 pr-4">
        <div className="mb-0.5 text-xs font-bold uppercase tracking-wider text-amber-900">
          Latest Management Update
        </div>
        <p className="text-xs font-medium leading-normal text-amber-800">{post.title}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-normal text-amber-800/90">{preview}</p>
        <Link
          to="/hcm-news"
          className="mt-2 inline-flex text-xs font-semibold text-amber-900 underline decoration-amber-300 underline-offset-2"
        >
          Read full notice
        </Link>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-3 top-3 p-1 text-sm text-amber-400 transition hover:text-amber-700"
        aria-label="Dismiss bulletin"
      >
        ✕
      </button>
    </div>
  );
}

export default HcmBulletinBanner;

export function isHcmPostWithinBulletinWindow(post) {
  if (!post?.id) {
    return false;
  }

  const timestamp = post.created_at || post.updated_at;
  if (!timestamp) {
    return false;
  }

  const createdMs = new Date(timestamp).getTime();
  if (Number.isNaN(createdMs)) {
    return false;
  }

  const hoursSince = (Date.now() - createdMs) / (1000 * 60 * 60);
  return hoursSince <= 48;
}
