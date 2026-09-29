import { useEffect, useState } from "react";
import { BellRing, ChevronDown, Link2, X } from "lucide-react";
import toast from "react-hot-toast";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { getPatientLinkState } from "../lib/patientAccountLink.js";
import { CLINIC_TEL, CLINIC_TEL_DISPLAY } from "../lib/clinicContact.js";
import {
  PushPermissionDeniedError,
  dismissPushBanner,
  fetchPushConfiguration,
  getPushPermissionState,
  isPushBannerDismissed,
  isPushSupported,
  subscribeToPushNotifications,
} from "../lib/pushNotifications.js";

const LINK_COPY = {
  unlinked: {
    title: "Account not linked to your clinic record",
    body: "Call with your National ID so we can connect your account to your OCS patient file.",
  },
  pending_review: {
    title: "Clinic link pending confirmation",
    body: "We matched your clinic record. The OCS team will confirm the link shortly.",
  },
  self_registered: {
    title: "Clinic record needs to be merged",
    body: "Call with your National ID to merge this with your official record.",
  },
  pending: {
    title: "Clinic record not fully verified",
    body: "Call the clinic so the OCS team can finish preparing your account.",
  },
};

function PatientAttentionCenter({ className = "" }) {
  const { user } = usePatientAuth();
  const [pushVisible, setPushVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const linkState = getPatientLinkState(user);
  const linkNotice = user && linkState !== "verified" ? LINK_COPY[linkState] || LINK_COPY.pending : null;

  useEffect(() => {
    let cancelled = false;

    async function evaluatePush() {
      if (!isPushSupported() || isPushBannerDismissed()) {
        if (!cancelled) setPushVisible(false);
        return;
      }

      const [{ configured }, permission] = await Promise.all([
        fetchPushConfiguration(),
        getPushPermissionState(),
      ]);

      if (!cancelled) {
        // A blocked permission is explained in Profile instead of occupying every page.
        setPushVisible(configured && permission === "default");
      }
    }

    void evaluatePush();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!linkNotice && !pushVisible) return null;

  async function handleEnable() {
    setIsEnabling(true);
    try {
      await subscribeToPushNotifications();
      toast.success("Care updates enabled.");
      setPushVisible(false);
      setExpanded(false);
    } catch (error) {
      if (error instanceof PushPermissionDeniedError) {
        setPushVisible(false);
        toast("Notifications are blocked. You can review this in Profile.");
      } else {
        toast.error(error?.message || "Could not enable notifications.");
      }
    } finally {
      setIsEnabling(false);
    }
  }

  function dismissNotifications() {
    dismissPushBanner();
    setPushVisible(false);
    setExpanded(false);
  }

  return (
    <section
      aria-label="Needs your attention"
      className={[
        "overflow-hidden rounded-2xl border bg-white/90",
        linkNotice ? "border-brand-gold/35" : "border-brand-teal/20",
        className,
      ].join(" ")}
    >
      {linkNotice ? (
        <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-gold/18 text-brand-dark-grey">
            <Link2 className="size-4.5" strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-[#9a7413] sm:tracking-[0.16em]">
                Needs attention
              </p>
              {pushVisible ? (
                <button
                  type="button"
                  onClick={() => setExpanded((open) => !open)}
                  aria-expanded={expanded}
                  className="inline-flex min-h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-brand-teal/8 px-3 text-[11px] font-bold text-[#2d7778]"
                >
                  {expanded ? "Show less" : "1 more"}
                  <ChevronDown className={`size-3.5 transition ${expanded ? "rotate-180" : ""}`} />
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-sm font-bold text-brand-dark-grey">{linkNotice.title}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-brand-cool-grey">
              {linkNotice.body}{" "}
              <a href={`tel:${CLINIC_TEL}`} className="font-semibold text-brand-teal underline-offset-2 hover:underline">
                Call {CLINIC_TEL_DISPLAY}
              </a>
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-teal/10 text-brand-teal">
              <BellRing className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-dark-grey">Stay connected to your care</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-brand-cool-grey">Enable visit alerts and new Care Stories.</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={handleEnable}
              disabled={isEnabling}
              className="rounded-full bg-brand-teal px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
            >
              {isEnabling ? "Enabling…" : "Enable alerts"}
            </button>
            <button type="button" onClick={dismissNotifications} aria-label="Dismiss notification reminder" className="rounded-full p-2 text-brand-cool-grey hover:bg-brand-teal/8">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {linkNotice && pushVisible && expanded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-brand-teal/10 bg-brand-teal/5 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-brand-teal">
              <BellRing className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-brand-dark-grey">Stay connected to your care</p>
              <p className="text-[12px] leading-relaxed text-brand-cool-grey">Enable visit alerts and new Care Stories.</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={handleEnable} disabled={isEnabling} className="rounded-full bg-brand-teal px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
              {isEnabling ? "Enabling…" : "Enable alerts"}
            </button>
            <button type="button" onClick={dismissNotifications} aria-label="Dismiss notification reminder" className="rounded-full p-2 text-brand-cool-grey hover:bg-white">
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default PatientAttentionCenter;
