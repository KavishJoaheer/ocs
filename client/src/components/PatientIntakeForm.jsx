import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import PatientWorkspaceHeader from "./patient-workspace/PatientWorkspaceHeader.jsx";
import AppUpdateBanner from "./AppUpdateBanner.jsx";
import PushNotificationBanner from "./PushNotificationBanner.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import PatientDateOfBirthInput from "./PatientDateOfBirthInput.jsx";
import PatientNationalIdInput from "./PatientNationalIdInput.jsx";
import PatientLocationTags from "./PatientLocationTags.jsx";
import {
  isLinkhamInsuranceProvider,
  resolveInsuranceProviderFromTags,
  syncInsuranceSelection,
  syncInsuranceProviderWithTags,
} from "../lib/insuranceProvider.js";
import {
  buildPatientLocationFieldFromTags,
  hasStructuredLocationTags,
  sanitizeLocationTagsForDisplay,
} from "../lib/locationTags.js";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { useKeyboardOffset } from "../hooks/useKeyboardOffset.js";
import { useMauritianNicPatientAutofill } from "../hooks/useMauritianNicPatientAutofill.js";
import { cx } from "../lib/utils.js";
import { capitalizeFirstLetter } from "../lib/patientText.js";

import { validatePatientIdentity } from "../lib/patientIdentity.js";

const DRAFT_KEY = "ocs_patient_draft";

const WIZARD_STEPS = [
  { label: "Intake" },
  { label: "Clinical" },
  { label: "Next of Kin" },
];

