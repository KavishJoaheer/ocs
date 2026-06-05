import { useEffect, useState } from "react";
import { X } from "lucide-react";
import toast from "react-hot-toast";
import LoadingState from "./LoadingState.jsx";
import { api } from "../lib/api.js";
import { formatDate, formatRupees } from "../lib/format.js";
import { parseMauritianID } from "../lib/nicParser.js";

function ReadOnlyField({ label, value }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <input
        readOnly
        disabled
        value={value || "Not recorded"}
        className="w-full cursor-default rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm font-semibold text-gray-800"
      />
    </label>
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close patient details"
        className="absolute inset-0 bg-[rgba(34,72,91,0.35)] backdrop-blur-[1px]"
        onClick={onClose}
      />

      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-gray-100 bg-white shadow-2xl">
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
                    <span className="text-xs font-bold text-gray-400">Policy Number Code</span>
                    <span className="mt-0.5 font-mono text-sm font-black tracking-wide text-[#557373]">
                      {patient.insurance_policy_number || "🚨 MISSING POLICY ID"}
                    </span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-xs font-bold text-gray-400">Verification Status</span>
                    <span className="mt-0.5 ml-auto w-fit rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-700">
                      🟢 Verified Covered
                    </span>
                  </div>
                </div>
              </div>

              <section className="space-y-3">
                <h3 className="text-sm font-bold text-gray-800">Demographics</h3>
                <ReadOnlyField label="Full name" value={patient.full_name} />
                <ReadOnlyField label="Case number" value={patient.case_number} />
                <ReadOnlyField label="National ID" value={patient.national_id} />
                <div className="grid grid-cols-2 gap-3">
                  <ReadOnlyField label="Date of birth" value={dobLabel} />
                  <ReadOnlyField label="Age" value={ageLabel} />
                </div>
                <ReadOnlyField label="Phone" value={patient.patient_contact_number} />
                <ReadOnlyField
                  label="Address"
                  value={[patient.address, patient.village].filter(Boolean).join(", ")}
                />
                <ReadOnlyField label="Registered" value={formatDate(patient.created_at)} />
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-bold text-gray-800">Treatment summary</h3>
                <ReadOnlyField
                  label="Active care profile"
                  value={patient.treatment_summary || "No treatment summary recorded"}
                />
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

              <section className="space-y-3">
                <h3 className="text-sm font-bold text-gray-800">80/20 financing summary</h3>
                <div className="grid grid-cols-2 gap-3">
                  <ReadOnlyField
                    label="Patient copay collected (20%)"
                    value={formatRupees(financing.patient_copay_collected)}
                  />
                  <ReadOnlyField
                    label="Linkham obligation (80%)"
                    value={formatRupees(financing.linkham_coverage_obligation)}
                  />
                  <ReadOnlyField
                    label="Approved corporate share"
                    value={formatRupees(financing.linkham_approved_amount)}
                  />
                  <ReadOnlyField
                    label="Outstanding corporate share"
                    value={formatRupees(financing.linkham_outstanding_amount)}
                  />
                </div>
              </section>

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
