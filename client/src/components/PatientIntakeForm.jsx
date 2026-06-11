import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import PatientDateOfBirthInput from "./PatientDateOfBirthInput.jsx";
import PatientNationalIdInput from "./PatientNationalIdInput.jsx";
import PatientLocationTags from "./PatientLocationTags.jsx";
import {
  isLinkhamInsuranceProvider,
  resolveInsuranceProviderFromTags,
  syncInsuranceProviderWithTags,
  syncInsuranceSelection,
} from "../lib/insuranceProvider.js";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { useKeyboardOffset } from "../hooks/useKeyboardOffset.js";
import { useMauritianNicPatientAutofill } from "../hooks/useMauritianNicPatientAutofill.js";
import { cx } from "../lib/utils.js";

const DRAFT_KEY = "ocs_patient_draft";

const WIZARD_STEPS = [
  { label: "Intake" },
  { label: "Clinical" },
  { label: "Next of Kin" },
];

const MOBILE_FIELD_LABEL = "mb-1.5 block text-sm font-semibold text-slate-700";
const MOBILE_STEP_STACK = "space-y-5.5";
const MOBILE_INPUT =
  "h-12 w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-sm placeholder:text-gray-400 focus:border-ocs-teal focus:bg-white";
const MOBILE_INPUT_DISABLED =
  "h-12 w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none transition placeholder:text-sm placeholder:text-gray-400 focus:border-ocs-teal focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100";
const MOBILE_TEXTAREA = cx(
  MOBILE_INPUT,
  "h-auto min-h-[5.5rem] resize-y leading-relaxed",
);

const DRAFT_TEXT_FIELDS = [
  "first_name",
  "last_name",
  "patient_identifier",
  "patient_id_number",
  "date_of_birth",
  "patient_contact_number",
  "address",
  "past_medical_history",
  "past_surgical_history",
  "drug_history",
  "drug_allergy_history",
  "particularity",
  "next_of_kin_name",
  "next_of_kin_relationship",
  "next_of_kin_contact_number",
  "next_of_kin_email",
  "ongoing_treatment",
  "insurance_provider",
  "insurance_policy_number",
];

function isPatientDraftMeaningful(form) {
  if (!form || typeof form !== "object") {
    return false;
  }

  if (DRAFT_TEXT_FIELDS.some((field) => String(form[field] || "").trim())) {
    return true;
  }

  if (Array.isArray(form.location_tags) && form.location_tags.length > 0) {
    return true;
  }

  return false;
}

function readPatientDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return isPatientDraftMeaningful(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const emptyPatient = {
  first_name: "",
  last_name: "",
  patient_identifier: "",
  patient_id_number: "",
  date_of_birth: "",
  gender: "M",
  assigned_doctor_id: "",
  patient_contact_number: "",
  address: "",
  location: "",
  location_tags: [],
  insurance_provider: "",
  insurance_policy_number: "",
  past_medical_history: "",
  past_surgical_history: "",
  drug_history: "",
  drug_allergy_history: "",
  particularity: "",
  next_of_kin_name: "",
  next_of_kin_relationship: "",
  next_of_kin_contact_number: "",
  next_of_kin_email: "",
  status: "active",
  ongoing_treatment: "",
  is_subscribed: false,
};

function toPatientFormState(patient) {
  if (!patient) {
    return emptyPatient;
  }

  return {
    first_name: patient.first_name ?? "",
    last_name: patient.last_name ?? "",
    patient_identifier: patient.patient_identifier ?? "",
    patient_id_number: patient.patient_id_number ?? "",
    date_of_birth: patient.date_of_birth ?? "",
    gender: patient.gender ?? "M",
    assigned_doctor_id: patient.assigned_doctor_id ? String(patient.assigned_doctor_id) : "",
    patient_contact_number:
      patient.patient_contact_number ?? patient.contact_number ?? "",
    address: patient.address ?? "",
    location: patient.location ?? "",
    location_tags: patient.location_tags ?? [],
    insurance_provider:
      patient.insurance_provider ||
      resolveInsuranceProviderFromTags(patient.location_tags ?? []),
    insurance_policy_number: patient.insurance_policy_number ?? "",
    past_medical_history: patient.past_medical_history ?? "",
    past_surgical_history: patient.past_surgical_history ?? "",
    drug_history: patient.drug_history ?? "",
    drug_allergy_history: patient.drug_allergy_history ?? "",
    particularity: patient.particularity ?? "",
    next_of_kin_name: patient.next_of_kin_name ?? "",
    next_of_kin_relationship:
      patient.next_of_kin_relationship ?? patient.contact_relationship ?? "",
    next_of_kin_contact_number: patient.next_of_kin_contact_number ?? "",
    next_of_kin_email: patient.next_of_kin_email ?? "",
    status: patient.status ?? "active",
    ongoing_treatment: patient.ongoing_treatment ?? "",
    is_subscribed:
      patient.is_subscribed === true || patient.is_subscribed === 1 || patient.is_subscribed === "1",
  };
}

const DESKTOP_INPUT =
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-sky-400 focus:bg-white";
const DESKTOP_TEXTAREA = cx(
  DESKTOP_INPUT,
  "min-h-[2.75rem] resize-y py-2 leading-relaxed",
);

function SubscriptionPlanField({ checked, onChange, className }) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-400/40",
        checked && "border-teal-200/80 bg-teal-50/40",
        className,
      )}
    >
      <input
        type="checkbox"
        name="is_subscribed"
        checked={checked}
        onChange={onChange}
        className="size-4 shrink-0 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
      <span className="text-sm font-semibold text-slate-700">On Active Subscription Plan</span>
    </label>
  );
}

