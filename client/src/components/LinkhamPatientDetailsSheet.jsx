import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import toast from "react-hot-toast";
import LoadingState from "./LoadingState.jsx";
import { api } from "../lib/api.js";
import { formatDate, formatRupees } from "../lib/format.js";
import { parseMauritianID } from "../lib/nicParser.js";
import { generateInsurerSummary } from "../utils/clinicalParser.js";

function MetadataField({ label, value, valueClassName = "", mono = false, span = 1 }) {
  const content =
    value === null || value === undefined || String(value).trim() === ""
      ? "Not recorded"
      : String(value);

  return (
    <div className={span === 2 ? "col-span-2 flex flex-col gap-0.5" : "flex flex-col gap-0.5"}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <span
        className={[
          mono ? "font-mono" : "",
          "text-sm font-semibold text-gray-800",
          valueClassName,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {content}
      </span>
    </div>
  );
}

export default function LinkhamPatientDetailsSheet({ patientId, open, onClose }) {
  const [patient, setPatient] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !patientId) {
      setPatient(null);
      return undefined;
    }

    let ignore = false;

    async function loadPatient() {
      setLoading(true);
      try {
        const data = await api.get(`/linkham/patients/${patientId}`);
        if (!ignore) {
          setPatient(data?.patient || null);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message || "Could not load patient details.");
          onClose?.();
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadPatient();
    return () => {
      ignore = true;
    };
  }, [open, patientId, onClose]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  const patientCaseHistoryRecords = patient?.case_history_records || [];
  const insurerSummarizedList = useMemo(
    () => generateInsurerSummary(patientCaseHistoryRecords),
    [patientCaseHistoryRecords],
  );

  if (!open) {
    return null;
  }

  const nicProfile = patient?.national_id ? parseMauritianID(patient.national_id) : null;
  const ageLabel =
    patient?.age != null
      ? `${patient.age} years`
      : nicProfile?.age != null
        ? `${nicProfile.age} years`
        : "Not available";
  const dobLabel = patient?.date_of_birth
    ? formatDate(patient.date_of_birth)
    : nicProfile?.formattedDob || "Not recorded";
  const financing = patient?.financing || {};
  const policyNumberLabel = patient?.insurance_policy_number?.trim()
    ? patient.insurance_policy_number
    : "MISSING POLICY ID";

  return (
    <div className="fixed inset-0 z-[var(--z-drawer)] flex justify-end">
      <button
        type="button"
        aria-label="Close patient details"
        className="absolute inset-0 bg-[rgba(34,72,91,0.35)] backdrop-blur-[1px]"
        onClick={onClose}
      />

      <aside
        className="relative z-10 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-gray-100 bg-white shadow-2xl"
        style={{
          paddingTop: "max(0px, var(--sat))",
          paddingBottom: "max(0px, var(--sab))",
        }}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
              Registration profile
            </p>
            <h2 className="text-lg font-bold text-gray-900">Patient details</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <LoadingState label="Loading patient profile" />
          ) : patient ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-2 rounded-2xl border border-gray-100 bg-gray-50/50 p-4">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                  Insured Eligibility Validation Anchor
                </span>
                <div className="flex w-full items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Policy Number Code
                    </span>
                    <span className="mt-0.5 font-mono text-sm font-black tracking-wide text-[#065a60]">
                      {policyNumberLabel}
                    </span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Verification Status
                    </span>
                    <span className="mt-0.5 ml-auto w-fit rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700">
                      Verified Covered
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 border-t border-gray-100 pt-4">
                <h4 className="mb-4 text-xs font-extrabold uppercase tracking-wider text-[#065a60]">
                  Demographics Summary
                </h4>

                <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                  <MetadataField label="Full Name" value={patient.full_name} span={2} />
                  <MetadataField label="National ID" value={patient.national_id} mono />
                  <MetadataField label="Case Number" value={patient.case_number} mono />
                  <MetadataField label="Date of Birth" value={dobLabel} />
                  <MetadataField label="Computed Patient Age" value={ageLabel} />
                </div>
              </div>

              <div className="mt-6 border-t border-gray-100 pt-4">
                <h4 className="mb-4 text-xs font-extrabold uppercase tracking-wider text-[#065a60]">
                  Contact & Address
                </h4>

                <div className="grid grid-cols-2 gap-x-4 gap-y-5">
                  <MetadataField label="Phone" value={patient.patient_contact_number} />
                  <MetadataField label="Registered" value={formatDate(patient.created_at)} />
                  <MetadataField
                    label="Address"
                    value={[patient.address, patient.village].filter(Boolean).join(", ")}
                    span={2}
                  />
                </div>
              </div>

              <section className="space-y-3">
                <div className="mt-6">
                  <h4 className="mb-2.5 text-xs font-extrabold uppercase tracking-wider text-gray-500">
                    Treatment summary
                  </h4>

                  <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                    {insurerSummarizedList.length === 0 ? (
                      <span className="text-xs italic text-gray-400">
                        No treatment history summaries logged yet.
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-2.5">
                        {insurerSummarizedList.map((item) => (
                          <li
                            key={item.sequenceNumber}
                            className="animate-fade-in flex items-start gap-2 border-b border-gray-50 pb-2.5 text-xs font-medium text-gray-700 last:border-0 last:pb-0"
                          >
                            <span className="font-black text-[#065a60]">
                              {item.sequenceNumber}.
                            </span>
                            <div>
                              <span className="font-extrabold text-gray-800">
                                {item.doctorTitle} consultation
                              </span>
                              <span className="mx-1.5 text-gray-300">—</span>
                              <span className="rounded-md border border-gray-100/60 bg-slate-50 px-2 py-0.5 font-semibold text-gray-600">
                                {item.summaryString}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="flex w-fit items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                    ICD-10 Code
                  </span>
                  <span className="font-mono text-xs font-black text-gray-800">
                    {patient.active_icd10_code || "N/A"}
                  </span>
                </div>
                {patient.active_icd10_label ? (
                  <p className="text-[11px] font-medium text-gray-500">{patient.active_icd10_label}</p>
                ) : null}
              </section>

              <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
                <h4 className="border-b border-gray-200/60 pb-2 text-xs font-extrabold uppercase tracking-wider text-gray-500">
                  80/20 Financing Matrix
                </h4>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Patient Copay Collected (20%)
                    </span>
                    <span className="text-sm font-black text-emerald-600">
                      {formatRupees(financing.patient_copay_collected)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Linkham Corporate Share (80%)
                    </span>
                    <span className="text-sm font-black text-gray-900">
                      {formatRupees(financing.linkham_coverage_obligation)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5 border-t border-gray-200/60 pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Approved Share
                    </span>
                    <span className="text-sm font-semibold text-gray-500">
                      {formatRupees(financing.linkham_approved_amount)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5 border-t border-gray-200/60 pt-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Outstanding Balance Due
                    </span>
                    <span className="text-sm font-black text-amber-600">
                      {formatRupees(financing.linkham_outstanding_amount)}
                    </span>
                  </div>
                </div>
              </div>

              {financing.visits?.length ? (
                <section className="space-y-3">
                  <h3 className="text-sm font-bold text-gray-800">Visit case log</h3>
                  <div className="space-y-2">
                    {financing.visits.map((visit) => (
                      <div
                        key={visit.billing_id}
                        className="rounded-xl border border-gray-100 bg-gray-50 px-3.5 py-3 text-xs text-gray-600"
                      >
                        <p className="font-bold text-gray-800">
                          {formatDate(visit.visit_date)} · {formatRupees(visit.total_amount)}
                        </p>
                        <p className="mt-1">
                          Copay {formatRupees(visit.patient_copay_amount)} · Linkham{" "}
                          {formatRupees(visit.linkham_share_amount)} · {visit.claim_status}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Patient profile unavailable.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
