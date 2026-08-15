import { useCallback, useEffect, useState } from "react";
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

export function useLongTermReviewQueue({ enabled = true } = {}) {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);

  const applyPatient = useCallback((updated) => {
    if (!updated?.id) {
      return;
    }

    setPatients((rows) => rows.map((row) => mergeReviewPatient(row, updated)));
  }, []);

  const reload = useCallback(async () => {
    if (!enabled) {
      setPatients([]);
      setError(null);
      setLoading(false);
      return [];
    }

    setError(null);

    try {
      const data = await api.get("/dashboard/long-term-review");
      const rows = Array.isArray(data?.patients) ? data.patients : [];
      setPatients(rows);
      return rows;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not load the review appointment queue.";
      setError(message);
      setPatients([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
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

  return { patients, loading, error, reload, applyPatient };
}