function PatientFormModal({
  open,
  layout = "modal",
  patient,
  doctors,
  mode,
  canSelectAssignedDoctor,
  canEditPatientIdentifier,
  onClose,
  onSubmit,
  isSaving,
}) {
  const isMobile = useIsMobile();
  const keyboardInset = useKeyboardOffset(isMobile && open);
  const [form, setForm] = useState(emptyPatient);
  const [wizardStep, setWizardStep] = useState(0);
  const [desktopWizardStep, setDesktopWizardStep] = useState(0);
  const firstNameRef = useRef(null);
  const stepFirstInputRef = useRef(null);
  const isPageLayout = layout === "page";

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  const { handleNationalIdChange, isDobLockedFromNic, nicParsed } = useMauritianNicPatientAutofill({
    nationalId: form.patient_id_number,
    dateOfBirth: form.date_of_birth,
    setForm,
    enabled: open,
  });

  const [resetSyncDeps, setResetSyncDeps] = useState({ open, patient, mode });
  const [draftRestoreSignal, setDraftRestoreSignal] = useState(0);

  if (
    resetSyncDeps.open !== open ||
    resetSyncDeps.patient !== patient ||
    resetSyncDeps.mode !== mode
  ) {
    setResetSyncDeps({ open, patient, mode });

    if (open) {
      setWizardStep(0);
      setDesktopWizardStep(0);

      let restoredDraft = null;
      if (mode !== "edit") {
        restoredDraft = readPatientDraft();
        if (!restoredDraft) {
          clearDraft();
        }
      }

      if (restoredDraft) {
        setForm(restoredDraft);
        setDraftRestoreSignal((signal) => signal + 1);
      } else {
        setForm(toPatientFormState(patient));
      }
    }
  }

  useEffect(() => {
    if (draftRestoreSignal > 0) {
      toast("Draft restored", { id: "patient-draft-restored", icon: "\u{1F4CB}" });
    }
  }, [draftRestoreSignal]);

  useEffect(() => {
    if (!open || mode === "edit") return;

    if (isPatientDraftMeaningful(form)) {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      } catch {
        /* storage full — ignore */
      }
      return;
    }

    clearDraft();
  }, [form, open, mode]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const id = window.requestAnimationFrame(() => {
      stepFirstInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, isMobile, wizardStep]);

  const isEditing = mode === "edit";
  const actionLabel = isEditing ? "Update patient" : "Add patient";

  function handleChange(event) {
    const { name, value, type, checked } = event.target;

    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
      ...(name === "status" && value === "discharged" ? { ongoing_treatment: "" } : {}),
    }));
  }

  function handleCancel() {
    clearDraft();
    setWizardStep(0);
    setDesktopWizardStep(0);
    onClose();
  }

  const currentStep = isMobile ? wizardStep : desktopWizardStep;
  const onFinalWizardStep = currentStep >= WIZARD_STEPS.length - 1;

  function goToWizardStep(stepIndex, event) {
    event?.preventDefault?.();
    const nextStep = Math.max(0, Math.min(WIZARD_STEPS.length - 1, stepIndex));
    if (isMobile) {
      setWizardStep(nextStep);
    } else {
      setDesktopWizardStep(nextStep);
    }
  }

  function goToNextWizardStep(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    goToWizardStep(currentStep + 1);
  }

  function goToPreviousWizardStep(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    goToWizardStep(currentStep - 1);
  }

  function handleFormKeyDown(event) {
    if (event.key !== "Enter" || event.target.tagName === "TEXTAREA") {
      return;
    }

    if (!onFinalWizardStep) {
      event.preventDefault();
      goToNextWizardStep(event);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!onFinalWizardStep) {
      return;
    }
    clearDraft();

    const locationTags = Array.isArray(form.location_tags) ? form.location_tags : [];
    const legacyLocation = locationTags.map((tag) => tag.name).join(", ");

    const insuranceProvider = resolveInsuranceProviderFromTags(
      locationTags,
      form.insurance_provider,
    );
    const insurancePolicyNumber = isLinkhamInsuranceProvider(insuranceProvider)
      ? String(form.insurance_policy_number || "").trim()
      : "";

    if (isLinkhamInsuranceProvider(insuranceProvider) && !insurancePolicyNumber) {
      toast.error("Linkham policy number is required when Linkham insurance is selected.");
      return;
    }

    onSubmit({
      ...form,
      location_tags: locationTags,
      location: legacyLocation,
      insurance_provider: insuranceProvider,
      insurance_policy_number: insurancePolicyNumber,
      assigned_doctor_id: form.assigned_doctor_id ? Number(form.assigned_doctor_id) : null,
      ongoing_treatment: form.status === "active" ? form.ongoing_treatment : "",
    });
  }

  /* ───────── Mobile: full-screen step wizard ───────── */
  if (isMobile && open) {
    return (
      <div
        className={
          isPageLayout
            ? "flex min-h-svh flex-col bg-white"
            : "fixed inset-0 z-50 flex flex-col bg-white"
        }
        style={{ padding: "var(--sat) var(--sar) 0 var(--sal)" }}
      >
        {isPageLayout ? (
          <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 px-2 py-1">
            <button
              type="button"
              onClick={handleCancel}
              className="grid min-h-12 min-w-12 shrink-0 place-items-center rounded-xl text-ocs-teal transition active:bg-ocs-teal/10"
              aria-label="Go back"
            >
              <ArrowLeft className="size-6" />
            </button>
            <span className="min-w-0 truncate text-lg font-bold text-ocs-slate">{actionLabel}</span>
          </div>
        ) : null}
        {/* Step progress indicator */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 pb-3 pt-4">
          {WIZARD_STEPS.map((step, i) => (
            <button
              key={step.label}
              type="button"
              onClick={(event) => goToWizardStep(i, event)}
              className="flex flex-col items-center gap-1 rounded-lg px-1 py-0.5 transition hover:bg-slate-50"
            >
              <div
                className={cx(
                  "flex size-9 items-center justify-center rounded-full text-sm font-bold transition",
                  i === wizardStep
                    ? "bg-ocs-teal text-white shadow-md"
                    : i < wizardStep
                      ? "bg-ocs-teal/70 text-white"
                      : "bg-slate-100 text-slate-400",
                )}
              >
                {i + 1}
              </div>
              <span
                className={cx(
                  "text-[11px] leading-tight",
                  i === wizardStep ? "font-semibold text-ocs-teal" : "text-ocs-grey",
                )}
              >
                {i + 1}. {step.label}
              </span>
            </button>
          ))}
        </div>

        <form
          id="mobile-patient-form"
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleSubmit}
          onKeyDown={handleFormKeyDown}
        >
          <div className="flex-1 overflow-y-auto px-4 py-5">
            {wizardStep === 0 && (
              <div className={MOBILE_STEP_STACK}>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>First name</span>
                  <input
                    ref={wizardStep === 0 ? stepFirstInputRef : undefined}
                    name="first_name"
                    value={form.first_name}
                    onChange={handleChange}
                    placeholder="Enter first name"
                    className={MOBILE_INPUT}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Last name</span>
                  <input
                    name="last_name"
                    value={form.last_name}
                    onChange={handleChange}
                    placeholder="Enter last name"
                    className={MOBILE_INPUT}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>OCS care number</span>
                  <input
                    name="patient_identifier"
                    value={form.patient_identifier}
                    onChange={handleChange}
                    placeholder={isEditing ? "" : "Auto-assigned from OCS-150"}
                    disabled={!canEditPatientIdentifier}
                    className={MOBILE_INPUT_DISABLED}
                  />
                </label>
                <PatientNationalIdInput
                  required
                  value={form.patient_id_number}
                  variant="mobile"
                  onChange={handleNationalIdChange}
                />
                <PatientDateOfBirthInput
                  open={open}
                  resetKey={patient?.id ?? "create"}
                  required
                  value={form.date_of_birth}
                  variant="mobile"
                  nicAutofill={isDobLockedFromNic ? nicParsed : null}
                  onChange={(isoDate) =>
                    setForm((current) => ({ ...current, date_of_birth: isoDate }))
                  }
                />
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Gender</span>
                  <select
                    required
                    name="gender"
                    value={form.gender}
                    onChange={handleChange}
                    className={MOBILE_INPUT}
                  >
                    <option value="M">M</option>
                    <option value="F">F</option>
                  </select>
                </label>

                <SubscriptionPlanField checked={form.is_subscribed} onChange={handleChange} />

                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Status</span>
                  <select
                    required
                    name="status"
                    value={form.status}
                    onChange={handleChange}
                    className={MOBILE_INPUT}
                  >
                    <option value="active">Active</option>
                    <option value="discharged">Discharged</option>
                  </select>
                </label>

                {canSelectAssignedDoctor ? (
                  <label className="block">
                    <span className={MOBILE_FIELD_LABEL}>Assigned doctor</span>
                    <select
                      required
                      name="assigned_doctor_id"
                      value={form.assigned_doctor_id}
                      onChange={handleChange}
                      className={MOBILE_INPUT}
                    >
                      <option value="">Select doctor</option>
                      {doctors.map((doctor) => (
                        <option key={doctor.id} value={doctor.id}>
                          {doctor.full_name} - {doctor.specialization}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {isEditing && patient?.assigned_doctor_name && !canSelectAssignedDoctor ? (
                  <div className="rounded-[24px] border border-amber-100 bg-amber-50/80 p-4">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-white p-3 text-amber-700 shadow-sm">
                        <LockKeyhole className="size-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-950">
                          Only admin can change the assigned doctor
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {patient.assigned_doctor_name}
                          {patient.assigned_doctor_specialization
                            ? ` - ${patient.assigned_doctor_specialization}`
                            : ""}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Patient contact number</span>
                  <input
                    required
                    name="patient_contact_number"
                    value={form.patient_contact_number}
                    onChange={handleChange}
                    inputMode="tel"
                    placeholder="Mobile or landline number"
                    className={MOBILE_INPUT}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Address</span>
                  <textarea
                    required
                    rows={2}
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    placeholder="Street, area, and locality"
                    className={MOBILE_TEXTAREA}
                  />
                </label>
                <div>
                  <span className={MOBILE_FIELD_LABEL}>Locations and affiliations</span>
                  <PatientLocationTags
                    tags={form.location_tags}
                    insuranceProvider={form.insurance_provider}
                    insurancePolicyNumber={form.insurance_policy_number}
                    onInsuranceChange={(update) =>
                      setForm((current) => syncInsuranceSelection(current, update))
                    }
                    onChange={(nextTags) =>
                      setForm((current) => syncInsuranceProviderWithTags(current, nextTags))
                    }
                  />
                </div>
              </div>
            )}

            {wizardStep === 1 && (
              <div className={MOBILE_STEP_STACK}>
                {form.status === "active" ? (
                  <label className="block">
                    <span className={MOBILE_FIELD_LABEL}>Ongoing treatment</span>
                    <textarea
                      ref={stepFirstInputRef}
                      rows={2}
                      name="ongoing_treatment"
                      value={form.ongoing_treatment}
                      onChange={handleChange}
                      placeholder="Current treatment plan or follow-up notes"
                      className={MOBILE_TEXTAREA}
                    />
                  </label>
                ) : null}
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Past medical history</span>
                  <textarea
                    ref={form.status !== "active" ? stepFirstInputRef : undefined}
                    rows={2}
                    name="past_medical_history"
                    value={form.past_medical_history}
                    onChange={handleChange}
                    placeholder="Prior diagnoses and conditions"
                    className={MOBILE_TEXTAREA}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Past surgical history</span>
                  <textarea
                    rows={2}
                    name="past_surgical_history"
                    value={form.past_surgical_history}
                    onChange={handleChange}
                    placeholder="Previous surgeries or procedures"
                    className={MOBILE_TEXTAREA}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Drug history</span>
                  <textarea
                    rows={2}
                    name="drug_history"
                    value={form.drug_history}
                    onChange={handleChange}
                    placeholder="Current and past medications"
                    className={MOBILE_TEXTAREA}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Allergy history</span>
                  <textarea
                    rows={2}
                    name="drug_allergy_history"
                    value={form.drug_allergy_history}
                    onChange={handleChange}
                    placeholder="Record medication, food, environmental, or other allergy details."
                    className={MOBILE_TEXTAREA}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Particularity</span>
                  <textarea
                    rows={2}
                    name="particularity"
                    value={form.particularity}
                    onChange={handleChange}
                    placeholder="Additional clinical notes or particularities"
                    className={MOBILE_TEXTAREA}
                  />
                </label>
              </div>
            )}

            {wizardStep === 2 && (
              <div className={MOBILE_STEP_STACK}>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Name</span>
                  <input
                    ref={stepFirstInputRef}
                    name="next_of_kin_name"
                    value={form.next_of_kin_name}
                    onChange={handleChange}
                    placeholder="Next of kin full name"
                    className={MOBILE_INPUT}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Relationship with patient</span>
                  <input
                    name="next_of_kin_relationship"
                    value={form.next_of_kin_relationship}
                    onChange={handleChange}
                    placeholder="Spouse, daughter, son, sibling..."
                    className={MOBILE_INPUT}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Contact number</span>
                  <input
                    name="next_of_kin_contact_number"
                    value={form.next_of_kin_contact_number}
                    onChange={handleChange}
                    inputMode="tel"
                    placeholder="Next of kin phone number"
                    className={MOBILE_INPUT}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Email address</span>
                  <input
                    name="next_of_kin_email"
                    type="email"
                    value={form.next_of_kin_email}
                    onChange={handleChange}
                    placeholder="Optional email address"
                    className={MOBILE_INPUT}
                  />
                </label>
              </div>
            )}
          </div>

          <div
            className="mt-auto shrink-0 border-t border-slate-100 bg-white px-4 pt-6"
            style={{
              paddingBottom: `max(var(--sab), calc(12px + ${keyboardInset.bottom}px))`,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="min-h-12 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                {wizardStep > 0 && (
                  <button
                    type="button"
                    onClick={goToPreviousWizardStep}
                    className="min-h-12 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    Back
                  </button>
                )}
                {wizardStep < 2 ? (
                  <button
                    type="button"
                    onClick={goToNextWizardStep}
                    className="min-h-12 rounded-2xl bg-ocs-teal px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-ocs-teal/20 transition hover:bg-ocs-teal/90"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="min-h-12 rounded-2xl bg-ocs-teal px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-ocs-teal/20 transition hover:bg-ocs-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving ? "Saving..." : actionLabel}
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    );
  }

  /* ───────── Desktop: tabbed modal with fixed footer ───────── */
  const careBadgeLabel = form.patient_identifier?.trim()
    ? form.patient_identifier.trim()
    : isEditing
      ? "—"
      : "Auto-assigned on save";

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={isEditing ? "Edit patient" : "Add patient"}
      size="xl"
      innerScroll={false}
    >
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
        <div className="shrink-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              OCS care number
            </span>
            <span className="inline-flex items-center rounded-lg bg-slate-100 px-3 py-1 font-mono text-sm font-medium text-slate-600">
              {careBadgeLabel}
            </span>
          </div>
          {canEditPatientIdentifier ? (
            <label className="block max-w-md space-y-1.5">
              <span className="text-xs font-medium text-slate-500">
                {isEditing ? "Update care number (admin)" : "Optional override (admin)"}
              </span>
              <input
                name="patient_identifier"
                value={form.patient_identifier}
                onChange={handleChange}
                placeholder={isEditing ? "" : "Leave blank for next in sequence"}
                className={DESKTOP_INPUT}
              />
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/90 pb-3">
            {WIZARD_STEPS.map((step, i) => (
              <button
                key={step.label}
                type="button"
                onClick={(event) => goToWizardStep(i, event)}
                className={cx(
                  "rounded-full px-3 py-1.5 text-sm font-semibold transition",
                  i === desktopWizardStep
                    ? "bg-sky-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {step.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-32 pt-4">
          {desktopWizardStep === 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">First name</span>
                <input
                  ref={firstNameRef}
                  name="first_name"
                  value={form.first_name}
                  onChange={handleChange}
                  placeholder="Enter first name"
                  className={DESKTOP_INPUT}
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Last name</span>
                <input
                  name="last_name"
                  value={form.last_name}
                  onChange={handleChange}
                  placeholder="Enter last name"
                  className={DESKTOP_INPUT}
                />
              </label>

              <PatientNationalIdInput
                required
                value={form.patient_id_number}
                variant="desktop"
                onChange={handleNationalIdChange}
              />

              <PatientDateOfBirthInput
                open={open}
                resetKey={patient?.id ?? "create"}
                required
                value={form.date_of_birth}
                variant="desktop"
                nicAutofill={isDobLockedFromNic ? nicParsed : null}
                onChange={(isoDate) =>
                  setForm((current) => ({ ...current, date_of_birth: isoDate }))
                }
              />

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Gender</span>
                <select
                  required
                  name="gender"
                  value={form.gender}
                  onChange={handleChange}
                  className={DESKTOP_INPUT}
                >
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Status</span>
                <select
                  required
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                  className={DESKTOP_INPUT}
                >
                  <option value="active">Active</option>
                  <option value="discharged">Discharged</option>
                </select>
              </label>

              <SubscriptionPlanField
                checked={form.is_subscribed}
                onChange={handleChange}
                className="md:col-span-2"
              />

              {canSelectAssignedDoctor ? (
                <label className="space-y-2 md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">Assigned doctor</span>
                  <select
                    required
                    name="assigned_doctor_id"
                    value={form.assigned_doctor_id}
                    onChange={handleChange}
                    className={DESKTOP_INPUT}
                  >
                    <option value="">Select doctor</option>
                    {doctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.full_name} - {doctor.specialization}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {isEditing && patient?.assigned_doctor_name && !canSelectAssignedDoctor ? (
                <div className="rounded-[24px] border border-amber-100 bg-amber-50/80 p-4 md:col-span-2">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-white p-3 text-amber-700 shadow-sm">
                      <LockKeyhole className="size-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        Only admin can change the assigned doctor
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {patient.assigned_doctor_name}
                        {patient.assigned_doctor_specialization
                          ? ` - ${patient.assigned_doctor_specialization}`
                          : ""}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-semibold text-slate-700">
                  Patient contact number
                </span>
                <input
                  required
                  name="patient_contact_number"
                  value={form.patient_contact_number}
                  onChange={handleChange}
                  className={DESKTOP_INPUT}
                />
              </label>

              <div className="grid gap-4 md:col-span-2 md:grid-cols-[1fr_0.46fr]">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Address</span>
                  <textarea
                    required
                    rows={2}
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    className={DESKTOP_TEXTAREA}
                  />
                </label>

                <div className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">
                    Locations and affiliations
                  </span>
                  <PatientLocationTags
                    tags={form.location_tags}
                    insuranceProvider={form.insurance_provider}
                    insurancePolicyNumber={form.insurance_policy_number}
                    onInsuranceChange={(update) =>
                      setForm((current) => syncInsuranceSelection(current, update))
                    }
                    onChange={(nextTags) =>
                      setForm((current) => syncInsuranceProviderWithTags(current, nextTags))
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}

          {desktopWizardStep === 1 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {form.status === "active" ? (
                <label className="space-y-2 md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">Ongoing treatment</span>
                  <textarea
                    rows={2}
                    name="ongoing_treatment"
                    value={form.ongoing_treatment}
                    onChange={handleChange}
                    className={DESKTOP_TEXTAREA}
                  />
                </label>
              ) : null}

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Past medical history</span>
                <textarea
                  rows={2}
                  name="past_medical_history"
                  value={form.past_medical_history}
                  onChange={handleChange}
                  className={DESKTOP_TEXTAREA}
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Past surgical history</span>
                <textarea
                  rows={2}
                  name="past_surgical_history"
                  value={form.past_surgical_history}
                  onChange={handleChange}
                  className={DESKTOP_TEXTAREA}
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-semibold text-slate-700">Drug history</span>
                <textarea
                  rows={2}
                  name="drug_history"
                  value={form.drug_history}
                  onChange={handleChange}
                  className={DESKTOP_TEXTAREA}
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-semibold text-slate-700">Allergy history</span>
                <textarea
                  rows={2}
                  name="drug_allergy_history"
                  value={form.drug_allergy_history}
                  onChange={handleChange}
                  placeholder="Record medication, food, environmental, or other allergy details."
                  className={DESKTOP_TEXTAREA}
                />
              </label>

              <label className="block space-y-2 md:col-span-2">
                <span className="font-display text-base font-semibold text-slate-700">
                  Particularity
                </span>
                <textarea
                  rows={2}
                  name="particularity"
                  value={form.particularity}
                  onChange={handleChange}
                  placeholder="Blank page for additional notes..."
                  className={DESKTOP_TEXTAREA}
                />
              </label>
            </div>
          ) : null}

          {desktopWizardStep === 2 ? (
            <div className="space-y-4">
              <div className="rounded-[26px] border border-slate-200/80 bg-slate-50/80 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Next of kin
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Name</span>
                    <input
                      name="next_of_kin_name"
                      value={form.next_of_kin_name}
                      onChange={handleChange}
                      className={cx(DESKTOP_INPUT, "bg-white")}
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">
                      Relationship with patient
                    </span>
                    <input
                      name="next_of_kin_relationship"
                      value={form.next_of_kin_relationship}
                      onChange={handleChange}
                      placeholder="Spouse, daughter, son, sibling..."
                      className={cx(DESKTOP_INPUT, "bg-white")}
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Contact number</span>
                    <input
                      name="next_of_kin_contact_number"
                      value={form.next_of_kin_contact_number}
                      onChange={handleChange}
                      className={cx(DESKTOP_INPUT, "bg-white")}
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-semibold text-slate-700">Email address</span>
                    <input
                      name="next_of_kin_email"
                      type="email"
                      value={form.next_of_kin_email}
                      onChange={handleChange}
                      className={cx(DESKTOP_INPUT, "bg-white")}
                    />
                  </label>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-3 border-t border-gray-200 bg-white p-4">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Cancel
          </button>
          {desktopWizardStep > 0 ? (
            <button
              type="button"
              onClick={goToPreviousWizardStep}
              className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              Back
            </button>
          ) : null}
          {desktopWizardStep < 2 ? (
            <button
              type="button"
              onClick={goToNextWizardStep}
              className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-700"
            >
              {desktopWizardStep === 0 ? "Next: Clinical history" : "Next: Next of kin"}
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : isEditing ? "Update patient" : "Save patient"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export { PatientFormModal };
