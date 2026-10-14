import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../lib/api.js";
import { LONG_TERM_REVIEW_EVENT } from "../lib/inventorySync.js";

function mergeReviewPatient(row, updated) {
  if (!updated || Number(updated.id) !== Number(row.id)) {
    return row;
  }

  return {
    ...row,
    assigned_doctor_id: updated.assigned_doctor_id ?? row.assigned_doctor_id,
    assigned_doctor_name: updated.assigned_doctor_name ?? row.assigned_doctor_name,
    assigned_doctor_specialization:
      updated.assigned_doctor_specialization ?? row.assigned_doctor_specialization,
    review_assigned_doctor_id:
      updated.review_assigned_doctor_id ?? row.review_assigned_doctor_id,
    review_assigned_doctor_name:
      updated.review_assigned_doctor_name ?? row.review_assigned_doctor_name,
    review_assigned_doctor_specialization:
      updated.review_assigned_doctor_specialization ?? row.review_assigned_doctor_specialization,
    review_appointment_time: updated.review_appointment_time ?? row.review_appointment_time,
    review_due_date: updated.review_due_date ?? row.review_due_date,
    review_reason_note: updated.review_reason_note ?? row.review_reason_note,
    is_under_review: updated.is_under_review ?? row.is_under_review,
  };
}

function buildReviewQueuePath(scope) {
  const value = String(scope || "").trim();
  if (value === "all") {
    return "/dashboard/long-term-review?view=all";
  }
  if (value && value !== "mine") {
    return `/dashboard/long-term-review?reviewDoctorId=${encodeURIComponent(value)}`;
  }
  return "/dashboard/long-term-review";
}

export function useLongTermReviewQueue({ enabled = true, scope = "mine" } = {}) {
  const [state, setState] = useState({ patients: [], scope: null, pending: Boolean(enabled), error: null });
  const requestId = useRef(0);

  const applyPatient = useCallback((updated) => {
    if (!updated?.id) return;
    setState(current => ({ ...current, patients: current.patients.map(row => mergeReviewPatient(row, updated)) }));
  }, []);

  const reload = useCallback(async () => {
    const sequence = ++requestId.current;
    if (!enabled) {
      setState({ patients: [], scope, error: null, pending: false });
      return [];
    }
    setState(current => ({ ...current, pending: true, error: null }));
    try {
      const data = await api.get(buildReviewQueuePath(scope));
      const rows = Array.isArray(data?.patients) ? data.patients : [];
      if (sequence === requestId.current) setState({ patients: rows, scope, error: null, pending: false });
      return rows;
    } catch (err) {
      if (sequence === requestId.current) setState(current => ({ ...current, pending: false,
        error: err instanceof ApiError ? err.message : "Could not load the review appointment queue.", errorScope: scope }));
      return [];
    }
  }, [enabled, scope]);

  useEffect(() => {
    void reload();
    return () => { requestId.current += 1; };
  }, [reload]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return undefined;
    }

    const handleRefresh = () => {
      void reload();
    };

    window.addEventListener(LONG_TERM_REVIEW_EVENT, handleRefresh);
    return () => window.removeEventListener(LONG_TERM_REVIEW_EVENT, handleRefresh);
  }, [enabled, reload]);

  const patients = state.scope === scope ? state.patients : [];
  const error = state.errorScope === scope ? state.error : null;
  const pending = state.pending || (enabled && state.scope !== scope && !error);
  return { patients, loading: pending && !patients.length, refreshing: pending,
    error, reload, applyPatient };
}
