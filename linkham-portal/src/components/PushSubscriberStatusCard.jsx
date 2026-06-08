import { useEffect, useState } from "react";
import { BellRing, BellOff } from "lucide-react";
import toast from "react-hot-toast";
import LoadingState from "./LoadingState.jsx";
import SectionCard from "./SectionCard.jsx";
import { api } from "../lib/api.js";
import { cx } from "../lib/utils.js";

const ROLE_LABELS = {
  admin: "Admin",
  doctor: "Doctor",
  operator: "Operator",
  accountant: "Accountant",
  lab_tech: "Lab tech",
};

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function PushSubscriberStatusCard() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      setLoading(true);

      try {
        const data = await api.get("/push/subscriber-status");
        if (!cancelled) {
          setStatus(data);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error.message || "Could not load notification status.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <LoadingState label="Loading notification status" />;
  }

  if (!status) {
    return null;
  }

  const { configured, summary, subscribers } = status;
  const enabledCount = Number(summary?.enabled || 0);
  const totalCount = Number(summary?.total || 0);
  const roleBreakdown = Object.entries(summary?.by_role || {});

  return (
    <SectionCard
      title="Mobile & desktop alerts"
      subtitle="See which team accounts have turned on push notifications on at least one device."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3">
          <div
            className={cx(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
            )}
          >
            <BellRing className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">
              {configured ? "Push service is configured" : "Push service is not configured"}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {enabledCount} of {totalCount} team {totalCount === 1 ? "account has" : "accounts have"}{" "}
              notifications enabled.
            </p>
            {roleBreakdown.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {roleBreakdown.map(([role, counts]) => (
                  <span
                    key={role}
                    className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
                  >
                    {roleLabel(role)}: {counts.enabled}/{counts.total}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {subscribers.length ? (
          <div className="overflow-hidden rounded-[24px] border border-slate-200/80">
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white text-left">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Name</th>
                    <th className="px-5 py-4">Role</th>
                    <th className="px-5 py-4">Username</th>
                    <th className="px-5 py-4">Alerts</th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((entry) => (
                    <tr key={entry.user_id} className="border-t border-slate-200/70">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-slate-950">{entry.full_name}</p>
                        {entry.doctor_profile_name && entry.doctor_profile_name !== entry.full_name ? (
                          <p className="mt-1 text-xs text-slate-500">{entry.doctor_profile_name}</p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600">{roleLabel(entry.role)}</td>
                      <td className="px-5 py-4 text-sm text-slate-600">@{entry.username}</td>
                      <td className="px-5 py-4">
                        <span
                          className={cx(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                            entry.push_enabled
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-600",
                          )}
                        >
                          {entry.push_enabled ? (
                            <BellRing className="size-3.5" aria-hidden />
                          ) : (
                            <BellOff className="size-3.5" aria-hidden />
                          )}
                          {entry.push_enabled ? "Enabled" : "Not enabled"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No active team accounts can receive push alerts yet.</p>
        )}
      </div>
    </SectionCard>
  );
}

export default PushSubscriberStatusCard;