const MOBILE_FIELD_LABEL = "mb-1.5 block text-sm font-semibold text-slate-700";
const MOBILE_STEP_STACK = "space-y-4";
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
  "manual_age",
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
  patient_id_type: "national_id",
  patient_id_number: "",
  manual_age: "",
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
    patient_id_type: patient.patient_id_type || "national_id",
    patient_id_number: patient.patient_id_number ?? "",
    manual_age: patient.manual_age ?? "",
    date_of_birth: patient.date_of_birth ?? "",
    gender: patient.gender ?? "M",
    assigned_doctor_id: patient.assigned_doctor_id ? String(patient.assigned_doctor_id) : "",
    patient_contact_number:
      patient.patient_contact_number ?? patient.contact_number ?? "",
    address: patient.address ?? "",
    location: patient.location ?? "",
    location_tags: sanitizeLocationTagsForDisplay(patient.location_tags ?? []),
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
  const { user } = useAuth();
  const keyboardInset = useKeyboardOffset(isMobile && open);
  const [form, setForm] = useState(() => open
    ? (mode === "edit" ? toPatientFormState(patient) : { ...emptyPatient, ...readPatientDraft() })
    : emptyPatient);
  const [wizardStep, setWizardStep] = useState(0);
  const [desktopWizardStep, setDesktopWizardStep] = useState(0);
  const formRef = useRef(null);
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

  const isNationalId = (form.patient_id_type || "national_id") === "national_id";

  function handleIdTypeChange(event) {
    const type = event.target.value;
    setForm((current) => ({
      ...current,
      patient_id_type: type,
      patient_id_number: "",
      date_of_birth: "",
      manual_age: "",
    }));
  }

  function handleDocumentNumberChange(event) {
    if (isNationalId) {
      handleNationalIdChange(event);
    } else {
      const value = event.target.value.toUpperCase();
      setForm((current) => ({ ...current, patient_id_number: value }));
    }
  }

  const { handleNationalIdChange, isDobLockedFromNic, nicParsed } = useMauritianNicPatientAutofill({
    nationalId: form.patient_id_number,
    dateOfBirth: form.date_of_birth,
    setForm,
    enabled: open && isNationalId,
  });

  const patientId = patient?.id ?? null;
  const [resetSyncDeps, setResetSyncDeps] = useState({ open, patientId, mode });
  const [draftRestoreSignal, setDraftRestoreSignal] = useState(0);

  if (
    resetSyncDeps.open !== open ||
    resetSyncDeps.patientId !== patientId ||
    resetSyncDeps.mode !== mode
  ) {
    setResetSyncDeps({ open, patientId, mode });

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
        setForm({ ...emptyPatient, ...restoredDraft });
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
      stepFirstInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, isMobile, wizardStep]);

  const isEditing = mode === "edit";
  const actionLabel = isEditing ? "Update patient" : "Add patient";

  function handleChange(event) {
    const { name, value, type, checked } = event.target;
    const capitalize = ["first_name", "last_name", "address"].includes(name);
    const nextValue = capitalize && !event.nativeEvent?.isComposing
      ? capitalizeFirstLetter(value)
      : value;

    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : nextValue,
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
    if (currentStep === 0 && nextStep > 0) {
      const identityError = validatePatientIdentity(form);
      if (identityError) {
        toast.error(identityError);
        return;
      }
      if (!formRef.current?.reportValidity()) return;
    }
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

  async function handleSubmit(event, skipOptional = false) {
    if (isSaving) return;
    event.preventDefault();
    if (!onFinalWizardStep && !skipOptional) {
      return;
    }
    const identityError = validatePatientIdentity(form);
    if (identityError) {
      toast.error(identityError);
      goToWizardStep(0);
      return;
    }
    const locationTags = sanitizeLocationTagsForDisplay(
      Array.isArray(form.location_tags) ? form.location_tags : [],
    );

    if (!hasStructuredLocationTags(locationTags)) {
      toast.error("Select a town, village, neighbourhood, or clinic before saving.");
      goToWizardStep(0);
      return;
    }

    const legacyLocation = buildPatientLocationFieldFromTags(locationTags);

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

    const saved = await onSubmit({
      ...form,
      patient_id_type: form.patient_id_type || "national_id",
      manual_age: isNationalId ? null : form.manual_age,
      location_tags: locationTags,
      location: legacyLocation,
      insurance_provider: insuranceProvider,
      insurance_policy_number: insurancePolicyNumber,
      assigned_doctor_id: form.assigned_doctor_id ? Number(form.assigned_doctor_id) : null,
      ongoing_treatment: form.status === "active" ? form.ongoing_treatment : "",
    });
    if (saved && !isEditing) clearDraft();
  }

  const careBadgeLabel = form.patient_identifier?.trim()
    ? form.patient_identifier.trim()
    : isEditing
      ? "—"
      : "Assigned on save";


  /* ───────── Mobile: full-screen step wizard ───────── */
  if (isMobile && open) {
    return (
      <div
        className={
          isPageLayout
            ? "patient-intake-workspace intake-page flex flex-col bg-white"
            : "patient-intake-workspace fixed inset-0 z-50 flex flex-col bg-white"
        }
        style={{ padding: "var(--sat) var(--sar) 0 var(--sal)" }}
      >
        <PatientWorkspaceHeader title={actionLabel} subtitle="Patient details first; clinical history and next of kin are optional." role={user.role} actions={<button type="button" className="patient-icon-control" aria-label="Go back" onClick={handleCancel}><ArrowLeft className="size-4" /></button>}>
          <span className="rounded-full bg-white/80 px-3 py-1 text-xs text-[#376168]">OCS care number · {careBadgeLabel}</span>
        </PatientWorkspaceHeader>
        {/* Step progress indicator */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
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
                {i + 1}. {step.label}{i > 0 ? <span className="block text-[10px] text-slate-500">Optional</span> : null}
              </span>
            </button>
          ))}
        </div>

        <form
          ref={formRef}
          id="mobile-patient-form"
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={handleSubmit}
          onKeyDown={handleFormKeyDown}
        >
          <div className="intake-content flex-1 overflow-y-auto px-4 py-4">
            {wizardStep === 0 && (
              <div className={MOBILE_STEP_STACK}>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>First name *</span>
                  <input
                    ref={wizardStep === 0 ? stepFirstInputRef : undefined}
                    name="first_name"
                    required
                    autoCapitalize="sentences"
                    onBlur={handleChange}
                    value={form.first_name}
                    onChange={handleChange}
                    placeholder="Enter first name"
                    className={MOBILE_INPUT}
                  />
                </label>
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Last name *</span>
                  <input
                    name="last_name"
                    required
                    autoCapitalize="sentences"
                    onBlur={handleChange}
                    value={form.last_name}
                    onChange={handleChange}
                    placeholder="Enter last name"
                    className={MOBILE_INPUT}
                  />
                </label>
                {canEditPatientIdentifier ? (
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
                ) : null}
                <PatientNationalIdInput
                  idType={form.patient_id_type || "national_id"}
                  onTypeChange={handleIdTypeChange}
                  required={form.patient_id_type !== "old_age"}
                  value={form.patient_id_number}
                  variant="mobile"
                  onChange={handleDocumentNumberChange}
                />
                <PatientDateOfBirthInput
                key={form.patient_id_type || "national_id"}
                  open={open}
                  resetKey={`${patient?.id ?? "create"}-${form.patient_id_type || "national_id"}`}
                  required={isNationalId}
                  nationalIdSelected={isNationalId}
                  manualAge={form.manual_age ?? ""}
                  onAgeChange={handleChange}
                  value={form.date_of_birth}
                  variant="mobile"
                  nicAutofill={isDobLockedFromNic ? nicParsed : null}
                  onChange={(isoDate) =>
                    setForm((current) => ({ ...current, date_of_birth: isoDate }))
                  }
                />
                <label className="block">
                  <span className={MOBILE_FIELD_LABEL}>Gender *</span>
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
                    <span className={MOBILE_FIELD_LABEL}>Assigned doctor (optional)</span>
                    <select
                      name="assigned_doctor_id"
                      value={form.assigned_doctor_id}
                      onChange={handleChange}
                      className={MOBILE_INPUT}
                    >
                      <option value="">Assign later</option>
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
                  <span className={MOBILE_FIELD_LABEL}>Patient contact number *</span>
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
                  <span className={MOBILE_FIELD_LABEL}>Address *</span>
                  <textarea
                    required
                    rows={2}
                    name="address"
                    autoCapitalize="sentences"
                    onBlur={handleChange}
                    value={form.address}
                    onChange={handleChange}
                    placeholder="Street, area, and locality"
                    className={MOBILE_TEXTAREA}
                  />
                </label>
                <div>
                  <span className={MOBILE_FIELD_LABEL}>Service location and affiliations *</span>
                  <PatientLocationTags
                    tags={form.location_tags}
                    insuranceProvider={form.insurance_provider}
                    insurancePolicyNumber={form.insurance_policy_number}
                    patientNationalId={isNationalId ? form.patient_id_number : ""}
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
            className="intake-footer mt-auto shrink-0 border-t border-slate-100 bg-white px-4 pt-3"
            style={{
              paddingBottom: `max(var(--sab), calc(12px + ${keyboardInset.bottom}px))`,
            }}
          >
            {wizardStep === 1 && !isEditing ? <button type="button" disabled={isSaving} onClick={(event) => void handleSubmit(event, true)} className="mb-2 min-h-11 w-full text-sm text-[#137b80]">Skip for now — save patient</button> : null}
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

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={isEditing ? "Edit patient" : "Add patient"}
      size="xl"
      className="patient-intake-workspace"
      description="Required details first. Clinical history and next of kin are optional."
      innerScroll={false}
    >
      <form ref={formRef} className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
        <div className="shrink-0 space-y-3 rounded-[24px] bg-[#edf8f4] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              OCS care number
            </span>
            <span className="inline-flex items-center rounded-full bg-white px-3 py-1 font-mono text-sm font-medium text-slate-600">
              {careBadgeLabel}
            </span>
          </div>
          <div className="flex items-center gap-1"><PushNotificationBanner compact role={user.role} /><AppUpdateBanner compact /></div>
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
                    ? "bg-[#137b80] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {step.label}{i > 0 ? <span className="ml-1 font-normal">· Optional</span> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="intake-content min-h-0 flex-1 overflow-y-auto px-1 pb-5 pt-4">
          {desktopWizardStep === 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">First name *</span>
                <input
                  ref={firstNameRef}
                  data-modal-initial-focus
                  name="first_name"
                    required
                  autoCapitalize="sentences"
                  onBlur={handleChange}
                  value={form.first_name}
                  onChange={handleChange}
                  placeholder="Enter first name"
                  className={DESKTOP_INPUT}
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Last name *</span>
                <input
                  name="last_name"
                    required
                  autoCapitalize="sentences"
                  onBlur={handleChange}
                  value={form.last_name}
                  onChange={handleChange}
                  placeholder="Enter last name"
                  className={DESKTOP_INPUT}
                />
              </label>

              <PatientNationalIdInput
                idType={form.patient_id_type || "national_id"}
                onTypeChange={handleIdTypeChange}
                required={form.patient_id_type !== "old_age"}
                value={form.patient_id_number}
                variant="desktop"
                onChange={handleDocumentNumberChange}
              />

              <PatientDateOfBirthInput
                key={form.patient_id_type || "national_id"}
                open={open}
                resetKey={`${patient?.id ?? "create"}-${form.patient_id_type || "national_id"}`}
                required={isNationalId}
                nationalIdSelected={isNationalId}
                manualAge={form.manual_age ?? ""}
                onAgeChange={handleChange}
                value={form.date_of_birth}
                variant="desktop"
                nicAutofill={isDobLockedFromNic ? nicParsed : null}
                onChange={(isoDate) =>
                  setForm((current) => ({ ...current, date_of_birth: isoDate }))
                }
              />

              <label className="space-y-2">
                <span className="text-sm font-semibold text-slate-700">Gender *</span>
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

              {canSelectAssignedDoctor ? (
                <label className="space-y-2 md:col-span-2">
                  <span className="text-sm font-semibold text-slate-700">Assigned doctor (optional)</span>
                  <select
                    name="assigned_doctor_id"
                    value={form.assigned_doctor_id}
                    onChange={handleChange}
                    className={DESKTOP_INPUT}
                  >
                    <option value="">Assign later</option>
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
                  Patient contact number *
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
                  <span className="text-sm font-semibold text-slate-700">Address *</span>
                  <textarea
                    required
                    rows={2}
                    name="address"
                    autoCapitalize="sentences"
                    onBlur={handleChange}
                    value={form.address}
                    onChange={handleChange}
                    className={DESKTOP_TEXTAREA}
                  />
                </label>

                <div className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">
                    Service location and affiliations *
                  </span>
                  <PatientLocationTags
                    tags={form.location_tags}
                    insuranceProvider={form.insurance_provider}
                    insurancePolicyNumber={form.insurance_policy_number}
                    patientNationalId={isNationalId ? form.patient_id_number : ""}
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

        {desktopWizardStep === 1 && !isEditing ? <button type="button" disabled={isSaving} onClick={(event) => void handleSubmit(event, true)} className="min-h-11 shrink-0 text-sm text-[#137b80]">Skip for now — save patient</button> : null}
        <div className="intake-footer flex w-full shrink-0 flex-wrap items-center justify-end gap-3 border-t border-gray-200 bg-white p-3">
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
              className="intake-next rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-700"
            >
              {desktopWizardStep === 0 ? "Next: Clinical history" : "Next: Next of kin"}
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSaving}
              className="intake-next rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-600/20 transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
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
