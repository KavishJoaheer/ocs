# OCS teleconsultation and operator-led onboarding

Operators create or find the patient in VP. The compact **Send OCS Care link** action in the patient profile opens an on-demand dialog; the invitation form is hidden during normal profile viewing. Choose **Patient records** for general Care access, or **Teleconsultation** to also record hotline screening. Both require identity and personal-mobile confirmation; the teleconsultation option also requires the screening checkbox. Create the personal invitation and copy it into the confirmed patient's WhatsApp conversation. Closing the dialog clears its local invitation and confirmations. No WhatsApp message or call is sent automatically.

The patient follows the link and presses **Continue to OCS Care**. No email address or password is required for an invited account. The normal dashboard contains **Request a teleconsultation**. The patient supplies the reason, current location and confirmed callback number, reads the terms and limitations, and accepts both the terms and clinical consent. A six-digit consultation code is then visible to the patient and operator.

The VP **Teleconsultations** queue lets dispatch assign an active doctor. The assigned doctor contacts the patient using WhatsApp, confirms identity, location, privacy, consent and suitability, and verifies the appointment code. The doctor saves an internal clinical note, patient-facing assessment, optional prescription text, care summary and follow-up instructions. Completion creates the existing consultation and billing records; patients access the summary and prescription through Care. Internal clinical notes are not included in the teleconsultation patient response. A separate referral/cancellation action records a patient-facing reason and the next responsible person.

## Configuration

Production invitations default to the established Care origin, `https://ocsvp.com`, including on existing NAS deployments without a `PATIENT_PORTAL_ORIGIN` setting. Both Compose files also supply this default. Set `PATIENT_PORTAL_ORIGIN` explicitly only if the public Care domain differs. An override must be an HTTPS origin without a path, credentials, query or fragment. The resolver never uses the staff portal's `CLIENT_ORIGIN` or request headers. Development defaults to `http://localhost:5174`. The patient portal and API must use the existing credentialed cookie arrangement.

Review the versioned patient terms in `server/src/lib/teleconsultations.js` with the OCS clinical lead before offering the service. They disclose WhatsApp, remote-assessment limitations, emergency exclusions, connection failure, patient choice and fee confirmation. They do not set a new fee or guarantee a response time. Existing billing creates a fee-review-required bill unless an existing consultation category is explicitly supplied. The workflow does not add call recording or ID-image storage.

## Access controls and lifecycle

- Magic links expire 10 minutes after issuance and are single-use. Replacement invalidates earlier unused invitations. Expiry does not end an authenticated session or consultation.
- Tokens are 32 random bytes; only their hashes are stored. URL fragments keep raw tokens out of HTTP request URLs. Care removes the fragment from browser history and consumes the token only on the patient's explicit action, not a preview GET.
- Redeeming the link creates a normal HttpOnly cookie session. Invited accounts have null email/password fields; no default passwords or invented addresses are created. Existing email/password accounts remain supported.
- Invitations require identity and mobile confirmation. Pending ownership, inactive accounts, conflicting account/mobile associations, dependents, changed mobile numbers and disabled issuers cannot bypass checks. A new account is created only on successful redemption.
- Staff may record teleconsultation screening while creating the invitation. Patient requests require screening within the last 24 hours on the same confirmed mobile. Dependent consultations remain a hotline-assisted process.
- Consent version, full wording and acceptance time are stored per request. No active request or consultation code is created before acceptance. One active request per patient is enforced in the database.
- Doctors see only their assigned queue. Starting a consultation requires the appointment code and confirmed clinical checks; five incorrect attempts block further starts until dispatch reviews/reassigns the case. Clinical completion is restricted to the assigned doctor or administrator.
- Completion, cancellation and referral remove the code from API responses. Prescription and patient-summary content is separate from the internal clinical note.
- Purging patients removes invitation and teleconsultation data. Merging patients revokes invitations and clears screening; merging two active teleconsultations is blocked until one is resolved.

## Verification

`server/tests/teleconsultations.test.js` covers onboarding, token hashing/expiry/replay/replacement, account ownership, role restrictions, consent, code verification, referral and record visibility, plus migration preservation of sessions and foreign keys. `e2e/teleconsultation.spec.js` walks through the actual operator, mobile patient and doctor screens using isolated test data.
